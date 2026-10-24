/* ============================================================================
 *  figure-probe.js —— 通用图纸自检（在渲染进程里跑）
 *  图内容由 figure-test.js 塞进 window.__FIG__
 *  检查：界面推荐的下一步是否靠谱、跟着走能不能化到底、传递函数有没有被改掉
 * ==========================================================================*/
(async function () {
  var out = { name: window.__FIG_NAME__ };
  var $ = function (id) { return document.getElementById(id); };
  var app = window.__BDS_APP__;
  var PL = BDS.planner, EN = BDS.engine, V = BDS.verify, M = BDS.model;

  function waitFor(fn, ms) {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function tick() {
        var v = null;
        try { v = fn(); } catch (e) { v = null; }
        if (v || Date.now() - t0 > ms) return res(v);
        setTimeout(tick, 60);
      })();
    });
  }

  try {
    var env = V.ENVS[0];
    var rawD = M.normalize(JSON.parse(JSON.stringify(window.__FIG__)));

    // ---- 0. 离线：候选操作里有没有"会改变传递函数"的，守门人挡没挡住 ----
    out.scanCount = EN.scanAll(rawD).length;
    out.legalCount = PL.legalOps(rawD).length;
    out.filtered = out.scanCount - out.legalCount;

    // 先合法地走一步（优先挑"移动"类，这类最容易出错），再看有没有被挡下来的
    (function () {
      var dc = M.clone(rawD);
      var step = PL.legalOps(dc).filter(function (o) {
        return o.kind === 'tapBack' || o.kind === 'virtualTapBack' || o.kind === 'sumFwd' || o.kind === 'sumBack';
      })[0];
      out.offlineStepped = !!step;
      if (step) step.run(dc);
      out.offlineAll = EN.scanAll(dc).length;
      out.offlineLegal = PL.legalOps(dc).length;
      out.offlineFiltered = out.offlineAll - out.offlineLegal;
    })();

    // ---- 1. 载入界面 ----
    app.load(rawD, out.name);
    out.uiOpCount = document.querySelectorAll('#pane-ops .op').length;
    out.uiMatchesLegal = (out.uiOpCount === PL.legalOps(app.state.diagram).length);

    // ---- 2. 自动化简不能把传递函数改掉 ----
    (function () {
      var before = V.tfOf(app.state.diagram, env);
      document.getElementById('btnAuto').click();
      var after = V.tfOf(app.state.diagram, env);
      out.autoBefore = before;
      out.autoAfter = after;
      out.autoKeepsTF = isFinite(after) && Math.abs(after - before) < 1e-9 * Math.max(1, Math.abs(before));
      out.autoBlocks = app.state.diagram.blocks.length;
      app.load(M.clone(rawD), out.name);          // 还原
    })();

    // ---- 3. 等规划算出来 ----
    out.busyShown = !!($('planBusy') || document.querySelector('#pane-ops .plan-bar.ok'));
    var bar = await waitFor(function () {
      return document.querySelector('#pane-ops .plan-bar.ok');
    }, 30000);
    out.planBarShown = !!bar;
    out.planText = bar ? bar.textContent.replace(/\s+/g, ' ').trim().slice(0, 30) : '';
    out.recCount = document.querySelectorAll('#pane-ops .op.rec').length;
    out.recTitle = (function () {
      var e = document.querySelector('#pane-ops .op.rec .op-t');
      return e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
    })();
    var routeBtn = $('planShow');
    if (routeBtn) {
      routeBtn.click();
      out.routeSteps = document.querySelectorAll('#planRoute .plan-step').length;
      routeBtn.click();
    }
    // 其余操作不该乱标"还需 N 步"（算不出来就只能标"较长"）
    out.straySteps = Array.prototype.filter.call(
      document.querySelectorAll('#pane-ops .op:not(.rec) .op-tag'),
      function (e) { return e.textContent.indexOf('还需') >= 0; }).length;

    // ---- 4. 一路跟着推荐走 ----
    //  "化完了" 有两种表现：出现新的结论条，或者面板里已经没有操作卡片了
    function ready() {
      return document.querySelector('#pane-ops .plan-bar.ok') ||
             document.querySelectorAll('#pane-ops .op').length === 0;
    }
    var ref = V.tfOf(app.state.diagram, env);
    var trace = [], keep = true, feasible = true;
    for (var g = 0; g < 12; g++) {
      var b = document.querySelector('#pane-ops .plan-bar.ok');
      var m = /最短 (\d+) 步/.exec((b || {}).textContent || '');
      if (m && m[1] === '0') break;
      var r = document.querySelector('#pane-ops .op.rec');
      if (!r) break;                                     // 没有推荐了，正常收尾
      trace.push(r.querySelector('.op-t').textContent.replace(/\s+/g, ' ').trim());
      r.click();
      if (!(await waitFor(ready, 20000))) { feasible = false; break; }
      var v = V.tfOf(app.state.diagram, env);
      if (!isFinite(v) || Math.abs(v - ref) > 1e-9 * Math.max(1, Math.abs(ref))) keep = false;
      if (PL.isSolved(app.state.diagram)) break;
    }
    out.trace = trace;
    out.traceLen = trace.length;
    out.feasible = feasible;
    out.keepsTF = keep;
    out.finalBlocks = app.state.diagram.blocks.length;
    out.solved = PL.isSolved(app.state.diagram);
    out.finalTF = V.tfOf(app.state.diagram, env);
    out.refTF = ref;
    out.finalMatches = isFinite(out.finalTF) &&
      Math.abs(out.finalTF - ref) < 1e-9 * Math.max(1, Math.abs(ref));

    /* ---- 5. 自动排版质量 ----
     * 光看弯折/重叠抓不到"信号从右往左流、输出方块跑到中间"，
     * 所以额外查两条结构上的硬道理：输入在最左、输出在最右、除反馈线外不能逆流。
     */
    app.load(M.clone(rawD), out.name);
    document.getElementById('btnLayout').click();
    M.normalize(app.state.diagram);
    (function () {
      var dd = app.state.diagram;
      var bs = dd.blocks;
      var xs = bs.map(function (b) { return b.x; });
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      var inp = bs.filter(function (b) { return b.type === 'input'; })[0];
      var outp = bs.filter(function (b) { return b.type === 'output'; })[0];
      out.layoutBends = BDS.router.totalBends(dd);
      out.layoutOverlap = Math.round(BDS.router.totalOverlap(dd));
      out.layoutCross = BDS.router.totalCrossings(dd);
      out.layoutLen = Math.round(BDS.router.totalLength(dd));
      out.inLeftmost = !!inp && inp.x === minX;
      out.outRightmost = !!outp && outp.x === maxX;
      out.wrongDir = 0;
      out.wrongDirList = [];
      dd.edges.forEach(function (e) {
        var A = M.block(dd, e.from), B = M.block(dd, e.to);
        if (!A || !B) return;
        if (B.type === 'sum') return;          // 反馈多半回到相加点，允许往左
        if (B.y > A.y + 10) return;            // 往下走到"反馈那一行"，也允许
        if (B.x < A.x - 4) {
          out.wrongDir++;
          out.wrongDirList.push((A.label || A.type) + '→' + (B.label || B.type));
        }
      });
    })();

    /* ---- 6. 化简途中再美化一次，也不能出现交叉 ----
     * 用户就是在这个中间状态点的"自动排版"，结果线缠成一团。
     */
    app.load(M.clone(rawD), out.name);
    (function () {
      var p = PL.analyze(M.clone(app.state.diagram), { msBudget: 15000 });
      var n = Math.min(4, p.path.length);
      for (var i = 0; i < n; i++) {
        var s = p.path[i];
        var op = PL.legalOps(app.state.diagram).find(function (o) {
          return o.kind === s.kind && o.title === s.title; });
        if (!op) break;
        op.run(app.state.diagram);
      }
      app.render();
      document.getElementById('btnLayout').click();
      out.midSteps = n;
      out.midBlocks = app.state.diagram.blocks.length;
      out.midCross = BDS.router.totalCrossings(app.state.diagram);
      out.midOverlap = Math.round(BDS.router.totalOverlap(app.state.diagram));
      out.midBends = BDS.router.totalBends(app.state.diagram);
    })();

    return out;
  } catch (err) {
    return { __error: String(err && err.stack ? err.stack : err), partial: out };
  }
})()
