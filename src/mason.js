/* ============================================================================
 *  mason.js  ——  方框图 → 信号流图 → 梅森公式
 *
 *  作用：把当前方框图自动转换成信号流图，列出
 *        前向通路 Pk、回路 Lk、互不接触回路组合、Δ 与 Δk，
 *        最后给出总传递函数 —— 可以用来核对手工化简的结果。
 * ==========================================================================*/
window.BDS = window.BDS || {};

(function (BDS) {
  'use strict';

  var M = BDS.model;
  var E = M.expr;
  var RT = BDS.rat;

  function ratOfBlock(b) {
    if (!b) return RT.rConst(1);
    if (!b.rat) b.rat = RT.parse(b.label || '1');
    return b.rat;
  }

  /* ------------------------- 符号多项式小工具 ------------------------- */

  /** 连乘：'-1' 视为负号；'1' 直接跳过 */
  function prod(gains) {
    var pos = [], neg = 0;
    gains.forEach(function (g) {
      if (g === '-1') neg++;
      else if (g !== '1' && g !== '' && g != null) pos.push(g);
    });
    var s = pos.length ? pos.reduce(function (a, b) { return E.mul(a, b); }, '1') : '1';
    if (neg % 2 === 1) s = E.neg(s);
    return s;
  }

  /* --------------------------- 方框图转信号流图 --------------------------- */

  function toSignalFlow(d) {
    var nodes = {};      // name -> {name, cn}
    var branches = [];   // {from, to, gain}

    function nameOf(blockId) {
      var b = M.block(d, blockId);
      if (!b) return '?';
      if (b.type === 'input') return b.label || 'R(s)';
      if (b.type === 'output') return b.label || 'C(s)';
      if (b.type === 'gain') return (b.label || 'G') + ' 的输出';
      if (b.type === 'sum') return '相加点输出';
      return '节点';
    }

    function addNode(name, cn) {
      if (!nodes[name]) nodes[name] = { name: name, cn: cn || name };
    }

    // 1) 每个环节自身产生一条「增益支路」
    d.blocks.forEach(function (b) {
      if (b.type !== 'gain') return;
      var ins = M.inEdges(d, b.id);
      var from;
      if (ins.length === 0) {
        from = 'IN:' + b.id;
        addNode(from, (b.label || 'G') + ' 的输入');
      } else {
        from = BDS.engine.outSignal(d, ins[0].from);
        addNode(from, nameOf(ins[0].from));
      }
      var to = 'S:' + b.id;
      addNode(to, nameOf(b.id));
      branches.push({ from: from, to: to, gain: b.label || '1', rat: ratOfBlock(b) });
    });

    // 2) 其余连线
    d.edges.forEach(function (e) {
      var F = M.block(d, e.from), G = M.block(d, e.to);
      if (!F || !G) return;
      var from = BDS.engine.outSignal(d, e.from);
      addNode(from, nameOf(e.from));

      if (G.type === 'gain') return;                  // 已由环节支路处理
      if (G.type === 'takeoff') return;               // 引出点不产生新信号
      if (G.type === 'input') return;

      var to = 'S:' + G.id;
      addNode(to, nameOf(G.id));
      var gain = G.type === 'sum' ? (e.sign === '-' ? '-1' : '1') : '1';
      branches.push({ from: from, to: to, gain: gain, rat: RT.rConst(gain === '-1' ? -1 : 1) });
    });

    // 3) 找出源和汇
    var inputs = d.blocks.filter(function (b) { return b.type === 'input'; });
    var outputs = d.blocks.filter(function (b) { return b.type === 'output'; });
    var src = inputs.length === 1 ? BDS.engine.outSignal(d, inputs[0].id) : null;
    var dst = outputs.length === 1 ? 'S:' + outputs[0].id : null;

    return { nodes: nodes, branches: branches, src: src, dst: dst };
  }

  /* ------------------------------ 图算法 ------------------------------ */

  function adj(branches) {
    var m = {};
    branches.forEach(function (b) {
      (m[b.from] = m[b.from] || []).push(b);
    });
    return m;
  }

  /** 所有从 src 到 dst 的简单通路 */
  function findPaths(sfg) {
    var A = adj(sfg.branches);
    var out = [];
    var guard = 0;

    function dfs(cur, nodesSeen, gains, edgeList, rats) {
      if (guard++ > 20000) return;
      if (out.length > 40) return;
      if (cur === sfg.dst) {
        out.push({
          nodes: nodesSeen.slice(), gains: gains.slice(),
          rats: rats.slice(), edges: edgeList.slice()
        });
        return;
      }
      var list = A[cur] || [];
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (nodesSeen.indexOf(e.to) >= 0) continue;
        nodesSeen.push(e.to);
        gains.push(e.gain);
        rats.push(e.rat);
        edgeList.push(e);
        dfs(e.to, nodesSeen, gains, edgeList, rats);
        edgeList.pop();
        rats.pop();
        gains.pop();
        nodesSeen.pop();
      }
    }
    if (sfg.src && sfg.dst) {
      dfs(sfg.src, [sfg.src], [], [], []);
    }
    return out;
  }

  /** 所有简单回路 */
  function findLoops(sfg) {
    var A = adj(sfg.branches);
    var names = Object.keys(sfg.nodes);
    var seen = {};
    var out = [];
    var guard = 0;

    names.forEach(function (start) {
      (function dfs(cur, path, gains, rats) {
        if (guard++ > 20000) return;
        var list = A[cur] || [];
        for (var i = 0; i < list.length; i++) {
          var e = list[i];
          if (e.to === start && path.length > 0) {
            var nodes = path.slice();
            var allGains = gains.concat([e.gain]);
            var key = nodes.slice().sort().join('|') + '#' +
                      allGains.map(String).sort().join(',');
            if (!seen[key]) {
              seen[key] = 1;
              out.push({ nodes: nodes, gains: allGains, rats: rats.concat([e.rat]) });
            }
            continue;
          }
          if (path.indexOf(e.to) >= 0) continue;
          path.push(e.to);
          gains.push(e.gain);
          rats.push(e.rat);
          dfs(e.to, path, gains, rats);
          rats.pop();
          gains.pop();
          path.pop();
        }
      })(start, [start], [], []);
    });
    return out;
  }

  function touches(loop, pathNodes) {
    for (var i = 0; i < loop.nodes.length; i++) {
      if (pathNodes.indexOf(loop.nodes[i]) >= 0) return true;
    }
    return false;
  }

  function loopsTouch(a, b) {
    for (var i = 0; i < a.nodes.length; i++) {
      if (b.nodes.indexOf(a.nodes[i]) >= 0) return true;
    }
    return false;
  }

  /** 枚举互不接触的回路组合，按阶数分组 */
  function nonTouchingSets(loops) {
    var byOrder = { 0: [[]] };   // 0 阶 = 空集
    var result = [];
    var maxOrder = Math.min(loops.length, 4);

    function rec(start, chosen) {
      if (chosen.length > 0) result.push(chosen.slice());
      if (chosen.length >= maxOrder) return;
      for (var i = start; i < loops.length; i++) {
        var ok = true;
        for (var j = 0; j < chosen.length; j++) {
          if (loopsTouch(chosen[j], loops[i])) { ok = false; break; }
        }
        if (!ok) continue;
        chosen.push(loops[i]);
        rec(i + 1, chosen);
        chosen.pop();
      }
    }
    rec(0, []);

    // 按阶数分组
    var groups = {};
    result.forEach(function (set) {
      (groups[set.length] = groups[set.length] || []).push(set);
    });
    byOrder = groups;
    return { sets: result, groups: groups };
  }

  /** 由一组互不接触回路构成 Δ 表达式（这里是「若干组」） */
  function deltaFromGroups(groups) {
    var maxOrder = 0;
    Object.keys(groups).forEach(function (k) { maxOrder = Math.max(maxOrder, parseInt(k, 10)); });

    var out = '1';
    for (var k = 1; k <= maxOrder; k++) {
      var g = groups[k] || [];
      if (!g.length) continue;

      var terms = g.map(function (set) {
        var factors = [];
        set.forEach(function (L) { factors = factors.concat(L.gains); });
        return prod(factors);
      });
      // 合并同类项（简单去重）
      var uniq = [];
      terms.forEach(function (t) { if (uniq.indexOf(t) < 0) uniq.push(t); });

      uniq.forEach(function (t) {
        var neg = t.charAt(0) === '-';
        var mag = neg ? t.slice(1) : t;
        // Δ 中第 k 阶整体带 (-1)^k 的符号
        var showMinus = (k % 2 === 1) !== neg;
        out += ' ' + (showMinus ? '-' : '+') + ' ' + mag;
      });
    }
    return out;
  }

  /** Δk：只保留与第 k 条前向通路不接触的回路 */
  function deltaForPath(loops, pathNodes) {
    var free = loops.filter(function (L) { return !touches(L, pathNodes); });
    if (!free.length) return { expr: '1', loops: [] };
    var nt = nonTouchingSets(free);
    return { expr: deltaFromGroups(nt.groups), loops: free };
  }

  /* ------------------------------ 主分析 ------------------------------ */

  function analyze(d) {
    var sfg = toSignalFlow(d);

    if (!sfg.src || !sfg.dst) {
      return {
        ok: false,
        error: '信号流图需要恰好一个输入块和一个输出块，请先在画布上放置「输入」和「输出」元件。',
        sfg: sfg
      };
    }

    var edges = sfg.branches.map(function (b) {
      return { from: b.from, to: b.to, gain: b.gain };
    });

    var paths = findPaths(sfg);
    var loops = findLoops(sfg).map(function (L) {
      var r = RT.rConst(1);
      L.rats.forEach(function (x) { r = RT.rMul(r, x); });
      return { nodes: L.nodes, gains: L.gains, gain: prod(L.gains), rat: r };
    });

    // 回路去重（同一个回路可能从不同起点被枚举多次）
    var uniq = [], seen = {}, seenNodes = {};
    loops.forEach(function (L) {
      var key = L.nodes.slice().sort().join('|') + '#' +
                L.gains.map(String).sort().join(',');
      if (!seen[key]) { seen[key] = 1; uniq.push(L); }
    });
    loops = uniq;

    var nt = nonTouchingSets(loops);
    var delta = deltaFromGroups(nt.groups);

    var terms = paths.map(function (p, i) {
      var P = prod(p.gains);
      var dk = deltaForPath(loops, p.nodes);
      return {
        index: i + 1,
        nodes: p.nodes,
        rats: p.rats,
        P: P,
        deltaK: dk.expr,
        term: E.isOne(P) ? dk.expr : (E.isOne(dk.expr) ? P : P + '·' + E.wrap(dk.expr))
      };
    });

    var numerator = terms.length
      ? terms.map(function (t) { return t.term; }).join(' + ')
      : '0';

    // 组装最终结果（Δ = 1 时不必写分母）
    var result;
    if (!terms.length) {
      result = '0';
    } else {
      var numTxt = terms.length > 1 ? '(' + numerator + ')' : numerator;
      result = delta === '1' ? numTxt : numTxt + ' / (' + delta + ')';
    }

    /* ---------------- 展开式：用符号有理函数再算一遍 ---------------- */

    function groupsToRat(groups) {
      var total = RT.rConst(1);
      Object.keys(groups).forEach(function (k) {
        var order = parseInt(k, 10);
        groups[k].forEach(function (set) {
          var term = RT.rConst(1);
          set.forEach(function (L) { term = RT.rMul(term, L.rat); });
          total = RT.rAdd(total, term, order % 2 === 1 ? -1 : 1);
        });
      });
      return total;
    }

    var expanded = null;
    try {
      var deltaRat = groupsToRat(nt.groups);
      var sumRat = RT.rConst(0);
      terms.forEach(function (p) {
        var pRat = RT.rConst(1);
        p.rats.forEach(function (x) { pRat = RT.rMul(pRat, x); });
        var freeLoops = loops.filter(function (L) { return !touches(L, p.nodes); });
        var dkRat = groupsToRat(nonTouchingSets(freeLoops).groups);
        sumRat = RT.rAdd(sumRat, RT.rMul(pRat, dkRat), 1);
      });
      var resultRat = RT.rDiv(sumRat, deltaRat);
      var parts = RT.rParts(resultRat);
      expanded = {
        numerator: parts.numerator,
        denominator: parts.denominator,
        compact: parts.compact,
        rat: resultRat
      };
    } catch (err) {
      expanded = null;
    }

    return {
      ok: true,
      sfg: sfg,
      edges: edges,
      paths: terms,
      loops: loops,
      nonTouching: nt.sets,
      delta: delta,
      numerator: numerator,
      result: result,
      expanded: expanded,
      nodeCount: Object.keys(sfg.nodes).length,
      branchCount: sfg.branches.length
    };
  }

  BDS.mason = { analyze: analyze, toSignalFlow: toSignalFlow };

})(window.BDS);
