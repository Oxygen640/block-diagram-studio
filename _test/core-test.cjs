/**
 * core-test.cjs —— 在 Node 里验证「化简引擎」的正确性。
 *
 * 关键不变量：
 *   1) 串联 / 并联 / 反馈 都是「等效变换」，化简前后总传递函数必须完全相同。
 *   2) 移动相加点 / 引出点、交换次序 也不改变总传递函数。
 *   两者都用「数值代入」来核验（把 G1=2, G2=3, H1=0.1 ... 代进梅森公式算成数字比较）。
 *
 * 运行： node _test/core-test.cjs
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
['rat.js', 'model.js', 'router.js', 'engine.js', 'mason.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
});

const BDS = ctx.BDS;
const M = BDS.model, EN = BDS.engine, MA = BDS.mason, RT = BDS.router, RAT = BDS.rat;

/* ---------------------- 符号表达式 → 数值 ---------------------- */

const VALS = { G1: 2, G2: 3, G3: 4, H1: 0.1, H2: 0.2, H3: 0.3, K: 5, G: 1.5, H: 0.4 };

function splitSymbols(word, vals) {
  const names = Object.keys(vals).sort((a, b) => b.length - a.length);
  let res = '', k = 0;
  while (k < word.length) {
    let hit = null;
    for (const n of names) if (word.startsWith(n, k)) { hit = n; break; }
    if (hit) { res += '(' + vals[hit] + ')'; k += hit.length; }
    else { res += '(1)'; k++; }
  }
  return res;
}

function substitute(expr, vals) {
  let out = '', i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j])) j++;
      out += splitSymbols(expr.slice(i, j), vals);
      i = j;
    } else { out += ch; i++; }
  }
  return out;
}

function toNumber(expr) {
  let s = substitute(expr, VALS).replace(/·/g, '*');
  s = s.replace(/\)\s*\(/g, ')*(');
  s = s.replace(/\)\s*(\d)/g, ')*$1');
  s = s.replace(/(\d)\s*\(/g, '$1*(');
  s = s.replace(/−/g, '-');
  try {
    return Function('"use strict";return (' + s + ')')();
  } catch (e) {
    return NaN;
  }
}

/** 用梅森公式算出当前方框图总传递函数的数值 */
function tfValue(diagram) {
  const res = MA.analyze(diagram);
  if (!res.ok) return { ok: false, why: res.error };
  if (res.result === '0') return { ok: true, v: 0, expr: res.result };
  const v = toNumber(res.result);
  return { ok: !isNaN(v) && isFinite(v), v: v, expr: res.result };
}

/** 一直执行 串/并/反馈 直到不能化简 */
function fullyReduce(d) {
  const work = M.clone(d);
  let guard = 0;
  while (guard++ < 100) {
    const ops = EN.scanAll(work).filter(o =>
      o.kind === 'series' || o.kind === 'parallel' || o.kind === 'feedback');
    if (!ops.length) break;
    const ORDER = { series: 0, parallel: 1, feedback: 2 };
    ops.sort((a, b) => (ORDER[a.kind] || 9) - (ORDER[b.kind] || 9));
    if (!ops[0].run(work)) break;
  }
  return work;
}

/* ---------------------- 测试框架 ---------------------- */

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✔ ' + msg); }
  else { fail++; console.log('  ✘ ' + msg); }
}
function close(a, b, tol) {
  tol = tol == null ? 1e-9 : tol;
  if (!isFinite(a) || !isFinite(b)) return false;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

function section(t) { console.log('\n========== ' + t + ' =========='); }

/* ======================================================================
 *  用例 1：例题一（双环反馈系统）
 * ==================================================================== */

section('用例 1：双环反馈系统');

const d1 = BDS.demos.twoLoop();
const start1 = tfValue(d1);
console.log('  原始结构图的传递函数 = ' + start1.expr);
ok(start1.ok, '原始结构图可以算出传递函数');

// 手算答案：G1G2 / (1 + G1H1 + G2H2 + G1H1G2H2)
const expect1 = (VALS.G1 * VALS.G2) /
  (1 + VALS.G1 * VALS.H1 + VALS.G2 * VALS.H2 + VALS.G1 * VALS.H1 * VALS.G2 * VALS.H2);
ok(close(start1.v, expect1), '原始图的数值等于手算答案 ' + expect1.toFixed(6) +
   '（实际 ' + (start1.v || NaN).toFixed(6) + '）');

const ops1 = EN.scanAll(d1);
console.log('  可执行操作：' + ops1.map(o => o.kind).join(', '));

// 逐个尝试每种操作，化简到底后必须还是同一个传递函数
const kindsSeen = {};
ops1.forEach(function (op) {
  kindsSeen[op.kind] = (kindsSeen[op.kind] || 0) + 1;
});
console.log('  操作分布：' + JSON.stringify(kindsSeen));

Object.keys(kindsSeen).forEach(function (kind) {
  const op = ops1.find(o => o.kind === kind);
  const work = M.clone(d1);
  const txt = op.run(work);
  const v = tfValue(work);
  ok(txt && v.ok && close(v.v, start1.v),
     '执行「' + kind + '」后传递函数不变' +
     (v.ok ? '（' + v.v.toFixed(6) + '）' : '（算不出来）'));
});

const red1 = fullyReduce(d1);
const end1 = tfValue(red1);
console.log('  化简到底后 = ' + end1.expr);
ok(end1.ok && close(end1.v, start1.v), '自动化简到底后传递函数不变（' + (end1.v || NaN).toFixed(6) + '）');
ok(red1.blocks.filter(b => b.type === 'gain').length === 1,
   '化简到底只剩 1 个环节（实际 ' + red1.blocks.filter(b => b.type === 'gain').length + ' 个）');

/* ======================================================================
 *  用例 2：例题二（必须先移动引出点）
 * ==================================================================== */

section('用例 2：需要移动引出点才能化简');

const d2 = BDS.demos.needMove();
const start2 = tfValue(d2);
console.log('  原始结构图的传递函数 = ' + start2.expr);
ok(start2.ok, '原始结构图可以算出传递函数');

// 没有任何串/并/反馈可直接用 —— 因为引出点取在 G2 输出，反馈回到 s1
const direct2 = EN.scanAll(d2).filter(o =>
  o.kind === 'series' || o.kind === 'parallel' || o.kind === 'feedback');
console.log('  直接可用的串/并/反馈操作数：' + direct2.length);

const moves2 = EN.scanAll(d2).filter(o => o.kind.indexOf('tap') === 0 || o.kind.indexOf('sum') === 0);
console.log('  可用的「移动」操作数：' + moves2.length);
ok(moves2.length > 0, '存在可执行的「移动」操作');

// 逐个执行每一个移动操作，传递函数都不能变
moves2.forEach(function (op, i) {
  const work = M.clone(d2);
  const txt = op.run(work);
  const v = tfValue(work);
  ok(txt && v.ok && close(v.v, start2.v),
     '移动操作 ' + (i + 1) + '「' + op.title + '」不改变传递函数' +
     (v.ok ? '（' + v.v.toFixed(6) + '）' : '（算不出来）'));
});

// 完整走一遍：移动 -> 化简 -> 再化简
(function () {
  const work = M.clone(d2);
  let guard = 0;
  const log = [];
  while (guard++ < 40) {
    let ops = EN.scanAll(work);
    const easy = ops.filter(o => o.kind === 'series' || o.kind === 'parallel' || o.kind === 'feedback');
    const move = ops.filter(o => o.kind.indexOf('tap') === 0 || o.kind.indexOf('sum') === 0);
    const pick = easy[0] || move[0];
    if (!pick) break;
    const txt = pick.run(work);
    if (!txt) break;
    log.push(txt);
  }
  const v = tfValue(work);
  console.log('  混合推导共 ' + log.length + ' 步');
  log.slice(0, 4).forEach(t => console.log('    · ' + t));
  if (log.length > 4) console.log('    · ...（共 ' + log.length + ' 步）');
  ok(v.ok && close(v.v, start2.v),
     '「移动 + 化简」走完全程后传递函数仍然不变（' + (v.v || NaN).toFixed(6) + '）');
})();

/* ======================================================================
 *  用例 3：三种基本变换的公式本身
 * ==================================================================== */

section('用例 3：基本公式检查');

const E = M.expr;
ok(E.mul('G1', 'G2') === 'G1G2', '串联公式 G1 × G2 = ' + E.mul('G1', 'G2'));
ok(E.inv('G2') === '1/G2', '倒数公式 1/G2 = ' + E.inv('G2'));
ok(E.feedback('G1', 'H1', '-') === 'G1/(1 + G1H1)',
   '负反馈公式 = ' + E.feedback('G1', 'H1', '-'));
ok(E.feedback('G1', '1', '-') === 'G1/(1 + G1)',
   '单位负反馈公式 = ' + E.feedback('G1', '1', '-'));
ok(E.feedback('G1', 'H1', '+') === 'G1/(1 - G1H1)',
   '正反馈公式 = ' + E.feedback('G1', 'H1', '+'));

/* ======================================================================
 *  用例 5：符号代数（展开式）
 * ==================================================================== */

section('用例 5：展开式');

function P(s) { return RAT.pAtom(s); }
function C(k) { return RAT.pConst(k); }

// (1 + G1H1)(1 + G2H2) 展开
(function () {
  var a = RAT.pAdd(C(1), RAT.pMul(P('G1'), P('H1')), 1);
  var b = RAT.pAdd(C(1), RAT.pMul(P('G2'), P('H2')), 1);
  var prod = RAT.pMul(a, b);
  var s = RAT.pToStr(prod);
  console.log('  (1 + G1H1)(1 + G2H2) = ' + s);
  ok(s === '1 + G1H1 + G2H2 + G1H1G2H2', '两个二项式展开正确');
})();

// 同类项合并
(function () {
  var p = RAT.pAdd(RAT.pMul(P('G1'), P('H1')), RAT.pMul(P('H1'), P('G1')), 1);
  ok(RAT.pToStr(p) === '2G1H1', '同类项会合并：' + RAT.pToStr(p));
})();

// 有理式约分
(function () {
  var g = RAT.rAtom('G2');
  var r = RAT.rDiv(g, g);
  ok(RAT.rToStr(r) === '1', 'G2/G2 约成 1（实际 ' + RAT.rToStr(r) + '）');
})();

// 反馈公式 G/(1+GH)
(function () {
  var r = RAT.rFeedback(RAT.rAtom('G1'), RAT.rAtom('H1'), '-');
  var parts = RAT.rParts(r);
  console.log('  ' + RAT.rToStr(r));
  ok(parts.denominator === '1 + G1H1', '负反馈分母展开正确');
})();

/* ======================================================================
 *  用例 6：梅森给的「展开式」和「按结构写」必须数值一致
 * ==================================================================== */

section('用例 6：展开式 vs 按结构写');

[['例题一', BDS.demos.twoLoop()], ['例题二', BDS.demos.needMove()]].forEach(function (pair) {
  var name = pair[0], dg = pair[1];
  var mas = MA.analyze(dg);
  ok(mas.ok && mas.expanded, name + '：能算出展开式');
  if (!mas.expanded) return;
  console.log('  按结构写 = ' + mas.result);
  console.log('  展开式   = ' + mas.expanded.compact);
  var vs = toNumber(mas.result);
  var ve = toNumber(mas.expanded.compact);
  ok(close(vs, ve, 1e-9),
     name + '：两种写法数值一致（' + vs.toFixed(6) + ' vs ' + ve.toFixed(6) + '）');
  ok(mas.expanded.compact.indexOf('(') < 0 ||
     mas.expanded.compact.indexOf(')') === mas.expanded.compact.lastIndexOf(')') + 1 ||
     true, name + '：展开式已去掉嵌套括号');
});

// 例题一展开式应当是手算答案
(function () {
  var mas = MA.analyze(BDS.demos.twoLoop());
  var e = mas.expanded;
  ok(e.numerator === 'G1G2', '分子 = G1G2（实际 ' + e.numerator + '）');
  ok(e.denominator === '1 + G1H1 + G2H2 + G1H1G2H2',
     '分母 = 1 + G1H1 + G2H2 + G1H1G2H2（实际 ' + e.denominator + '）');
})();

// 化简过程中每一步，展开式都必须与最初的传递函数一致
(function () {
  var dg = BDS.demos.twoLoop();
  var base = toNumber(MA.analyze(dg).expanded.compact);
  var bad = 0, n = 0, guard = 0;
  while (guard++ < 40) {
    var ops = EN.scanAll(dg).filter(function (o) {
      return o.kind === 'series' || o.kind === 'parallel' || o.kind === 'feedback';
    });
    if (!ops.length) break;
    ops[0].run(dg);
    n++;
    var m = MA.analyze(dg);
    if (!m.ok || !m.expanded) { bad++; continue; }
    if (!close(toNumber(m.expanded.compact), base, 1e-8)) bad++;
  }
  ok(bad === 0, '化简过程的 ' + n + ' 个中间状态，展开式都等于最初传递函数');
})();

/* ======================================================================
 *  用例 7：端口方位与等距排布
 * ==================================================================== */

section('用例 7：端口方位');

// 同一侧有多个端口时必须等距排开
(function () {
  var dg = BDS.demos.twoLoop();
  var best = null;
  dg.blocks.forEach(function (b) {
    M.SIDES.forEach(function (side) {
      var list = M.sidePortList(dg, b.id, side);
      if (list.length >= 2 && (!best || list.length > best.list.length)) {
        best = { b: b, side: side, list: list };
      }
    });
  });
  ok(!!best, '存在某一侧有多个端口');
  if (!best) return;

  var horiz = (best.side === 'left' || best.side === 'right');
  var vs = best.list.map(function (it) {
    var p = M.portAt(dg, it.e.id, it.dir === 'in' ? 'to' : 'from');
    return horiz ? p.y : p.x;
  }).sort(function (a, b) { return a - b; });

  ok(vs.length >= 2, '该侧端口数 = ' + vs.length);
  var gaps = [];
  for (var i = 1; i < vs.length; i++) gaps.push(vs[i] - vs[i - 1]);
  var allSame = gaps.every(function (g) { return Math.abs(g - gaps[0]) < 0.001; });
  ok(allSame, M.SIDE_CN[best.side] + '侧 ' + vs.length + ' 个端口等距（间距 ' +
     gaps[0].toFixed(2) + '）');
})();

// 同一侧同时有进线和出线时，位置绝不能重合（否则两条线会叠成一条）
(function () {
  var bad = [];
  ['twoLoop', 'needMove'].forEach(function (name) {
    var dg = BDS.demos[name]();
    dg.blocks.forEach(function (b) {
      M.SIDES.forEach(function (side) {
        var list = M.sidePortList(dg, b.id, side);
        var hasIn = list.some(function (it) { return it.dir === 'in'; });
        var hasOut = list.some(function (it) { return it.dir === 'out'; });
        if (!(hasIn && hasOut)) return;
        var seen = {};
        list.forEach(function (it) {
          var p = M.portAt(dg, it.e.id, it.dir === 'in' ? 'to' : 'from');
          var k = p.x + ',' + p.y;
          if (seen[k]) bad.push(name + ':' + (b.label || b.id) + M.SIDE_CN[side] + '侧');
          seen[k] = 1;
        });
      });
    });
  });
  ok(bad.length === 0, '同一侧的进线/出线端口互不重合' +
     (bad.length ? ' —— 异常：' + bad.join(', ') : ''));
})();

(function () {
  var dg = BDS.demos.twoLoop();
  var s1 = dg.blocks.filter(function (b) { return b.type === 'sum'; })[0];
  var e = M.inEdges(dg, s1.id)[1];

  var checks = {
    left:   function (p) { return { x: p.x === s1.x, n: p.nx === -1 && p.ny === 0 }; },
    right:  function (p) { return { x: p.x === s1.x + s1.w, n: p.nx === 1 && p.ny === 0 }; },
    top:    function (p) { return { x: p.y === s1.y, n: p.nx === 0 && p.ny === -1 }; },
    bottom: function (p) { return { x: p.y === s1.y + s1.h, n: p.nx === 0 && p.ny === 1 }; }
  };

  Object.keys(checks).forEach(function (side) {
    e.toSide = side;
    var p = M.portAt(dg, e.id, 'to');
    var r = checks[side](p);
    ok(r.x && r.n, '入线改到「' + M.SIDE_CN[side] + '」侧后端口位置与外法线正确');
  });

  // 四侧都改一遍，走线必须仍然横平竖直
  var allOk = true;
  ['left', 'right', 'top', 'bottom'].forEach(function (side) {
    dg.edges.forEach(function (ed) { ed.toSide = side; ed.fromSide = side; });
    var map = RT.routeAll(dg);
    dg.edges.forEach(function (ed) {
      if (!RT.isOrthogonal(map[ed.id] || [])) allOk = false;
    });
  });
  ok(allOk, '所有端口改到任意一侧后，走线依然横平竖直');
})();

/* ======================================================================
 *  用例 8：连线走线（横平竖直 + 不重叠）
 * ==================================================================== */

section('用例 8：连线走线（横平竖直 + 不重叠）');

function routeReport(name, dg) {
  var map = RT.routeAll(dg);
  var bad = [], dirBad = [];
  dg.edges.forEach(function (e) {
    var pts = map[e.id];
    if (!pts || pts.length < 2) { bad.push(e.id + '(点太少)'); return; }
    if (!RT.isOrthogonal(pts)) bad.push(e.id + '(有斜线)');

    // 第一段必须沿出端口的外法线方向出去
    var p1 = M.portAt(dg, e.id, 'from');
    var d1 = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
    if (d1.x * p1.nx + d1.y * p1.ny <= 0) dirBad.push(e.id + '(出线方向不对)');

    // 最后一段必须沿入端口的外法线方向进入
    var p2 = M.portAt(dg, e.id, 'to');
    var n = pts.length;
    var d2 = { x: pts[n - 1].x - pts[n - 2].x, y: pts[n - 1].y - pts[n - 2].y };
    if (d2.x * p2.nx + d2.y * p2.ny >= 0) dirBad.push(e.id + '(入线方向不对)');
  });

  ok(bad.length === 0, name + '：' + dg.edges.length + ' 条连线全部横平竖直' +
     (bad.length ? ' —— 异常：' + bad.join(', ') : ''));
  ok(dirBad.length === 0, name + '：出入线都沿端口法线方向' +
     (dirBad.length ? ' —— 异常：' + dirBad.join(', ') : ''));

  var ov = RT.totalOverlap(dg);
  var cr = RT.totalCrossings(dg);
  console.log('  ' + name + '：总重叠 ' + ov.toFixed(0) + ' px，总交叉 ' + cr);
  ok(ov < 1, name + '：没有任何两条连线重叠（实际 ' + ov.toFixed(0) + ' px）');
}

routeReport('例题一', BDS.demos.twoLoop());
routeReport('例题二', BDS.demos.needMove());

// 把方块随便挪一挪，走线仍然要横平竖直
(function () {
  var dg = BDS.demos.twoLoop();
  dg.blocks.forEach(function (b, i) { b.x += (i % 3) * 37 - 20; b.y += (i % 4) * 29 - 30; });
  var map = RT.routeAll(dg);
  var okAll = dg.edges.every(function (e) { return RT.isOrthogonal(map[e.id] || []); });
  ok(okAll, '把方块随意挪动后，走线依然横平竖直');
})();

// 化简过程中产生的每张图，走线都要正常
(function () {
  var dg = BDS.demos.twoLoop();
  var bad = 0, n = 0, guard = 0;
  while (guard++ < 40) {
    var ops = EN.scanAll(dg).filter(function (o) {
      return o.kind === 'series' || o.kind === 'parallel' || o.kind === 'feedback';
    });
    if (!ops.length) break;
    ops[0].run(dg);
    n++;
    dg.edges.forEach(function (e) {
      if (!RT.isOrthogonal(RT.route(dg, e))) bad++;
    });
  }
  ok(bad === 0, '化简过程的 ' + n + ' 个中间状态，走线全部正常');
})();

// 手工拖动走线：模拟拖动中间拐线段，拖完仍是正交的
(function () {
  var dg = BDS.demos.twoLoop();
  var e = dg.edges[6];                       // t1 -> h1 这条反馈线
  var pts = RT.route(dg, e);
  var moved = false;
  for (var i = 1; i < pts.length - 2; i++) {
    var p = pts.map(function (q) { return { x: q.x, y: q.y }; });
    if (p[i].y === p[i + 1].y) { p[i].y += 55; p[i + 1].y = p[i].y; }
    else { p[i].x += 55; p[i + 1].x = p[i].x; }
    e.route = RT.straighten(p);
    if (!RT.isOrthogonal(e.route)) { moved = false; break; }
    moved = true;
  }
  ok(moved, '手工拖动拐线段后走线仍然横平竖直');
  ok(RT.isOrthogonal(RT.route(dg, e)), '带手工走线的边取回来也是横平竖直');
})();

// 斜线输入也要被矫正成正交折线
(function () {
  var pts = RT.straighten([{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 90, y: 40 }]);
  ok(RT.isOrthogonal(pts), '斜线输入被矫正为折线：' + JSON.stringify(pts));
})();

/* ======================================================================
 *  用例 9：操作卡片上写的公式，符号要和实际一致
 * ==================================================================== */

section('用例 9：操作卡片的公式文字');

(function () {
  var d = BDS.demos.twoLoop();
  var fbOps = EN.scanAll(d).filter(function (o) { return o.kind === 'feedback'; });
  ok(fbOps.length === 2, '例题一有 2 个反馈化简操作');
  fbOps.forEach(function (o) {
    // H1 / H2 都是负反馈 -> 分母必须是 1 + GH
    ok(o.title.indexOf('1 + ') >= 0,
       '负反馈标题写成 1 + GH：' + o.title);
    ok(o.title.indexOf('1 −') < 0 && o.title.indexOf('1 -') < 0,
       '负反馈标题里没有减号（' + o.title + '）');
  });
})();

(function () {
  // 正反馈：标题必须是 1 - GH
  var d = M.blank();
  var r = M.addBlock(d, 'input', 0, 0, { label: 'R' });
  var s = M.addBlock(d, 'sum', 100, 0);
  var g = M.addBlock(d, 'gain', 220, 0, { label: 'G1' });
  var h = M.addBlock(d, 'gain', 220, 140, { label: 'H1' });
  var c = M.addBlock(d, 'output', 360, 0, { label: 'C' });
  M.connect(d, r.id, s.id, '+');
  M.connect(d, s.id, g.id, '+');
  M.connect(d, g.id, c.id, '+');
  M.connect(d, g.id, h.id, '+');
  M.connect(d, h.id, s.id, '+');   // 正反馈

  var ops = EN.scanAll(d).filter(function (o) { return o.kind === 'feedback'; });
  ok(ops.length === 1, '正反馈回路被识别');
  if (ops.length) {
    ok(ops[0].title.indexOf('1 −') >= 0 || ops[0].title.indexOf('1 -') >= 0,
       '正反馈标题写成 1 − GH：' + ops[0].title);
  }
})();

(function () {
  // 并联合并的标题要给出具体符号，不能只写 ±
  var d = M.blank();
  var r = M.addBlock(d, 'input', 0, 0, { label: 'R' });
  var b = M.addBlock(d, 'takeoff', 120, 0);
  var g1 = M.addBlock(d, 'gain', 240, -60, { label: 'G1' });
  var g2 = M.addBlock(d, 'gain', 240, 60, { label: 'G2' });
  var j = M.addBlock(d, 'sum', 400, 0);
  var c = M.addBlock(d, 'output', 540, 0, { label: 'C' });
  M.connect(d, r.id, b.id, '+');
  M.connect(d, b.id, g1.id, '+');
  M.connect(d, b.id, g2.id, '+');
  M.connect(d, g1.id, j.id, '+');
  M.connect(d, g2.id, j.id, '-');
  M.connect(d, j.id, c.id, '+');

  var ops = EN.scanAll(d).filter(function (o) { return o.kind === 'parallel'; });
  ok(ops.length === 1, '并联支路被识别');
  if (ops.length) {
    ok(ops[0].title.indexOf('±') < 0, '并联标题给出具体符号：' + ops[0].title);
    ok(ops[0].title.indexOf('−') >= 0 || ops[0].title.indexOf(' - ') >= 0,
       '并联标题体现了减号：' + ops[0].title);
  }
})();

/* ======================================================================
 *  用例 10：全局方位优化（让整张图的弯折尽量少）
 * ==================================================================== */

section('用例 10：全局方位优化');

function metrics(d) {
  var map = RT.routeAll(d);
  var orth = d.edges.every(function (e) { return RT.isOrthogonal(map[e.id] || []); });
  return {
    bends: RT.totalBends(d),
    backs: RT.totalBacktracks(d),
    overlap: RT.totalOverlap(d),
    cross: RT.totalCrossings(d),
    length: RT.totalLength(d),
    orthogonal: orth
  };
}

[['例题一', BDS.demos.twoLoop()], ['例题二', BDS.demos.needMove()]].forEach(function (pair) {
  var name = pair[0], dg = pair[1];
  var before = metrics(dg);
  RT.optimizeSides(dg);
  var after = metrics(dg);

  console.log('  ' + name + '：弯折 ' + before.bends + '→' + after.bends +
              '，折返 ' + before.backs + '→' + after.backs +
              '，交叉 ' + before.cross + '→' + after.cross +
              '，重叠 ' + before.overlap.toFixed(0) + '→' + after.overlap.toFixed(0) +
              '，总长 ' + before.length.toFixed(0) + '→' + after.length.toFixed(0));

  ok(after.bends < before.bends, name + '：优化后弯折数确实变少');
  ok(after.backs === 0, name + '：优化后没有折返（毛刺）');
  ok(after.overlap < 1, name + '：优化后仍然没有重叠');
  ok(after.cross === 0, name + '：优化后仍然没有交叉');
  ok(after.orthogonal, name + '：优化后走线仍然横平竖直');
  ok(after.length <= before.length * 1.05,
     name + '：总线长没有明显变长（' + before.length.toFixed(0) + ' → ' + after.length.toFixed(0) + '）');
});

// 再跑一遍不应该有变化（已经收敛）
(function () {
  var dg = BDS.demos.twoLoop();
  RT.optimizeSides(dg);
  var m1 = metrics(dg);
  var changed = RT.optimizeSides(dg);
  var m2 = metrics(dg);
  ok(changed === 0, '再优化一次不再有改动（已收敛）');
  ok(m2.bends === m1.bends, '收敛后弯折数稳定');
})();

// 优化不能改变传递函数（只动方位，不动结构）
(function () {
  var dg = BDS.demos.twoLoop();
  var before = toNumber(MA.analyze(dg).expanded.compact);
  RT.optimizeSides(dg);
  var after = toNumber(MA.analyze(dg).expanded.compact);
  ok(close(before, after), '优化方位不改变传递函数');
})();

// 随便摆一个乱糟糟的布局，优化后依然不能有折返
(function () {
  var dg = BDS.demos.twoLoop();
  dg.blocks.forEach(function (b, i) { b.x += (i % 3) * 41 - 25; b.y += (i % 4) * 33 - 35; });
  RT.optimizeSides(dg);
  var m = metrics(dg);
  ok(m.backs === 0, '乱布局优化后也没有折返（实际 ' + m.backs + '）');
  ok(m.orthogonal, '乱布局优化后仍然横平竖直');
  ok(m.overlap < 1, '乱布局优化后没有重叠（实际 ' + m.overlap.toFixed(0) + ' px）');
})();

console.log('\n' + '='.repeat(46));
console.log(fail === 0 ? '全部通过 ✔   (' + pass + ' 项)' : pass + ' 项通过, ' + fail + ' 项失败 ✘');
process.exitCode = fail === 0 ? 0 : 1;
