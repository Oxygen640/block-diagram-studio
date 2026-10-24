/* ============================================================================
 *  plan-probe.js  ——  化简规划（推荐步骤）的界面自检
 *  会返回一个 Promise，所以可以等异步的规划算完再断言。
 * ==========================================================================*/
(async function () {
  var out = {};
  var $ = function (id) { return document.getElementById(id); };
  var app = window.__BDS_APP__;
  var PL = BDS.planner, EN = BDS.engine, V = BDS.verify;

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
    // ---------- 0. 守门人本身能识别"会改变传递函数"的操作 ----------
    var d0 = app.state.diagram;
    var good = PL.legalOps(d0);
    out.oracleAcceptsLegal = good.length > 0 && V.opKeeps(d0, good[0]) === true;

    var broken = {
      kind: 'bogus', title: '故意搞破坏', desc: '',
      run: function (dd) { dd.edges.splice(0, 1); }        // 硬删一条连线
    };
    out.oracleRejectsBroken = V.opKeeps(d0, broken) === false;
    out.scanCount0 = EN.scanAll(d0).length;
    out.legalCount0 = good.length;

    // ---------- 1. 例题一：等推荐标记出现 ----------
    var sel = $('demoSel');
    sel.value = 'twoLoop';
    sel.dispatchEvent(new Event('change'));

    // 切图之后重新数一遍：界面上的卡片数必须等于"合法操作"数
    var dNow = app.state.diagram;
    out.scanCount = EN.scanAll(dNow).length;
    out.legalCount = PL.legalOps(dNow).length;
    out.filtered = out.scanCount - out.legalCount;
    out.uiOpCount = document.querySelectorAll('#pane-ops .op').length;

    out.busyOrDone = !!($('planBusy') || document.querySelector('#pane-ops .plan-bar.ok'));

    var bar = await waitFor(function () {
      return document.querySelector('#pane-ops .plan-bar.ok');
    }, 20000);

    out.planBarShown = !!bar;
    out.planText = bar ? bar.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    out.recCount = document.querySelectorAll('#pane-ops .op.rec').length;
    out.recTagText = Array.prototype.map.call(
      document.querySelectorAll('#pane-ops .op.rec .op-tag'),
      function (e) { return e.textContent; }).join('|');
    out.recTitles = Array.prototype.map.call(
      document.querySelectorAll('#pane-ops .op.rec .op-t'),
      function (e) { return e.textContent.replace(/\s+/g, ' ').trim(); }).slice(0, 4);

    // 推荐的一定排在该组最前面
    out.recFirstInGroup = (function () {
      var ok = true;
      document.querySelectorAll('#pane-ops .pane-title').forEach(function (t) {
        var sib = t.nextElementSibling;
        var sawRec = false, sawPlain = false;
        while (sib && !sib.classList.contains('pane-title')) {
          if (sib.classList.contains('op')) {
            if (sib.classList.contains('rec')) { if (sawPlain) ok = false; sawRec = true; }
            else sawPlain = true;
          }
          sib = sib.nextElementSibling;
        }
        void sawRec;
      });
      return ok;
    })();

    // 完整路线可以展开
    var btn = $('planShow');
    out.hasRouteBtn = !!btn;
    if (btn) {
      btn.click();
      out.routeVisible = !$('planRoute').hidden;
      out.routeSteps = document.querySelectorAll('#planRoute .plan-step').length;
      btn.click();
      out.routeHiddenAgain = $('planRoute').hidden;
    }

    // ---------- 2. 点推荐的那一步，确认能执行并重新规划 ----------
    var recOp = document.querySelector('#pane-ops .op.rec');
    var stepsBefore = document.querySelectorAll('#pane-steps .step').length;
    if (recOp) recOp.click();
    out.clickWorked = document.querySelectorAll('#pane-steps .step').length > stepsBefore;

    var bar2 = await waitFor(function () {
      return document.querySelector('#pane-ops .plan-bar.ok');
    }, 20000);
    out.replanAfterStep = !!bar2;
    out.replanText = bar2 ? bar2.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : '';

    // ---------- 3. 一路点推荐，看能不能真的化到最简 ----------
    var guard = 0;
    while (guard++ < 12) {
      var b = document.querySelector('#pane-ops .plan-bar.ok');
      if (b && /最短\s*0\s*步|最短\s*1\s*步/.test(b.textContent) === false && !document.querySelector('#pane-ops .op')) break;
      var r = document.querySelector('#pane-ops .op.rec') || document.querySelector('#pane-ops .op');
      if (!r) break;
      var m = /最短 (\d+) 步/.exec((b || {}).textContent || '');
      if (m && m[1] === '0') break;
      r.click();
      /* 等规划刷新 */
      await waitFor(function () { return document.querySelector('#pane-ops .plan-bar'); }, 12000);
    }
    out.autoSolvedBlocks = app.state.diagram.blocks.length;
    out.autoSolvedRemain = $('stRemain').textContent;

    return out;
  } catch (err) {
    return { __error: String(err && err.stack ? err.stack : err), partial: out };
  }
})()
