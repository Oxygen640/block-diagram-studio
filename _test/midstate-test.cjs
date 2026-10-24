/* ============================================================================
 *  midstate-test.cjs —— 化简途中，结果面板给出的东西必须始终"长得对"
 *
 *  用户踩过的坑：化到第 4 步时，展示的展开式是
 *      分子 = G1G2G3 + 2G1G2G3G3H3 + G1G2G3G3G3H3H3
 *      分母 = 1 + G1H1 + G2H2 + 3G3H3 + ...
 *  数值上没错（多出来的 (1+G3H3) 因子会约掉），但学生看到这种式子
 *  只会以为自己算错了。根因是有理式引擎不会约多项式公因子。
 *
 *  这里对每张图纸、每一步都检查三件事：
 *    · 数值 C/R 和原图一致
 *    · 梅森展开式的数值和原图一致
 *    · 梅森展开式的分子/分母，和**原图的分子/分母一模一样**（也就是真的约干净了）
 *
 *  用法：node _test/midstate-test.cjs
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

const BDS = ctx.BDS, M = BDS.model, V = BDS.verify, PL = BDS.planner, MA = BDS.mason, RT = BDS.rat;

const env = V.ENVS[0];
let bad = 0;
function need(ok, label) {
  if (!ok) bad++;
  console.log('   ' + (ok ? '✔' : '✘') + ' ' + label);
}

const figures = [
  { name: '例题一 双环', d: () => BDS.demos.twoLoop() },
  { name: '例题二 需移引出点', d: () => BDS.demos.needMove() },
  { name: '例题三 并联＋反馈', d: () => BDS.demos.parallel() }
];
fs.readdirSync(path.join(__dirname, 'fixtures'))
  .filter(f => f.endsWith('.json'))
  .forEach(f => {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
    figures.push({ name: '图纸 ' + f, d: () => raw.diagram || raw });
  });

figures.forEach(function (fig) {
  console.log('\n══ ' + fig.name + ' ══');
  const d0 = M.normalize(JSON.parse(JSON.stringify(fig.d())));
  const ref = V.tfOf(d0, env);
  const ma0 = MA.analyze(d0);
  const refNum = ma0.expanded ? ma0.expanded.numerator : null;
  const refDen = ma0.expanded ? ma0.expanded.denominator : null;
  console.log('   原图 ' + refNum + ' / ' + refDen);

  const plan = PL.analyze(M.clone(d0), { msBudget: 15000 });
  const d = M.normalize(JSON.parse(JSON.stringify(fig.d())));
  let ok = true;

  function check(tag) {
    const v = V.tfOf(d, env);
    const ma = MA.analyze(d);
    const same = isFinite(v) && Math.abs(v - ref) < 1e-9 * Math.max(1, Math.abs(ref));
    const num = ma.expanded ? ma.expanded.numerator : null;
    const den = ma.expanded ? ma.expanded.denominator : null;
    const numOk = (num === refNum), denOk = (den === refDen);
    if (!same || !numOk || !denOk) {
      ok = false;
      console.log('   ✘ ' + tag);
      console.log('       数值 ' + v + '（应为 ' + ref + '）' + (same ? '' : ' ← 变了'));
      if (!numOk) console.log('       分子 ' + num + '（应为 ' + refNum + '）');
      if (!denOk) console.log('       分母 ' + den + '（应为 ' + refDen + '）');
    } else {
      console.log('   ✔ ' + tag + '：' + num + ' / ' + den);
    }
  }

  check('第 0 步（原图）');
  plan.path.forEach(function (s, i) {
    const op = PL.legalOps(d).find(o => o.kind === s.kind && o.title === s.title);
    if (!op) { ok = false; console.log('   ✘ 找不到操作：' + s.title); return; }
    op.run(d);
    check('第 ' + (i + 1) + ' 步 ' + s.title.slice(0, 40));
  });
  need(ok, '整条路线每一步的展开式都约干净了');
});

console.log('\n' + (bad === 0 ? '中间状态检查全部通过 ✔' : bad + ' 项未通过 ✘'));
process.exit(bad === 0 ? 0 : 1);
