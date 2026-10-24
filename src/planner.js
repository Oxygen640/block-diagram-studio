/* ============================================================================
 *  planner.js  ——  化简路线规划：从当前图搜到"最简形式"的最短操作序列
 *
 *  用途：
 *    · 在「可执行操作」列表里标出推荐步骤
 *    · 一键给出完整化简路线
 *
 *  算法：广度优先搜索（BFS）
 *    · 状态 = 当前方框图（只算结构，不算坐标）
 *    · 走一步 = 执行一个可执行操作
 *    · 目标 = 化到只剩一个环节（没有任何可做的操作）
 *
 *  广度优先天然给出"最少步数"，而且搜索过程中每个状态的层号会被记下来，
 *  于是"当前这一步是不是走在最短路线"只需要查一次表，不用再从头搜一遍。
 *
 *  两条硬约束：
 *    · 候选操作先过一遍**数值守门人**（verify.js），把会改变传递函数的操作剔掉；
 *    · 状态用「颜色精化」算结构指纹（忽略坐标和 id），
 *      "移过去再移回来"这类绕圈子的状态会被识别出来，不会无限展开。
 * ==========================================================================*/
window.BDS = window.BDS || {};

(function (BDS) {
  'use strict';

  var M = BDS.model, EN = BDS.engine;

  var COMBINE = { series: 1, parallel: 1, feedback: 1 };
  var KIND_CN = {
    series: '串联', parallel: '并联', feedback: '反馈',
    sumBack: '相加点后移', sumFwd: '相加点前移',
    tapBack: '引出点后移', tapFwd: '引出点前移',
    swapSum: '交换相加点', swapTap: '交换引出点'
  };

  /* ------------------------------ 工具 ------------------------------ */

  /** 结构克隆（比 JSON 往返快很多；rat 对象只读，可以共享） */
  function fastClone(d) {
    var blocks = new Array(d.blocks.length);
    for (var i = 0; i < d.blocks.length; i++) {
      var b = d.blocks[i];
      blocks[i] = {
        id: b.id, type: b.type, label: b.label,
        x: b.x, y: b.y, w: b.w, h: b.h, rat: b.rat
      };
    }
    var edges = new Array(d.edges.length);
    for (var j = 0; j < d.edges.length; j++) {
      var e = d.edges[j];
      edges[j] = {
        id: e.id, from: e.from, to: e.to, sign: e.sign,
        fromSide: e.fromSide, toSide: e.toSide, route: null
      };
    }
    return { blocks: blocks, edges: edges };
  }

  /**
   * 结构指纹：颜色精化，忽略坐标与 id。
   * 同一张"结构上等价"的图会得到相同的串。
   */
  function canonical(d) {
    var idx = {};
    var i, j;
    for (i = 0; i < d.blocks.length; i++) {
      var b = d.blocks[i];
      idx[b.id] = b.type + '~' + (b.label || '');
    }
    // 邻接表
    var insOf = {}, outsOf = {};
    for (i = 0; i < d.blocks.length; i++) { insOf[d.blocks[i].id] = []; outsOf[d.blocks[i].id] = []; }
    for (j = 0; j < d.edges.length; j++) {
      var e = d.edges[j];
      if (outsOf[e.from]) outsOf[e.from].push(e.to + (e.sign || '+'));
      if (insOf[e.to]) insOf[e.to].push(e.from + (e.sign || '+'));
    }

    for (var round = 0; round < 3; round++) {
      var next = {}, sigs = [];
      for (i = 0; i < d.blocks.length; i++) {
        var id = d.blocks[i].id;
        var a = insOf[id].map(function (x) { return idx[x.replace(/[+-]$/, '')] + x.slice(-1); }).sort().join(',');
        var c = outsOf[id].map(function (x) { return idx[x]; }).sort().join(',');
        next[id] = idx[id] + '|' + a + '|' + c;
        sigs.push(next[id]);
      }
      sigs.sort();
      var code = {}, k = 0;
      for (i = 0; i < sigs.length; i++) if (code[sigs[i]] === undefined) code[sigs[i]] = '#' + (k++);
      for (i = 0; i < d.blocks.length; i++) idx[d.blocks[i].id] = code[next[d.blocks[i].id]];
    }

    var bs = d.blocks.map(function (b) { return idx[b.id]; }).sort();
    var es = d.edges.map(function (e) { return idx[e.from] + '>' + idx[e.to] + (e.sign || '+'); }).sort();
    return bs.join(',') + '|' + es.join(',');
  }

  /** 是否已经化到最简：只剩一个环节，没有相加点/引出点 */
  function isSolved(d) {
    var gains = 0;
    for (var i = 0; i < d.blocks.length; i++) {
      var t = d.blocks[i].type;
      if (t === 'gain') gains++;
      else if (t === 'sum' || t === 'takeoff') return false;
    }
    return gains === 1;
  }

  function sortOps(ops) {
    return ops.slice().sort(function (a, b) {
      var ca = COMBINE[a.kind] ? 0 : 1, cb = COMBINE[b.kind] ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return 0;   // 同类保持原顺序（引擎给出的顺序本身就有讲究）
    });
  }

  /**
   * 当前图上"真正可用"的操作。
   *
   * 关键一步：先用数值守门人把**改变传递函数**的操作全部剔除。
   * 框图化简的每条基本变换都有适用条件，条件不满足时硬套公式，
   * 图看着像对的，传递函数早就变了。规划器要是把这种操作算进路线，
   * 就会推荐一条"越化越错"的路 —— 必须在这里拦死。
   */
  function legalOps(d) {
    var ops = EN.scanAll(d);
    var V = BDS.verify;
    if (!V || !V.refOf) return ops;
    return V.filterOps(d, ops);
  }

  /* --------------------------- 步骤代价 --------------------------- */

  /*
   *  为什么不是"步数最少"就完了？
   *
   *  对同一道题，"5 步"的走法往往有好几条：有的全靠串联/并联/反馈一路合并，
   *  有的却要先把引出点搬来搬去。后者虽然步数一样，但会把传递函数写成
   *  一堆 1/G2、1/G3 的分式方块，学生照着做只会更糊涂。
   *
   *  所以这里给每类操作标一个"代价"：能合并的便宜，搬方块贵，
   *  搬完还引入分式方块的最贵。搜索按总代价排序，
   *  于是"步数一样"的那些走法里，会优先挑出干净的那一条。
   */
  var KIND_COST = {
    series: 10, parallel: 10, feedback: 10,     // 合并：最省事
    sumMerge: 12, tapMerge: 12,                 // 把串在一起的相加点/引出点并掉，几乎无副作用
    swapSum: 22, swapTap: 22,                   // 交换相加点/引出点
    sumBack: 26, sumFwd: 26,                    // 搬相加点
    tapBack: 26, tapFwd: 26, virtualTapBack: 26 // 搬引出点
  };
  var FRACTION_COST = 45;                        // 引入 1/G 这类分式方块

  /* 把"步数"和"丑度"拼成一个数比较：步数记在千位，丑度记在千位以下。
     这样"步数少"永远压过"更干净"，符合"先求最短路，再求最好看"。 */
  var UNIT = 1000;

  /** 图里有没有"带除号的方块"（1/G2 这种，属于化简过程中的临时产物） */
  function hasFraction(d) {
    for (var i = 0; i < d.blocks.length; i++) {
      var b = d.blocks[i];
      if (b.type === 'gain' && b.label && b.label.indexOf('/') >= 0) return true;
    }
    return false;
  }

  function stepCost(op, fracBefore, fracAfter) {
    var c = KIND_COST[op.kind] || 30;
    if (fracAfter && !fracBefore) c += FRACTION_COST;
    return c;
  }

  /* ------------------------------ 搜索 ------------------------------ */

  /**
   * 分层搜索：**步数优先，丑度次之**。
   *
   * 直接按"总代价"做最短路会掉进一个坑：为了确认某条 6 步路线最优，
   * 得先把 5 步以内能到达的状态全部展开一遍，状态数会爆掉。
   *
   * 所以这里分两层来做：
   *   · 外层仍然是逐层推进（广度优先），所以第一层出现的解就是最少步数；
   *   · 每一层内部把状态按"丑度"从小到大排队再展开，
   *     于是同一层里冒出来的第一个解，就是同一步数下最干净的那个；
   *   · 再补一条剪枝：当前状态的丑度已经追平已知解时，后面的不用看了。
   *
   * 副产品 best 记录每个状态第一次被搜到的 {层号, 丑度}，
   * 于是"当前这一步走完还剩几步"直接查表就有。
   *
   * 候选操作先过一遍数值守门人（verify.js），把会改变传递函数的操作全部剔除。
   */
  function search(rootDiagram, opts) {
    var s = makeSearch(rootDiagram, opts);
    var r;
    do { r = s.runChunk(Infinity); } while (!r.done);
    return r.result;
  }

  /**
   * 可中断版本：每调一次 runChunk(ms) 就干 ms 毫秒的活然后让出主线程。
   * 界面靠它把大图的搜索切成很多小片，边算边响应，不会卡死。
   */
  function makeSearch(rootDiagram, opts) {
    opts = opts || {};
    var maxSteps = opts.maxSteps || 9;
    var cap = opts.frontierCap === undefined ? 400 : opts.frontierCap;
    var stateBudget = opts.stateBudget || 120000;
    var msBudget = opts.msBudget || 6000;
    var t0 = Date.now();
    var MIN_STEP_COST = 10;

    var best = {};                                  // 结构指纹 -> {steps, ugly, cost}
    var rootKey = canonical(rootDiagram);
    best[rootKey] = { steps: 0, ugly: 0, cost: 0 };

    var frontier = [{
      d: fastClone(rootDiagram), path: [], key: rootKey,
      ugly: 0, frac: hasFraction(rootDiagram)
    }];
    var expanded = 0, truncated = false;
    var level = 0, idx = 0, next = [], solved = null, done = false;
    var result = null;

    function finish() {
      done = true;
      result = solved
        ? { path: solved.path, cost: solved.cost, steps: level,
            best: best, expanded: expanded, truncated: false }
        : { path: null, cost: -1, steps: -1, best: best, expanded: expanded, truncated: truncated };
      return result;
    }

    function startLevel(L) {
      level = L;
      idx = 0;
      next = [];
      solved = null;
      frontier.sort(function (a, b) { return a.ugly - b.ugly; });
    }

    /** 把当前这层交给上层继续展开 */
    function closeLevel() {
      if (solved) return finish();
      if (cap > 0 && next.length > cap) {
        /*
         * 每层只留一部分"最有希望"的状态继续往下走。
         * 判据：方块越少越接近终点；方块一样多时，挑这一步最干净的（丑度小）。
         * 不设这个上限的话，第 4、5 层会膨胀到上万状态，
         * 而其中绝大多数是"把方块搬来搬去"的死路。
         */
        next.sort(function (a, b) {
          var da = a.d.blocks.length - b.d.blocks.length;
          if (da) return da;
          return a.ugly - b.ugly;
        });
        next = next.slice(0, cap);
      }
      frontier = next;
      if (!frontier.length || level >= maxSteps) return finish();
      startLevel(level + 1);
      return null;
    }

    function runChunk(ms) {
      if (done) return { done: true, result: result, expanded: expanded };
      var deadline = ms === Infinity ? Infinity : Date.now() + ms;
      if (frontier.length && idx === 0 && level === 0) startLevel(1);

      while (!done) {
        if (Date.now() > deadline) break;
        if (Date.now() - t0 > msBudget || expanded > stateBudget) {
          truncated = true;
          finish();
          break;
        }
        if (idx >= frontier.length) {
          var f = closeLevel();
          if (f) break;
          continue;
        }

        var ent = frontier[idx++];
        // 后面的状态丑度只会更大，而任何一步至少也要 MIN_STEP_COST，
        // 所以再也追不上已知解了，可以提前收工
        if (solved && ent.ugly + MIN_STEP_COST >= solved.ugly) { finish(); break; }

        var ops = sortOps(legalOps(ent.d));
        for (var j = 0; j < ops.length; j++) {
          var nd = fastClone(ent.d);
          if (!ops[j].run(nd)) continue;
          expanded++;

          var nk = canonical(nd);
          if (best[nk]) continue;                    // 更少的步数或更干净的路已经到过
          var nf = hasFraction(nd);
          var nu = ent.ugly + stepCost(ops[j], ent.frac, nf);
          var np = ent.path.concat([{ kind: ops[j].kind, title: ops[j].title, desc: '' }]);
          best[nk] = { steps: level, ugly: nu, cost: level * UNIT + nu };

          if (isSolved(nd)) {
            if (!solved || nu < solved.ugly) solved = { path: np, ugly: nu, cost: level * UNIT + nu };
            continue;
          }
          next.push({ d: nd, path: np, key: nk, ugly: nu, frac: nf });
        }
      }

      return { done: done, result: result, expanded: expanded, level: level };
    }

    return { runChunk: runChunk, best: best };
  }

  /* ------------------------------ 主搜索 ------------------------------ */

  /**
   * 从某个状态出发、限定步数，最多还要几步才能化到最简。
   *
   * 逐层推进，所以第一次碰到解时的层号就是最少剩余步数。
   * 给一个时间预算：超时返回 null，表示"至少不比这个数少，但没算完"。
   */
  function restSteps(d, maxSteps, deadline) {
    if (isSolved(d)) return 0;
    var seen = {};
    var frontier = [fastClone(d)];
    seen[canonical(d)] = 1;

    for (var level = 1; level <= maxSteps; level++) {
      var next = [];
      for (var i = 0; i < frontier.length; i++) {
        if (Date.now() > deadline) return null;
        var ops = legalOps(frontier[i]);
        for (var j = 0; j < ops.length; j++) {
          var nd = fastClone(frontier[i]);
          if (!ops[j].run(nd)) continue;
          var k = canonical(nd);
          if (seen[k]) continue;
          seen[k] = 1;
          if (isSolved(nd)) return level;
          next.push(nd);
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return null;                     // 预算内没走通
  }

  /**
   * 从当前图出发，找一条到最简形式的路线，并标出"当前这一步怎么走最好"。
   * @returns {object} {
   *    solvable : 是否可达最简,
   *    steps    : 最优路线的步数（不可达时为 -1）,
   *    cost     : 最优路线的"丑度"（越小越干净）,
   *    path     : [{kind, title, desc}] 每一步,
   *    recommend: 推荐操作的下标数组（★）,
   *    ops      : 当前可用操作（已过滤掉会改变传递函数的）,
   *    annotated: [{op, remaining, remainingKnown}] remaining = 走完这一步后还需几步,
   *    reason   : 说明文字
   * }
   */
  function analyze(d, opts) {
    opts = opts || {};
    var msBudget = opts.msBudget || 6000;
    var t0 = Date.now();

    var ops0 = legalOps(d);
    var solved0 = isSolved(d);

    if (solved0 || !ops0.length) {
      return {
        solvable: solved0, steps: 0, cost: 0, path: [], recommend: [], ops: ops0,
        annotated: ops0.map(function (op) { return { op: op, remaining: 0, remainingKnown: true }; }),
        truncated: false,
        ms: Date.now() - t0,
        reason: solved0 ? '已经是最简形式' : '当前状态没有可执行的化简操作'
      };
    }

    // 第一步：搜出最优路线（步数优先，同一步数下挑最干净的）
    var res = search(d, {
      maxSteps: opts.maxSteps,
      frontierCap: opts.frontierCap,
      msBudget: msBudget,
      stateBudget: opts.stateBudget
    });
    var bestPath = res.path;
    var bestSteps = res.steps;
    var frac0 = hasFraction(d);

    // 第二步：逐条看"这一步走完，还要几步"
    //   剩下的时间平均分给每条操作，教案大小的图都能算准；
    //   图很大时可能算不完，那就只标"比推荐路线长"，不瞎猜数字。
    var perOp = Math.max(60, Math.min(900, Math.round(
      (opts.perOpMs || 2000) / Math.max(1, ops0.length)
    )));
    var limit = bestSteps > 0 ? bestSteps - 1 : (opts.maxSteps || 9) - 1;

    var annotated = ops0.map(function (op) {
      var one = fastClone(d);
      if (!op.run(one)) {
        return { op: op, remaining: null, remainingKnown: false, step: KIND_COST[op.kind] || 30 };
      }
      var c0 = stepCost(op, frac0, hasFraction(one));
      if (isSolved(one)) return { op: op, remaining: 0, remainingKnown: true, step: c0 };
      var r = restSteps(one, Math.max(0, limit), Date.now() + perOp);
      return { op: op, remaining: r, remainingKnown: r !== null, step: c0 };
    });

    /*
     * 推荐规则：
     *   1. 先看"走完它还剩几步"，剩余步数最少的那些，就是走在最短路线上；
     *   2. 剩余步数算不出来的（预算不够），只有当它这一步明显更干净时才补进候选；
     *   3. 最后把已经搜出来的最优路线的第一步兜进来，保证一定有 ★。
     */
    var minRemain = Infinity;
    annotated.forEach(function (a) {
      if (a.remaining !== null && a.remaining < minRemain) minRemain = a.remaining;
    });

    var recommend = [];
    if (isFinite(minRemain)) {
      var minStep = Infinity;
      annotated.forEach(function (a) {
        if (a.remaining === minRemain && a.step < minStep) minStep = a.step;
      });
      annotated.forEach(function (a, i) {
        if (a.remaining === minRemain && a.step === minStep) recommend.push(i);
      });
    }
    if (!recommend.length && bestPath && bestPath.length) {
      annotated.forEach(function (a, i) {
        if (a.op.kind === bestPath[0].kind && a.op.title === bestPath[0].title) {
          recommend.push(i);
          // 这条操作就在搜出来的最优路线上，剩余步数是确定的
          a.remaining = bestSteps - 1;
          a.remainingKnown = true;
        }
      });
    }

    return {
      solvable: !!bestPath,
      steps: bestPath ? bestPath.length : -1,
      cost: bestPath ? res.cost - bestPath.length * UNIT : -1,
      path: bestPath || [],
      recommend: recommend,
      ops: ops0,
      annotated: annotated,
      truncated: !!res.truncated,
      reason: bestPath
        ? ('最短 ' + bestPath.length + ' 步可以化到最简')
        : (res.truncated
            ? '搜索超时，暂时算不出完整路线'
            : '在当前操作范围内找不到化简到底的路线'),
      ms: Date.now() - t0
    };
  }

  BDS.planner = {
    analyze: analyze,
    search: search,
    makeSearch: makeSearch,
    restSteps: restSteps,
    legalOps: legalOps,
    hasFraction: hasFraction,
    stepCost: stepCost,
    canonical: canonical,
    isSolved: isSolved,
    KIND_CN: KIND_CN
  };

})(window.BDS);
