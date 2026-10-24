/* ============================================================================
 *  figure-test.js —— 拿真实图纸跑一遍界面，检查「推荐步骤」确实靠谱
 *
 *  用法：node node_modules/electron/cli.js _test/figure-test.js [图.json ...]
 *  不给参数就跑 _test/fixtures 下的全部图纸。
 * ==========================================================================*/
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const FIXDIR = path.join(__dirname, 'fixtures');

function listFixtures() {
  return fs.readdirSync(FIXDIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(FIXDIR, f));
}

app.whenReady().then(async () => {
  const files = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const targets = files.length ? files : listFixtures();

  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false }
  });

  const errors = [];
  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) errors.push(msg);
  });
  win.webContents.on('render-process-gone', (_e, d) =>
    errors.push('渲染进程崩溃: ' + JSON.stringify(d)));

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  await new Promise(r => setTimeout(r, 700));

  const probe = fs.readFileSync(path.join(__dirname, 'figure-probe.js'), 'utf8');
  const all = [];
  let failed = 0;

  for (const file of targets) {
    if (!fs.existsSync(file)) { console.log('找不到图纸：' + file); failed++; continue; }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const name = path.basename(file, '.json');

    await win.webContents.executeJavaScript(
      'window.__FIG__ = ' + JSON.stringify(raw.diagram || raw) + ';' +
      'window.__FIG_NAME__ = ' + JSON.stringify(name) + ';'
    );

    let out;
    try {
      out = await win.webContents.executeJavaScript(probe);
    } catch (e) {
      out = { __error: e.message, name: name };
    }

    const checks = [];
    const need = (ok, label) => checks.push({ ok: !!ok, label: label });

    if (out && out.__error) {
      console.log('\n══ ' + name + ' ══  探针抛错：\n' + out.__error);
      console.log(JSON.stringify(out.partial, null, 2));
      failed++;
      continue;
    }

    need(out.uiMatchesLegal, '界面列出的操作数 = 合法操作数（' + out.uiOpCount + '）');
    need(out.autoKeepsTF, '「⚡自动化简」不改变传递函数（' +
      Number(out.autoBefore).toFixed(6) + ' → ' + Number(out.autoAfter).toFixed(6) + '）');
    need(out.planBarShown, '算出了最短路线（' + out.planText + '）');
    need(out.recCount > 0, '标出了推荐步骤：' + out.recTitle);
    need(out.routeSteps >= 1, '完整路线能展开（' + out.routeSteps + ' 步）');
    need(out.feasible, '一路跟着推荐走，每步都点得动（' + out.traceLen + ' 步）');
    need(out.keepsTF, '每一步的传递函数都没变');
    need(out.solved, '最终化到最简形式（剩 ' + out.finalBlocks + ' 个元件）');
    need(out.finalMatches, '最简形式的 C/R 与原图一致');
    need(out.inLeftmost, '自动排版后输入方块在最左边');
    need(out.outRightmost, '自动排版后输出方块在最右边');
    need(out.wrongDir === 0, '自动排版后没有逆流的连线' +
      (out.wrongDir ? '（' + out.wrongDirList.join('，') + '）' : ''));
    need(out.layoutOverlap < 1, '自动排版后没有连线重叠（' + out.layoutOverlap + ' px）');
    need(out.layoutCross === 0, '自动排版后没有连线交叉（' + out.layoutCross + ' 处）');
    need(out.layoutBends <= (out.bendLimit || 16), '自动排版后弯折不多（' +
      out.layoutBends + ' ≤ ' + (out.bendLimit || 16) + '）');
    need(out.midCross === 0, '化简途中再排版也不出现交叉（' + out.midCross + ' 处）');

    console.log('\n══ ' + name + ' ══');
    console.log('   候选 ' + out.scanCount + ' 条，其中合法 ' + out.legalCount +
                '（挡下 ' + out.filtered + ' 条）');
    console.log('   走一步后：' + out.offlineLegal + '/' + out.offlineAll +
                ' 条合法（挡下 ' + out.offlineFiltered + ' 条）');
    console.log('   ' + out.planText);
    out.trace.forEach((t, i) => console.log('     ' + (i + 1) + '. ' + t));
    console.log('   排版：弯折 ' + out.layoutBends + '，重叠 ' + out.layoutOverlap +
                ' px，交叉 ' + out.layoutCross + '，总线长 ' + out.layoutLen);

    checks.forEach(c => console.log('   ' + (c.ok ? '✔' : '✘') + ' ' + c.label));
    const bad = checks.filter(c => !c.ok);
    if (bad.length) failed++;
    all.push({ name: name, bad: bad.length, total: checks.length });
  }

  if (errors.length) {
    console.log('\n页面错误：');
    errors.forEach(e => console.log('  ' + e));
    failed++;
  }

  console.log('\n' + '='.repeat(46));
  all.forEach(a => console.log('  ' + a.name + '：' + (a.total - a.bad) + '/' + a.total +
                               (a.bad ? '  ✘' : '  ✔')));
  console.log(failed === 0 ? '\n真实图纸自检全部通过 ✔' : '\n' + failed + ' 张图纸未通过 ✘');
  app.exit(failed === 0 ? 0 : 1);
});
