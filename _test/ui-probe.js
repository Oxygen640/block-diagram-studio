/* ============================================================================
 *  ui-probe.js  ——  在渲染进程里跑的自检脚本（由 ui-test.js 注入执行）
 *  这里可以直接用 node --check 做语法检查
 * ==========================================================================*/
(function () {
  try {
    var out = {};

    // 1) 初始渲染是否正常
    out.blocksRendered = document.querySelectorAll('#blocks .blk').length;
    out.wiresRendered = document.querySelectorAll('#wires path').length;
    out.opCount = document.querySelectorAll('#pane-ops .op').length;
    out.badge = document.getElementById('opBadge').textContent;
    out.remainText = document.getElementById('stRemain').textContent;

    // 1b) 双击改名的关键：mousedown 不能把方块 DOM 重建掉
    var blk0 = document.querySelector('#blocks .blk.gain');
    var r0 = blk0.getBoundingClientRect();
    var cx0 = r0.left + r0.width / 2, cy0 = r0.top + r0.height / 2;
    blk0.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx0, clientY: cy0 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    var blk0after = document.querySelector('#blocks .blk.gain');
    out.blockElementPreserved = (blk0 === blk0after);

    blk0after.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    out.renameModalOpened = document.getElementById('modal').classList.contains('on');
    out.renameHasInput = !!document.getElementById('mdInput');
    out.renameDefaultValue = document.getElementById('mdInput')
      ? document.getElementById('mdInput').value : '';
    document.getElementById('mdCancel').click();
    out.renameModalClosed = !document.getElementById('modal').classList.contains('on');

    // 1c) 拖动连线中间的拐线段（竖直段用横向拖，水平段用纵向拖）
    var app = window.__BDS_APP__;
    var dg = app.state.diagram;
    var tgt = null, segPt = null, segIsH = false, segIdx = -1;
    for (var i = 0; i < dg.edges.length && !tgt; i++) {
      var pts = BDS.router.route(dg, dg.edges[i]);
      for (var k = 1; k < pts.length - 2; k++) {
        tgt = dg.edges[i];
        segIdx = k;
        segIsH = pts[k].y === pts[k + 1].y;
        segPt = { x: (pts[k].x + pts[k + 1].x) / 2, y: (pts[k].y + pts[k + 1].y) / 2 };
        break;
      }
    }
    out.foundDraggableSegment = !!tgt;
    out.dragSegmentOrientation = segIsH ? '水平段' : '竖直段';
    if (tgt) {
      var sc = app.state.view.scale || 1;
      var cRect = document.getElementById('canvas').getBoundingClientRect();
      var mx = cRect.left + segPt.x * sc, my = cRect.top + segPt.y * sc;
      var nx = mx + (segIsH ? 0 : 70);
      var ny = my + (segIsH ? 70 : 0);

      var hitEl = document.querySelector('#wires .hit[data-edge="' + tgt.id + '"]');
      var dBefore = hitEl.getAttribute('d');
      hitEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: mx, clientY: my }));
      out.wireDragArmed = !!app.state.wire;
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: nx, clientY: ny }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      var afterEl = document.querySelector('#wires .hit[data-edge="' + tgt.id + '"]');
      out.wireRouteChanged = afterEl.getAttribute('d') !== dBefore;
      out.wireOrthogonalAfterDrag =
        BDS.router.isOrthogonal(BDS.router.route(app.state.diagram, tgt));
      out.wireRouteSaved = !!tgt.route;
      // 双击连线恢复自动走线
      afterEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      out.wireRouteReset = !tgt.route;
    }

    // 1d) 所有已渲染连线都是折线（路径里只有 M/L，没有曲线命令）
    out.allWiresArePolylines = Array.prototype.every.call(
      document.querySelectorAll('#wires path:not(.hit)'),
      function (p) { return /^M[^CQSTA]*$/.test(p.getAttribute('d') || ''); });

    // 1e) 视图：缩放 / 平移
    var wrap = document.getElementById('canvas-wrap');
    var wr = wrap.getBoundingClientRect();

    out.zoomLabelFit = document.getElementById('zoomLabel').textContent;
    document.getElementById('zoomIn').click();
    out.zoomAfterIn = document.getElementById('zoomLabel').textContent;
    document.getElementById('zoomOut').click();
    out.zoomAfterOut = document.getElementById('zoomLabel').textContent;

    wrap.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: -120,
      clientX: wr.left + 200, clientY: wr.top + 200
    }));
    out.zoomAfterWheel = document.getElementById('zoomLabel').textContent;
    out.viewHasTransform = /scale\(/.test(document.getElementById('canvas').style.transform);

    var tx0 = app.state.view.tx, ty0 = app.state.view.ty;
    wrap.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 1,
      clientX: wr.left + 300, clientY: wr.top + 300
    }));
    out.panArmed = !!app.state.pan;
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: wr.left + 380, clientY: wr.top + 340
    }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    out.panMoved = (app.state.view.tx !== tx0 || app.state.view.ty !== ty0);
    out.panReleased = !app.state.pan;

    // 还原视图，免得影响后面的检查
    document.getElementById('zoomFit').click();
    out.zoomAfterFit = document.getElementById('zoomLabel').textContent;

    // 1f) 端口：每个非输出方块四侧各一个拉线点
    out.portDots = document.querySelectorAll('#blocks .port').length;
    out.portDotsRight = document.querySelectorAll('#blocks .port[data-side="right"]').length;
    out.signBadges = document.querySelectorAll('#blocks .sign').length;

    // 1g) 右键菜单里有"方位"按钮行
    var blkCtx = document.querySelector('#blocks .blk.gain');
    blkCtx.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 500, clientY: 300
    }));
    out.ctxMenuOpen = document.getElementById('ctxmenu').classList.contains('on');
    out.ctxSideRows = document.querySelectorAll('#ctxmenu .rowbtns').length;
    out.ctxSideButtons = document.querySelectorAll('#ctxmenu .rb').length;
    out.ctxHasRename = document.getElementById('ctxmenu').textContent.indexOf('重命名') >= 0;
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    out.ctxMenuClosed = !document.getElementById('ctxmenu').classList.contains('on');

    // 1h) 展开式
    out.hasExpandedSection = document.getElementById('pane-mason').textContent.indexOf('展开式') >= 0;
    out.expandedText = (document.getElementById('pane-mason').textContent || '')
      .replace(/\s+/g, ' ').slice(0, 400);

    // 1i) LaTeX 分式框 + 代码 + 导出按钮
    out.hasFracBox = !!document.querySelector('#pane-mason .frac-box');
    out.hasFracParts = !!document.querySelector('#pane-mason .fx-num') &&
                       !!document.querySelector('#pane-mason .fx-den') &&
                       !!document.querySelector('#pane-mason .fx-bar');
    var texEl = document.querySelector('#pane-mason .tex-code');
    out.texCode = texEl ? texEl.textContent.slice(0, 120) : '';
    out.texHasFrac = (texEl ? texEl.textContent : '').indexOf('\\frac') >= 0;
    out.exportBtns = document.querySelectorAll('#pane-mason button[data-act]').length;
    out.copyTexBtn = !!document.querySelector('#pane-mason button[data-act="copy-tex"]');
    out.saveTexBtn = !!document.querySelector('#pane-mason button[data-act="save-tex"]');
    out.exportPngBtn = !!document.querySelector('#pane-mason button[data-act="export-png"]');

    // 1j) Canvas 绘图：尺寸与清晰度可控
    var cv1 = BDS.latex.drawFormula({ num: 'G1G2', den: '1 + G1H1', width: 800, scale: 2 });
    out.canvasPx = cv1.width + 'x' + cv1.height;
    out.canvasScaleOk = cv1.width === 1600;
    var cv2 = BDS.latex.drawFormula({ num: 'G1G2', den: '1 + G1H1', width: 400, scale: 1 });
    out.canvasWidthOk = cv2.width === 400;
    out.canvasHasPixels = (function () {
      var c = BDS.latex.drawFormula({ num: 'G1G2', den: '1 + G1H1', width: 800, scale: 1 });
      var g = c.getContext('2d');
      var data = g.getImageData(0, 0, c.width, c.height).data;
      var painted = 0;
      for (var i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
      return painted > 500;
    })();

    // 1k) 悬停「可执行操作」→ 高亮相关元件
    var opCards = document.querySelectorAll('#pane-ops .op');
    out.opCards = opCards.length;
    out.hlBlocks = 0; out.hlWires = 0;
    if (opCards.length) {
      opCards[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      out.hlBlocks = document.querySelectorAll('#blocks .blk.hl').length;
      out.hlWires = document.querySelectorAll('#wires path.wire.hl').length;
      opCards[0].dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      out.hlCleared = document.querySelectorAll('#blocks .blk.hl').length === 0 &&
                      document.querySelectorAll('#wires path.wire.hl').length === 0;
    }

    // 2) 梅森面板是否有内容
    var mas = document.getElementById('pane-mason').textContent || '';
    out.masonHasDelta = mas.indexOf('Δ') >= 0;
    out.masonHasResult = mas.indexOf('总传递函数') >= 0;

    // 3) 点第一个操作，看步骤有没有记录
    var firstOp = document.querySelector('#pane-ops .op');
    if (firstOp) firstOp.click();
    out.stepsAfterOneClick = document.querySelectorAll('#pane-steps .step').length;

    // 4) 点「自动化简」
    document.getElementById('btnAuto').click();
    out.stepsAfterAuto = document.querySelectorAll('#pane-steps .step').length;
    out.blocksAfterAuto = document.querySelectorAll('#blocks .blk').length;
    out.remainAfterAuto = document.getElementById('stRemain').textContent;

    // 5) 撤销能不能回退（步骤列表会保留"未来步骤"并灰显，所以看当前指针）
    var curEl = document.querySelector('#pane-steps .step.cur');
    out.stepCurBeforeUndo = curEl ? curEl.dataset.step : '';
    document.getElementById('btnUndo').click();
    var curEl2 = document.querySelector('#pane-steps .step.cur');
    out.stepCurAfterUndo = curEl2 ? curEl2.dataset.step : '';
    out.futureSteps = document.querySelectorAll('#pane-steps .step.future').length;

    // 6) 切到例题二，确认出现「移动」类操作
    var sel = document.getElementById('demoSel');
    sel.value = 'needMove';
    sel.dispatchEvent(new Event('change'));
    var kinds = {};
    document.querySelectorAll('#pane-ops .op').forEach(function (el) {
      kinds[el.dataset.kind] = (kinds[el.dataset.kind] || 0) + 1;
    });
    out.needMoveKinds = JSON.stringify(kinds);

    // 7) 执行一个「移动」操作，确认步骤被记录
    var moveOp = document.querySelector('#pane-ops .op[data-kind^="tap"], #pane-ops .op[data-kind^="sum"]');
    out.hasMoveOp = !!moveOp;
    if (moveOp) moveOp.click();
    out.stepsAfterMove = document.querySelectorAll('#pane-steps .step').length;

    // 8) 切 tab
    document.querySelector('.tab[data-tab="mason"]').click();
    out.masonTabActive = document.getElementById('pane-mason').classList.contains('active');

    // 9) 帮助弹窗
    document.getElementById('btnHelp').click();
    out.helpModalOpen = document.getElementById('modal').classList.contains('on');
    document.getElementById('mdOk').click();
    out.helpModalClosed = !document.getElementById('modal').classList.contains('on');

    // 10) 打开/保存按钮存在且可用（不真的触发系统对话框）
    out.hasOpenBtn = !!document.getElementById('btnOpen');
    out.hasSaveBtn = !!document.getElementById('btnSave');
    out.saveBtnHasHandler = typeof document.getElementById('btnSave').onclick === 'function';
    out.openBtnHasHandler = typeof document.getElementById('btnOpen').onclick === 'function';

    // 11) 自动理线 / 自动排版（放在最后，避免影响前面的计数）
    var dg3 = app.state.diagram;
    var edgeCount = dg3.edges.length;
    document.getElementById('btnWire').click();
    out.wireKeptEdges = app.state.diagram.edges.length === edgeCount;
    out.wireStillOrthogonal = app.state.diagram.edges.every(function (e) {
      var pts = (app.state.pts && app.state.pts[e.id]) || [];
      return BDS.router.isOrthogonal(pts);
    });
    out.wireNoManualRoute = app.state.diagram.edges.every(function (e) { return !e.route; });
    out.wireOverlap = BDS.router.totalOverlap(app.state.diagram);

    var posBefore = app.state.diagram.blocks.map(function (b) { return b.x + ',' + b.y; }).join(';');
    document.getElementById('btnLayout').click();
    var posAfter = app.state.diagram.blocks.map(function (b) { return b.x + ',' + b.y; }).join(';');
    out.layoutMoved = posBefore !== posAfter;
    out.layoutOverlap = BDS.router.totalOverlap(app.state.diagram);
    out.layoutCrossings = BDS.router.totalCrossings(app.state.diagram);
    out.layoutOrthogonal = app.state.diagram.edges.every(function (e) {
      var pts = (app.state.pts && app.state.pts[e.id]) || [];
      return BDS.router.isOrthogonal(pts);
    });
    out.layoutNoOverlap = (function () {
      var bs = app.state.diagram.blocks;
      for (var i = 0; i < bs.length; i++) {
        for (var j = i + 1; j < bs.length; j++) {
          var a = bs[i], b = bs[j];
          if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) return false;
        }
      }
      return true;
    })();

    // 例题二也排版一次
    var sel2 = document.getElementById('demoSel');
    sel2.value = 'needMove';
    sel2.dispatchEvent(new Event('change'));
    document.getElementById('btnLayout').click();
    out.layout2Overlap = BDS.router.totalOverlap(app.state.diagram);
    out.layout2Crossings = BDS.router.totalCrossings(app.state.diagram);

    // 渲染性能：连续算 40 次全部走线取平均
    var t0 = performance.now();
    for (var k = 0; k < 40; k++) BDS.router.routeAll(app.state.diagram);
    out.routeAllMs = Math.round((performance.now() - t0) / 40 * 100) / 100;

    return out;
  } catch (err) {
    return { __error: String(err && err.stack ? err.stack : err) };
  }
})()
