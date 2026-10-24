/* ============================================================================
 *  router.js  ——  连线的「横平竖直」走线算法
 *
 *  整条连线只由水平段和竖直段组成（正交折线），和教材上的画法一致。
 *  端口可以在方框的 左 / 右 / 上 / 下 任意一侧，位置由 model.js 统一分配
 *  （同一侧的进线和出线一起等距排开）。
 *
 *  算法分两层：
 *    1. route(d, e)   —— 单独算一条边（只躲方块）
 *    2. routeAll(d)   —— 一次算全部边：**先走的线会被后面的线当成障碍**，
 *                        这样两条线就不会压在一起（重叠比交叉难看得多）
 *
 *  打分 = 拐弯数 × 900 + 长度 + 重叠长度 × 90 + 交叉次数 × 25
 *  重叠的惩罚远大于绕远路，所以宁可多绕一点，也不让两条线贴在一起。
 * ==========================================================================*/
window.BDS = window.BDS || {};

(function (BDS) {
  'use strict';

  var M = BDS.model;

  var GAP = 20;      // 进出方块前必须直着走的长度
  var PAD = 10;      // 障碍方块向外扩张的量

  var W_BEND = 900;
  var W_BACK = 2600;
  var W_OVERLAP = 90;
  var W_CROSS = 25;

  function rect(b) {
    return { x1: b.x - PAD, y1: b.y - PAD, x2: b.x + b.w + PAD, y2: b.y + b.h + PAD };
  }
  function hHits(x1, x2, y, r) {
    if (y < r.y1 || y > r.y2) return false;
    var a = Math.min(x1, x2), c = Math.max(x1, x2);
    return !(c < r.x1 || a > r.x2);
  }
  function vHits(y1, y2, x, r) {
    if (x < r.x1 || x > r.x2) return false;
    var a = Math.min(y1, y2), c = Math.max(y1, y2);
    return !(c < r.y1 || a > r.y2);
  }
  function segHits(a, b, r) {
    if (a.y === b.y) return hHits(a.x, b.x, a.y, r);
    if (a.x === b.x) return vHits(a.y, b.y, a.x, r);
    return true;
  }
  function hitsAny(pts, obs) {
    if (!obs || !obs.length) return false;
    // 先用整条折线的包围盒筛掉大部分方块，再做逐段精确判断
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    for (var j = 0; j < obs.length; j++) {
      var r = obs[j];
      if (r.x2 < minX || r.x1 > maxX || r.y2 < minY || r.y1 > maxY) continue;
      for (var k = 0; k < pts.length - 1; k++) {
        if (segHits(pts[k], pts[k + 1], r)) return true;
      }
    }
    return false;
  }

  /** 去掉重复点与共线的中间点，并取整 */
  function dedupe(pts) {
    var out = [];
    pts.forEach(function (p) {
      var last = out[out.length - 1];
      if (last && Math.abs(last.x - p.x) < 0.6 && Math.abs(last.y - p.y) < 0.6) return;
      out.push({ x: Math.round(p.x), y: Math.round(p.y) });
    });
    var res = [];
    for (var i = 0; i < out.length; i++) {
      var a = res[res.length - 1], b = out[i], c = out[i + 1];
      // 只有 b 夹在 a、c 之间时才能算"共线的中间点"删掉。
      // 如果 b 在 a、c 之外（比如出门先往右、再折回来往左），
      // 删掉它会让第一段变成反向，线就"倒着出门"了。
      if (a && c) {
        if (a.x === b.x && b.x === c.x && between(a.y, b.y, c.y)) continue;
        if (a.y === b.y && b.y === c.y && between(a.x, b.x, c.x)) continue;
      }
      res.push(b);
    }
    if (res.length === 1) res.push({ x: out[out.length - 1].x, y: out[out.length - 1].y });
    return res;
  }

  /** q 是否落在 p 与 r 之间（含端点） */
  function between(p, q, r) {
    return q >= Math.min(p, r) - 0.5 && q <= Math.max(p, r) + 0.5;
  }

  /** 把一串顶点修正成严格正交折线 */
  function straighten(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = { x: Math.round(pts[i].x), y: Math.round(pts[i].y) };
      var prev = out[out.length - 1];
      if (!prev) { out.push(p); continue; }
      if (prev.x !== p.x && prev.y !== p.y) {
        var prevPrev = out[out.length - 2];
        var horizontal = !prevPrev || prevPrev.y === prev.y;
        out.push(horizontal ? { x: p.x, y: prev.y } : { x: prev.x, y: p.y });
      }
      out.push(p);
    }
    return dedupe(out);
  }

  function orientations(pts) {
    var o = [];
    for (var i = 0; i < pts.length - 1; i++) {
      if (pts[i].y === pts[i + 1].y) o.push('h');
      else if (pts[i].x === pts[i + 1].x) o.push('v');
      else o.push('?');
    }
    return o;
  }
  function isOrthogonal(pts) { return orientations(pts).indexOf('?') < 0; }

  function bends(pts) { return Math.max(0, pts.length - 2); }

  /**
   * 折返次数：连续两段在同一轴上方向相反，视觉上就是一根"毛刺"。
   * 例：(398,264) -> (398,284) -> (398,265)  先下后上，中间那段白走了。
   * 这种形状按"弯折数"算只有 1 个顶点，但比正常拐弯难看得多，必须单独惩罚。
   */
  function backtracks(pts) {
    var n = 0;
    for (var i = 0; i < pts.length - 2; i++) {
      var a = pts[i], b = pts[i + 1], c = pts[i + 2];
      if (a.y === b.y && b.y === c.y && (b.x - a.x) * (c.x - b.x) < 0) n++;
      else if (a.x === b.x && b.x === c.x && (b.y - a.y) * (c.y - b.y) < 0) n++;
    }
    return n;
  }

  function lengthOf(pts) {
    var L = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      L += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    }
    return L;
  }

  /* ---------------------- 与已走线的重叠 / 交叉 ---------------------- */

  /** 同向且同坐标的线段重叠长度（这是最难看的：两条线压成一条） */
  function segOverlap(a, b, o) {
    if (a.y === b.y && o.a.y === o.b.y && Math.abs(a.y - o.a.y) < 0.5) {
      var lo = Math.max(Math.min(a.x, b.x), Math.min(o.a.x, o.b.x));
      var hi = Math.min(Math.max(a.x, b.x), Math.max(o.a.x, o.b.x));
      return Math.max(0, hi - lo);
    }
    if (a.x === b.x && o.a.x === o.b.x && Math.abs(a.x - o.a.x) < 0.5) {
      var lo2 = Math.max(Math.min(a.y, b.y), Math.min(o.a.y, o.b.y));
      var hi2 = Math.min(Math.max(a.y, b.y), Math.max(o.a.y, o.b.y));
      return Math.max(0, hi2 - lo2);
    }
    return 0;
  }

  function overlapOf(pts, occ) {
    var total = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      for (var j = 0; j < occ.length; j++) total += segOverlap(pts[i], pts[i + 1], occ[j]);
    }
    return total;
  }

  /** 垂直交叉次数（交叉比重叠好得多，但少一点总归更清爽） */
  function crossingsOf(pts, occ) {
    var n = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var ah = (a.y === b.y);
      for (var j = 0; j < occ.length; j++) {
        var o = occ[j];
        var oh = (o.a.y === o.b.y);
        if (ah === oh) continue;
        var hor = ah ? { a: a, b: b } : o;
        var ver = ah ? o : { a: a, b: b };
        var hy = hor.a.y;
        var hx1 = Math.min(hor.a.x, hor.b.x), hx2 = Math.max(hor.a.x, hor.b.x);
        var vx = ver.a.x;
        var vy1 = Math.min(ver.a.y, ver.b.y), vy2 = Math.max(ver.a.y, ver.b.y);
        if (vx > hx1 + 0.5 && vx < hx2 - 0.5 && hy > vy1 + 0.5 && hy < vy2 - 0.5) n++;
      }
    }
    return n;
  }

  /* ---------------------------- 候选走法 ---------------------------- */

  /** a1 -> a2 之间的简单走法（≤3 段），绝大多数情况够用 */
  function candidatesSimple(a1, a2) {
    var list = [], seen = {};
    function push(mid) {
      var key = mid.map(function (p) { return Math.round(p.x) + ',' + Math.round(p.y); }).join(';');
      if (seen[key]) return;
      seen[key] = 1;
      list.push(mid);
    }
    // 两段式
    push([a1, { x: a2.x, y: a1.y }, a2]);
    push([a1, { x: a1.x, y: a2.y }, a2]);
    // 三段式：在某个 x 处竖直转折
    [a2.x, a1.x, (a1.x + a2.x) / 2,
     a1.x + (a2.x - a1.x) * 0.25, a1.x + (a2.x - a1.x) * 0.75]
      .forEach(function (x) { push([a1, { x: x, y: a1.y }, { x: x, y: a2.y }, a2]); });
    // 三段式：在某个 y 处水平转折
    [a1.y, a2.y, (a1.y + a2.y) / 2,
     a1.y + (a2.y - a1.y) * 0.25, a1.y + (a2.y - a1.y) * 0.75]
      .forEach(function (y) { push([a1, { x: a1.x, y: y }, { x: a2.x, y: y }, a2]); });
    return list;
  }

  /** 绕远一点再回来的"大招"（4 段），只在简单走法都不行时才需要 */
  function candidatesExtra(a1, a2) {
    var list = [], seen = {};
    function push(mid) {
      var key = mid.map(function (p) { return Math.round(p.x) + ',' + Math.round(p.y); }).join(';');
      if (seen[key]) return;
      seen[key] = 1;
      list.push(mid);
    }
    [[24, 0], [-24, 0], [0, 24], [0, -24], [44, 44], [-44, 44], [44, -44], [-44, -44]]
      .forEach(function (d) {
        var m = { x: (a1.x + a2.x) / 2 + d[0], y: (a1.y + a2.y) / 2 + d[1] };
        push([a1, { x: m.x, y: a1.y }, { x: m.x, y: m.y }, { x: a2.x, y: m.y }, a2]);
        push([a1, { x: a1.x, y: m.y }, { x: m.x, y: m.y }, { x: m.x, y: a2.y }, a2]);
      });
    return list;
  }

  /** 判断一条候选是否"刚出端口就掉头扎回方块里" */
  function directionOK(mid, p1) {
    if (mid.length < 2) return false;
    var first = { x: mid[1].x - mid[0].x, y: mid[1].y - mid[0].y };
    return (first.x * p1.nx + first.y * p1.ny) >= -0.001;
  }

  /**
   * 引线长度：从端口沿法线方向先直着走的距离。
   * 固定 20px 在方块挨得近时会打架（两边引线加起来超过间距，
   * 出来的线就会"回头"），所以按可用空间自适应收缩。
   */
  function leadFor(p, other, n) {
    var d = (n.nx !== 0) ? Math.abs(other.x - p.x) : Math.abs(other.y - p.y);
    return Math.min(GAP, Math.max(6, d / 2 - 2));
  }

  /* ---------------------------- 单边走线 ---------------------------- */

  /**
   * @param {object} d    图
   * @param {object} e    边
   * @param {Array}  occ  已经走好的线段 [{a,b}, ...]，会被当成障碍
   */
  function routeCore(d, e, occ) {
    var F = M.block(d, e.from), T = M.block(d, e.to);
    if (!F || !T) return [];

    var p1 = M.portAt(d, e.id, 'from');
    var p2 = M.portAt(d, e.id, 'to');
    if (!p1 || !p2) return [];

    // 用户手工调整过：以手工顶点为准，首尾点跟随端口
    if (e.route && e.route.length >= 2) {
      var pts0 = e.route.map(function (p) { return { x: p.x, y: p.y }; });
      pts0[0] = { x: p1.x, y: p1.y };
      pts0[pts0.length - 1] = { x: p2.x, y: p2.y };
      return straighten(pts0);
    }

    var lead1 = leadFor(p1, p2, p1);
    var lead2 = leadFor(p2, p1, p2);
    var a1 = { x: p1.x + p1.nx * lead1, y: p1.y + p1.ny * lead1 };
    var a2 = { x: p2.x + p2.nx * lead2, y: p2.y + p2.ny * lead2 };

    var obs = [], ends = [];
    d.blocks.forEach(function (b) {
      if (b.id === F.id || b.id === T.id) {
        // 两端方块只做"中间段不许穿过"的检查
        ends.push({ x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h });
        return;
      }
      obs.push(rect(b));
    });

    var best = null, bestScore = Infinity;
    var fallback = null, fallbackScore = Infinity;

    /** 评估一批候选，更新 best / fallback */
    function tryBatch(batch) {
      batch.forEach(function (mid) {
        if (!directionOK(mid, p1)) return;
        // 中间段不许横穿两端的方块（否则线会直接画在方块身上）
        if (hitsAny(mid, ends)) return;

        var full = dedupe([p1].concat(mid).concat([p2]));
        if (full.length < 2 || !isOrthogonal(full)) return;

        var base = bends(full) * W_BEND + backtracks(full) * W_BACK + lengthOf(full);
        if (base < fallbackScore) { fallbackScore = base; fallback = full; }

        if (hitsAny(full, obs)) return;
        var score = base + overlapOf(full, occ) * W_OVERLAP + crossingsOf(full, occ) * W_CROSS;
        if (score < bestScore) { bestScore = score; best = full; }
      });
    }

    // 先用简单走法；只有没找到"两个弯以内"的方案时，才去试那些绕远的大招
    tryBatch(candidatesSimple(a1, a2));
    if (!best || bends(best) > 2) tryBatch(candidatesExtra(a1, a2));

    if (best) return best;
    if (fallback) return fallback;

    // 极端兜底：绕到下方
    var lane = Math.max(F.y + F.h, T.y + T.h) + 40;
    return dedupe([
      { x: p1.x, y: p1.y }, a1,
      { x: a1.x, y: lane }, { x: a2.x, y: lane }, a2,
      { x: p2.x, y: p2.y }
    ]);
  }

  /** 只算一条边（不参考其它线） */
  function route(d, e) {
    return routeCore(d, e, []);
  }

  /** 估算一条边大概要跑多长（决定走线顺序） */
  function approxLen(d, e) {
    var p1 = M.portAt(d, e.id, 'from');
    var p2 = M.portAt(d, e.id, 'to');
    if (!p1 || !p2) return 1e9;
    return Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y);
  }

  /**
   * 一次算完所有连线。
   * 短路优先（短边选择余地小，先让它们占位）；手工调过走线的边先固定。
   * @returns {Object} edgeId -> 折线顶点数组
   */
  function routeAll(d) {
    var occ = [];
    var map = {};

    var order = d.edges.slice().sort(function (x, y) {
      var mx = x.route ? 0 : 1, my = y.route ? 0 : 1;
      if (mx !== my) return mx - my;
      var lx = approxLen(d, x), ly = approxLen(d, y);
      if (lx !== ly) return lx - ly;
      return M.idNum(x.id) - M.idNum(y.id);
    });

    order.forEach(function (e) {
      var pts = routeCore(d, e, occ);
      map[e.id] = pts;
      for (var i = 0; i < pts.length - 1; i++) occ.push({ a: pts[i], b: pts[i + 1] });
    });
    return map;
  }

  /* --------------------------- 全局方位优化 --------------------------- */

  /**
   * 全局评分。经实验确定的权重：
   *   弯折（拐弯次数）是主要目标；
   *   折返（毛刺）重罚；
   *   重叠 / 交叉 当硬约束（权重极大）；
   *   sameSide 罚"同一个方块同一侧既有进线又有出线"——
   *     这种情况下读图分不清哪根进哪根出。
   *     注意权重必须低于一个弯折（1000）：实测一旦调高到 1100 以上，
   *     优化器宁可绕远也要避开它，结果反而更难看。所以它只当"平局判定"用。
   *   总线长只做最后微调。
   */
  var SCORE_W = {
    bend: 1000, back: 3000, sameSide: 800,
    overlap: 100000, cross: 5000, length: 1
  };

  /** 统计"同一侧既有进线又有出线"的方块侧面数（不分配数组，求快） */
  function sameSideCount(d) {
    var n = 0, SIDES = M.SIDES, edges = d.edges;
    for (var bi = 0; bi < d.blocks.length; bi++) {
      var bid = d.blocks[bi].id;
      for (var s = 0; s < SIDES.length; s++) {
        var side = SIDES[s], hasIn = false, hasOut = false;
        for (var ei = 0; ei < edges.length; ei++) {
          var e = edges[ei];
          if (!hasIn && e.to === bid && (e.toSide || 'left') === side) hasIn = true;
          else if (!hasOut && e.from === bid && (e.fromSide || 'right') === side) hasOut = true;
          if (hasIn && hasOut) break;
        }
        if (hasIn && hasOut) n++;
      }
    }
    return n;
  }

  function globalScore(d, w) {
    w = w || SCORE_W;
    var map = routeAll(d);
    var nb = 0, nk = 0, len = 0;

    // 把所有线段摊平进一个数字数组（每 5 个一组：x1,y1,x2,y2,边序号），避免反复分配对象
    var seg = [];
    d.edges.forEach(function (e) {
      var pts = map[e.id] || [];
      nb += bends(pts);
      nk += backtracks(pts);
      len += lengthOf(pts);
      for (var i = 0; i < pts.length - 1; i++) {
        seg.push(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, e.id);
      }
    });

    var ns = sameSideCount(d);
    var ov = 0, cr = 0;
    var n = seg.length / 5;

    for (var a = 0; a < n; a++) {
      var a5 = a * 5;
      var ax1 = seg[a5], ay1 = seg[a5 + 1], ax2 = seg[a5 + 2], ay2 = seg[a5 + 3];
      var aid = seg[a5 + 4];
      var aH = (ay1 === ay2);
      var aLo = aH ? Math.min(ax1, ax2) : Math.min(ay1, ay2);
      var aHi = aH ? Math.max(ax1, ax2) : Math.max(ay1, ay2);
      var aFix = aH ? ay1 : ax1;

      for (var b = a + 1; b < n; b++) {
        var b5 = b * 5;
        if (seg[b5 + 4] === aid) continue;
        var bx1 = seg[b5], by1 = seg[b5 + 1], bx2 = seg[b5 + 2], by2 = seg[b5 + 3];
        var bH = (by1 === by2);
        var bLo = bH ? Math.min(bx1, bx2) : Math.min(by1, by2);
        var bHi = bH ? Math.max(bx1, bx2) : Math.max(by1, by2);
        var bFix = bH ? by1 : bx1;

        if (aH === bH) {
          // 同向：只有共线才可能重叠
          if (Math.abs(aFix - bFix) < 0.5) {
            var lo = Math.max(aLo, bLo), hi = Math.min(aHi, bHi);
            if (hi > lo) ov += hi - lo;
          }
        } else {
          // 一横一竖：判交叉（端点相接不算交叉）
          var hy = aH ? aFix : bFix;
          var hx1 = aH ? aLo : bLo, hx2 = aH ? aHi : bHi;
          var vx = aH ? bFix : aFix;
          var vy1 = aH ? bLo : aLo, vy2 = aH ? bHi : aHi;
          if (vx > hx1 + 0.5 && vx < hx2 - 0.5 && hy > vy1 + 0.5 && hy < vy2 - 0.5) cr++;
        }
      }
    }

    return w.bend * nb + w.back * nk + w.sameSide * ns +
           w.overlap * ov + w.cross * cr + w.length * len;
  }

  /**
   * 全局优化端口方位：逐个端点试四种方位，能降低总分就留下，反复迭代到收敛。
   * 这就是「让整张图的弯折尽量少」的思路 —— 但单看弯折不够，
   * 必须同时把"折返/重叠/交叉"当约束，否则会挑出更难看的走法。
   *
   * @returns {number} 实际改动的端点数
   */
  function optimizeSides(d, maxPass, w, budgetMs) {
    if (!d.edges.length) return 0;
    if (d.edges.length > 40) return 0;          // 太大就跳过，保证响应速度

    var wx = w || SCORE_W;
    var t0 = Date.now();
    var budget = budgetMs || 900;               // 时间预算，到点就收工（保留已找到的最优）
    var cur = globalScore(d, wx);
    var changed = 0, pass = 0, improved = true;

    while (improved && pass++ < (maxPass || 6)) {
      improved = false;
      var edges = d.edges.slice();
      for (var i = 0; i < edges.length; i++) {
        if (Date.now() - t0 > budget) return changed;
        var e = edges[i];
        var keys = ['toSide', 'fromSide'];
        for (var k = 0; k < keys.length; k++) {
          var key = keys[k];
          var orig = e[key];
          var bestSide = orig;
          for (var s = 0; s < M.SIDES.length; s++) {
            var side = M.SIDES[s];
            if (side === orig) continue;
            e[key] = side;
            var sc = globalScore(d, wx);
            if (sc < cur - 1e-6) { cur = sc; bestSide = side; }
          }
          e[key] = bestSide;
          if (bestSide !== orig) { improved = true; changed++; }
        }
      }
    }
    return changed;
  }

  /* --------------------------- 统计（给测试用） --------------------------- */

  function collectSegs(d, map) {
    var segs = [];
    d.edges.forEach(function (e) {
      var pts = map[e.id] || [];
      for (var i = 0; i < pts.length - 1; i++) segs.push({ id: e.id, a: pts[i], b: pts[i + 1] });
    });
    return segs;
  }

  /** 全部连线的总弯折数 */
  function totalBends(d) {
    var map = routeAll(d);
    var n = 0;
    d.edges.forEach(function (e) { n += bends(map[e.id] || []); });
    return n;
  }

  /** 全部连线的总折返次数（越少越好，0 最好） */
  function totalBacktracks(d) {
    var map = routeAll(d);
    var n = 0;
    d.edges.forEach(function (e) { n += backtracks(map[e.id] || []); });
    return n;
  }

  /** 全部连线的总线长 */
  function totalLength(d) {
    var map = routeAll(d);
    var L = 0;
    d.edges.forEach(function (e) { L += lengthOf(map[e.id] || []); });
    return L;
  }

  /** 所有连线之间的总重叠长度（0 = 没有任何两条线贴在一起） */
  function totalOverlap(d) {
    var segs = collectSegs(d, routeAll(d));
    var total = 0;
    for (var i = 0; i < segs.length; i++) {
      for (var j = i + 1; j < segs.length; j++) {
        if (segs[i].id === segs[j].id) continue;
        total += segOverlap(segs[i].a, segs[i].b, segs[j]);
      }
    }
    return total;
  }

  /** 所有连线之间的总交叉次数 */
  function totalCrossings(d) {
    var segs = collectSegs(d, routeAll(d));
    var n = 0;
    for (var i = 0; i < segs.length; i++) {
      for (var j = i + 1; j < segs.length; j++) {
        if (segs[i].id === segs[j].id) continue;
        n += crossingsOf([segs[i].a, segs[i].b], [segs[j]]);
      }
    }
    return n;
  }

  /** 哪几条线在哪儿交叉（调试 / 界面提示用） */
  function crossingList(d) {
    var segs = collectSegs(d, routeAll(d));
    var out = [];
    for (var i = 0; i < segs.length; i++) {
      for (var j = i + 1; j < segs.length; j++) {
        if (segs[i].id === segs[j].id) continue;
        if (crossingsOf([segs[i].a, segs[i].b], [segs[j]])) {
          out.push({
            a: segs[i].id, b: segs[j].id,
            x: Math.round((segs[i].a.x + segs[i].b.x) / 2),
            y: Math.round((segs[i].a.y + segs[i].b.y) / 2)
          });
        }
      }
    }
    return out;
  }

  BDS.router = {
    route: route,
    routeAll: routeAll,
    optimizeSides: optimizeSides,
    globalScore: globalScore,
    dedupe: dedupe,
    straighten: straighten,
    orientations: orientations,
    isOrthogonal: isOrthogonal,
    bends: bends,
    backtracks: backtracks,
    totalBends: totalBends,
    totalBacktracks: totalBacktracks,
    totalLength: totalLength,
    totalOverlap: totalOverlap,
    totalCrossings: totalCrossings,
    crossingList: crossingList,
    GAP: GAP
  };

})(window.BDS);
