/* ============================================================================
 *  ui.js  ——  界面与交互
 * ==========================================================================*/
(function () {
  'use strict';

  var M = BDS.model, EN = BDS.engine, MA = BDS.mason, RT = BDS.router,
      RAT = BDS.rat, LAT = BDS.latex;

  /* ------------------------------ 状态 ------------------------------ */

  var state = {
    diagram: M.blank(),
    history: [{ diagram: M.blank(), text: '空白画布' }],
    hi: 0,
    ops: [],
    sel: null,
    linking: null,
    drag: null,
    wire: null,
    pan: null,
    view: { scale: 1, tx: 0, ty: 0 },
    tab: 'ops'
  };

  var $ = function (id) { return document.getElementById(id); };
  var elCanvas = $('canvas');
  var elWires = $('wires');
  var elBlocks = $('blocks');
  var elTip = $('tip');
  var elCtx = $('ctxmenu');

  var KIND_CN = {
    series: '串联', parallel: '并联', feedback: '反馈',
    sumBack: '相加点', sumFwd: '相加点', tapBack: '引出点', tapFwd: '引出点',
    sumMerge: '相加点', tapMerge: '引出点',
    swapSum: '交换', swapTap: '交换'
  };
  // 引擎里「引出点后移」和「分支点后移跨过方块」共用 tapBack 代号，
  // 两者靠标题区分，配色统一按引出点处理。

  /* ------------------------------ 小工具 ------------------------------ */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var tipTimer = null;
  function toast(msg, ms) {
    elTip.textContent = msg;
    elTip.style.display = 'block';
    clearTimeout(tipTimer);
    tipTimer = setTimeout(function () { elTip.style.display = 'none'; }, ms || 2200);
  }

  function canvasPoint(ev) {
    var r = elCanvas.getBoundingClientRect();
    var s = state.view.scale || 1;
    return { x: (ev.clientX - r.left) / s, y: (ev.clientY - r.top) / s };
  }

  /* ------------------------------ 视图（缩放 / 平移） ------------------------------ */

  var elWrap = $('canvas-wrap');

  function applyView() {
    var v = state.view;
    elCanvas.style.transform =
      'translate(' + Math.round(v.tx) + 'px,' + Math.round(v.ty) + 'px) scale(' + v.scale + ')';
    $('zoomLabel').textContent = Math.round(v.scale * 100) + '%';
  }

  function setScale(next, cx, cy) {
    // (cx, cy) 是相对 #canvas-wrap 的视口坐标；不传则以视口中心为基准
    var v = state.view;
    next = Math.max(0.2, Math.min(4, next));
    var w = elWrap.clientWidth, h = elWrap.clientHeight;
    if (cx == null) { cx = w / 2; cy = h / 2; }
    var mx = (cx - v.tx) / v.scale;   // 缩放前鼠标处的画布坐标
    var my = (cy - v.ty) / v.scale;
    v.scale = next;
    v.tx = cx - mx * next;
    v.ty = cy - my * next;
    applyView();
  }

  function zoomBy(factor, cx, cy) { setScale(state.view.scale * factor, cx, cy); }

  /** 把画布尺寸包住所有元件（不动视图） */
  function fitCanvas() {
    var d = state.diagram;
    if (!d.blocks.length) {
      elCanvas.style.width = '1200px';
      elCanvas.style.height = '760px';
      renderWires();
      return;
    }
    var maxX = 0, maxY = 0;
    d.blocks.forEach(function (b) {
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    });
    elCanvas.style.width = Math.max(900, maxX + 200) + 'px';
    elCanvas.style.height = Math.max(520, maxY + 200) + 'px';
    renderWires();
  }

  /** 让全部内容刚好落在视口里 */
  function fitView() {
    fitCanvas();
    var cw = parseFloat(elCanvas.style.width) || 1200;
    var ch = parseFloat(elCanvas.style.height) || 760;
    var w = elWrap.clientWidth, h = elWrap.clientHeight;
    var s = Math.min(w / cw, h / ch);
    s = Math.max(0.2, Math.min(1.6, s));
    state.view.scale = s;
    state.view.tx = Math.max(0, (w - cw * s) / 2);
    state.view.ty = Math.max(0, (h - ch * s) / 2);
    applyView();
  }

  /* ------------------------------ 历史 ------------------------------ */

  function resetHistory(d, label) {
    state.diagram = M.clone(d);
    state.history = [{ diagram: M.clone(d), text: label || '初始结构图' }];
    state.hi = 0;
    state.sel = null;
    render();
    fitView();
  }

  /** 把当前位置的改动（改名、挪位置、调走线）写回当前快照，不产生新的化简步骤 */
  function syncSnapshot() {
    state.history[state.hi] = {
      diagram: M.clone(state.diagram),
      text: state.history[state.hi].text
    };
  }

  function pushStep(d, text) {
    state.history = state.history.slice(0, state.hi + 1);
    state.history.push({ diagram: M.clone(d), text: text });
    state.hi = state.history.length - 1;
    state.diagram = M.clone(d);
  }

  function gotoStep(i) {
    if (i < 0 || i >= state.history.length) return;
    state.hi = i;
    state.diagram = M.clone(state.history[i].diagram);
    state.sel = null;
    render();
  }

  /* ------------------------------ 渲染 ------------------------------ */

  function render() {
    renderWires();
    renderBlocks();
    renderOps();
    renderSteps();
    renderMason();
    renderStatus();
  }

  function pathOf(pts) {
    if (!pts || pts.length < 2) return '';
    var s = 'M ' + pts[0].x + ' ' + pts[0].y;
    for (var i = 1; i < pts.length; i++) s += ' L ' + pts[i].x + ' ' + pts[i].y;
    return s;
  }

  function renderWires() {
    var d = state.diagram;
    // 一次算完全部走线：先走的线会被后面的线当成障碍，避免两条线压在一起
    state.pts = RT.routeAll(d);

    var out = [];
    out.push('<defs><marker id="arw" viewBox="0 0 10 10" refX="9.5" refY="5" ' +
             'markerWidth="7" markerHeight="7" orient="auto">' +
             '<path d="M 0 0 L 10 5 L 0 10 z" fill="#334155"/></marker></defs>');

    d.edges.forEach(function (e) {
      var pts = state.pts[e.id] || [];
      if (pts.length < 2) return;
      var dstr = pathOf(pts);
      out.push('<path class="wire" data-edge="' + e.id + '" d="' + dstr + '" fill="none" ' +
               'stroke="#334155" stroke-width="2" stroke-linejoin="round" marker-end="url(#arw)"/>');
      out.push('<path class="hit" d="' + dstr + '" fill="none" stroke="rgba(0,0,0,0)" ' +
               'stroke-width="16" data-edge="' + e.id + '"/>');
    });

    elWires.innerHTML = out.join('');
    elWires.setAttribute('width', elCanvas.style.width || 1400);
    elWires.setAttribute('height', elCanvas.style.height || 800);
  }

  /** 取一条连线当前的折线顶点 */
  function wirePts(e) {
    if (state.pts && state.pts[e.id]) return state.pts[e.id];
    return RT.route(state.diagram, e);
  }

  function renderBlocks() {
    var d = state.diagram;
    var out = [];

    d.blocks.forEach(function (b) {
      var style = 'left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px;';
      var cls = 'blk ' + b.type + (state.sel === b.id ? ' sel' : '');
      var inner;

      if (b.type === 'sum') inner = '<span class="lbl">Σ</span>';
      else if (b.type === 'takeoff') inner = '';
      else inner = '<span class="lbl">' + esc(b.label) + '</span>';

      out.push('<div class="' + cls + '" data-id="' + b.id + '" style="' + style + '">' +
               inner + '</div>');
    });

    // 各侧端口小圆点（用于拉线；输出块不需要）
    d.blocks.forEach(function (b) {
      if (b.type === 'output') return;
      M.SIDES.forEach(function (side) {
        var px, py;
        if (side === 'left')       { px = b.x - 7;           py = b.y + b.h / 2 - 6; }
        else if (side === 'right') { px = b.x + b.w - 5;     py = b.y + b.h / 2 - 6; }
        else if (side === 'top')   { px = b.x + b.w / 2 - 6; py = b.y - 7; }
        else                       { px = b.x + b.w / 2 - 6; py = b.y + b.h - 5; }
        out.push('<div class="port" data-port="' + b.id + '" data-side="' + side + '" ' +
                 'title="从这里拖出连线（' + M.SIDE_CN[side] + '侧出线）" ' +
                 'style="left:' + px + 'px;top:' + py + 'px;"></div>');
      });
    });

    // 相加点的 + / − 号（跟着端口方位走）
    d.edges.forEach(function (e) {
      var T = M.block(d, e.to);
      if (!T || T.type !== 'sum') return;
      var p = M.portAt(d, e.id, 'to');
      if (!p) return;
      var bx = p.x + p.nx * 15, by = p.y + p.ny * 15;
      var minus = e.sign === '-';
      out.push('<div class="sign' + (minus ? ' minus' : '') + '" data-sign="' + e.id + '" ' +
               'title="点击切换正负号" ' +
               'style="left:' + (bx - 8) + 'px;top:' + (by - 8) + 'px;">' +
               (minus ? '−' : '+') + '</div>');
    });

    elBlocks.innerHTML = out.join('');
  }

  /* ======================================================================
   *  化简路线规划
   *
   *  目标：在「可执行操作」里标出**推荐步骤** —— 也就是"走在通往最简
   *  形式的最短路线上的那一步"。
   *
   *  两件事必须做对：
   *    1. 候选操作要先过数值守门人（verify.js）。框图化简的每条基本变换
   *       都有适用条件，条件不满足时硬套公式，图看着像对的，传递函数
   *       早就变了。这种操作绝不能出现在列表里，更不能被推荐。
   *    2. 大图搜索很费时间，不能一次算完把界面卡死。
   *       所以用 PL.makeSearch 分片跑，每片 40ms，算完再刷新界面。
   * ==================================================================== */

  var PL = BDS.planner;
  var planCache = { key: null, data: null };

  function planKey() {
    try { return PL.canonical(state.diagram); } catch (e) { return null; }
  }

  var planRun = null;          // 正在进行的规划任务

  function cancelPlan() {
    if (planRun) { planRun.cancelled = true; planRun = null; }
  }

  /** 启动一次（可中断、分片的）路线规划 */
  function startPlan() {
    cancelPlan();
    var key = planKey();
    if (key === null) return;
    if (planCache.key === key) return;            // 已经算过这张图了

    var job = { key: key, cancelled: false, phase: 'search' };
    planRun = job;

    var diagram = M.clone(state.diagram);
    var searcher;
    try {
      searcher = PL.makeSearch(diagram, { frontierCap: 400, msBudget: 8000 });
    } catch (e) { planRun = null; return; }

    var result = null;

    function chunk() {
      if (job.cancelled || planRun !== job) return;
      var r;
      try { r = searcher.runChunk(40); }
      catch (e) { planRun = null; return; }

      if (!r.done) {
        setTimeout(chunk, 0);                        // 下一帧继续，界面不卡
        return;
      }

      // 搜索完了，接着逐条操作算"走完它还剩几步"
      var res = r.result;
      result = {
        solvable: !!res.path,
        steps: res.path ? res.path.length : -1,
        cost: res.path ? res.cost - res.path.length * 1000 : -1,
        path: res.path || [],
        truncated: !!res.truncated,
        recommend: [],
        annotated: []
      };
      annotate(res.steps);
    }

    function annotate(bestSteps) {
      var ops = planOps;                            // 与界面列表一一对应
      var frac0 = PL.hasFraction(diagram);
      var limit = bestSteps > 0 ? bestSteps - 1 : 8;
      var perOp = Math.max(60, Math.min(500, Math.round(1500 / Math.max(1, ops.length))));
      var i = 0;

      function step() {
        if (job.cancelled || planRun !== job) return;
        var until = Date.now() + 40;
        while (i < ops.length && Date.now() < until) {
          var op = ops[i];
          var one = M.clone(diagram);
          var rem = null, known = false, c0 = 30;
          try {
            if (!op.run(one)) { rem = null; known = false; }
            else {
              c0 = PL.stepCost(op, frac0, PL.hasFraction(one));
              if (PL.isSolved(one)) { rem = 0; known = true; }
              else { rem = PL.restSteps(one, Math.max(0, limit), Date.now() + perOp); known = rem !== null; }
            }
          } catch (e) { rem = null; known = false; }
          result.annotated[i] = { op: op, remaining: rem, remainingKnown: known, step: c0 };
          i++;
        }
        if (i < ops.length) { setTimeout(step, 0); return; }

        // 推荐：剩余步数最少的那些；同样少时挑这一步最干净的
        var minRemain = Infinity;
        result.annotated.forEach(function (a) {
          if (a.remaining !== null && a.remaining < minRemain) minRemain = a.remaining;
        });
        if (isFinite(minRemain)) {
          var minStep = Infinity;
          result.annotated.forEach(function (a) {
            if (a.remaining === minRemain && a.step < minStep) minStep = a.step;
          });
          result.annotated.forEach(function (a, k) {
            if (a.remaining === minRemain && a.step === minStep) result.recommend.push(k);
          });
        }
        if (!result.recommend.length && result.path.length) {
          result.annotated.forEach(function (a, k) {
            if (a.op.kind === result.path[0].kind && a.op.title === result.path[0].title) {
              result.recommend.push(k);
              a.remaining = bestSteps - 1;
              a.remainingKnown = true;
            }
          });
        }

        planCache = { key: job.key, data: result };
        planRun = null;
        if (planKey() === job.key) renderOps();
      }
      setTimeout(step, 0);
    }

    setTimeout(chunk, 0);
  }

  var planOps = [];            // 与界面列表一一对应的操作

  /* ------------------------------ 操作面板 ------------------------------ */

  function renderOps() {
    // 只保留"不会改变传递函数"的操作
    var ops = PL.legalOps(state.diagram);
    planOps = ops;
    state.ops = ops;
    $('opBadge').textContent = ops.length;

    var pane = $('pane-ops');
    if (!ops.length) {
      var done = PL.isSolved(state.diagram);
      pane.innerHTML = '<div class="empty">' +
        (done
          ? '🎉 已经没有可执行的化简操作了。<br>结构图已经化到最简。'
          : '当前这张图上没有<b>可安全执行</b>的化简操作。<br>' +
            '常见原因是图还没画完：缺输入／输出方块，或者连线没接通；<br>' +
            '也可能剩下的操作都会改变传递函数，所以被拦住了。') +
        '<br><br><span style="color:#94a3b8">可以先用顶栏的「✦ 自动理线」整理一下连线</span></div>';
      cancelPlan();
      return;
    }

    var key = planKey();
    var plan = planCache.key === key ? planCache.data : null;

    var order = ['series', 'parallel', 'feedback', 'sumMerge', 'tapMerge',
                 'sumBack', 'sumFwd', 'tapBack', 'tapFwd', 'swapSum', 'swapTap'];
    var head = {
      series: '串联化简',
      parallel: '并联合并',
      feedback: '反馈化简',
      sumMerge: '相加点合并 / 清理',
      tapMerge: '去掉多余的引出点',
      sumBack: '移动相加点（后移）',
      sumFwd: '移动相加点（前移）',
      tapBack: '移动引出点（后移）',
      tapFwd: '移动引出点（前移）',
      swapSum: '交换相加点次序',
      swapTap: '交换引出点次序'
    };

    var html = [];

    // 顶部：规划结论
    if (plan) {
      if (plan.solvable) {
        html.push('<div class="plan-bar ok">' +
          '<b>最短 ' + plan.steps + ' 步</b>即可化到最简' +
          '<button class="plan-btn" id="planShow">查看完整路线 ▾</button>' +
          '<div class="plan-route" id="planRoute" hidden>' +
          plan.path.map(function (s, i) {
            return '<div class="plan-step"><span class="plan-n">' + (i + 1) + '</span>' +
                   esc(s.title) + '</div>';
          }).join('') +
          '</div></div>');
      } else {
        html.push('<div class="plan-bar warn">' +
          (plan.truncated
            ? '图比较大，暂时没算出完整路线（下面的推荐标记可能不全）'
            : '在当前操作范围内找不到化简到底的路线') +
          '</div>');
      }
    } else {
      html.push('<div class="plan-bar busy" id="planBusy">正在计算推荐步骤…</div>');
    }

    order.forEach(function (k) {
      var list = [];
      ops.forEach(function (o, i) {
        if (o.kind === k) list.push({ o: o, i: i });
      });
      if (!list.length) return;

      if (k === 'feedback') {
        html.push('<div class="hint">' +
          '<b>提示：</b>反馈化简前，请先确认相加点上的正负号画对了 —— ' +
          '减号表示负反馈，公式是 G/(1+GH)。</div><br>');
      }

      // 推荐的操作排到该组最前面
      list.sort(function (a, b) {
        var ra = plan && plan.recommend.indexOf(a.i) >= 0 ? 0 : 1;
        var rb = plan && plan.recommend.indexOf(b.i) >= 0 ? 0 : 1;
        return ra - rb;
      });

      html.push('<div class="pane-title">' + head[k] + '（' + list.length + '）</div>');
      list.forEach(function (it) {
        var ann = plan && plan.annotated ? plan.annotated[it.i] : null;
        var star = plan && plan.recommend.indexOf(it.i) >= 0;
        var tag = '';
        if (star) tag = '<span class="op-tag rec">★ 推荐</span>';
        else if (ann && ann.remainingKnown && ann.remaining !== null) {
          tag = '<span class="op-tag">还需 ' + ann.remaining + ' 步</span>';
        } else if (plan && plan.solvable) {
          tag = '<span class="op-tag dim">较长</span>';
        }

        html.push('<div class="op' + (star ? ' rec' : '') + '" data-kind="' + it.o.kind +
                  '" data-idx="' + it.i + '" title="点击执行这一步">' +
                  '<div class="op-t"><span class="op-title">' +
                  '<span class="op-k">' + (KIND_CN[it.o.kind] || '') + '</span>' +
                  esc(it.o.title) + '</span>' + tag + '</div>' +
                  '<div class="op-d">' + esc(it.o.desc) + '</div></div>');
      });
    });

    pane.innerHTML = html.join('');

    var btn = $('planShow');
    if (btn) {
      btn.onclick = function () {
        var box = $('planRoute');
        if (!box) return;
        box.hidden = !box.hidden;
        btn.textContent = box.hidden ? '查看完整路线 ▾' : '收起路线 ▴';
      };
    }

    // 没有现成结论就异步算一个
    if (!plan) startPlan();
  }

  /* ======================================================================
   *  悬停「可执行操作」时，把涉及的元件和连线高亮
   * ==================================================================== */

  function clearHighlight() {
    elBlocks.querySelectorAll('.blk.hl').forEach(function (el) { el.classList.remove('hl'); });
    elWires.querySelectorAll('path.wire.hl').forEach(function (el) { el.classList.remove('hl'); });
  }

  function highlightOp(op) {
    clearHighlight();
    if (!op) return;
    (op.blocks || []).forEach(function (id) {
      var el = elBlocks.querySelector('.blk[data-id="' + id + '"]');
      if (el) el.classList.add('hl');
    });
    (op.edges || []).forEach(function (id) {
      var el = elWires.querySelector('path.wire[data-edge="' + id + '"]');
      if (el) el.classList.add('hl');
    });
  }

  $('pane-ops').addEventListener('mouseover', function (ev) {
    var card = ev.target.closest('.op');
    if (!card) return;
    highlightOp(state.ops[+card.dataset.idx]);
  });

  $('pane-ops').addEventListener('mouseout', function (ev) {
    var card = ev.target.closest('.op');
    if (!card) return;
    var to = ev.relatedTarget;
    if (to && card.contains(to)) return;   // 还在卡片内部移动
    clearHighlight();
  });

  function renderSteps() {
    var pane = $('pane-steps');
    var h = state.history;

    if (h.length <= 1) {
      pane.innerHTML = '<div class="empty">还没有执行任何化简。<br><br>' +
        '在左边「可执行操作」里点任意一项，<br>或者点顶栏的「⚡ 自动化简」。</div>';
      return;
    }

    var html = ['<div class="pane-title">化简过程（点击任意一步可回退）</div>', '<div class="step-rail">'];
    h.forEach(function (s, i) {
      var cls = i === state.hi ? 'step cur' : (i > state.hi ? 'step future' : 'step');
      html.push('<div class="' + cls + '" data-step="' + i + '">' +
                '<div class="no">' + i + '</div>' +
                '<div class="tx">' + (i === 0 ? '<b>原始结构图</b>' : esc(s.text)) + '</div></div>');
    });
    html.push('</div>');
    pane.innerHTML = html.join('');
  }

  function renderMason() {
    var pane = $('pane-mason');
    var res = MA.analyze(state.diagram);

    if (!res.ok) {
      pane.innerHTML = '<div class="empty">' + esc(res.error) + '</div>';
      return;
    }

    var html = [];
    html.push('<div class="hint">信号流图用「梅森公式」独立算一遍总传递函数，' +
              '用来核对你手工化简的结果。它和你的化简过程互不干扰。</div><br>');

    html.push('<div class="mas-sec"><h4>信号流图规模</h4>' +
              '<div class="mas-row">节点 ' + res.nodeCount + ' 个 ｜ 支路 ' + res.branchCount + ' 条</div></div>');

    html.push('<div class="mas-sec"><h4>前向通路 Pk</h4>');
    if (!res.paths.length) {
      html.push('<div class="mas-row">（没有从输入到输出的通路）</div>');
    } else {
      res.paths.forEach(function (p) {
        html.push('<div class="mas-row"><span class="tag">P' + p.index + '</span> = ' + esc(p.P) + '</div>');
      });
    }
    html.push('</div>');

    html.push('<div class="mas-sec"><h4>回路 Lk</h4>');
    if (!res.loops.length) {
      html.push('<div class="mas-row">（无回路）</div>');
    } else {
      res.loops.forEach(function (L, i) {
        html.push('<div class="mas-row"><span class="tag">L' + (i + 1) + '</span> = ' + esc(L.gain) + '</div>');
      });
    }
    html.push('</div>');

    if (res.nonTouching.length) {
      html.push('<div class="mas-sec"><h4>互不接触回路组合</h4>');
      res.nonTouching.forEach(function (set) {
        var names = set.map(function (L) { return 'L' + (res.loops.indexOf(L) + 1); });
        var gains = set.map(function (L) { return L.gain; });
        html.push('<div class="mas-row">' + esc(names.join(' · ')) + '  →  ' + esc(gains.join(' · ')) + '</div>');
      });
      html.push('</div>');
    }

    html.push('<div class="mas-sec"><h4>特征式 Δ</h4>' +
              '<div class="mas-row">Δ = ' + esc(res.delta) + '</div></div>');

    html.push('<div class="mas-sec"><h4>余子式 Δk</h4>');
    res.paths.forEach(function (p) {
      html.push('<div class="mas-row"><span class="tag">Δ' + p.index + '</span> = ' + esc(p.deltaK) + '</div>');
    });
    html.push('</div>');

    html.push('<div class="mas-sec"><h4>总传递函数 C(s)/R(s) = ΣPkΔk / Δ（按结构写）</h4>' +
              '<div class="mas-row" style="font-size:13.5px;">' + esc(res.result) + '</div></div>');

    if (res.expanded) {
      var ex = res.expanded;
      var tex = LAT.fullLatex(ex.numerator, ex.denominator);

      html.push('<div class="mas-sec"><h4>最终结果（分式形式）</h4>' +
                '<div class="frac-box">' +
                  LAT.formulaHtml(ex.numerator, ex.denominator) +
                '</div>' +
                '<div class="btnrow" style="margin-top:8px;">' +
                  '<button data-act="copy-tex">复制 LaTeX</button>' +
                  '<button data-act="save-tex">保存 .tex</button>' +
                  '<button class="primary" data-act="export-png">导出图片…</button>' +
                '</div>' +
                '</div>');

      html.push('<div class="mas-sec"><h4>LaTeX 代码</h4>' +
                '<div class="tex-code">' + esc(tex) + '</div></div>');

      html.push('<div class="mas-sec"><h4>展开式（纯文本）</h4>' +
                '<div class="mas-row">分子 = ' + esc(ex.numerator) + '</div>' +
                '<div class="mas-row">分母 = ' + esc(ex.denominator) + '</div></div>');
    }

    pane.innerHTML = html.join('');
  }

  /** 取当前结构图的最终结果（分子 / 分母） */
  function currentResult() {
    var res = MA.analyze(state.diagram);
    if (!res.ok || !res.expanded) return null;
    return res.expanded;
  }

  $('pane-mason').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    var ex = currentResult();
    if (!ex) { toast('当前结构图算不出传递函数'); return; }
    var act = btn.dataset.act;
    var tex = LAT.fullLatex(ex.numerator, ex.denominator);

    if (act === 'copy-tex') {
      copyText(tex, 'LaTeX 代码已复制到剪贴板');
    } else if (act === 'save-tex') {
      downloadBlob(new Blob([tex + '\n'], { type: 'text/plain;charset=utf-8' }), '传递函数.tex');
      toast('已保存 传递函数.tex');
    } else if (act === 'export-png') {
      showExportDialog(ex);
    }
  });

  /* ------------------------------ 导出图片 ------------------------------ */

  function showExportDialog(ex) {
    var widths = [600, 800, 1000, 1200, 1600, 2000, 2400];
    var scales = [1, 2, 3, 4];

    mdMode = 'export';
    mdCb = function () {
      var w = +$('expW').value, s = +$('expS').value, bg = $('expB').value;
      LAT.formulaBlob({
        num: ex.numerator, den: ex.denominator,
        width: w, scale: s,
        background: bg === 'white' ? '#ffffff' : null
      }, function (blob) {
        if (!blob) { toast('导出失败'); return; }
        downloadBlob(blob, '传递函数.png');
        toast('图片已导出：' + (w * s) + ' 像素宽');
      });
    };

    openModal('导出结果图片',
      '<div class="exprow"><label>图片宽度</label><select id="expW">' +
        widths.map(function (w) {
          return '<option value="' + w + '"' + (w === 1200 ? ' selected' : '') + '>' + w + ' px</option>';
        }).join('') +
      '</select></div>' +
      '<div class="exprow"><label>清晰度</label><select id="expS">' +
        scales.map(function (s) {
          return '<option value="' + s + '"' + (s === 2 ? ' selected' : '') + '>' +
                 s + ' 倍' + (s === 2 ? '（推荐）' : (s === 4 ? '（超清）' : '')) + '</option>';
        }).join('') +
      '</select></div>' +
      '<div class="exprow"><label>背景</label><select id="expB">' +
        '<option value="white" selected>白色</option><option value="none">透明</option>' +
      '</select></div>' +
      '<div class="expnote">实际导出像素：<b id="expPx"></b></div>' +
      '<div class="frac-box" style="margin-top:12px;">' +
        LAT.formulaHtml(ex.numerator, ex.denominator) + '</div>');

    function upd() {
      var w = +$('expW').value, s = +$('expS').value;
      var cv = LAT.drawFormula({ num: ex.numerator, den: ex.denominator, width: w, scale: 1 });
      $('expPx').textContent = (w * s) + ' × ' + Math.round(cv.height * s) + ' 像素';
    }
    $('expW').onchange = upd;
    $('expS').onchange = upd;
    upd();
    $('mdCancel').style.display = '';
  }

  /* ------------------------------ 剪贴板 / 下载 ------------------------------ */

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(okMsg || '已复制');
      }, function () { showText('请手动复制', text); });
    } else {
      showText('请手动复制', text);
    }
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  /* ======================================================================
   *  自动理线 / 自动排版
   * ==================================================================== */

  /**
   * 只理线：清除手工走线 + 全局优化每条边的端口方位。
   * 优化目标是"整张图弯折最少"，同时把折返/重叠/交叉当硬约束。
   */
  function autoWire(quiet) {
    var d = state.diagram;
    d.edges.forEach(function (e) { e.route = null; });

    // 先按"朝向对方"给一个不错的起点，再全局优化
    var changed = 0;
    d.edges.forEach(function (e) {
      var inSide = M.autoSide(d, e.from, e.to);
      var outSide = M.autoSide(d, e.to, e.from);
      if (M.sideOf(e.toSide, 'left') !== inSide) { e.toSide = inSide; changed++; }
      if (M.sideOf(e.fromSide, 'right') !== outSide) { e.fromSide = outSide; changed++; }
    });

    changed += RT.optimizeSides(d);
    return changed;
  }

  /** 自动排版：分层排列 + 理线 */
  function autoLayout() {
    var d = state.diagram;
    if (!d.blocks.length) { toast('画布是空的'); return; }

    // 1) 用 DFS 标出回边（反馈线）
    var color = {}, back = {};
    function dfs(u) {
      color[u] = 1;
      M.outEdges(d, u).forEach(function (e) {
        if (color[e.to] === 1) { back[e.id] = true; return; }
        if (!color[e.to]) dfs(e.to);
      });
      color[u] = 2;
    }
    d.blocks.forEach(function (b) { if (!color[b.id]) dfs(b.id); });

    /*
     * 1b) 把"断点"挪到该断的地方。
     *
     * 一条回路，从哪条边断开，画出来的样子差别很大：
     *   · 断在中间 —— 前向通路被截断，各个方块会被摊到两个方向上去，
     *     结果就是"信号从右往左流"、输出方块跑到中间，看着很乱；
     *   · 断在负反馈线上 —— 前向通路从做到右整整齐齐铺开，
     *     反馈支路绕到下面一行，这才是教材上的画法。
     *
     * DFS 碰巧断在哪儿是随机的，所以这里回头检查一遍：
     * 如果同一回路里还有更像"负反馈线"的边（进入相加点、符号是减号），
     * 就把断点换过去 —— 换完只要还无环就采纳。
     */
    var edgeById = function (id) {
      return d.edges.filter(function (x) { return x.id === id; })[0];
    };
    var fwdEdges = function () {
      return d.edges.filter(function (x) { return !back[x.id]; });
    };
    function acyclicWithoutBack() {
      var ind = {}, cnt = 0;
      d.blocks.forEach(function (b) { ind[b.id] = 0; });
      fwdEdges().forEach(function (e) { if (ind[e.to] !== undefined) ind[e.to]++; });
      var q = d.blocks.filter(function (b) { return !ind[b.id]; }).map(function (b) { return b.id; });
      var seen = {}, guard2 = 0;
      while (q.length && guard2++ < 5000) {
        var u = q.shift();
        if (seen[u]) continue;
        seen[u] = 1; cnt++;
        fwdEdges().forEach(function (e) {
          if (e.from === u && --ind[e.to] === 0) q.push(e.to);
        });
      }
      return cnt === d.blocks.length;
    }
    /** 在"非回边"子图上找一条 from -> to 的路径，返回边数组 */
    function forwardPath(from, to) {
      var prev = {}, seen = {};
      seen[from] = 1;
      var q = [from];
      while (q.length) {
        var u = q.shift();
        if (u === to) break;
        fwdEdges().forEach(function (e) {
          if (e.from !== u || seen[e.to]) return;
          seen[e.to] = 1; prev[e.to] = e; q.push(e.to);
        });
      }
      if (!seen[to]) return null;
      var path = [], cur = to, guard3 = 0;
      while (cur !== from && guard3++ < 200) {
        var e = prev[cur];
        if (!e) return null;
        path.push(e);
        cur = e.from;
      }
      return path;
    }

    Object.keys(back).forEach(function (bid) {
      var b = edgeById(bid);
      if (!b) return;
      var cyc = forwardPath(b.to, b.from);
      if (!cyc || !cyc.length) return;

      /*
       * 给一条边打"像不像负反馈线"的分：进入相加点 +2 分，符号是减号 +3 分。
       *
       * 关键：一定要拿**当前这条回边自己的分数**当基准去比。
       * 回边本身多半就是那条负反馈线（分数很高），只是候选路径里看不到它；
       * 要是只跟 0 比，随便一条"进入相加点"的普通前向边（2 分）都能把它顶掉，
       * 本来画得整整齐齐的图反而会被改乱。
       */
      function scoreEdge(e) {
        var T = M.block(d, e.to);
        var sc = 0;
        if (T && T.type === 'sum') sc += 2;
        if ((e.sign || '+') === '-') sc += 3;
        return sc;
      }
      var curScore = scoreEdge(b);

      var best = null, bestScore = curScore;
      cyc.forEach(function (e) {
        var sc = scoreEdge(e);
        if (sc > bestScore) { bestScore = sc; best = e; }
      });
      if (!best) return;                     // 没有更好的断点，保持原样

      back[bid] = false;
      back[best.id] = true;
      if (!acyclicWithoutBack()) {          // 换了之后有环，那就别换
        back[bid] = true;
        back[best.id] = false;
      }
    });

    // 2) 去掉回边后拓扑排序，顺带算层号（最长路径）
    var indeg = {}, level = {};
    d.blocks.forEach(function (b) { indeg[b.id] = 0; level[b.id] = 0; });
    d.edges.forEach(function (e) {
      if (!back[e.id] && indeg[e.to] !== undefined) indeg[e.to]++;
    });
    var queue = d.blocks.filter(function (b) { return !indeg[b.id]; }).map(function (b) { return b.id; });
    var done = {};
    var guard = 0;
    while (queue.length && guard++ < 5000) {
      var u = queue.shift();
      if (done[u]) continue;
      done[u] = 1;
      M.outEdges(d, u).forEach(function (e) {
        if (back[e.id]) return;
        if (level[u] + 1 > level[e.to]) level[e.to] = level[u] + 1;
        if (--indeg[e.to] === 0) queue.push(e.to);
      });
    }

    // 3) 反馈环节（出边全是回边）单独放到下面一行
    var main = [], fb = [];
    d.blocks.forEach(function (b) {
      var outs = M.outEdges(d, b.id);
      var allBack = outs.length > 0 && outs.every(function (e) { return back[e.id]; });
      (allBack ? fb : main).push(b);
    });

    var byLevel = {};
    main.forEach(function (b) {
      var L = level[b.id] || 0;
      (byLevel[L] = byLevel[L] || []).push(b);
    });
    var levels = Object.keys(byLevel).map(Number).sort(function (a, b) { return a - b; });
    if (!levels.length) levels = [0];

    // 4) 列位置
    var GAPX = 120, GAPY = 36, LEFT = 80, TOP = 80;
    var colW = {}, colX = {}, x = LEFT;
    levels.forEach(function (L) {
      colW[L] = Math.max.apply(null, byLevel[L].map(function (b) { return b.w; }));
      colX[L] = x;
      x += colW[L] + GAPX;
    });

    // 5) 每层的总高（顺序无关）与主区高度
    var heights = {};
    levels.forEach(function (L) {
      var list = byLevel[L];
      heights[L] = list.reduce(function (s, b) { return s + b.h; }, 0) + GAPY * (list.length - 1);
    });
    var mainH = Math.max.apply(null, levels.map(function (L) { return heights[L]; }));

    /*
     * 6) 摆放 + 交叉最小化
     *
     *  光按原来的 y 顺序摆是远远不够的：同一个层里几个方块谁上谁下，
     *  连线交不交叉差别很大。这里用图论里经典的"重心法"多试几种排法，
     *  每种都真的走一遍线、数一数交叉和重叠，挑最好的那个。
     *
     *  判分：重叠是绝对不允许的（权重最大），其次是交叉，再看弯折和线长。
     */
    function fbList(order) {
      var arr = order ? order.slice() : fb.slice();
      arr.forEach(function (b) {
        var xs = [];
        M.inEdges(d, b.id).forEach(function (e) {
          var p = M.block(d, e.from); if (p) xs.push(p.x + p.w / 2);
        });
        M.outEdges(d, b.id).forEach(function (e) {
          var p = M.block(d, e.to); if (p) xs.push(p.x + p.w / 2);
        });
        b._want = xs.length ? xs.reduce(function (s, v) { return s + v; }, 0) / xs.length : b.x;
      });
      if (!order) arr.sort(function (a, b) { return a._want - b._want; });
      return arr;
    }

    function place(orderByLevel, fbOrder) {
      levels.forEach(function (L) {
        var list = orderByLevel[L];
        var y = TOP + Math.max(0, (mainH - heights[L]) / 2);
        list.forEach(function (b) {
          b.x = Math.round(colX[L] + (colW[L] - b.w) / 2);
          b.y = Math.round(y);
          y += b.h + GAPY;
        });
      });
      if (fb.length) {
        var fbY = TOP + mainH + 100;
        var prevRight = -Infinity;
        fbList(fbOrder).forEach(function (b) {
          b.x = Math.round(Math.max(Math.round(b._want - b.w / 2), prevRight + 56, LEFT));
          b.y = Math.round(fbY);
          prevRight = b.x + b.w;
        });
      }
    }

    var lastOver = 0, lastCross = 0;
    function scoreNow() {
      var over = RT.totalOverlap(d);
      var cross = RT.totalCrossings(d);
      var bends = RT.totalBends(d);
      var len = RT.totalLength(d);
      lastOver = over; lastCross = cross;
      return over * 1e7 + cross * 1e5 + bends * 100 + len * 0.01;
    }

    var bestOrd = null, bestFb = null, bestScore = Infinity, bestSnap = null;
    var bestOver = Infinity, bestCross = Infinity;
    /** 记录一个"更好的方案"。顺便记住它的重叠/交叉数，用来判断是不是已经够好了。 */
    function consider(sc, ord, fbOrd) {
      if (sc >= bestScore) return false;
      bestScore = sc; bestOrd = ord; bestFb = fbOrd; bestSnap = snapshot();
      bestOver = lastOver; bestCross = lastCross;
      return true;
    }
    /** 已经"没有重叠也没有交叉"就够了，再抠弯折线长不划算 */
    function perfect() { return bestOver < 1 && bestCross === 0; }

    function snapshot() {
      return d.blocks.map(function (b) { return { id: b.id, x: b.x, y: b.y }; });
    }
    function restore(snap) {
      snap.forEach(function (s) {
        var b = M.block(d, s.id);
        if (b) { b.x = s.x; b.y = s.y; }
      });
    }

    /** 重心法扫描一次：把每个方块往它邻居的平均位置靠 */
    function barycenter(orderByLevel, dir) {
      var pos = {};
      levels.forEach(function (L) {
        orderByLevel[L].forEach(function (b, i) { pos[b.id] = i; });
      });
      var next = {};
      levels.forEach(function (L) {
        var list = orderByLevel[L];
        var keyed = list.map(function (b, i) {
          var nb = [];
          var adj = dir > 0 ? M.inEdges(d, b.id) : M.outEdges(d, b.id);
          adj.forEach(function (e) {
            var other = dir > 0 ? e.from : e.to;
            if (pos[other] !== undefined) nb.push(pos[other]);
          });
          return {
            b: b, i: i,
            k: nb.length ? nb.reduce(function (s, v) { return s + v; }, 0) / nb.length : i
          };
        });
        // 稳定排序：重心相同就保持原来的上下顺序
        keyed.sort(function (p, q) { return (p.k - q.k) || (p.i - q.i); });
        next[L] = keyed.map(function (o) { return o.b; });
      });
      return next;
    }

    // 初始顺序：按原来的 y
    var baseOrder = {};
    levels.forEach(function (L) {
      baseOrder[L] = byLevel[L].slice().sort(function (a, b) { return a.y - b.y; });
    });

    var candidates = [baseOrder];
    var o = baseOrder, sweep;
    for (sweep = 0; sweep < 4; sweep++) {
      o = barycenter(o, 1);
      candidates.push(o);
      o = barycenter(o, -1);
      candidates.push(o);
    }

    var bestOrd = null, bestFb = null;

    // 反馈行的排法也一起试：按理想位置排、反过来、保持原样
    var fbVariants = [null, fb.slice().reverse(), fb.slice()];

    candidates.forEach(function (ord) {
      fbVariants.forEach(function (fbOrd) {
        place(ord, fbOrd);
        consider(scoreNow(), ord, fbOrd);
      });
    });

    /*
     * 局部搜索：同层里挪动方块，只要变好就留下。
     * 两种挪法都试 ——
     *   · 相邻两块交换（图论里叫 greedy switch，ELK 也是这么干的）；
     *   · 把一个方块插到本层任意位置（相邻交换够不到的坑，靠这个跳出来）。
     * 重心法只能给个大概，真正把"最后那几处交叉"消掉的往往是这几下微调。
     */
    function localSearch(ord, fbOrd, rounds) {
      var improvedAny = false;
      for (var round = 0; round < rounds; round++) {
        var improved = false;
        for (var li = 0; li < levels.length; li++) {
          var list = ord[levels[li]];

          // 交换相邻两块
          for (var k = 0; k + 1 < list.length; k++) {
            var t = list[k]; list[k] = list[k + 1]; list[k + 1] = t;
            place(ord, fbOrd);
            if (consider(scoreNow(), ord, fbOrd)) { improved = true; improvedAny = true; }
            else { var t2 = list[k]; list[k] = list[k + 1]; list[k + 1] = t2; }
          }

          // 把一个方块插到本层别的位置
          for (var a = 0; a < list.length; a++) {
            var jumped = false;
            for (var b2 = 0; b2 < list.length; b2++) {
              if (a === b2) continue;
              var moved = list.splice(a, 1)[0];
              list.splice(b2, 0, moved);
              place(ord, fbOrd);
              if (consider(scoreNow(), ord, fbOrd)) {
                improved = true; improvedAny = true; jumped = true;
                break;                               // 顺序变了，重来
              }
              list.splice(b2, 1);
              list.splice(a, 0, moved);
            }
            if (jumped) break;
          }
        }
        if (!improved) break;
      }
      return improvedAny;
    }

    if (bestOrd) {
      localSearch(bestOrd, bestFb, 6);

      /*
       * 还不完美就随机重启几轮。
       * 局部搜索容易卡在局部最优，随机换一换起点常常能跳出来。
       * 随机数用固定种子，保证同一张图每次排版结果一模一样（不然"撤销再排版"会变样）。
       */
      var seed = 20240918;
      function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
      var t0 = Date.now();
      while (!perfect() && Date.now() - t0 < 250) {
        var cand = {};
        levels.forEach(function (L) {
          var list = bestOrd[L].slice();
          for (var i = list.length - 1; i > 0; i--) {
            var j = Math.floor(rnd() * (i + 1));
            var t3 = list[i]; list[i] = list[j]; list[j] = t3;
          }
          cand[L] = list;
        });
        place(cand, bestFb);
        if (consider(scoreNow(), cand, bestFb)) localSearch(bestOrd, bestFb, 4);
      }
      restore(bestSnap);
    }
    fb.forEach(function (b) { delete b._want; });

    // 7) 理线
    var changed = autoWire(true);

    pushStep(state.diagram, '自动排版：按信号流向重新排列元件位置，并重新理线' +
             (changed ? '（' + changed + ' 处端口方位已优化）' : ''));
    render();
    fitView();

    // 把实际结果如实报出来：交叉没消干净就说没消干净，别让用户以为万事大吉
    var nCross = RT.totalCrossings(state.diagram);
    var nOver = Math.round(RT.totalOverlap(state.diagram));
    var tail = nOver > 0 ? ('，重叠 ' + nOver + ' px')
             : nCross > 0 ? ('，还有 ' + nCross + ' 处交叉')
             : '，无交叉无重叠';
    toast('已重新排版：' + main.length + ' 个主环节 + ' + fb.length + ' 个反馈环节' + tail);
  }

  function renderStatus() {
    var r = EN.remains(state.diagram);
    var parts = [];
    if (r.series) parts.push('串联 ' + r.series);
    if (r.parallel) parts.push('并联 ' + r.parallel);
    if (r.feedback) parts.push('反馈 ' + r.feedback);
    if (r.moves) parts.push('可移动 ' + r.moves);
    $('stRemain').textContent = parts.length ? '可化简：' + parts.join('，') : '已化简到最简形式';

    var b = state.sel ? M.block(state.diagram, state.sel) : null;
    $('stSel').textContent = b
      ? '已选中：' + (M.TYPE_CN[b.type] || b.type) + (b.label ? '「' + b.label + '」' : '')
      : '未选中元件';

    $('btnUndo').disabled = state.hi <= 0;
    $('btnRedo').disabled = state.hi >= state.history.length - 1;
  }

  function nameOf(id) {
    var b = M.block(state.diagram, id);
    if (!b) return '?';
    if (b.type === 'sum') return '相加点';
    if (b.type === 'takeoff') return '引出点';
    return b.label || (M.TYPE_CN[b.type] || b.type);
  }

  /* ======================================================================
   *  元件：拖动
   * ==================================================================== */

  elBlocks.addEventListener('mousedown', function (ev) {
    var port = ev.target.closest('.port');
    if (port) {
      ev.preventDefault();
      ev.stopPropagation();
      state.linking = { from: port.dataset.port, side: port.dataset.side || 'right' };
      document.body.classList.add('linking');
      toast('现在点击另一个元件的方块完成连线（按 Esc 取消）；入线方位会自动选朝向这一侧的边');
      return;
    }

    var sign = ev.target.closest('.sign');
    if (sign) {
      ev.preventDefault();
      ev.stopPropagation();
      var e = M.edge(state.diagram, sign.dataset.sign);
      if (e) { e.sign = e.sign === '-' ? '+' : '-'; syncSnapshot(); render(); }
      return;
    }

    var blkEl = ev.target.closest('.blk');
    if (!blkEl) return;
    ev.preventDefault();

    if (state.linking) {
      var toId = blkEl.dataset.id;
      if (toId !== state.linking.from) {
        var dup = state.diagram.edges.some(function (e2) {
          return e2.from === state.linking.from && e2.to === toId;
        });
        if (dup) toast('这两个元件之间已经有连线了');
        else {
          var toSide = M.autoSide(state.diagram, state.linking.from, toId);
          M.connect(state.diagram, state.linking.from, toId, '+',
                    { fromSide: state.linking.side, toSide: toSide });
          pushStep(state.diagram, '手动添加连线：把 ' + nameOf(state.linking.from) +
                   ' 接到 ' + nameOf(toId) + '（从' + M.SIDE_CN[state.linking.side] +
                   '侧出线，' + M.SIDE_CN[toSide] + '侧进线）');
          render();
          fitCanvas();
        }
      }
      state.linking = null;
      document.body.classList.remove('linking');
      return;
    }

    var b = M.block(state.diagram, blkEl.dataset.id);
    if (!b) return;

    // 只切换高亮样式，绝不重建 DOM —— 否则双击事件会被打断
    var prev = elBlocks.querySelector('.blk.sel');
    if (prev && prev !== blkEl) prev.classList.remove('sel');
    blkEl.classList.add('sel');
    state.sel = b.id;
    renderStatus();

    state.drag = {
      id: b.id,
      startX: ev.clientX, startY: ev.clientY,
      ox: b.x, oy: b.y,
      moved: false
    };
  });

  document.addEventListener('mousemove', function (ev) {
    /* ---- 中键平移视图 ---- */
    if (state.pan) {
      state.view.tx = state.pan.tx + (ev.clientX - state.pan.startX);
      state.view.ty = state.pan.ty + (ev.clientY - state.pan.startY);
      applyView();
      ev.preventDefault();
      return;
    }

    /* ---- 拖动连线 ---- */
    if (state.wire) {
      var w = state.wire;
      var mp = canvasPoint(ev);
      var pts = w.pts.map(function (p) { return { x: p.x, y: p.y }; });
      var ddx = mp.x - w.start.x, ddy = mp.y - w.start.y;
      if (w.orient === 'h') {
        pts[w.seg].y = w.pts[w.seg].y + ddy;
        pts[w.seg + 1].y = pts[w.seg].y;
      } else {
        pts[w.seg].x = w.pts[w.seg].x + ddx;
        pts[w.seg + 1].x = pts[w.seg].x;
      }
      var we = M.edge(state.diagram, w.edgeId);
      if (we) {
        we.route = RT.straighten(pts);
        renderWires();
      }      ev.preventDefault();
      return;
    }

    /* ---- 拖动元件 ---- */
    if (state.drag) {
      var b = M.block(state.diagram, state.drag.id);
      if (!b) return;
      var dx = ev.clientX - state.drag.startX;
      var dy = ev.clientY - state.drag.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) state.drag.moved = true;
      b.x = Math.max(0, Math.round(state.drag.ox + dx));
      b.y = Math.max(0, Math.round(state.drag.oy + dy));

      var el = elBlocks.querySelector('.blk[data-id="' + b.id + '"]');
      if (el) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; }
      renderWires();
      renderBlocksPositions();
    }
  });

  /** 拖动时只更新端口和符号的位置，避免整块重绘 */
  function renderBlocksPositions() {
    var d = state.diagram;
    d.blocks.forEach(function (b) {
      if (b.type === 'output') return;
      M.SIDES.forEach(function (side) {
        var el = elBlocks.querySelector('.port[data-port="' + b.id + '"][data-side="' + side + '"]');
        if (!el) return;
        var px, py;
        if (side === 'left')       { px = b.x - 7;           py = b.y + b.h / 2 - 6; }
        else if (side === 'right') { px = b.x + b.w - 5;     py = b.y + b.h / 2 - 6; }
        else if (side === 'top')   { px = b.x + b.w / 2 - 6; py = b.y - 7; }
        else                       { px = b.x + b.w / 2 - 6; py = b.y + b.h - 5; }
        el.style.left = px + 'px';
        el.style.top = py + 'px';
      });
    });
    d.edges.forEach(function (e) {
      var T = M.block(d, e.to);
      if (!T || T.type !== 'sum') return;
      var el = elBlocks.querySelector('.sign[data-sign="' + e.id + '"]');
      if (!el) return;
      var p = M.portAt(d, e.id, 'to');
      if (!p) return;
      el.style.left = (p.x + p.nx * 15 - 8) + 'px';
      el.style.top = (p.y + p.ny * 15 - 8) + 'px';
    });
  }

  document.addEventListener('mouseup', function () {
    if (state.pan) {
      state.pan = null;
      document.body.classList.remove('panning');
    }
    if (state.wire) {
      state.wire = null;
      document.body.classList.remove('wiredrag');
      syncSnapshot();
    }
    if (state.drag) {
      state.drag = null;
      syncSnapshot();
      fitCanvas();
    }
  });

  /* ======================================================================
   *  连线：拖动线段调整走线
   * ==================================================================== */

  /** 找到离 (mx,my) 最近的线段，返回线段下标 */
  function nearestSegment(pts, mx, my) {
    var best = -1, bestD = Infinity;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], d;
      if (a.y === b.y) {
        if (mx < Math.min(a.x, b.x) - 10 || mx > Math.max(a.x, b.x) + 10) continue;
        d = Math.abs(my - a.y);
      } else if (a.x === b.x) {
        if (my < Math.min(a.y, b.y) - 10 || my > Math.max(a.y, b.y) + 10) continue;
        d = Math.abs(mx - a.x);
      } else continue;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** 该线段能不能拖（首段和末段的端点是钉在方块上的） */
  function draggable(pts, seg) {
    return seg > 0 && seg < pts.length - 2;
  }

  /* ======================================================================
   *  视图：中键平移 + 滚轮缩放（AutoCAD 习惯）
   * ==================================================================== */

  elWrap.addEventListener('mousedown', function (ev) {
    if (ev.button === 1) {                 // 中键
      ev.preventDefault();
      state.pan = {
        startX: ev.clientX, startY: ev.clientY,
        tx: state.view.tx, ty: state.view.ty
      };
      document.body.classList.add('panning');
    }
  });

  elWrap.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var r = elWrap.getBoundingClientRect();
    var cx = ev.clientX - r.left, cy = ev.clientY - r.top;
    var factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomBy(factor, cx, cy);
  }, { passive: false });

  // 阻止中键在 Chromium 里触发自动滚动
  elWrap.addEventListener('auxclick', function (ev) {
    if (ev.button === 1) ev.preventDefault();
  });

  $('zoomIn').onclick = function () { zoomBy(1.2); };
  $('zoomOut').onclick = function () { zoomBy(1 / 1.2); };
  $('zoomFit').onclick = function () { fitView(); };

  /** 拖动连线线段 */
  elWires.addEventListener('mousedown', function (ev) {
    var hit = ev.target.closest('.hit');
    if (!hit) return;
    ev.preventDefault();
    var e = M.edge(state.diagram, hit.dataset.edge);
    if (!e) return;

    var pts = wirePts(e);
    var mp = canvasPoint(ev);
    var seg = nearestSegment(pts, mp.x, mp.y);
    if (seg < 0) return;

    if (!draggable(pts, seg)) {
      toast('首尾线段固定在方块上，请拖动中间的拐线段', 2600);
      return;
    }

    state.wire = {
      edgeId: e.id,
      seg: seg,
      pts: pts,
      start: mp,
      orient: pts[seg].y === pts[seg + 1].y ? 'h' : 'v'
    };
    document.body.classList.add('wiredrag');
  });

  elWires.addEventListener('mousemove', function (ev) {
    if (state.wire || state.drag) return;
    var hit = ev.target.closest('.hit');
    if (!hit) return;
    var e = M.edge(state.diagram, hit.dataset.edge);
    if (!e) return;
    var pts = wirePts(e);
    var mp = canvasPoint(ev);
    var seg = nearestSegment(pts, mp.x, mp.y);
    if (seg >= 0 && draggable(pts, seg)) {
      hit.style.cursor = (pts[seg].y === pts[seg + 1].y) ? 'ns-resize' : 'ew-resize';
    } else {
      hit.style.cursor = 'default';
    }
  });

  /* 双击连线：恢复自动走线 */
  elWires.addEventListener('dblclick', function (ev) {
    var hit = ev.target.closest('.hit');
    if (!hit) return;
    var e = M.edge(state.diagram, hit.dataset.edge);
    if (!e) return;
    if (e.route) {
      e.route = null;
      syncSnapshot();
      renderWires();
      toast('已恢复自动走线');
    }
  });

  /* ======================================================================
   *  双击改名 / 右键菜单
   * ==================================================================== */

  function renameBlock(id) {
    var b = M.block(state.diagram, id);
    if (!b) return;
    if (b.type === 'sum' || b.type === 'takeoff') {
      toast('相加点／引出点没有名字可以改');
      return;
    }
    askText('修改名称', '例如：G1、K、1/(Ts+1)、H2', b.label, function (v) {
      if (v === null) return;
      var nv = String(v).trim();
      if (!nv) { toast('名称不能为空'); return; }
      M.setLabel(b, nv);
      syncSnapshot();
      render();
      toast('已改名为「' + nv + '」');
    });
  }

  function deleteBlock(id) {
    var b = M.block(state.diagram, id);
    if (!b) return;
    var nm = nameOf(id);
    askConfirm('删除元件', '确定删除「' + nm + '」及其所有连线吗？', function () {
      M.removeBlock(state.diagram, id);
      pushStep(state.diagram, '删除了元件「' + nm + '」');
      state.sel = null;
      render();
    });
  }

  function deleteEdge(id) {
    var e = M.edge(state.diagram, id);
    if (!e) return;
    var from = nameOf(e.from), to = nameOf(e.to);
    M.removeEdge(state.diagram, id);
    pushStep(state.diagram, '删除了连线：' + from + ' → ' + to);
    render();
  }

  elBlocks.addEventListener('dblclick', function (ev) {
    var blkEl = ev.target.closest('.blk');
    if (!blkEl) return;
    ev.preventDefault();
    renameBlock(blkEl.dataset.id);
  });

  /* ------------------------------ 右键菜单 ------------------------------ */

  function showCtxMenu(x, y, header, items) {
    var html = header ? '<div class="hd">' + esc(header) + '</div>' : '';
    items.forEach(function (it, i) {
      if (it === '-') { html += '<div class="sep"></div>'; return; }
      if (it.head) { html += '<div class="mini">' + esc(it.head) + '</div>'; return; }
      if (it.row) {
        html += '<div class="rowbtns">';
        it.row.forEach(function (b, j) {
          html += '<button class="rb' + (b.active ? ' on' : '') + '" ' +
                  'data-row="' + i + '" data-j="' + j + '">' + esc(b.label) + '</button>';
        });
        html += '</div>';
        return;
      }
      html += '<div class="it' + (it.danger ? ' danger' : '') + '" data-i="' + i + '">' +
              esc(it.label) + '</div>';
    });
    elCtx.innerHTML = html;
    elCtx.classList.add('on');
    var w = elCtx.offsetWidth, h = elCtx.offsetHeight;
    elCtx.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 8)) + 'px';
    elCtx.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 8)) + 'px';
    elCtx.onclick = function (ev2) {
      var rb = ev2.target.closest('.rb');
      if (rb) {
        var rowItem = items[+rb.dataset.row];
        var btn = rowItem.row[+rb.dataset.j];
        hideCtxMenu();
        if (btn && btn.run) btn.run();
        return;
      }
      var it = ev2.target.closest('.it');
      if (!it) return;
      var item = items[+it.dataset.i];
      hideCtxMenu();
      if (item && item.run) item.run();
    };
  }
  function hideCtxMenu() { elCtx.classList.remove('on'); }

  /** 生成"入线/出线方位"那一行按钮 */
  function sideRow(currentSide, apply) {
    return {
      row: M.SIDES.map(function (s) {
        return {
          label: M.SIDE_CN[s],
          active: currentSide === s,
          run: function () {
            apply(s);
            syncSnapshot();
            render();
            toast('已改到「' + M.SIDE_CN[s] + '」侧');
          }
        };
      })
    };
  }

  document.addEventListener('mousedown', function (ev) {
    if (!ev.target.closest('#ctxmenu')) hideCtxMenu();
  }, true);
  window.addEventListener('blur', hideCtxMenu);

  elBlocks.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    hideCtxMenu();
    var blkEl = ev.target.closest('.blk');
    if (!blkEl) return;
    var b = M.block(state.diagram, blkEl.dataset.id);
    if (!b) return;

    var ins = M.inEdges(state.diagram, b.id);
    var outs = M.outEdges(state.diagram, b.id);
    var items = [];

    if (b.type !== 'sum' && b.type !== 'takeoff') {
      items.push({ label: '✏  重命名', run: function () { renameBlock(b.id); } });
    }
    if (ins.length) {
      items.push({ head: '全部入线的方位（共 ' + ins.length + ' 条）' });
      items.push(sideRow(M.sideOf(ins[0].toSide, 'left'), function (s) {
        ins.forEach(function (e) { e.toSide = s; });
      }));
    }
    if (outs.length) {
      items.push({ head: '全部出线的方位（共 ' + outs.length + ' 条）' });
      items.push(sideRow(M.sideOf(outs[0].fromSide, 'right'), function (s) {
        outs.forEach(function (e) { e.fromSide = s; });
      }));
    }
    items.push('-');
    items.push({ label: '🗑  删除元件', danger: true, run: function () { deleteBlock(b.id); } });

    showCtxMenu(ev.clientX, ev.clientY, nameOf(b.id), items);
  });

  elWires.addEventListener('contextmenu', function (ev) {
    var hit = ev.target.closest('.hit');
    if (!hit) { hideCtxMenu(); return; }
    ev.preventDefault();
    hideCtxMenu();
    var e = M.edge(state.diagram, hit.dataset.edge);
    if (!e) return;

    var T = M.block(state.diagram, e.to);
    var items = [];

    items.push({ head: '这条线从哪一侧进「' + nameOf(e.to) + '」' });
    items.push(sideRow(M.sideOf(e.toSide, 'left'), function (s) { e.toSide = s; }));

    items.push({ head: '这条线从哪一侧出「' + nameOf(e.from) + '」' });
    items.push(sideRow(M.sideOf(e.fromSide, 'right'), function (s) { e.fromSide = s; }));

    items.push('-');
    if (T && T.type === 'sum') {
      items.push({
        label: e.sign === '-' ? '＋  改成正号' : '－  改成负号',
        run: function () { e.sign = e.sign === '-' ? '+' : '-'; syncSnapshot(); render(); }
      });
    }
    if (e.route) {
      items.push({
        label: '↺  恢复自动走线',
        run: function () { e.route = null; syncSnapshot(); renderWires(); toast('已恢复自动走线'); }
      });
    }
    items.push({ label: '🗑  删除连线', danger: true, run: function () { deleteEdge(e.id); } });

    showCtxMenu(ev.clientX, ev.clientY,
      (e.sign === '-' ? '− ' : '') + nameOf(e.from) + ' → ' + nameOf(e.to), items);
  });

  /* ------------------------------ 执行操作 ------------------------------ */

  $('pane-ops').addEventListener('click', function (ev) {
    var card = ev.target.closest('.op');
    if (!card) return;
    var op = state.ops[+card.dataset.idx];
    if (!op) return;
    var work = M.clone(state.diagram);
    var txt = op.run(work);
    if (!txt) { toast('这一步在当前结构上已经无法执行，请先执行其它操作'); return; }
    pushStep(work, txt);
    render();
    fitCanvas();
  });

  $('pane-steps').addEventListener('click', function (ev) {
    var s = ev.target.closest('.step');
    if (!s) return;
    gotoStep(+s.dataset.step);
  });

  /* ------------------------------ 顶栏按钮 ------------------------------ */

  $('btnUndo').onclick = function () { gotoStep(state.hi - 1); };
  $('btnRedo').onclick = function () { gotoStep(state.hi + 1); };
  $('btnReset').onclick = function () {
    askConfirm('重置', '确定回到最初的结构图吗？所有化简步骤会被清除。', function () { gotoStep(0); });
  };

  $('btnAuto').onclick = function () {
    var work = M.clone(state.diagram);
    var made = 0, guard = 0;
    var ORDER = { series: 0, parallel: 1, sumMerge: 2, tapMerge: 3, feedback: 4 };

    /*
     * 注意：这里必须用 PL.legalOps 而不是 EN.scanAll。
     * 反馈化简之类的变换都有适用条件（比如回路中途还挂着别的引出支路时就不成立），
     * 不满足条件硬套公式会把传递函数改掉。自动化简一路点下来，
     * 中间只要错一步，最后的结果就是错的，而且看不出来。
     */
    while (guard++ < 80) {
      var ops = PL.legalOps(work).filter(function (o) {
        return ORDER[o.kind] !== undefined;
      });
      if (!ops.length) break;
      ops.sort(function (a, b) { return (ORDER[a.kind] || 9) - (ORDER[b.kind] || 9); });
      var txt = ops[0].run(work);
      if (!txt) break;
      pushStep(work, txt);
      made++;
    }

    render();
    fitCanvas();

    if (!made) {
      if (PL.isSolved(state.diagram)) {
        toast('结构图已经是最简形式了');
      } else {
        var movers = PL.legalOps(state.diagram).length;
        toast(movers > 0
          ? ('没有能直接合并的地方了，但有 ' + movers +
             ' 个「移动相加点／引出点」的操作 —— 请先移动，再化简' +
             '（右边标了 ★ 推荐 的那一步就是最好的起点）')
          : '当前这张图上没有可安全执行的化简操作，检查一下输入/输出方块和连线是否齐了', 4600);
      }
    } else {
      toast('自动完成了 ' + made + ' 步化简，可在「化简步骤」里逐步查看');
    }
  };

  $('btnWire').onclick = function () {
    if (!state.diagram.blocks.length) { toast('画布是空的'); return; }
    var changed = autoWire();
    pushStep(state.diagram, '自动理线：清除手工走线，重新为每条线选择端口方位' +
             (changed ? '（调整了 ' + changed + ' 处）' : ''));
    render();
    toast(changed ? '已重新理线：' + changed + ' 处端口方位已优化' : '走线已经是自动模式');
  };

  $('btnLayout').onclick = autoLayout;

  /* ------------------------------ 打开 / 保存 ------------------------------ */

  $('btnSave').onclick = function () {
    try {
      var data = { app: '方框图化简工作室', version: 1, diagram: state.diagram };
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '方框图.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('图纸已保存');
    } catch (e) {
      toast('保存失败：' + e.message);
    }
  };

  $('btnOpen').onclick = function () {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result));
          var dg = data && data.diagram ? data.diagram : data;
          if (!dg || !Array.isArray(dg.blocks) || !Array.isArray(dg.edges)) {
            throw new Error('这不是本程序保存的图纸文件');
          }
          dg.blocks.forEach(function (b) {
            if (!b.id || !b.type) throw new Error('文件内容不完整');
            if (typeof b.x !== 'number') b.x = 100;
            if (typeof b.y !== 'number') b.y = 100;
            if (typeof b.w !== 'number') b.w = (M.BLOCK_DEF[b.type] || M.BLOCK_DEF.gain).w;
            if (typeof b.h !== 'number') b.h = (M.BLOCK_DEF[b.type] || M.BLOCK_DEF.gain).h;
            if (b.label === undefined) b.label = '';
          });
          dg.edges.forEach(function (e) { if (e.route === undefined) e.route = null; });
          M.ensureSeq(dg);
          M.normalize(dg);
          resetHistory(dg, '打开的图纸：' + f.name);
          toast('已打开「' + f.name + '」');
        } catch (e) {
          toast('打开失败：' + e.message, 3200);
        }
      };
      reader.readAsText(f, 'utf-8');
    };
    inp.click();
  };

  $('btnCopy').onclick = function () {
    var lines = ['方框图化简过程', '='.repeat(40)];
    for (var i = 0; i <= state.hi; i++) {
      lines.push('【第 ' + i + ' 步】' + state.history[i].text);
    }
    lines.push('');
    lines.push('='.repeat(40));
    var mas = MA.analyze(state.diagram);
    if (mas.ok) {
      lines.push('用梅森公式独立验证：');
      mas.loops.forEach(function (L, i) { lines.push('  回路 L' + (i + 1) + ' = ' + L.gain); });
      lines.push('  Δ = ' + mas.delta);
      lines.push('');
      lines.push('总传递函数（按结构写）：');
      lines.push('  ' + mas.result);
      if (mas.expanded) {
        lines.push('');
        lines.push('总传递函数（展开式）：');
        lines.push('  分子 = ' + mas.expanded.numerator);
        lines.push('  分母 = ' + mas.expanded.denominator);
        lines.push('  C(s)/R(s) = ' + mas.expanded.compact);
      }
    }
    var text = lines.join('\n');

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () {
        toast('化简过程已复制到剪贴板');
      }, function () { showText('化简过程（请手动复制）', text); });
    } else {
      showText('化简过程（请手动复制）', text);
    }
  };

  $('btnHelp').onclick = function () {
    showText('使用说明',
      '【这个工具是做什么的】\n' +
      '把《自动控制原理》里"结构图化简"的手工过程搬到屏幕上：\n' +
      '每一步做了什么、为什么这么做，都会在右边记下来。\n\n' +
      '【化简的三种基本变换】\n' +
      '  串联： G1 与 G2 串联      → G1·G2\n' +
      '  并联： G1 与 G2 并联      → G1 ± G2\n' +
      '  反馈： 前向 G、反馈 H      → G/(1 ± GH)   （负反馈用 +）\n\n' +
      '【两种"移动"】（很多题必须先移动才能化简）\n' +
      '  相加点后移（跨过 G）：支路乘 G\n' +
      '  相加点前移（跨过 G）：支路乘 1/G\n' +
      '  引出点后移（跨过 G）：支路乘 1/G\n' +
      '  引出点前移（跨过 G）：支路乘 G\n\n' +
      '【怎么用】\n' +
      '  1. 顶栏"载入例题"选一个题，或者自己画图\n' +
      '  2. 右边"可执行操作"里，点任意一项 = 执行这一步\n' +
      '  3. "化简步骤"里点某一步，可以回退重来\n' +
      '  4. "结果与验证"里有两种写法的答案，还有梅森公式核对\n\n' +
      '【画图操作】\n' +
      '  拖动方块                移动位置\n' +
      '  双击方块 / F2           改名字（例如 G1、1/(Ts+1)）\n' +
      '  方块上拖端口小圆点       连线（四边都可以拉线）\n' +
      '  拖动连线中间的拐线段      手动调整走线\n' +
      '  双击连线                恢复自动走线\n' +
      '  点相加点旁的 + / −       切换反馈正负\n' +
      '  右键方块 / 连线          弹出菜单\n\n' +
      '【让图更好看：端口方位】\n' +
      '  连线全部横平竖直，不会出现斜线。\n' +
      '  同一个方块同一侧的多个端口会自动等距排开。\n' +
      '  想让某条线"从右边进"而其他线从左边进？\n' +
      '    · 右键那条连线 → 选入线方位（左/右/上/下）\n' +
      '    · 或者右键方块 → 一次改掉这个方框的全部入线/出线方位\n\n' +
      '【看大图：缩放和平移】\n' +
      '  鼠标中键拖动          平移画布\n' +
      '  滚轮                  以鼠标位置为中心缩放\n' +
      '  右下角 − / ＋ / 适应   缩放按钮\n' +
      '  Ctrl + = / - / 0      快捷键（0 = 适应窗口）\n\n' +
      '【两种答案写法】\n' +
      '  "结果与验证"里会同时给出：\n' +
      '    · 按化简结构写（带括号，如 (G1/(1+G1H1))·(G2/(1+G2H2))）\n' +
      '    · 展开式（无嵌套括号，如 G1G2/(1 + G1H1 + G2H2 + G1H1G2H2)）\n' +
      '  展开式一般更接近老师希望的写法。\n\n' +
      '【为什么有时没有可化简的操作】\n' +
      '  说明这张图必须先"移动相加点/引出点"才能凑出串并联结构，\n' +
      '  请执行"移动相加点"那一类操作。');
  };

  /* ------------------------------ 添加元件 ------------------------------ */

  document.querySelectorAll('#tools button[data-add]').forEach(function (btn) {
    btn.onclick = function () {
      var type = btn.dataset.add;
      var n = state.diagram.blocks.length;
      var x = 140 + (n % 6) * 130;
      var y = 120 + Math.floor(n / 6) * 120;
      var b = M.addBlock(state.diagram, type, x, y);
      pushStep(state.diagram, '添加了一个' + (M.TYPE_CN[type] || type));
      state.sel = b.id;
      render();
      fitCanvas();
    };
  });

  /* ------------------------------ 例题 ------------------------------ */

  $('demoSel').onchange = function () {
    var v = this.value;
    this.value = '';
    var d = null, label = '';
    if (v === 'twoLoop') { d = BDS.demos.twoLoop(); label = '例题一：双环反馈系统'; }
    else if (v === 'needMove') { d = BDS.demos.needMove(); label = '例题二：需要移动引出点'; }
    else if (v === 'parallel') { d = BDS.demos.parallel(); label = '例题三：并联＋反馈（要合并相加点）'; }
    else if (v === 'blank') { d = M.blank(); label = '空白画布'; }
    if (!d) return;
    // 让内置例题一上来就是"弯折最少"的方位
    if (d.edges.length) RT.optimizeSides(d);
    resetHistory(d, label);
  };

  /* ------------------------------ 标签页 ------------------------------ */

  document.querySelectorAll('.tab').forEach(function (t) {
    t.onclick = function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.pane').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      $('pane-' + t.dataset.tab).classList.add('active');
    };
  });

  /* ------------------------------ 键盘 ------------------------------ */

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') {
      if (state.linking) {
        state.linking = null;
        document.body.classList.remove('linking');
        toast('已取消连线');
      }
      hideCtxMenu();
      closeModal();
      return;
    }
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;

    if (ev.key === 'F2') {
      ev.preventDefault();
      if (state.sel) renameBlock(state.sel);
      return;
    }
    if (ev.key === 'Delete' && state.sel) {
      ev.preventDefault();
      deleteBlock(state.sel);
      return;
    }

    var k = ev.key.toLowerCase();
    if ((ev.ctrlKey || ev.metaKey) && k === 'z' && !ev.shiftKey) { ev.preventDefault(); gotoStep(state.hi - 1); }
    else if ((ev.ctrlKey || ev.metaKey) && (k === 'y' || (k === 'z' && ev.shiftKey))) { ev.preventDefault(); gotoStep(state.hi + 1); }
    else if ((ev.ctrlKey || ev.metaKey) && (k === '=' || k === '+')) { ev.preventDefault(); zoomBy(1.2); }
    else if ((ev.ctrlKey || ev.metaKey) && k === '-') { ev.preventDefault(); zoomBy(1 / 1.2); }
    else if ((ev.ctrlKey || ev.metaKey) && k === '0') { ev.preventDefault(); fitView(); }
  });

  /* ------------------------------ 弹窗 ------------------------------ */

  var modal = $('modal'), mdOk = $('mdOk'), mdCancel = $('mdCancel');
  var mdCb = null, mdMode = '';

  function openModal(title, bodyHTML) {
    $('mdTitle').textContent = title;
    $('mdBody').innerHTML = bodyHTML;
    modal.classList.add('on');
  }
  function closeModal() { modal.classList.remove('on'); mdCb = null; }

  modal.onclick = function (ev) { if (ev.target === modal) closeModal(); };
  mdCancel.onclick = closeModal;

  function askText(title, hint, value, cb) {
    mdMode = 'text';
    mdCb = cb;
    openModal(title,
      '<div style="font-size:12.5px;color:#64748b;margin-bottom:8px;">' + esc(hint) + '</div>' +
      '<input id="mdInput" value="' + esc(value || '') + '">');
    var inp = $('mdInput');
    inp.focus(); inp.select();
    inp.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); mdOk.click(); }
    };
  }

  function askConfirm(title, text, cb) {
    mdMode = 'confirm';
    mdCb = cb;
    openModal(title, '<div style="font-size:13.5px;line-height:1.8;">' + esc(text) + '</div>');
    $('mdCancel').style.display = '';
  }

  function showText(title, text) {
    mdMode = 'show';
    mdCb = null;
    openModal(title, '<textarea id="mdText" readonly></textarea>');
    $('mdText').value = text;
    $('mdCancel').style.display = 'none';
  }

  mdOk.onclick = function () {
    if (mdMode === 'text') {
      var v = $('mdInput') ? $('mdInput').value : '';
      var cb = mdCb;
      closeModal();
      if (cb) cb(v);
    } else if (mdMode === 'confirm') {
      var cb2 = mdCb;
      closeModal();
      if (cb2) cb2();
    } else if (mdMode === 'export') {
      var cb3 = mdCb;
      closeModal();
      if (cb3) cb3();
    } else {
      closeModal();
    }
  };

  /* ------------------------------ 启动 ------------------------------ */

  resetHistory(BDS.demos.twoLoop(), '例题一：双环反馈系统');
  RT.optimizeSides(state.diagram);
  state.history[0] = { diagram: M.clone(state.diagram), text: '例题一：双环反馈系统' };
  render();
  fitView();
  toast('已载入例题一：双环反馈系统。右边点任意操作即可开始化简', 4000);

  // 只读调试引用，供自动化测试与排查问题使用
  window.__BDS_APP__ = {
    state: state,
    render: render,
    fitView: fitView,
    setScale: setScale,
    canvasPoint: canvasPoint,
    /** 供自动化测试直接装一张图（正式使用走"打开文件"） */
    load: function (d, label) {
      resetHistory(M.normalize(d), label || '测试用图');
      render();
    }
  };

})();
