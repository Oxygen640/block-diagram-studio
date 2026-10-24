/* ============================================================================
 *  verify-plan.cjs —— 把规划器算出的"最简路线"逐步送进数值校验
 *
 *  用法：node _test/verify-plan.cjs <图.json>
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const { tf, ENV, M, EN, RT } = require('./tf-verify.cjs');
const PL = require('./tf-verify.cjs').ctx.BDS.planner;

const file = process.argv[2];
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const d0 = M.normalize(raw.diagram || raw);

const ref = tf(d0, ENV);
console.log('原图 C/R = ' + ref.toFixed(9));
console.log('');

const t0 = Date.now();
const plan = PL.analyze(d0, { msBudget: 30000 });
console.log(`规划：最少 ${plan.steps} 步，耗时 ${Date.now() - t0} ms，推荐下标 [${plan.recommend}]`);
plan.path.forEach((s, i) => console.log(`   ${i + 1}. [${s.kind}] ${s.title}`));
console.log('');

/** 按 (kind,title) 精确取操作，找不到再退化成只按 title 找 */
function pick(d, step) {
  const ops = EN.scanAll(d);
  return ops.find(o => o.kind === step.kind && o.title === step.title) ||
         ops.find(o => o.title === step.title) ||
         null;
}

const cur = M.normalize(JSON.parse(JSON.stringify(raw.diagram || raw)));
let bad = 0;
plan.path.forEach((step, i) => {
  const op = pick(cur, step);
  if (!op) { console.log(`${i + 1}. ✗ 找不到「${step.title}」`); bad++; return; }
  op.run(cur);
  const v = tf(cur, ENV);
  const ok = isFinite(v) && Math.abs(v - ref) < 1e-7 * Math.max(1, Math.abs(ref));
  if (!ok) bad++;
  console.log(`${String(i + 1).padStart(2)}. ${ok ? '✓' : '✗'} ${step.title}`);
  console.log(`     C/R = ${isFinite(v) ? v.toFixed(9) : v}   方块数 ${cur.blocks.length}`);
});

console.log('');
console.log(bad === 0 ? '规划路线的每一步都等价 ✓' : `有 ${bad} 步不等价 ✗`);
process.exit(bad === 0 ? 0 : 1);
