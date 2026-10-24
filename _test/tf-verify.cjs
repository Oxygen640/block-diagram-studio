/* ============================================================================
 *  tf-verify.cjs —— 独立数值校验：每一步化简后传递函数是否还等于原图
 *
 *  做法：把框图直接翻译成信号流方程，高斯消元解出 C/R。
 *  这条路径完全不经过 engine / mason 的任何公式，所以能真正验伪。
 *
 *  用法：
 *     node _test/tf-verify.cjs <图.json> ["操作标题1" "操作标题2" ...]
 *  也可以被 require，拿到 tf() / ENV 复用。
 * ==========================================================================*/
'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
['rat.js', 'latex.js', 'model.js', 'router.js', 'engine.js', 'mason.js', 'verify.js', 'planner.js']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), ctx, { filename: f }));

const BDS = ctx.BDS;
const M = BDS.model, EN = BDS.engine, RT = BDS.rat;

/* --------------------------- 1. 数值解 C/R --------------------------- */

const ENV = { R: 1, G1: 2.3, G2: 1.7, G3: 3.1, H1: 0.31, H2: 0.17, H3: 0.43, K: 2.9, G: 1.9, H: 0.37 };

function gainOf(b, env) {
  if (b.rat) return RT.rEval(b.rat, env);
  if (b.type === 'gain') return RT.rEval(RT.parse(b.label), env);
  return 1;
}

/** 解线性方程组 A x = y（高斯-若尔当消元 + 部分主元） */
function solve(A, y) {
  const n = y.length;
  const M2 = A.map((row, i) => row.concat([y[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M2[r][c]) > Math.abs(M2[p][c])) p = r;
    if (Math.abs(M2[p][c]) < 1e-14) continue;
    [M2[c], M2[p]] = [M2[p], M2[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M2[r][c] / M2[c][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) M2[r][k] -= f * M2[c][k];
    }
  }
  return M2.map((row, i) => (Math.abs(row[i]) < 1e-14 ? 0 : row[n] / row[i]));
}

/** 直接由框图结构算 C/R，env 省略则用默认 ENV */
function tf(d, env) {
  env = env || ENV;
  const src = d.blocks.find(b => b.type === 'input');
  const sink = d.blocks.find(b => b.type === 'output');
  if (!src || !sink) return NaN;

  const vars = d.blocks.filter(b => b !== src).map(b => b.id);
  const idx = {}; vars.forEach((id, i) => { idx[id] = i; });
  const n = vars.length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const y = new Array(n).fill(0);

  // 每个非源节点一行：out(b) - Σ(输入项) = 0，源节点当常数 1 挪到右端
  d.blocks.forEach(b => {
    if (b === src) return;
    const r = idx[b.id];
    A[r][r] = 1;
    const ins = d.edges.filter(e => e.to === b.id);
    const feed = (id, coef) => {
      if (id === src.id) y[r] += coef;
      else A[r][idx[id]] -= coef;
    };
    if (b.type === 'gain') {
      if (ins.length !== 1) return;                          // 悬空：输出 0
      feed(ins[0].from, gainOf(b, env));
    } else if (b.type === 'takeoff' || b.type === 'output') {
      if (ins.length !== 1) return;
      feed(ins[0].from, 1);
    } else {                                                // sum
      ins.forEach(e => feed(e.from, e.sign === '-' ? -1 : 1));
    }
  });

  const x = solve(A, y);
  const val = id => (id === src.id ? 1 : x[idx[id]]);
  return val(sink.id) / val(src.id);
}

module.exports = { tf, ENV, BDS, M, EN, RT, ctx };

/* ------------------------------ 2. 命令行 ------------------------------ */

if (require.main === module) {
  const file = process.argv[2];
  const seq = process.argv.slice(3);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const d = M.normalize(raw.diagram || raw);
  const ref = tf(d);

  const fmt = v => (isFinite(v) ? v.toFixed(9) : String(v));
  console.log('原图 C/R = ' + fmt(ref));
  console.log('');

  const cur = d;
  let bad = 0;
  seq.forEach((title, i) => {
    const ops = EN.scanAll(cur);
    const op = ops.find(o => o.title === title) || ops.find(o => o.title.indexOf(title) >= 0);
    if (!op) {
      console.log(`第 ${i + 1} 步  ✗ 找不到操作「${title}」`);
      console.log('   当前可选：' + ops.map(o => o.title).join(' | '));
      bad++;
      return;
    }
    op.run(cur);
    const v = tf(cur);
    const ok = isFinite(v) && Math.abs(v - ref) < 1e-7 * Math.max(1, Math.abs(ref));
    if (!ok) bad++;
    const nSum = cur.blocks.filter(b => b.type === 'sum').length;
    const nGain = cur.blocks.filter(b => b.type === 'gain').length;
    console.log(`${String(i + 1).padStart(2)}. ${ok ? '✓' : '✗'} ${op.title}`);
    console.log(`     C/R = ${fmt(v)}    方块数 ${cur.blocks.length}（增益 ${nGain}，相加点 ${nSum}）`);
  });

  console.log('');
  console.log(bad === 0 ? '全部步骤等价 ✓' : `有 ${bad} 处不等价 ✗`);
  process.exit(bad === 0 ? 0 : 1);
}
