/* ============================================================================
 *  shot-plan.js —— 截一张"推荐步骤"界面的图，肉眼确认渲染没问题
 *  用法：node node_modules/electron/cli.js _test/shot-plan.js
 * ==========================================================================*/
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

async function grab(win, tries) {
  for (let i = 0; i < (tries || 12); i++) {
    const img = await win.webContents.capturePage();
    if (!img.isEmpty()) return img;
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1560, height: 960, show: true,
    webPreferences: { contextIsolation: false, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  await new Promise(r => setTimeout(r, 900));

  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hard.json'), 'utf8'));
  await win.webContents.executeJavaScript(
    'window.__BDS_APP__.load(' + JSON.stringify(raw.diagram || raw) + ',"硬骨头例题");'
  );

  // 等推荐算出来
  await win.webContents.executeJavaScript(`new Promise(function(res){
    var t0 = Date.now();
    (function tick(){
      if (document.querySelector('#pane-ops .plan-bar.ok') || Date.now()-t0 > 25000) return res(1);
      setTimeout(tick, 100);
    })();
  })`);

  await new Promise(r => setTimeout(r, 400));
  let img = await grab(win);
  if (img) { fs.writeFileSync(path.join(OUT, 'plan-hard.png'), img.toPNG()); console.log('plan-hard.png'); }

  // 把完整路线也展开再截一张
  await win.webContents.executeJavaScript(
    "var b=document.getElementById('planShow'); if(b) b.click(); 1;"
  );
  await new Promise(r => setTimeout(r, 300));
  img = await grab(win);
  if (img) { fs.writeFileSync(path.join(OUT, 'plan-route.png'), img.toPNG()); console.log('plan-route.png'); }

  // 滚到"推荐"那张卡片，单独截一张
  await win.webContents.executeJavaScript(`
    var rec = document.querySelector('#pane-ops .op.rec');
    if (rec) rec.scrollIntoView({ block: 'center' });
    1;
  `);
  await new Promise(r => setTimeout(r, 400));
  img = await grab(win);
  if (img) { fs.writeFileSync(path.join(OUT, 'plan-rec.png'), img.toPNG()); console.log('plan-rec.png'); }

  app.exit(0);
});
