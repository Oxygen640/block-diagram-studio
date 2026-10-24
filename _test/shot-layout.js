/* ============================================================================
 *  shot-layout.cjs —— 把每张图纸"自动理线 + 自动排版"之后的样子截下来
 *  用法：node node_modules/electron/cli.js _test/shot-layout.cjs
 * ==========================================================================*/
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
  await new Promise(r => setTimeout(r, 800));

  const FIX = path.join(__dirname, 'fixtures');
  const jobs = fs.readdirSync(FIX).filter(f => f.endsWith('.json')).map(f => ({
    name: 'layout-' + f.replace(/\.json$/, ''),
    diagram: JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')).diagram
  }));
  // 内置例题也来一张
  jobs.push({ name: 'layout-ex3', demo: 'parallel' });

  for (const j of jobs) {
    const code = j.demo
      ? 'window.__BDS_APP__.load(BDS.demos.' + j.demo + '(),"排版检查");'
      : 'window.__BDS_APP__.load(' + JSON.stringify(j.diagram) + ',"排版检查");';
    await win.webContents.executeJavaScript(code);
    await new Promise(r => setTimeout(r, 250));
    await win.webContents.executeJavaScript(
      "document.getElementById('btnLayout').click(); document.getElementById('zoomFit').click(); 1;");
    await new Promise(r => setTimeout(r, 600));
    const img = await grab(win);
    if (img) {
      fs.writeFileSync(path.join(OUT, j.name + '.png'), img.toPNG());
      console.log(j.name + '.png');
    }
  }
  app.exit(0);
});
