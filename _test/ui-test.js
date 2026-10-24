/* ============================================================================
 *  ui-test.js  ——  用 Electron 无界面地把界面跑一遍，验证渲染与交互接线。
 *  运行： npx electron _test/ui-test.js
 *  探测脚本在 _test/ui-probe.js（可在渲染进程里执行，能单独做语法检查）
 * ==========================================================================*/
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const errors = [];
const logs = [];

// 无界面运行
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1500, height: 940, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });

  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    logs.push('[' + level + '] ' + message);
    // Electron 自己在开发模式下的安全提示不算错误
    if (/Security Warning|Content Security Policy|devtools/i.test(message)) return;
    if (level >= 2) errors.push(message + '  @' + sourceId + ':' + line);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    errors.push('渲染进程崩溃: ' + JSON.stringify(d));
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    errors.push('页面加载失败 ' + code + ' ' + desc);
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  await new Promise(r => setTimeout(r, 800));

  let result;
  try {
    const code = fs.readFileSync(path.join(__dirname, 'ui-probe.js'), 'utf8');
    result = await win.webContents.executeJavaScript(code);
  } catch (e) {
    console.log('探针执行失败：' + e.message);
    console.log('--- 渲染进程日志 ---');
    logs.forEach(l => console.log('  ' + l));
    errors.forEach(l => console.log('  [ERR] ' + l));
    app.exit(1);
    return;
  }

  if (result && result.__error) {
    console.log('探针内部抛错：\n' + result.__error);
    app.exit(1);
    return;
  }

  console.log('===== 界面自检结果 =====');
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) {
    console.log('\n===== 页面错误 =====');
    errors.forEach(e => console.log('  ' + e));
  } else {
    console.log('\n没有捕获到页面错误 ✔');
  }

  const checks = [];
  function need(cond, label) {
    checks.push({ ok: !!cond, label: label });
  }

  need(errors.length === 0, '没有页面错误');
  need(result.blocksRendered === 9, '初始渲染 9 个元件');
  need(result.opCount > 0, '有可执行操作');
  need(result.blockElementPreserved, 'mousedown 不重建方块 DOM（双击改名前提）');
  need(result.renameModalOpened, '双击弹出改名框');
  need(result.renameHasInput, '改名框有输入框');
  need(result.renameModalClosed, '改名框能关闭');
  need(result.foundDraggableSegment, '找到可拖动的连线线段');
  need(result.wireDragArmed, '连线拖动已武装');
  need(result.wireRouteChanged, '拖动后走线改变');
  need(result.wireOrthogonalAfterDrag, '拖动后仍然横平竖直');
  need(result.wireRouteReset, '双击连线恢复自动走线');
  need(result.allWiresArePolylines, '所有连线都是折线');
  need(result.viewHasTransform, '画布应用了缩放变换');
  need(result.panArmed, '中键按下进入平移');
  need(result.panMoved, '中键拖动改变了视图');
  need(result.panReleased, '松开中键结束平移');
  need(result.zoomAfterIn !== result.zoomLabelFit, '放大按钮生效');
  need(result.zoomAfterWheel !== result.zoomAfterOut, '滚轮缩放生效');
  need(result.portDots > 0, '方块有端口拉线点');
  need(result.portDotsRight > 0, '右侧端口点存在');
  need(result.signBadges > 0, '相加点正负号显示正常');
  need(result.ctxMenuOpen, '右键菜单能弹出');
  need(result.ctxSideRows === 2, '右键菜单有两行方位按钮（预期 2，实际 ' + result.ctxSideRows + '）');
  need(result.ctxSideButtons === 8, '方位按钮共 8 个（预期 8，实际 ' + result.ctxSideButtons + '）');
  need(result.ctxHasRename, '右键菜单里有重命名');
  need(result.ctxMenuClosed, '点击别处能关闭菜单');
  need(result.hasExpandedSection, '结果面板有展开式');
  need(result.hasFracBox, '有分式显示框');
  need(result.hasFracParts, '分式框里分子/分母/分数线齐全');
  need(result.texHasFrac, 'LaTeX 代码里有 \\frac');
  need(result.exportBtns === 3, '有 3 个导出按钮（复制/保存/图片）');
  need(result.copyTexBtn && result.saveTexBtn && result.exportPngBtn, '三个按钮都找到了');
  need(result.canvasScaleOk, 'Canvas 清晰度倍数生效（800×2 = 1600px）');
  need(result.canvasWidthOk, 'Canvas 宽度可调（400×1 = 400px）');
  need(result.canvasHasPixels, 'Canvas 真的画出了内容');
  need(result.opCards > 0, '有操作卡片可悬停');
  need(result.hlBlocks > 0, '悬停操作时高亮相关方块（' + result.hlBlocks + ' 个）');
  need(result.hlWires > 0, '悬停操作时高亮相关连线（' + result.hlWires + ' 条）');
  need(result.hlCleared, '移开鼠标后高亮消失');
  need(result.wireKeptEdges, '自动理线不增删连线');
  need(result.wireStillOrthogonal, '自动理线后走线仍横平竖直');
  need(result.wireNoManualRoute, '自动理线清除了手工走线');
  need(result.wireOverlap < 1, '自动理线后没有连线重叠（' + Number(result.wireOverlap).toFixed(0) + ' px）');
  need(result.layoutMoved, '自动排版移动了元件');
  need(result.layoutOrthogonal, '自动排版后走线仍横平竖直');
  need(result.layoutNoOverlap, '自动排版后元件不重叠');
  need(result.layoutOverlap < 1, '例题一排版后没有连线重叠（' + Number(result.layoutOverlap).toFixed(0) + ' px）');
  need(result.layoutCrossings <= 2, '例题一排版后交叉很少（' + result.layoutCrossings + ' 处）');
  need(result.layout2Overlap < 1, '例题二排版后没有连线重叠（' + Number(result.layout2Overlap).toFixed(0) + ' px）');
  need(result.routeAllMs < 40, '全部走线一次耗时 ' + result.routeAllMs + ' ms（<40 才拖得流畅）');
  need(result.stepsAfterOneClick === 2, '点一次操作记录一步');
  need(result.stepsAfterAuto > result.stepsAfterOneClick, '自动化简产生多步');
  need(result.blocksAfterAuto <= 3, '自动化简后元件数减少');
  need(Number(result.stepCurAfterUndo) === Number(result.stepCurBeforeUndo) - 1, '撤销能回退一步');
  need(result.futureSteps > 0, '回退后保留灰显的未来步骤');
  need(result.hasMoveOp, '例题二有移动类操作');
  need(result.stepsAfterMove === 2, '移动操作被记录成一步');
  need(result.masonHasResult, '结果面板有传递函数');
  need(result.helpModalOpen, '帮助能打开');
  need(result.helpModalClosed, '帮助能关闭');
  need(result.hasOpenBtn && result.hasSaveBtn, '打开/保存按钮存在');
  need(result.saveBtnHasHandler && result.openBtnHasHandler, '打开/保存按钮已接线');

  // ---------------- 第二轮：化简规划（推荐步骤）----------------
  let plan;
  try {
    const code2 = fs.readFileSync(path.join(__dirname, 'plan-probe.js'), 'utf8');
    plan = await win.webContents.executeJavaScript(code2);
  } catch (e) {
    plan = { __error: e.message };
  }
  if (plan && plan.__error) {
    console.log('规划探针内部抛错：\n' + plan.__error);
    checks.push({ ok: false, label: '规划探针能跑完' });
  } else {
    console.log('\n===== 规划自检结果 =====');
    console.log(JSON.stringify(plan, null, 2));
    need(plan.oracleAcceptsLegal, '守门人放行合法操作');
    need(plan.oracleRejectsBroken, '守门人能拦下会改变传递函数的操作');
    need(plan.legalCount > 0, '界面只列出合法操作（' + plan.legalCount + '/' + plan.scanCount + ' 条）');
    need(plan.uiOpCount === plan.legalCount,
         '界面卡片数与合法操作数一致（' + plan.uiOpCount + ' = ' + plan.legalCount + '）');
    need(plan.busyOrDone, '切换图纸后立刻有规划状态提示');
    need(plan.planBarShown, '算出了最短路线结论条');
    need(/最短 \d+ 步/.test(plan.planText || ''), '结论条写明了最少步数（' + plan.planText + '）');
    need(plan.recCount > 0, '有推荐步骤标记（' + plan.recCount + ' 个）');
    need((plan.recTagText || '').indexOf('推荐') >= 0, '推荐步骤带「★ 推荐」标签');
    need(plan.recFirstInGroup, '推荐步骤排在该组最前面');
    need(plan.hasRouteBtn, '有「查看完整路线」按钮');
    need(plan.routeVisible && plan.routeSteps > 0, '完整路线能展开（' + plan.routeSteps + ' 步）');
    need(plan.routeHiddenAgain, '路线能收起');
    need(plan.clickWorked, '点推荐步骤能执行');
    need(plan.replanAfterStep, '执行后重新规划出新的路线');
    need(plan.autoSolvedBlocks <= 3, '一路跟着推荐走能化到最简（剩 ' + plan.autoSolvedBlocks + ' 个元件）');
  }

  const failed = checks.filter(c => !c.ok);
  console.log('\n----- 逐项检查（' + checks.length + ' 项）-----');
  checks.forEach(c => console.log((c.ok ? '  ✔ ' : '  ✘ ') + c.label));

  console.log('\n' + (failed.length === 0
    ? '界面自检通过 ✔  (' + checks.length + ' 项)'
    : failed.length + ' 项未通过 ✘'));
  app.exit(failed.length === 0 ? 0 : 1);
});
