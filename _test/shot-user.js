/* ============================================================================
 *  shot-user.cjs —— 把用户那张图在"自动理线 + 自动排版"前后的样子截下来
 *  用法：node node_modules/electron/cli.js _test/shot-user.cjs [图.json]
 * ==========================================================================*/
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const file = process.argv.slice(2).filter(a => !a.startsWith('-'))[0] ||
  path.join(__dirname, 'fixtures', 'parallel-user.json');

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

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  await win.webContents.executeJavaScript(
    'window.__BDS_APP__.load(' + JSON.stringify(raw.diagram || raw) + ',"用户图");'
  );
  await new Promise(r => setTimeout(r, 500));
  let img = await grab(win);
  if (img) { fs.writeFileSync(path.join(OUT, 'user-before.png'), img.toPNG()); console.log('user-before.png'); }

  const info = await win.webContents.executeJavaScript(`(function(){
    document.getElementById('btnWire').click();
    var app = window.__BDS_APP__;
    var d = app.state.diagram;
    function metrics(tag){
      return { tag: tag,
        bends: BDS.router.totalBends(d),
        overlap: Math.round(BDS.router.totalOverlap(d)),
        cross: BDS.router.totalCrossings(d),
        back: BDS.router.totalBacktracks(d),
        len: Math.round(BDS.router.totalLength(d)) };
    }
    var out = [metrics('自动理线后')];
    document.getElementById('btnLayout').click();
    out.push(metrics('自动排版后'));
    return out;
  })()`);
  console.log(JSON.stringify(info, null, 2));

  await new Promise(r => setTimeout(r, 400));
  img = await grab(win);
  if (img) { fs.writeFileSync(path.join(OUT, 'user-after.png'), img.toPNG()); console.log('user-after.png'); }

  app.exit(0);
});
