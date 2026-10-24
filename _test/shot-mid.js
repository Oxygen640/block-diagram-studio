/* ============================================================================
 *  shot-mid.cjs —— 复现用户截图里那个"化到第 4 步再美化"的中间状态
 *  检查：排版后有没有交叉，结果面板的传递函数对不对
 * ==========================================================================*/
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const FILE = process.argv.slice(2).filter(a => !a.startsWith('-'))[0] ||
  path.join(__dirname, 'fixtures', 'hard.json');
const STEPS = Number(process.env.MID_STEPS || 4);

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

  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const out = await win.webContents.executeJavaScript(`(function(){
    var app = window.__BDS_APP__;
    var PL = BDS.planner, M = BDS.model, RT = BDS.router, V = BDS.verify;
    var env = V.ENVS[0];

    app.load(${JSON.stringify(raw.diagram || raw)}, '中间状态');
    var ref = V.tfOf(app.state.diagram, env);

    // 按规划路线走前 ${STEPS} 步
    var plan = PL.analyze(M.clone(app.state.diagram), { msBudget: 15000 });
    var trace = [];
    for (var i = 0; i < ${STEPS}; i++) {
      var s = plan.path[i];
      if (!s) break;
      var op = PL.legalOps(app.state.diagram).find(function(o){
        return o.kind === s.kind && o.title === s.title; });
      if (!op) break;
      op.run(app.state.diagram);
      trace.push(op.title);
    }
    app.render();

    var res = { trace: trace, blocks: app.state.diagram.blocks.length };

    function metrics(tag) {
      return { tag: tag,
        bends: RT.totalBends(app.state.diagram),
        overlap: Math.round(RT.totalOverlap(app.state.diagram)),
        cross: RT.totalCrossings(app.state.diagram),
        len: Math.round(RT.totalLength(app.state.diagram)) };
    }
    res.before = metrics('美化前');

    document.getElementById('btnLayout').click();
    res.after = metrics('美化后');
    res.crossList = RT.crossingList(app.state.diagram).map(function (c) {
      function lbl(eid) {
        var e = app.state.diagram.edges.filter(function (x) { return x.id === eid; })[0];
        if (!e) return '?';
        function nm(id) { var b = M.block(app.state.diagram, id); return b ? (b.label || b.type) : '?'; }
        return nm(e.from) + '→' + nm(e.to);
      }
      return lbl(c.a) + '  ×  ' + lbl(c.b) + '  @(' + c.x + ',' + c.y + ')';
    });

    // 结果面板里的东西
    var mas = BDS.mason.analyze(app.state.diagram);
    res.tfStruct = mas.result;
    res.tfNum = mas.expanded ? mas.expanded.numerator : '';
    res.tfDen = mas.expanded ? mas.expanded.denominator : '';
    res.refNum = (function(){
      var m0 = BDS.mason.analyze(M.normalize(JSON.parse(${JSON.stringify(JSON.stringify(raw.diagram || raw))})));
      return m0.expanded ? m0.expanded.numerator : '';
    })();
    res.refDen = (function(){
      var m0 = BDS.mason.analyze(M.normalize(JSON.parse(${JSON.stringify(JSON.stringify(raw.diagram || raw))})));
      return m0.expanded ? m0.expanded.denominator : '';
    })();
    res.numOk = res.tfNum === res.refNum;
    res.denOk = res.tfDen === res.refDen;
    res.numSame = V.tfOf(app.state.diagram, env);
    res.numRef = ref;
    res.tfOk = Math.abs(res.numSame - ref) < 1e-9 * Math.max(1, Math.abs(ref));
    return res;
  })()`);

  console.log(JSON.stringify(out, null, 2));

  await new Promise(r => setTimeout(r, 400));
  const img = await grab(win);
  if (img) {
    const name = 'mid-' + path.basename(FILE, '.json') + '-' + STEPS + '.png';
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
    console.log(name);
  }
  app.exit(0);
});
