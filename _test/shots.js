/* ============================================================================
 *  shots.js  ——  把界面、分式、排版前后的效果存成 PNG，方便人工确认
 *  运行： npx electron _test/shots.js      输出在 _test/shots/
 * ==========================================================================*/
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

function save(name, buf) {
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log('已保存 ' + name + '  (' + Math.round(buf.length / 1024) + ' KB)');
}

/** capturePage 有时会返回空图（窗口没合成帧），重试几次 */
async function grab(win, tries) {
  for (let i = 0; i < (tries || 10); i++) {
    const img = await win.webContents.capturePage();
    if (!img.isEmpty()) return img;
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

async function shoot(win, name) {
  const img = await grab(win);
  if (!img) { console.log('（跳过）' + name + '：截图始终为空'); return; }
  save(name, img.toPNG());
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
  await new Promise(r => setTimeout(r, 600));

  // 1) 默认例题一
  await shoot(win, '01-默认界面.png');

  // 2) 结果与验证页（分式框）
  await win.webContents.executeJavaScript(
    "document.querySelector('.tab[data-tab=\"mason\"]').click(); true;");
  await new Promise(r => setTimeout(r, 800));
  await shoot(win, '02-结果与验证.png');

  // 3) 单独导出分式 PNG（2 倍清晰度，不依赖截图）
  const fracPng = await win.webContents.executeJavaScript(`(function(){
    var res = BDS.mason.analyze(window.__BDS_APP__.state.diagram);
    var cv = BDS.latex.drawFormula({
      num: res.expanded.numerator, den: res.expanded.denominator,
      width: 1000, scale: 2, background: '#ffffff', color: '#0f172a'
    });
    return cv.toDataURL('image/png');
  })()`);
  save('03-分式导出.png', Buffer.from(fracPng.split(',')[1], 'base64'));

  // 4) 自动排版
  await win.webContents.executeJavaScript(
    "document.getElementById('btnLayout').click(); true;");
  await new Promise(r => setTimeout(r, 900));
  await shoot(win, '04-自动排版后.png');

  const stat = await win.webContents.executeJavaScript(`(function(){
    var d = window.__BDS_APP__.state.diagram;
    return {
      overlap: BDS.router.totalOverlap(d),
      crossings: BDS.router.totalCrossings(d)
    };
  })()`);
  console.log('  排版后：重叠 ' + stat.overlap.toFixed(0) + ' px，交叉 ' + stat.crossings + ' 处');

  // 5) 换例题二排版
  await win.webContents.executeJavaScript(`(function(){
    var s = document.getElementById('demoSel');
    s.value = 'needMove'; s.dispatchEvent(new Event('change'));
    document.getElementById('btnLayout').click();
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 900));
  await shoot(win, '05-例题二排版.png');

  // 6) 悬停操作看高亮
  await win.webContents.executeJavaScript(`(function(){
    var s = document.getElementById('demoSel');
    s.value = 'twoLoop'; s.dispatchEvent(new Event('change'));
    document.querySelector('.tab[data-tab="ops"]').click();
    var card = document.querySelector('#pane-ops .op');
    if (card) card.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 800));
  await shoot(win, '06-悬停高亮.png');

  app.exit(0);
});
