/* 对比两种方位方案的视觉效果：baseline（自然朝向）vs 弯折最少 */
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

async function grab(win) {
  for (let i = 0; i < 12; i++) {
    const img = await win.webContents.capturePage();
    if (!img.isEmpty()) return img;
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1560, height: 960, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setBackgroundThrottling(false);
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  await new Promise(r => setTimeout(r, 2200));
  win.focus();
  await new Promise(r => setTimeout(r, 500));

  // 放大到画布区域，看得清楚一点
  await win.webContents.executeJavaScript(`(function(){
    window.__BDS_APP__.setScale(0.62);
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 500));

  async function shot(name, setup) {
    await win.webContents.executeJavaScript(setup);
    await new Promise(r => setTimeout(r, 700));
    const img = await grab(win);
    if (!img) { console.log('（跳过）' + name); return; }
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
    console.log('已保存 ' + name);
  }

  // A) 自然朝向（不优化）
  await shot('A-自然朝向.png', `(function(){
    var s = document.getElementById('demoSel');
    s.value='twoLoop'; s.dispatchEvent(new Event('change'));
    var d = window.__BDS_APP__.state.diagram;
    d.edges.forEach(function(e){
      e.toSide = BDS.model.autoSide(d, e.from, e.to);
      e.fromSide = BDS.model.autoSide(d, e.to, e.from);
      e.route = null;
    });
    window.__BDS_APP__.render();
    window.__BDS_APP__.fitView();
    return true;
  })()`);

  // B) 弯折最少（用默认权重）
  await shot('B-弯折最少.png', `(function(){
    var app = window.__BDS_APP__;
    BDS.router.optimizeSides(app.state.diagram, 6, null, 5000);
    app.render(); app.fitView();
    return true;
  })()`);

  const stat = await win.webContents.executeJavaScript(`(function(){
    var d = window.__BDS_APP__.state.diagram;
    return {
      bends: BDS.router.totalBends(d),
      backs: BDS.router.totalBacktracks(d),
      overlap: BDS.router.totalOverlap(d),
      cross: BDS.router.totalCrossings(d),
      length: Math.round(BDS.router.totalLength(d))
    };
  })()`);
  console.log('弯折最少方案：' + JSON.stringify(stat));

  app.exit(0);
});
