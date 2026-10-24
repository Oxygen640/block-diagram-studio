/* 测试规划器：在几道题上跑一下 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
['rat.js', 'latex.js', 'model.js', 'router.js', 'engine.js', 'mason.js', 'verify.js', 'planner.js']
  .forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  });
const BDS = ctx.BDS, M = BDS.model, EN = BDS.engine, PL = BDS.planner;

function run(name, d, opts) {
  console.log('\n══════ ' + name + ' ══════');
  d = M.normalize(d);
  const tf = BDS.mason.analyze(d);
  console.log('  传递函数: ' + (tf.ok ? tf.expanded.compact : '—'));
  console.log('  方块数: ' + d.blocks.length +
              '，引擎可做操作: ' + EN.scanAll(d).length +
              '，其中合法: ' + PL.legalOps(d).length);

  const t0 = Date.now();
  const r = PL.analyze(d, opts);
  const ms = Date.now() - t0;

  console.log('  ' + r.reason + '   (耗时 ' + ms + ' ms)');
  if (r.path.length) {
    console.log('  路线：');
    r.path.forEach(function (s, i) {
      console.log('    ' + (i + 1) + '. [' + (PL.KIND_CN[s.kind] || s.kind) + '] ' + s.title);
    });
  }
  if (r.ops.length) {
    console.log('  推荐标记：');
    r.ops.forEach(function (o, i) {
      const a = r.annotated[i] || {};
      const mark = r.recommend.indexOf(i) >= 0 ? ' ← ★推荐'
        : (a.remaining === null ? '（较长）' : '（还需 ' + a.remaining + ' 步）');
      console.log('    ' + (i + 1) + '. ' + o.title + mark);
    });
  }
  return r;
}

// 内置例题
run('例题一 双环', BDS.demos.twoLoop());
run('例题二 需移引出点', BDS.demos.needMove());

// 用户上传的题
if (process.argv[2]) {
  const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  run('用户上传的题', raw.diagram || raw, { msBudget: 8000 });
} else {
  run('硬骨头（内置样例）', JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hard.json'), 'utf8')).diagram,
      { msBudget: 8000 });
}
