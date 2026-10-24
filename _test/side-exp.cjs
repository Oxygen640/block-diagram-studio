/* ============================================================================
 *  side-exp.cjs  ——  方位方案实验台
 *
 *  验证一个假设：「让所有连线弯折次数最少的方位方案 = 最美观的方案」
 *  做法：
 *    1. 量出当前方案的总弯折 / 交叉 / 重叠 / 总长
 *    2. 用局部搜索找「总弯折最少」的方案，看它长什么样
 *    3. 再试几种不同的目标函数，比较结果
 * ==========================================================================*/
'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
['rat.js', 'latex.js', 'model.js', 'router.js', 'engine.js', 'mason.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
});

const BDS = ctx.BDS, M = BDS.model, RT = BDS.router;

/* ---------------------------- 全局指标 ---------------------------- */

function measure(d) {
  const map = RT.routeAll(d);
  let bends = 0, backs = 0, length = 0;
  d.edges.forEach(function (e) {
    const pts = map[e.id] || [];
    bends += RT.bends(pts);
    backs += RT.backtracks(pts);
    for (let i = 0; i < pts.length - 1; i++) {
      length += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    }
  });
  return {
    bends: bends,
    backs: backs,
    length: length,
    overlap: RT.totalOverlap(d),
    crossings: RT.totalCrossings(d)
  };
}

function score(d, w) {
  w = w || OPT;
  const m = measure(d);
  return w.bends * m.bends + w.backs * m.backs + w.overlap * m.overlap +
         w.cross * m.crossings + w.length * m.length;
}

/** 默认目标：弯折为主，折返重罚，重叠/交叉当硬约束，长度做微调 */
const OPT = { bends: 1000, backs: 3000, overlap: 100000, cross: 5000, length: 1 };

/** 局部搜索：逐条边的每个端点试四种方位，能改善就留下 */
function optimizeSides(d, w, maxPass) {
  let cur = score(d, w);
  let pass = 0, improved = true, changed = 0;
  while (improved && pass++ < (maxPass || 8)) {
    improved = false;
    d.edges.forEach(function (e) {
      ['toSide', 'fromSide'].forEach(function (key) {
        const orig = e[key];
        let bestSide = orig;
        M.SIDES.forEach(function (side) {
          if (side === orig) return;
          e[key] = side;
          const s = score(d, w);
          if (s < cur - 1e-6) { cur = s; bestSide = side; }
        });
        e[key] = bestSide;
        if (bestSide !== orig) { improved = true; changed++; }
      });
    });
  }
  return { score: cur, changed: changed, passes: pass };
}

/* ---------------------------- 输出 ---------------------------- */

function dump(name, d) {
  const m = measure(d);
  console.log('  ' + name + '：弯折 ' + m.bends + ' 次，折返 ' + m.backs + ' 次，交叉 ' +
              m.crossings + ' 处，重叠 ' + m.overlap.toFixed(0) + ' px，总线长 ' +
              m.length.toFixed(0) + ' px');
  return m;
}

function showEdges(d) {
  const map = RT.routeAll(d);
  d.edges.forEach(function (e) {
    const F = M.block(d, e.from), T = M.block(d, e.to);
    const pts = map[e.id] || [];
    const bk = RT.backtracks(pts);
    console.log('    ' + ((F.label || F.type) + '').padEnd(9) + '->' +
                ((T.label || T.type) + '').padEnd(9) +
                ' 出' + M.SIDE_CN[e.fromSide] + ' 入' + M.SIDE_CN[e.toSide] +
                '  弯折 ' + RT.bends(pts) + (bk ? ' ⚠折返 ' + bk : '') +
                '  顶点 ' + pts.map(function (p) { return '(' + p.x + ',' + p.y + ')'; }).join(''));
  });
}

function snapshot(d) {
  return d.edges.map(function (e) { return { id: e.id, fromSide: e.fromSide, toSide: e.toSide }; });
}
function restore(d, snap) {
  snap.forEach(function (s) {
    const e = M.edge(d, s.id);
    if (e) { e.fromSide = s.fromSide; e.toSide = s.toSide; }
  });
}

/* ============================= 实验开始 ============================= */

function tryW(name, weights) {
  const dg = BDS.demos.twoLoop();
  RT.optimizeSides(dg, 6, weights);
  const m = measure(dg);
  const tk = dg.edges.filter(function (e) {
    return M.block(dg, e.from).type === 'takeoff' &&
           (M.block(dg, e.to).label || '') === 'H1';
  })[0];
  const h2o = dg.edges.filter(function (e) {
    return (M.block(dg, e.from).label || '') === 'H2';
  })[0];
  let extra = '';
  if (tk) extra += '  [引出点→H1 出' + M.SIDE_CN[tk.fromSide] + ' 入' + M.SIDE_CN[tk.toSide] + ']';
  if (h2o) extra += '  [H2 出' + M.SIDE_CN[h2o.fromSide] + ' 入' + M.SIDE_CN[h2o.toSide] + ']';
  console.log('  ' + name.padEnd(20) + '弯折 ' + String(m.bends).padStart(2) +
              '，折返 ' + m.backs + '，交叉 ' + m.crossings +
              '，重叠 ' + m.overlap.toFixed(0) +
              '，总长 ' + m.length.toFixed(0) + extra);
}

[[0, 'sameSide 0'], [1000, 'sameSide 1000'], [1100, 'sameSide 1100'],
 [1200, 'sameSide 1200'], [1300, 'sameSide 1300'], [1400, 'sameSide 1400']].forEach(function (row) {  tryW(row[1], { bend: 1000, back: 3000, sameSide: row[0], overlap: 100000, cross: 5000, length: 1 });
});

console.log('\n══════════ 例题二 ══════════\n');
[[0, 'sameSide 0'], [1400, 'sameSide 1400']].forEach(function (row) {
  const dg = BDS.demos.needMove();
  RT.optimizeSides(dg, 6, { bend: 1000, back: 3000, sameSide: row[0], overlap: 100000, cross: 5000, length: 1 });
  const m = measure(dg);
  console.log('  ' + row[1].padEnd(20) + '弯折 ' + String(m.bends).padStart(2) +
              '，折返 ' + m.backs + '，交叉 ' + m.crossings +
              '，重叠 ' + m.overlap.toFixed(0) + '，总长 ' + m.length.toFixed(0));
});
