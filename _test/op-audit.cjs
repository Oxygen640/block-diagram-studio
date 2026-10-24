/* ============================================================================
 *  op-audit.cjs —— 用数值守门人审计所有化简算子
 *
 *  对每个演示图，把当前能生成的每条操作都跑一遍，
 *  报告哪些"保传递函数"（✓）、哪些已经改变了传递函数（✗）。
 *
 *  用法：node _test/op-audit.cjs [图.json ...]
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
const M = BDS.model, EN = BDS.engine, V = BDS.verify;

function auditDiagram(tag, d0, depth) {
  console.log('══════ ' + tag + ' ══════');
  let cur = M.clone(d0);
  const t0 = Date.now();
  let bad = 0, total = 0;

  for (let step = 0; step <= (depth || 0); step++) {
    if (step > 0) {
      // 往最简方向走一步：优先串联 → 并联 → 反馈，找一个合法操作
      const ops = V.filterOps(cur, EN.scanAll(cur));
      const pickOrder = ['series', 'parallel', 'feedback', 'sumMerge', 'tapMerge',
                         'tapBack', 'tapFwd', 'sumBack', 'sumFwd', 'virtualTapBack', 'swap'];
      let done = false;
      for (const k of pickOrder) {
        const op = ops.find(o => o.kind === k);
        if (op) { op.run(cur); done = true; console.log(`   ↳ 自动执行：${op.title}`); break; }
      }
      if (!done) { console.log('   ↳ 无可用的合法操作，停止'); break; }
    }
    const ops = EN.scanAll(cur);
    if (!ops.length) { console.log('  （没有可用的化简操作）'); break; }
    console.log(`  ── 第 ${step} 层，共 ${ops.length} 条候选 ──`);
    ops.forEach(op => {
      total++;
      const ok = V.opKeeps(cur, op);
      if (!ok) bad++;
      console.log(`   ${ok ? '✓' : '✗'} [${op.kind}] ${op.title}`);
    });
  }

  console.log(`  小计：${total} 条候选，${bad} 条非法，耗时 ${Date.now() - t0} ms`);
  console.log('');
  return { total, bad };
}

let T = 0, B = 0;
const files = process.argv.slice(2);
if (files.length) {
  files.forEach(f => {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    const r = auditDiagram(path.basename(f), M.normalize(raw.diagram || raw), 3);
    T += r.total; B += r.bad;
  });
} else {
  ['twoLoop', 'needMove', 'parallel'].forEach(name => {
    const d = M.normalize(BDS.demos[name]());
    const r = auditDiagram('演示图 ' + name, d, 4);
    T += r.total; B += r.bad;
  });
}
console.log(`总计：${T} 条候选，${B} 条非法`);
process.exit(B === 0 ? 0 : 1);
