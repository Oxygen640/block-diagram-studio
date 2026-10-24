/* ============================================================================
 *  engine.js  ——  化简操作引擎
 *
 *  全部操作都以「符号」推导，输出接近教材手写过程：
 *     串联  G1 × G2   -> G1G2
 *     并联  G1 + G2
 *     反馈  G/(1 + GH)
 *     相加点后移  -> 支路乘 G
 *     相加点前移  -> 支路乘 1/G
 *     引出点后移  -> 支路乘 1/G
 *     引出点前移  -> 支路乘 G
 *
 *  每个操作 = { kind, title, desc, run(diagram) -> 步骤说明 }
 *  扫描函数返回当前图上「所有可执行的操作」，用户点哪个就执行哪个。
 * ==========================================================================*/
window.BDS = window.BDS || {};

(function (BDS) {
  'use strict';

  var M = BDS.model;
  var E = M.expr;
  var RT = BDS.rat;

  /** 取方块的符号有理式（老图纸可能没有，现补） */
  function ratOf(b) {
    if (!b) return RT.rConst(1);
    if (!b.rat) b.rat = RT.parse(b.label || '1');
    return b.rat;
  }

  /** 给方块同时设置名字和符号有理式 */
  function setLabelRat(b, text, rat) {
    b.label = text;
    b.rat = rat;
  }

  /* ------------------------------ 小工具 ------------------------------ */

  function isGain(d, id) { var b = M.block(d, id); return !!b && b.type === 'gain'; }
  function isSum(d, id) { var b = M.block(d, id); return !!b && b.type === 'sum'; }
  function isTap(d, id) { var b = M.block(d, id); return !!b && b.type === 'takeoff'; }
  function lbl(d, id) { var b = M.block(d, id); return b ? (b.label || '1') : '1'; }

  /** 给相加点/引出点起个中文编号，便于写步骤说明 */
  function makeNamer(d) {
    var sumIdx = {}, tapIdx = {}, k1 = 0, k2 = 0;
    d.blocks.forEach(function (b) {
      if (b.type === 'sum') sumIdx[b.id] = ++k1;
      if (b.type === 'takeoff') tapIdx[b.id] = ++k2;
    });
    return function (id) {
      var b = M.block(d, id);
      if (!b) return '?';
      if (b.type === 'sum') return '相加点' + '①②③④⑤⑥⑦⑧⑨'[sumIdx[b.id] - 1];
      if (b.type === 'takeoff') return '引出点' + '①②③④⑤⑥⑦⑧⑨'[tapIdx[b.id] - 1];
      return b.label || M.TYPE_CN[b.type] || b.type;
    };
  }

  /** 取块的输出信号节点名（引出点直接短路到上游） */
  function outSignal(d, id, guard) {
    guard = guard || 0;
    var b = M.block(d, id);
    if (!b) return null;
    if (b.type === 'takeoff' && guard < 20) {
      var ins = M.inEdges(d, b.id);
      if (ins.length === 1) return outSignal(d, ins[0].from, guard + 1);
    }
    return 'S:' + id;
  }

  function midpoint(list) {
    var x = 0, y = 0, n = 0;
    list.forEach(function (p) { x += p.x; y += p.y; n++; });
    return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
  }

  /* ======================================================================
   *  1. 串联化简
   * ==================================================================== */

  function findSeriesAll(d) {
    var ops = [];
    var nm = makeNamer(d);
    d.blocks.forEach(function (A) {
      if (A.type !== 'gain') return;
      var outs = M.outEdges(d, A.id);
      if (outs.length !== 1) return;
      var B = M.block(d, outs[0].to);
      if (!B || B.type !== 'gain') return;
      if (M.inEdges(d, B.id).length !== 1) return;   // B 只能由 A 单独驱动

      ops.push({
        kind: 'series',
        blocker: 'gain',
        blocks: [A.id, B.id],
        edges: [outs[0].id],
        title: '串联化简：' + (A.label || '1') + ' · ' + (B.label || '1'),
        desc: '把 ' + (A.label || '1') + ' 与 ' + (B.label || '1') +
              ' 两个串联环节合并为一个环节，等效传递函数为两者之积。',
        run: function (dd) {
          var a = M.block(dd, A.id), b = M.block(dd, B.id);
          if (!a || !b) return null;
          var la = a.label || '1', lb = b.label || '1';
          var merged = E.mul(la, lb);
          setLabelRat(a, merged, RT.rMul(ratOf(a), ratOf(b)));
          fitLabel(a);
          // 把 b 的输出边改接到 a，再删除 b
          M.outEdges(dd, b.id).forEach(function (e) { e.from = a.id; });
          M.removeBlock(dd, b.id);
          return '串联化简：' + la + ' 与 ' + lb + ' 串联 → 等效为 ' + merged +
                 '（' + la + ' × ' + lb + '）';
        }
      });
    });
    return ops;
  }

  function fitLabel(b) {
    var need = 46 + b.label.length * 8;
    if (need > b.w) b.w = Math.min(need, 240);
  }

  /* ======================================================================
   *  2. 并联合并
   * ==================================================================== */

  /** 把两条并联支路写成表达式：sign1·name1 + sign2·name2 */
  function parExpr(n1, s1, n2, s2) {
    if (s1 === '+') return s2 === '+' ? (n1 + ' + ' + n2) : (n1 + ' − ' + n2);
    return s2 === '+' ? (n2 + ' − ' + n1) : ('−(' + n1 + ' + ' + n2 + ')');
  }

  function findParallelAll(d) {
    var ops = [];
    var nm = makeNamer(d);

    d.blocks.forEach(function (X) {
      var outs = M.outEdges(d, X.id);
      if (outs.length < 2) return;

      // 找出「X -> A -> Y」形态的支路
      var branches = [];
      // 找出「X ---> Y」这种没有环节的直通支路（相当于增益 1）
      var directs = [];
      outs.forEach(function (e) {
        var A = M.block(d, e.to);
        if (!A) return;
        if (A.type === 'sum') {
          // 直通支路：教科书里写成"1"，是很常见的一种并联支路
          directs.push({ e: e, Y: A, sign: e.sign || '+' });
          return;
        }
        if (A.type !== 'gain') return;
        if (M.inEdges(d, A.id).length !== 1) return;
        var ao = M.outEdges(d, A.id);
        if (ao.length !== 1) return;
        var Y = M.block(d, ao[0].to);
        if (!Y || Y.type !== 'sum') return;
        branches.push({ A: A, toY: ao[0], Y: Y });
      });

      // 按汇合点 Y 两两组合
      for (var i = 0; i < branches.length; i++) {
        for (var j = i + 1; j < branches.length; j++) {
          if (branches[i].Y.id !== branches[j].Y.id) continue;
          (function (b1, b2) {
            if (!M.block(d, b1.A.id) || !M.block(d, b2.A.id)) return;
            var n1 = b1.A.label || '1', n2 = b2.A.label || '1';
            var s1 = b1.toY.sign, s2 = b2.toY.sign;
            var expr = parExpr(n1, s1, n2, s2);

            ops.push({
              kind: 'parallel',
              blocks: [X.id, b1.A.id, b2.A.id, b1.Y.id],
              edges: [b1.toY.id, b2.toY.id],
              title: '并联合并：' + expr,
              desc: '把从 ' + nm(X.id) + ' 分出的两条并联支路（' + n1 + ' 与 ' + n2 +
                    '）合并，在相加点 ' + nm(b1.Y.id) + ' 处相加。',
              run: function (dd) {
                var A = M.block(dd, b1.A.id), B = M.block(dd, b2.A.id);
                if (!A || !B) return null;
                var Y = M.block(dd, b1.Y.id);
                if (!Y) return null;
                var ea = M.inEdges(dd, A.id)[0], eb = M.inEdges(dd, B.id)[0];
                var oa = M.outEdges(dd, A.id)[0], ob = M.outEdges(dd, B.id)[0];
                var sA = oa ? oa.sign : '+', sB = ob ? ob.sign : '+';
                var lA = A.label || '1', lB = B.label || '1';
                var ex = parExpr(lA, sA, lB, sB);

                var srcId = ea ? ea.from : null;
                var ratA = sA === '-' ? RT.rNeg(ratOf(A)) : ratOf(A);
                var ratB = sB === '-' ? RT.rNeg(ratOf(B)) : ratOf(B);

                // 删除两条支路及其环节
                M.removeBlock(dd, A.id);
                M.removeBlock(dd, B.id);

                var C = M.addBlock(dd, 'gain', 0, 0, { label: ex });
                C.rat = RT.rAdd(ratA, ratB, 1);
                var pa = M.block(dd, srcId), py = M.block(dd, Y.id);
                if (pa && py) {
                  C.x = Math.round((pa.x + pa.w + py.x) / 2 - C.w / 2);
                  C.y = Math.round(py.y + py.h / 2 - C.h / 2);
                }
                if (srcId) M.connect(dd, srcId, C.id, '+');
                M.connect(dd, C.id, Y.id, '+');
                fitLabel(C);
                return '并联合并：' + lA + ' 与 ' + lB + ' 两条并联支路 → 等效为 ' + ex +
                       '（符号取自相加点 ' + nm(Y.id) + ' 上的 +/−）';
              }
            });
          })(branches[i], branches[j]);
        }
      }

      // 有环节的支路 × 直通支路（直通那一路的增益记作 1）
      branches.forEach(function (b) {
        directs.forEach(function (dir) {
          if (b.Y.id !== dir.Y.id) return;
          var lA = b.A.label || '1', sA = b.toY.sign;
          var sDir = dir.sign;
          var showExpr = parExpr('1', sDir, lA, sA);

          ops.push({
            kind: 'parallel',
            blocks: [X.id, b.A.id, dir.Y.id],
            edges: [b.toY.id, dir.e.id],
            title: '并联合并：' + showExpr,
            desc: '从 ' + nm(X.id) + ' 到相加点 ' + nm(dir.Y.id) + ' 有两条并联支路：' +
                  '一条直接过去（相当于增益 1），另一条经过 ' + lA +
                  '。合并后等效为 ' + showExpr + '。',
            run: function (dd) {
              var A = M.block(dd, b.A.id);
              var Y = M.block(dd, dir.Y.id);
              var eDir = dd.edges.filter(function (x) { return x.id === dir.e.id; })[0];
              if (!A || !Y || !eDir) return null;
              var ea = M.inEdges(dd, A.id)[0];
              var oa = M.outEdges(dd, A.id)[0];
              var sA2 = oa ? oa.sign : '+';
              var lA2 = A.label || '1';
              var sD = eDir.sign || '+';
              var ex2 = parExpr('1', sD, lA2, sA2);

              var srcId = ea ? ea.from : null;
              // 合并后的等效增益 = sD·1 + sA·(A 的增益)，保持符号取反的正确性
              var c1 = sD === '-' ? RT.rConst(-1) : RT.rConst(1);
              var c2 = sA2 === '-' ? RT.rNeg(ratOf(A)) : ratOf(A);

              M.removeBlock(dd, A.id);

              // 新环节直接插在那条直通线上
              var C = M.addBlock(dd, 'gain', 0, 0, { label: ex2 });
              C.rat = RT.rAdd(c1, c2, 1);
              eDir.to = C.id;
              eDir.sign = '+';
              var pa = M.block(dd, srcId), py = M.block(dd, Y.id);
              if (pa && py) {
                C.x = Math.round((pa.x + pa.w + py.x) / 2 - C.w / 2);
                C.y = Math.round(py.y + py.h / 2 - C.h / 2);
              }
              M.connect(dd, C.id, Y.id, '+');
              fitLabel(C);
              return '并联合并：直通支路（1）与 ' + lA2 + ' 两条并联支路 → 等效为 ' + ex2 +
                     '（符号取自相加点 ' + nm(Y.id) + ' 上的 +/−）';
            }
          });
        });
      });
    });
    return ops;
  }

  /* ======================================================================
   *  3. 反馈化简
   * ==================================================================== */

  /** 从 T 出发找一条回到 sumId 的反馈路径。
   *  路径上的节点必须是"链上节点"（只有一个输入、不合并信号），
   *  但**允许有多个输出** —— 只要其中一条能走回 sumId 就行。
   *  这样"反馈支路上还挂着别的分支"的图也能识别出回路。 */
  function findFeedbackPath(d, fromId, sumId) {
    var outs = M.outEdges(d, fromId);
    for (var i = 0; i < outs.length; i++) {
      var r = walkBack(d, outs[i], sumId, 0);
      if (r) {
        return {
          blocks: r.blocks, sign: r.sign,
          startEdge: outs[i].id, closeEdge: r.closeEdge
        };
      }
    }
    return null;
  }

  function walkBack(d, edge, sumId, depth) {
    if (depth > 20) return null;
    if (edge.to === sumId) {
      return { blocks: [], sign: edge.sign || '+', closeEdge: edge.id };
    }
    var cur = M.block(d, edge.to);
    if (!cur) return null;
    if (cur.type !== 'gain' && cur.type !== 'takeoff') return null;
    if (M.inEdges(d, cur.id).length !== 1) return null;
    var outs = M.outEdges(d, cur.id);
    for (var i = 0; i < outs.length; i++) {
      var r = walkBack(d, outs[i], sumId, depth + 1);
      if (r) {
        return { blocks: [cur.id].concat(r.blocks), sign: r.sign, closeEdge: r.closeEdge };
      }
    }
    return null;
  }

  /** 从 sumId 出发解析一个单回路： { forward:[], feedback:[], sign, fbStartEdge, closeEdge, G, H }
   *  前向链里允许出现「引出点」（增益为 1 的直通节点）。 */
  function analyzeLoop(d, sumId) {
    var S = M.block(d, sumId);
    if (!S || S.type !== 'sum') return null;
    var sout = M.outEdges(d, sumId);
    if (sout.length !== 1) return null;

    function chainable(b) {
      return !!b && (b.type === 'gain' || b.type === 'takeoff');
    }

    var forward = [];
    var cur = M.block(d, sout[0].to);
    if (!cur) return null;
    if (M.inEdges(d, cur.id).length !== 1) return null;
    if (!chainable(cur)) return null;
    forward.push(cur.id);

    var guard = 0;
    while (guard++ < 40) {
      var outs = M.outEdges(d, cur.id);
      if (outs.length === 0) return null;
      var directBack = null;
      for (var i = 0; i < outs.length; i++) if (outs[i].to === sumId) { directBack = outs[i]; break; }

      if (outs.length === 1 && !directBack) {
        var nx = M.block(d, outs[0].to);
        if (!chainable(nx)) return null;
        if (M.inEdges(d, nx.id).length !== 1) return null;
        forward.push(nx.id);
        cur = nx;
        continue;
      }

      // cur 是分叉点 T
      var fb = findFeedbackPath(d, cur.id, sumId);
      if (!fb) return null;

      var G = '1';
      forward.forEach(function (id) {
        var bb = M.block(d, id);
        if (bb && bb.type === 'gain') G = E.mul(G, bb.label || '1');
      });
      var H = '1';
      fb.blocks.forEach(function (id) { H = E.mul(H, M.block(d, id).label || '1'); });

      return {
        sum: sumId,
        forward: forward,
        forwardTail: forward[forward.length - 1],
        feedback: fb.blocks,
        sign: fb.sign,
        fbStartEdge: fb.startEdge,
        closeEdge: fb.closeEdge,
        G: G, H: H
      };
    }
    return null;
  }

  function findFeedbackAll(d) {
    var ops = [];
    var nm = makeNamer(d);
    d.blocks.forEach(function (S) {
      if (S.type !== 'sum') return;
      var loop = analyzeLoop(d, S.id);
      if (!loop) return;

      /*
       * 相加点除反馈边外，至少要有一条外部输入，否则化简以后这个方块没有输入。
       *
       * 注意这里**不能**要求"恰好一条"。
       * 反馈公式 G/(1±GH) 只跟回路本身有关，相加点上还有几路别的信号进来
       * 完全不影响它 —— 那些信号只是照常相加。
       * 教材里"多路输入 + 一个回路"的题很常见，卡成一条就永远化不动了。
       */
      var ins = M.inEdges(d, S.id);
      var external = ins.filter(function (e) { return e.id !== loop.closeEdge; });
      if (!external.length) return;
      if (M.block(d, S.id) !== S) return;

      var expr = E.feedback(loop.G, loop.H, loop.sign);
      var fbTxt = loop.feedback.length
        ? loop.feedback.map(function (id) { return lbl(d, id); }).join('·')
        : '1';
      var inName = external.map(function (e) { return nm(e.from); }).join('、');
      var keepSum = external.length > 1;   // 多路输入时相加点要留着，不能删

      ops.push({
        kind: 'feedback',
        blocks: [S.id].concat(loop.forward).concat(loop.feedback),
        edges: [loop.closeEdge].concat(loop.fbStartEdge ? [loop.fbStartEdge] : []),
        // 负反馈（相加点上是减号）→ 分母写成 1 + GH
        title: '反馈化简：' + loop.G + ' / (1 ' + (loop.sign === '-' ? '+' : '−') + ' ' +
               E.mul(loop.G, loop.H) + ')',
        desc: '把 ' + nm(S.id) + ' 所在的回路化简：前向通路 ' + loop.G +
              '，反馈通路 ' + fbTxt + '，反馈极性为' + (loop.sign === '-' ? '负' : '正') + '。' +
              (keepSum
                ? '相加点上还有 ' + external.length + ' 路别的输入（' + inName +
                  '），它们照常相加，不受这个回路影响。'
                : ''),
        run: function (dd) {
          var loop2 = analyzeLoop(dd, S.id);
          if (!loop2) return null;
          var SS = M.block(dd, S.id);
          var ins2 = M.inEdges(dd, S.id);
          var ext = ins2.filter(function (e) { return e.id !== loop2.closeEdge; });
          if (!ext.length) return null;

          var T = M.block(dd, loop2.forwardTail);
          var ex = E.feedback(loop2.G, loop2.H, loop2.sign);

          // 先算好等效有理式（这些方块马上要被删掉）
          var gRat = RT.rConst(1);
          loop2.forward.forEach(function (id) {
            var bb = M.block(dd, id);
            if (bb && bb.type === 'gain') gRat = RT.rMul(gRat, ratOf(bb));
          });
          var hRat = RT.rConst(1);
          loop2.feedback.forEach(function (id) {
            var bb = M.block(dd, id);
            if (bb) hRat = RT.rMul(hRat, ratOf(bb));
          });
          var eqRat = RT.rFeedback(gRat, hRat, loop2.sign);

          // 记录 T 的「继续向下游」的出边
          var touts = M.outEdges(dd, T.id).filter(function (e) { return e.id !== loop2.fbStartEdge; });
          var pos = { x: SS.x, y: SS.y };

          // 相加点「走前向通路」的那条出线，改成指到新块
          var eSF = M.outEdges(dd, S.id).filter(function (e) {
            return e.to === loop2.forward[0];
          })[0];

          var newB = M.addBlock(dd, 'gain', pos.x, pos.y, { label: ex });
          newB.rat = eqRat;
          fitLabel(newB);

          if (ext.length === 1) {
            // 只有一路输入：相加点没什么可加的了，直接并进新块
            ext[0].to = newB.id;
          } else {
            // 多路输入：相加点留着，改由它把各路信号送给新块
            if (eSF) eSF.to = newB.id;
          }

          // 下游边 -> 从新块出发
          touts.forEach(function (e) { e.from = newB.id; });

          // 删除回路内全部块（多路输入时保留相加点）
          loop2.feedback.forEach(function (id) { M.removeBlock(dd, id); });
          loop2.forward.forEach(function (id) { M.removeBlock(dd, id); });
          if (ext.length === 1) M.removeBlock(dd, S.id);

          newB.x = Math.round((pos.x + (T.x + T.w)) / 2 - newB.w / 2);
          newB.y = pos.y;

          var signTxt = loop2.sign === '-' ? '负反馈' : '正反馈';
          var den = (loop2.sign === '-' ? '1 + ' : '1 − ') + E.mul(loop2.G, loop2.H);
          return '反馈化简：' + signTxt + '回路的等效传递函数 = ' + loop2.G + ' / (' + den +
                 ') = ' + ex + '；原回路上的环节已合并为一个方框。';
        }
      });
    });
    return ops;
  }

  /* ======================================================================
   *  4. 相加点移动
   * ==================================================================== */

  function findSumMoveAll(d) {
    var ops = [];

    d.blocks.forEach(function (S) {
      if (S.type !== 'sum') return;
      var ins = M.inEdges(d, S.id);
      if (ins.length < 2) return;
      var outs = M.outEdges(d, S.id);

      /* --- 后移：相加点在 G 之前，把它移到 G 之后，支路乘 G --- */
      if (outs.length === 1) {
        var G = M.block(d, outs[0].to);
        if (G && G.type === 'gain' && M.inEdges(d, G.id).length === 1) {
          // 选一条 '+' 的入边作为直通（它直接接 G）
          var thru = ins.filter(function (e) { return (e.sign || '+') === '+'; })[0];
          if (thru) {
            var others = ins.filter(function (e) { return e.id !== thru.id; });
            (function (Sid, Gid, thruId, otherIds, gLabel, otherSrc) {
              var otherNames = otherSrc.map(function (id) { return lbl(d, id); });
              ops.push({
                kind: 'sumBack',
                blocks: [Sid, Gid].concat(otherSrc),
                edges: [thruId].concat(otherIds),
                title: '相加点后移跨过 ' + gLabel,
                desc: '把相加点从 ' + gLabel + ' 之前移到 ' + gLabel +
                      ' 之后。移动后，除主通路外的 ' + otherIds.length +
                      ' 条支路都要乘上 ' + gLabel + '。',
                run: function (dd) {
                  return doSumMove(dd, Sid, Gid, thruId);
                }
              });
            })(S.id, G.id, thru.id, others.map(function (e) { return e.id; }), G.label || '1',
               others.map(function (e) { return e.from; }));
          }
        }
      }

      /* --- 前移：G -> S，把 S 移到 G 之前，支路乘 1/G --- */
      ins.forEach(function (eIn) {
        var G = M.block(d, eIn.from);
        if (!G || G.type !== 'gain') return;
        if (M.outEdges(d, G.id).length !== 1) return;
        var Gout = M.outEdges(d, G.id)[0];

        var others = ins.filter(function (e) { return e.id !== eIn.id; });
        var gLabel = G.label || '1';
        var otherCount = others.length;

        ops.push({
          kind: 'sumFwd',
          blocks: [S.id, G.id].concat(others.map(function (e2) { return e2.from; })),
          edges: [eIn.id].concat(others.map(function (e2) { return e2.id; })),
          title: '相加点前移跨过 ' + gLabel,
          desc: '把相加点从 ' + gLabel + ' 之后移到 ' + gLabel +
                ' 之前。移动后，除主通路外的 ' + otherCount +
                ' 条支路都要乘上 1/' + gLabel + '。',
          run: function (dd) { return doSumMoveForward(dd, S.id, G.id); }
        });
      });
    });
    return ops;
  }

  /** 相加点后移： S -> G  变成  P -> G -> S -> 原来的下游 ，其余支路各乘 G */
  function doSumMove(dd, sumId, gainId, thruEdgeId) {
    var S = M.block(dd, sumId), G = M.block(dd, gainId);
    if (!S || !G) return null;
    var eSG = M.outEdges(dd, sumId)[0];
    if (!eSG) return null;
    var gLabel = G.label || '1';

    var ins = M.inEdges(dd, sumId);
    var thru = ins.filter(function (e) { return e.id === thruEdgeId; })[0] ||
               ins.filter(function (e) { return (e.sign || '+') === '+'; })[0];
    if (!thru) return null;
    var others = ins.filter(function (e) { return e.id !== thru.id; });

    // G 原来的下游连线，移动后要改从相加点出发
    var gOuts = M.outEdges(dd, gainId).slice();

    var movedNames = others.map(function (e) { return lbl(dd, e.from); });

    // 1) 直通边接到 G
    thru.to = G.id;
    thru.sign = '+';

    // 2) 其余支路各插一个 G 环节
    var insertRat = ratOf(G);
    var insertY = S.y + S.h + 30;
    others.forEach(function (e, i) {
      var srcId = e.from;
      var sign = e.sign || '+';
      var B = M.addBlock(dd, 'gain', 0, 0, { label: gLabel });
      B.rat = insertRat;
      fitLabel(B);
      B.x = Math.round(G.x - B.w - 30);
      B.y = Math.round(insertY + i * (B.h + 16));
      M.removeEdge(dd, e.id);
      M.connect(dd, srcId, B.id, '+');
      M.connect(dd, B.id, S.id, sign);
    });

    // 3) G 的下游改成从相加点出发
    gOuts.forEach(function (e) { e.from = S.id; });

    // 4) S -> G 改成 G -> S
    eSG.from = G.id;
    eSG.to = S.id;
    eSG.sign = '+';

    // 5) 位置调整
    var gx = G.x, gy = G.y;
    G.x = S.x; G.y = S.y;
    S.x = gx + G.w + 44; S.y = gy;

    return '相加点后移：把相加点从 ' + gLabel + ' 之前移到之后；' +
           (movedNames.length
             ? '支路 ' + movedNames.join('、') + ' 各乘 ' + gLabel + '（' +
               movedNames.map(function (n) { return n + '×' + gLabel; }).join('、') + '）'
             : '（无支路需要补偿）');
  }

  /** 相加点前移： G -> S  变成  P -> S -> G ，其余支路各乘 1/G */
  function doSumMoveForward(dd, sumId, gainId) {
    var S = M.block(dd, sumId), G = M.block(dd, gainId);
    if (!S || !G) return null;
    var eGS = M.outEdges(dd, gainId).filter(function (e) { return e.to === sumId; })[0];
    if (!eGS) return null;
    var gLabel = G.label || '1';
    var invG = E.inv(gLabel);

    var gIn = M.inEdges(dd, gainId)[0];
    if (!gIn) return null;
    var pId = gIn.from;
    var pName = lbl(dd, pId);

    var ins = M.inEdges(dd, sumId);
    var others = ins.filter(function (e) { return e.id !== eGS.id; });
    var movedNames = others.map(function (e) { return lbl(dd, e.from); });

    // 1) P -> G 改成 P -> S（保留原符号信息：G 输出进 S 的符号）
    var sIntoSum = eGS.sign || '+';
    gIn.to = sumId;
    gIn.sign = sIntoSum;

    // 2) G -> S 改成 S -> G
    eGS.from = sumId;
    eGS.to = gainId;
    eGS.sign = '+';

    // 3) 其余支路各插一个 1/G
    var invRat = RT.rInv(ratOf(G));
    var insertY = S.y + S.h + 30;
    others.forEach(function (e, i) {
      var src = M.block(dd, e.from);
      var B = M.addBlock(dd, 'gain', 0, 0, { label: invG });
      B.rat = invRat;
      fitLabel(B);
      B.x = Math.round(S.x - B.w - 20);
      B.y = Math.round(insertY + i * (B.h + 16));
      var sign = e.sign || '+';
      var srcId = e.from;
      M.removeEdge(dd, e.id);
      M.connect(dd, srcId, B.id, '+');
      M.connect(dd, B.id, S.id, sign);
      void src;
    });

    // 4) S 的输出边改成从 G 出发
    M.outEdges(dd, sumId).forEach(function (e) {
      if (e.id === eGS.id) return;
      e.from = gainId;
    });

    // 5) 位置：S 移到 G 前面
    var gx = G.x, gy = G.y;
    G.x = gx;
    S.x = gx - S.w - 40;
    S.y = gy + (G.h - S.h) / 2;

    return '相加点前移：把相加点从 ' + gLabel + ' 之后移到之前；' +
           (movedNames.length
             ? '支路 ' + movedNames.join('、') + ' 各乘 1/' + gLabel + '（' +
               movedNames.map(function (n) { return n + '×1/' + gLabel; }).join('、') + '）'
             : '（无支路需要补偿）') +
           '；主通路 ' + pName + ' 现在直接进入相加点。';
  }

  /* ======================================================================
   *  5. 引出点移动
   * ==================================================================== */

  /** 在 T 的出边中挑一条「主线」（目标节点最靠右的那条） */
  function pickMainOut(d, tapId) {
    var outs = M.outEdges(d, tapId);
    if (outs.length < 2) return null;
    var best = null, bestX = -Infinity;
    outs.forEach(function (e) {
      var t = M.block(d, e.to);
      var x = t ? t.x + t.w : -Infinity;
      if (x > bestX) { bestX = x; best = e; }
    });
    return best;
  }

  function findTapMoveAll(d) {
    var ops = [];

    d.blocks.forEach(function (T) {
      if (T.type !== 'takeoff') return;
      var touts = M.outEdges(d, T.id);
      if (touts.length < 2) return;

      /* --- 后移： X -> T -> G ，把 T 移到 G 之后，其他引出支路乘 1/G --- */
      touts.forEach(function (eTG) {
        var G = M.block(d, eTG.to);
        if (!G || G.type !== 'gain') return;
        if (M.inEdges(d, G.id).length !== 1) return;
        var gOut = M.outEdges(d, G.id);
        if (gOut.length !== 1) return;
        var others = touts.filter(function (e) { return e.id !== eTG.id; });
        var gLabel = G.label || '1';

        ops.push({
          kind: 'tapBack',
          blocks: [T.id, G.id].concat(others.map(function (e2) { return e2.to; })),
          edges: [eTG.id].concat(others.map(function (e2) { return e2.id; })),
          title: '引出点后移跨过 ' + gLabel,
          desc: '把引出点从 ' + gLabel + ' 之前移到 ' + gLabel +
                ' 之后。移动后，其他 ' + others.length + ' 条引出支路都要乘 1/' + gLabel +
                '，才能保持引出信号不变。',
          run: function (dd) { return doTapBackward(dd, T.id, G.id); }
        });
      });

      /* --- 前移： X -> G -> T ，把 T 移到 G 之前，其他引出支路乘 G --- */
      var tins = M.inEdges(d, T.id);
      if (tins.length === 1) {
        var G2 = M.block(d, tins[0].from);
        if (G2 && G2.type === 'gain' && M.inEdges(d, G2.id).length === 1) {
          var main = pickMainOut(d, T.id);
          if (main) {
            var others2 = touts.filter(function (e) { return e.id !== main.id; });
            var gLabel2 = G2.label || '1';
            ops.push({
              kind: 'tapFwd',
              blocks: [T.id, G2.id].concat(others2.map(function (e2) { return e2.to; })),
              edges: [main.id].concat(others2.map(function (e2) { return e2.id; })),
              title: '引出点前移跨过 ' + gLabel2,
              desc: '把引出点从 ' + gLabel2 + ' 之后移到 ' + gLabel2 +
                    ' 之前。移动后，其他 ' + others2.length + ' 条引出支路都要乘 ' + gLabel2 +
                    '，才能保持引出信号等于 ' + gLabel2 + ' 之后的信号。',
              run: function (dd) { return doTapForward(dd, T.id, G2.id, main.id); }
            });
          }
        }
      }
    });
    return ops;
  }

  /**
   * 「隐含分支点」的移动。
   *
   * 画图时经常不画那个小圆点，直接把一个相加点/环节的输出接到两处 ——
   * 这在数学上就是"引出点在 G 之前"。这种图如果不先把分支移到 G 之后，
   * 整条回路就不是"一进一出"的简单回路，反馈化简根本认不出来。
   *
   * 例：sum → H2 （分支） 和 sum → G3（主线）
   *  → 把 H2 的引出改到 G3 之后，支路乘 1/G3
   */
  function findVirtualTapMoveAll(d) {
    var ops = [];
    d.blocks.forEach(function (N) {
      if (N.type === 'takeoff') return;              // 显式引出点交给 findTapMoveAll
      var outs = M.outEdges(d, N.id);
      if (outs.length !== 2) return;                 // 只处理最常见的两分支情况

      outs.forEach(function (eMain) {
        var G = M.block(d, eMain.to);
        if (!G || G.type !== 'gain') return;
        if (M.inEdges(d, G.id).length !== 1) return;
        var eTap = outs.filter(function (e) { return e.id !== eMain.id; })[0];
        if (!eTap) return;
        var tapTarget = M.block(d, eTap.to);
        if (!tapTarget) return;

        var gLabel = G.label || '1';
        var tLabel = tapTarget.label || M.TYPE_CN[tapTarget.type] || '节点';
        var nLabel = N.type === 'sum' ? '相加点' : (N.label || M.TYPE_CN[N.type] || '节点');

        ops.push({
          kind: 'tapBack',
          blocks: [N.id, G.id, tapTarget.id],
          edges: [eMain.id, eTap.id],
          title: '分支点后移跨过 ' + gLabel,
          desc: nLabel + ' 的输出同时送到 ' + gLabel + ' 和 ' + tLabel +
                '，相当于「' + gLabel + ' 之前有个分支点」。把 ' + tLabel +
                ' 这条支路移到 ' + gLabel + ' 之后，支路要乘 1/' + gLabel +
                ' 才能保持信号不变。移动后回路就变成一进一出的标准形状，可以反馈化简了。',
          run: function (dd) { return doVirtualTapBack(dd, N.id, G.id); }
        });
      });
    });
    return ops;
  }

  /** 隐含分支点后移：N 的多条出线中，把非主线的那条改到 G 之后并乘 1/G */
  function doVirtualTapBack(dd, nodeId, gainId) {
    var N = M.block(dd, nodeId), G = M.block(dd, gainId);
    if (!N || !G) return null;
    var gLabel = G.label || '1';
    var invG = E.inv(gLabel);
    var invRat = RT.rInv(ratOf(G));

    var eMain = M.outEdges(dd, nodeId).filter(function (e) { return e.to === gainId; })[0];
    if (!eMain) return null;
    var others = M.outEdges(dd, nodeId).filter(function (e) { return e.id !== eMain.id; });
    if (!others.length) return null;

    var names = others.map(function (e) {
      var t = M.block(dd, e.to);
      return t ? (t.label || M.TYPE_CN[t.type] || '节点') : '?';
    });

    var insertY = G.y + G.h + 30;
    others.forEach(function (e, i) {
      var dstId = e.to;
      M.removeEdge(dd, e.id);
      var B = M.addBlock(dd, 'gain', 0, 0, { label: invG });
      B.rat = invRat;
      fitLabel(B);
      B.x = Math.round(G.x);
      B.y = Math.round(insertY + i * (B.h + 16));
      M.connect(dd, gainId, B.id, '+');
      M.connect(dd, B.id, dstId, '+');
    });

    return '分支点后移：把 ' + (N.type === 'sum' ? '相加点' : '节点') + ' 上的分支移到 ' +
           gLabel + ' 之后（引出信号原本取自 ' + gLabel + ' 之前，所以支路 ' +
           names.join('、') + ' 各乘 1/' + gLabel + '）。' +
           '现在这个位置只剩一条出线，回路成为标准形状。';
  }

  /** 引出点后移： X->T->G  变成  X->G->T，T 的其他引出支路乘 1/G */
  function doTapBackward(dd, tapId, gainId) {
    var T = M.block(dd, tapId), G = M.block(dd, gainId);
    if (!T || !G) return null;
    var gLabel = G.label || '1';
    var invG = E.inv(gLabel);

    var eTG = M.outEdges(dd, tapId).filter(function (e) { return e.to === gainId; })[0];
    if (!eTG) return null;
    var gOut = M.outEdges(dd, gainId)[0];
    if (!gOut) return null;
    var tIn = M.inEdges(dd, tapId)[0];
    if (!tIn) return null;

    var others = M.outEdges(dd, tapId).filter(function (e) { return e.id !== eTG.id; });
    var movedNames = others.map(function (e) { return lbl(dd, e.to); });

    // 1) 上游 -> T 改成 上游 -> G
    tIn.to = gainId;

    // 2) T -> G 改成 G -> T
    eTG.from = gainId;
    eTG.to = tapId;
    eTG.sign = '+';

    // 3) G 的原有输出改成从 T 出发
    gOut.from = tapId;

    // 4) T 的其他引出支路各插一个 1/G
    var invRat = RT.rInv(ratOf(G));
    var insertY = T.y + 40;
    others.forEach(function (e, i) {
      var dst = M.block(dd, e.to);
      var B = M.addBlock(dd, 'gain', 0, 0, { label: invG });
      B.rat = invRat;
      fitLabel(B);
      B.x = Math.round(T.x + 30);
      B.y = Math.round(insertY + i * (B.h + 16));
      var dstId = e.to;
      M.removeEdge(dd, e.id);
      M.connect(dd, tapId, B.id, '+');
      M.connect(dd, B.id, dstId, '+');
      void dst;
    });

    // 5) 位置
    var tx = T.x, ty = T.y;
    T.x = Math.round(gOut ? G.x + G.w + 30 : tx);
    T.y = gy_(G);

    return '引出点后移：把引出点从 ' + gLabel + ' 之前移到之后；' +
           (movedNames.length
             ? '引出支路 ' + movedNames.join('、') + ' 各乘 1/' + gLabel
             : '（无其他引出支路）');
  }

  function gy_(G) { return Math.round(G.y + G.h / 2 - 9); }

  /** 引出点前移： X->G->T  变成  X->T->G，T 的其他引出支路乘 G */
  function doTapForward(dd, tapId, gainId, mainEdgeId) {
    var T = M.block(dd, tapId), G = M.block(dd, gainId);
    if (!T || !G) return null;
    var gLabel = G.label || '1';

    var tIn = M.inEdges(dd, tapId)[0];
    var gIn = M.inEdges(dd, gainId)[0];
    if (!tIn || !gIn) return null;
    var mainEdge = M.edge(dd, mainEdgeId);
    if (!mainEdge) return null;

    var others = M.outEdges(dd, tapId).filter(function (e) { return e.id !== mainEdgeId; });
    var movedNames = others.map(function (e) { return lbl(dd, e.to); });

    // 1) 上游 -> G 改成 上游 -> T
    gIn.to = tapId;

    // 2) G -> T 改成 T -> G
    tIn.from = tapId;
    tIn.to = gainId;

    // 3) 主线改成从 G 出发
    mainEdge.from = gainId;

    // 4) 其他引出支路各插一个 G
    var insertRat = ratOf(G);
    var insertY = T.y + 40;
    others.forEach(function (e, i) {
      var B = M.addBlock(dd, 'gain', 0, 0, { label: gLabel });
      B.rat = insertRat;
      fitLabel(B);
      B.x = Math.round(T.x + 30);
      B.y = Math.round(insertY + i * (B.h + 16));
      var dstId = e.to;
      M.removeEdge(dd, e.id);
      M.connect(dd, tapId, B.id, '+');
      M.connect(dd, B.id, dstId, '+');
    });

    // 5) 位置
    T.x = Math.round(G.x - T.w - 30);
    T.y = gy_(G);

    return '引出点前移：把引出点从 ' + gLabel + ' 之后移到之前；' +
           (movedNames.length
             ? '引出支路 ' + movedNames.join('、') + ' 各乘 ' + gLabel
             : '（无其他引出支路）') +
           '；主线继续保持 ' + gLabel + ' 之后的信号。';
  }

  /* ======================================================================
   *  6. 合并串联在一起的相加点 / 去掉多余的引出点
   *
   *  为什么需要这一条？
   *  「相加点前移」「引出点后移」这类操作做完之后，经常会出现
   *  两个相加点直接串在一起（前一个的输出就是后一个的输入）。
   *  这时它们其实是同一个相加点，只是被拆成了两个 ——
   *  不合并的话，后面的反馈化简根本认不出回路，题就化不动了。
   *
   *  教材里这一步一般直接"心算"掉了，所以很多同学意识不到它是一条独立的等效变换。
   * ==================================================================== */

  function findSumMergeAll(d) {
    var ops = [];
    var nm = makeNamer(d);

    d.blocks.forEach(function (A) {
      if (A.type !== 'sum') return;
      var outs = M.outEdges(d, A.id);
      // A 只能有一条出线：否则 A 上的信号还有别的去处，合并会把那条支路弄丢
      if (outs.length !== 1) return;
      var B = M.block(d, outs[0].to);
      var aIns = M.inEdges(d, A.id);

      /* --- 情况一：A 只剩下一个输入，那它就是根导线，直接删掉 --- */
      if (aIns.length === 1 && (aIns[0].sign || '+') === '+' && (!B || B.type !== 'sum')) {
        ops.push({
          kind: 'sumMerge',
          blocks: [A.id],
          edges: [aIns[0].id, outs[0].id],
          title: '去掉多余的相加点：' + nm(A.id),
          desc: nm(A.id) + ' 现在只剩一路输入，已经不再"相加"了，等价于一根导线，可以直接去掉。',
          run: function (dd) { return doSumDrop(dd, A.id); }
        });
        return;
      }

      if (!B || B.type !== 'sum') return;

      var eAB = outs[0];
      if (!aIns.length) return;
      if (M.inEdges(d, B.id).length < 2) return;   // B 只有 A 一个输入的话，那是纯粹的直通，另有合并路径

      var sign = eAB.sign === '-' ? '−' : '+';
      var flipped = eAB.sign === '-';
      var srcNames = aIns.map(function (e) { return lbl(d, e.from); });

      ops.push({
        kind: 'sumMerge',
        blocks: [A.id, B.id].concat(aIns.map(function (e) { return e.from; })),
        edges: [eAB.id].concat(aIns.map(function (e) { return e.id; })),
        title: '合并相邻相加点：' + nm(A.id) + ' + ' + nm(B.id),
        desc: '两个相加点串在一起（' + nm(A.id) + ' 的输出直接进 ' + nm(B.id) +
              '，中间是「' + sign + '」号），本质上是同一个相加点，可以合并成一个。' +
              (flipped ? '因为中间是减号，' + nm(A.id) + ' 那一路的输入符号要全部取反。' : '') +
              '合并后 ' + srcNames.join('、') + ' 直接进入合并后的相加点。',
        run: function (dd) { return doSumMerge(dd, A.id, B.id); }
      });
    });
    return ops;
  }

  /** 只有一个输入的相加点 = 一根导线，删掉 */
  function doSumDrop(dd, aId) {
    var A = M.block(dd, aId);
    if (!A || A.type !== 'sum') return null;
    var ins = M.inEdges(dd, aId);
    var outs = M.outEdges(dd, aId);
    if (ins.length !== 1 || outs.length !== 1) return null;
    if ((ins[0].sign || '+') !== '+') return null;
    ins[0].to = outs[0].to;
    M.removeEdge(dd, outs[0].id);
    M.removeBlock(dd, aId);
    return '去掉多余的相加点：它只剩一路输入，等价于导线，直接省掉。';
  }

  function doSumMerge(dd, aId, bId) {    var A = M.block(dd, aId), B = M.block(dd, bId);
    if (!A || !B) return null;
    var eAB = M.outEdges(dd, aId).filter(function (e) { return e.to === bId; })[0];
    if (!eAB) return null;

    var flipped = eAB.sign === '-';
    var aIns = M.inEdges(dd, aId).slice();
    var names = aIns.map(function (e) { return lbl(dd, e.from); });

    // A 的每条输入改接到 B；中间是减号时符号取反
    aIns.forEach(function (e) {
      e.to = bId;
      if (flipped) e.sign = (e.sign === '-') ? '+' : '-';
    });
    M.removeEdge(dd, eAB.id);
    M.removeBlock(dd, aId);

    // 合并后的相加点摆到原来 A 的位置（A 在上游，入线短）
    B.x = A.x;
    B.y = A.y;

    return '合并相邻相加点：' + names.join('、') + ' 直接进入合并后的相加点' +
           (flipped ? '（中间是减号，这几路的符号已取反）' : '') + '，两个相加点合成一个。';
  }

  /**
   * 去掉"多余的引出点"。
   *
   * 引出点的作用是把一路信号分成几路。如果一个引出点只剩一条出线，
   * 那它已经不再"引出"任何东西了，纯粹是个多余的节点，直接删掉、前后接上即可。
   * 化简到后面经常剩下这样一个孤零零的点，不删掉就永远到不了"只剩一个环节"。
   */
  function findTapMergeAll(d) {
    var ops = [];
    var nm = makeNamer(d);
    d.blocks.forEach(function (A) {
      if (A.type !== 'takeoff') return;
      var outs = M.outEdges(d, A.id);
      if (outs.length !== 1) return;              // 还有多条出线：确实在分支，不能删
      var ins = M.inEdges(d, A.id);
      if (ins.length !== 1) return;
      var B = M.block(d, outs[0].to);
      if (!B) return;

      var bName = B.type === 'takeoff' ? nm(B.id)
                : B.type === 'sum' ? nm(B.id)
                : ('「' + (B.label || '环节') + '」');

      ops.push({
        kind: 'tapMerge',
        blocks: [A.id, B.id],
        edges: [outs[0].id].concat(ins.map(function (e) { return e.id; })),
        title: '去掉多余的引出点：' + nm(A.id),
        desc: nm(A.id) + ' 现在只剩一条出线（只接到 ' + bName +
              '），已经不起分支作用了，可以直接去掉。',
        run: function (dd) { return doTapMerge(dd, A.id); }
      });
    });
    return ops;
  }

  function doTapMerge(dd, aId) {
    var A = M.block(dd, aId);
    if (!A || A.type !== 'takeoff') return null;
    var outs = M.outEdges(dd, aId);
    if (outs.length !== 1) return null;
    var ins = M.inEdges(dd, aId);
    if (ins.length !== 1) return null;

    var eOut = outs[0];
    ins[0].to = eOut.to;                          // 上游直接接到原来引出点的下游
    M.removeEdge(dd, eOut.id);
    M.removeBlock(dd, aId);
    return '去掉多余的引出点：它只剩一条出线，已经不起分支作用，直接省掉。';
  }

  /* ======================================================================
   *  7. 交换相邻的相加点 / 引出点
   * ==================================================================== */

  function findSwapAll(d) {
    var ops = [];
    var nm = makeNamer(d);

    d.blocks.forEach(function (A) {
      if (A.type !== 'sum' && A.type !== 'takeoff') return;
      var outs = M.outEdges(d, A.id);
      if (outs.length !== 1) return;
      var B = M.block(d, outs[0].to);
      if (!B || B.type !== A.type) return;
      if (A.type === 'sum' && M.inEdges(d, B.id).length < 2) return;

      var cn = A.type === 'sum' ? '相加点' : '引出点';
      ops.push({
        kind: A.type === 'sum' ? 'swapSum' : 'swapTap',
        blocks: [A.id, B.id],
        edges: [outs[0].id],
        title: '交换相邻' + cn + '：' + nm(A.id) + ' ↔ ' + nm(B.id),
        desc: '把相邻的两个' + cn + '的先后次序对调。' +
              (A.type === 'sum'
                ? '相加点交换不改变传递函数，但常常能"凑"出可以串并联化简的结构。'
                : '引出点交换同样不改变信号，用于调整引出位置。'),
        run: function (dd) { return doSwap(dd, A.id, B.id); }
      });
    });
    return ops;
  }

  function doSwap(dd, aId, bId) {
    var A = M.block(dd, aId), B = M.block(dd, bId);
    if (!A || !B) return null;
    var cn = A.type === 'sum' ? '相加点' : '引出点';
    var eAB = M.outEdges(dd, aId).filter(function (e) { return e.to === bId; })[0];
    if (!eAB) return null;

    var aIns = M.inEdges(dd, aId);
    var bIns = M.inEdges(dd, bId).filter(function (e) { return e.id !== eAB.id; });
    var bOuts = M.outEdges(dd, bId);

    // A 的输入 -> 改接到 B
    aIns.forEach(function (e) { e.to = bId; });
    // B 的其他输入 -> 改接到 A
    bIns.forEach(function (e) { e.to = aId; });
    // A->B 改成 B->A
    eAB.from = bId;
    eAB.to = aId;
    // B 的输出 -> 改从 A 出发
    bOuts.forEach(function (e) { e.from = aId; });

    // 位置对调
    var ax = A.x, ay = A.y;
    A.x = B.x; A.y = B.y;
    B.x = ax; B.y = ay;

    return '交换相邻' + cn + '：' + cn + '的先后次序对调（传递函数不变，只是重排结构）。';
  }

  /* ======================================================================
   *  8. 对外的统一接口
   * ==================================================================== */

  /** 扫描当前图上所有可执行操作 */
  function scanAll(d) {
    var ops = [];
    ops = ops.concat(findSeriesAll(d));
    ops = ops.concat(findParallelAll(d));
    ops = ops.concat(findFeedbackAll(d));
    ops = ops.concat(findSumMoveAll(d));
    ops = ops.concat(findTapMoveAll(d));
    ops = ops.concat(findVirtualTapMoveAll(d));
    ops = ops.concat(findSumMergeAll(d));
    ops = ops.concat(findTapMergeAll(d));
    ops = ops.concat(findSwapAll(d));
    return ops;
  }

  var AUTO_ORDER = { series: 0, parallel: 1, sumMerge: 2, tapMerge: 2, feedback: 3 };

  /** 自动推导：反复执行 串联/并联/反馈 直到化简不动 */
  function autoSteps(d) {
    var steps = [];
    var guard = 0;
    while (guard++ < 60) {
      var ops = []
        .concat(findSeriesAll(d))
        .concat(findParallelAll(d))
        .concat(findFeedbackAll(d));
      if (!ops.length) break;
      ops.sort(function (a, b) { return (AUTO_ORDER[a.kind] || 9) - (AUTO_ORDER[b.kind] || 9); });
      var txt = ops[0].run(d);
      if (!txt) break;
      steps.push(txt);
    }
    return steps;
  }

  /** 判断图上还剩多少个可化简的模式 */
  function remains(d) {
    return {
      series: findSeriesAll(d).length,
      parallel: findParallelAll(d).length,
      feedback: findFeedbackAll(d).length,
      moves: findSumMoveAll(d).length + findTapMoveAll(d).length
    };
  }

  BDS.engine = {
    scanAll: scanAll,
    autoSteps: autoSteps,
    remains: remains,
    outSignal: outSignal,
    analyzeLoop: analyzeLoop,
    findSumMergeAll: findSumMergeAll,
    findTapMergeAll: findTapMergeAll
  };

})(window.BDS);
