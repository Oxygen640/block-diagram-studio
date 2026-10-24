/* ============================================================================
 *  layout-sweep.cjs —— 把每张图纸、化简的每一步都"美化"一次，报告交叉数
 *  用法：node node_modules/electron/cli.js _test/layout-sweep.cjs
 * ==========================================================================*/
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  await new Promise(r => setTimeout(r, 700));

  const FIX = path.join(__dirname, 'fixtures');
  const figs = [];
  ['twoLoop', 'needMove', 'parallel'].forEach(n =>
    figs.push({ name: n, demo: n }));
  fs.readdirSync(FIX).filter(f => f.endsWith('.json')).forEach(f => {
    figs.push({
      name: f.replace(/\.json$/, ''),
      diagram: JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')).diagram
    });
  });

  let bad = 0, total = 0;
  for (const fig of figs) {
    const setup = fig.demo
      ? 'BDS.demos.' + fig.demo + '()'
      : JSON.stringify(fig.diagram);
    const res = await win.webContents.executeJavaScript(`(function(){
      var app = window.__BDS_APP__;
      var PL = BDS.planner, M = BDS.model, RT = BDS.router;
      var base = M.normalize(${setup});
      var plan = PL.analyze(M.clone(base), { msBudget: 15000 });
      var out = [];
      for (var step = 0; step <= plan.path.length; step++) {
        var d = M.normalize(JSON.parse(JSON.stringify(base)));
        for (var i = 0; i < step; i++) {
          var s = plan.path[i];
          var op = PL.legalOps(d).find(function(o){
            return o.kind === s.kind && o.title === s.title; });
          if (!op) break;
          op.run(d);
        }
        app.load(d, '扫描');
        var t0 = Date.now();
        document.getElementById('btnLayout').click();
        out.push({
          step: step,
          ms: Date.now() - t0,
          title: step === 0 ? '原图' : plan.path[step-1].title.slice(0, 36),
          blocks: app.state.diagram.blocks.length,
          cross: RT.totalCrossings(app.state.diagram),
          overlap: Math.round(RT.totalOverlap(app.state.diagram)),
          bends: RT.totalBends(app.state.diagram),
          list: RT.crossingList(app.state.diagram).length
        });
      }
      return out;
    })()`);

    console.log('\n══ ' + fig.name + ' ══');
    res.forEach(r => {
      total++;
      const ok = r.cross === 0 && r.overlap < 1;
      if (!ok) bad++;
      console.log('   ' + (ok ? '✔' : '✘') + ' 第 ' + r.step + ' 步 交叉 ' + r.cross +
                  '，重叠 ' + r.overlap + ' px，弯折 ' + r.bends +
                  '，方块 ' + r.blocks + '，耗时 ' + r.ms + ' ms   ' + r.title);
    });
  }

  console.log('\n共 ' + total + ' 个状态，' + (bad === 0 ? '全部无交叉 ✔' : bad + ' 个有交叉 ✘'));
  app.exit(bad === 0 ? 0 : 1);
});
