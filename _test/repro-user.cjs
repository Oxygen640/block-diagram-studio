/* ============================================================================
 *  repro-user.cjs —— 用户「图二」那张图的回归测试
 *
 *  接线：R(s) → 引出点 T1
 *          T1 → G1 → 上相加点 ⊕top(+)
 *          T1 → 下相加点 ⊕low(+) → G2 → ⊕top(+)
 *          ⊕top → 引出点 T2 → C(s)，T2 → G3 → ⊕low(−)
 *
 *  手算：⊕top(1 + G2G3) = (G1+G2)R  ⇒  C/R = (G1+G2)/(1+G2G3)
 *
 *  这张图曾经化不动，暴露出三个能力缺口：
 *    · 缺少「合并相邻相加点」
 *    · 缺少「去掉多余的相加点 / 引出点」
 *    · 反馈化简错误地要求相加点"恰好只有一路外部输入"
 *    · 并联化简不认"直通支路"（增益为 1 的那一路）
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

const BDS = ctx.BDS, M = BDS.model, EN = BDS.engine, V = BDS.verify, PL = BDS.planner;

const FIX = path.join(__dirname, 'fixtures', 'parallel-user.json');
function build() {
  return M.normalize(JSON.parse(fs.readFileSync(FIX, 'utf8')).diagram);
}

const env = V.ENVS[0];
const ref = V.tfOf(build(), env);
const hand = (env.G1 + env.G2) / (1 + env.G2 * env.G3);

let bad = 0;
function need(ok, label) {
  if (!ok) bad++;
  console.log('  ' + (ok ? '✔' : '✘') + ' ' + label);
}

console.log('原图 C/R = ' + ref.toFixed(9) + '，手算 (G1+G2)/(1+G2G3) = ' + hand.toFixed(9));
need(Math.abs(ref - hand) < 1e-9, '程序算出的传递函数与手算一致');

/* ---------------- 1. 守门人：这张图上所有候选操作都合法 ---------------- */
console.log('\n【一】合规性');
const all = EN.scanAll(build());
const legal = PL.legalOps(build());
need(all.length > 0, '能扫描出可执行操作（' + all.length + ' 条）');
need(legal.length === all.length,
     '所有候选操作都保传递函数（' + legal.length + '/' + all.length + '）');

/* ------------------- 2. 规划器：能自己找到路线 ------------------- */
console.log('\n【二】规划器');
const plan = PL.analyze(build(), { msBudget: 15000 });
need(plan.solvable, '能从这张图算出化简到底的路线（' + plan.reason + '）');
need(plan.steps > 0 && plan.steps <= 8, '路线长度合理（' + plan.steps + ' 步）');
need(plan.recommend.length > 0, '标出了推荐的第一步');
plan.path.forEach(function (s, i) {
  console.log('       ' + (i + 1) + '. ' + s.title);
});

/* ------------- 3. 一路跟着推荐，验证能化到底且传递函数不变 ------------- */
console.log('\n【三】跟着推荐走');
const d3 = build();
let n = 0, keep = true, feasible = true;
while (n < 12) {
  const p = PL.analyze(M.clone(d3), { msBudget: 8000 });
  if (!p.recommend.length) { feasible = false; break; }
  const want = p.ops[p.recommend[0]];
  const op = PL.legalOps(d3).find(o => o.kind === want.kind && o.title === want.title);
  if (!op) { feasible = false; break; }
  op.run(d3);
  n++;
  const v = V.tfOf(d3, env);
  const ok = Math.abs(v - ref) < 1e-9 * Math.max(1, Math.abs(ref));
  if (!ok) keep = false;
  console.log('       ' + (ok ? '✓' : '✗') + ' ' + n + '. ' + op.title +
              '  → 剩 ' + d3.blocks.length + ' 个元件');
  if (PL.isSolved(d3)) break;
}
need(feasible, '每一步都有可执行的推荐操作（走了 ' + n + ' 步）');
need(keep, '每一步的传递函数都没变');
need(PL.isSolved(d3), '最终化到了最简形式（剩 ' + d3.blocks.length + ' 个元件）');
need(Math.abs(V.tfOf(d3, env) - ref) < 1e-9, '最简形式的 C/R 与原图一致');

/* ------------------- 4. 同一张"图形"，换一种画法也认 ------------------- */
console.log('\n【四】等价画法');
const d4 = build();
// 把两条相加点的先后对调，看看还能不能走通
const sw = PL.legalOps(d4).find(o => o.kind === 'sumMerge' || o.kind === 'sumBack');
need(!!sw, '存在可用于微调结构的操作');

console.log('\n' + (bad === 0 ? '全部通过 ✔' : bad + ' 项未通过 ✘'));
process.exit(bad === 0 ? 0 : 1);
