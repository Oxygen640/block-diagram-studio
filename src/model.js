/* ============================================================================
 *  model.js  ——  方框图数据模型与符号表达式
 *  方框图化简工作室
 * ==========================================================================*/
window.BDS = window.BDS || {};

(function (BDS) {
  'use strict';

  /* ------------------------------ 基本常量 ------------------------------ */

  var BLOCK_DEF = {
    input:   { w: 66, h: 40, cn: '输入' },
    output:  { w: 66, h: 40, cn: '输出' },
    gain:    { w: 104, h: 54, cn: '环节' },
    sum:     { w: 50, h: 50, cn: '相加点' },
    takeoff: { w: 18, h: 18, cn: '引出点' }
  };

  var TYPE_CN = {
    input: '输入信号',
    output: '输出信号',
    gain: '环节（方框）',
    sum: '相加点（比较点）',
    takeoff: '引出点（分支点）'
  };

  var _seq = 1;
  function uid(prefix) { return (prefix || 'x') + '_' + (_seq++); }
  function resetSeq() { _seq = 1; }

  /** 载入外部图纸后，把 id 计数器推到已有 id 之后，避免新元件重名 */
  function ensureSeq(d) {
    var max = _seq;
    (d.blocks || []).concat(d.edges || []).forEach(function (o) {
      var m = /_(\d+)$/.exec(String(o.id || ''));
      if (m) max = Math.max(max, parseInt(m[1], 10) + 1);
    });
    _seq = max;
  }

  /* ------------------------------ 图结构 ------------------------------ */

  function blank() { return { blocks: [], edges: [] }; }

  function clone(d) { return JSON.parse(JSON.stringify(d)); }

  function addBlock(d, type, x, y, opts) {
    opts = opts || {};
    var def = BLOCK_DEF[type] || BLOCK_DEF.gain;
    var b = {
      id: opts.id || uid('b'),
      type: type,
      label: opts.label !== undefined ? opts.label : defaultLabel(type),
      x: Math.round(x),
      y: Math.round(y),
      w: opts.w || def.w,
      h: opts.h || def.h,
      note: opts.note || ''
    };
    b.rat = (BDS.rat && BDS.rat.parse) ? BDS.rat.parse(b.label) : null;
    d.blocks.push(b);
    return b;
  }

  /** 给方块改名，同时更新它的符号有理式 */
  function setLabel(b, text) {
    b.label = text;
    b.rat = (BDS.rat && BDS.rat.parse) ? BDS.rat.parse(text) : null;
  }

  /** 载入外部图纸后，补齐可能缺失的新字段 */
  function normalize(d) {
    /*
     * 先把 id 计数器推到已有 id 之后。
     * 否则从文件载入一张图（里面的 id 是 b_20、e_32…）之后，
     * 新建的方块会从 b_1 开始编号，攒够十几个就撞上原有的 b_20，
     * 于是"同一个图跑两遍结果不一样"这种玄学问题就来了。
     */
    ensureSeq(d);
    d.blocks.forEach(function (b) {
      if (!b.rat) b.rat = (BDS.rat && BDS.rat.parse) ? BDS.rat.parse(b.label) : null;
    });
    d.edges.forEach(function (e) {
      if (e.route === undefined) e.route = null;
      if (!e.fromSide) e.fromSide = 'right';
      if (!e.toSide) e.toSide = 'left';
    });
    return d;
  }

  function defaultLabel(type) {
    if (type === 'input') return 'R(s)';
    if (type === 'output') return 'C(s)';
    if (type === 'gain') return 'G';
    return '';
  }

  function block(d, id) {
    for (var i = 0; i < d.blocks.length; i++) if (d.blocks[i].id === id) return d.blocks[i];
    return null;
  }

  function removeBlock(d, id) {
    d.blocks = d.blocks.filter(function (b) { return b.id !== id; });
    d.edges = d.edges.filter(function (e) { return e.from !== id && e.to !== id; });
  }

  function removeEdge(d, id) {
    d.edges = d.edges.filter(function (e) { return e.id !== id; });
  }

  function edge(d, id) {
    for (var i = 0; i < d.edges.length; i++) if (d.edges[i].id === id) return d.edges[i];
    return null;
  }

  function connect(d, from, to, sign, opts) {
    opts = opts || {};
    var e = {
      id: uid('e'),
      from: from,
      to: to,
      sign: sign === '-' ? '-' : '+',
      // 出线方位默认朝向目标、入线方位默认朝向来源 —— 线最短，也最不容易和别的线打结
      fromSide: opts.fromSide || autoSide(d, to, from),
      toSide: opts.toSide || autoSide(d, from, to),
      route: null                              // 手动调整过的走线；为 null 时自动走线
    };
    d.edges.push(e);
    return e;
  }

  /* ------------------------------ 端口方位 ------------------------------ */

  var SIDES = ['left', 'right', 'top', 'bottom'];
  var SIDE_CN = { left: '左', right: '右', top: '上', bottom: '下' };

  function sideOf(s, def) { return SIDES.indexOf(s) >= 0 ? s : def; }

  /** 自动判断：信号从哪一侧进入目标方块最自然 */
  function autoSide(d, fromId, toId) {
    var F = block(d, fromId), T = block(d, toId);
    if (!F || !T) return 'left';
    var fx = F.x + F.w / 2, fy = F.y + F.h / 2;
    var tx = T.x + T.w / 2, ty = T.y + T.h / 2;
    var vx = (fx - tx) / Math.max(1, T.w / 2);
    var vy = (fy - ty) / Math.max(1, T.h / 2);
    if (Math.abs(vx) >= Math.abs(vy)) return vx < 0 ? 'left' : 'right';
    return vy < 0 ? 'top' : 'bottom';
  }

  /**
   * 某个方块某一侧上的全部端口。
   * 关键：**进线和出线放在同一个队列里统一分配位置**。
   * 否则一个方块"入线在左、出线也在左"时，两边各自都排在侧边中点，
   * 进线和出线就会完全重合，看起来只有一条线。
   */
  /**
   * 元件的 id 形如 b_12 / e_7，比较时一定要按**数字**比。
   * 直接用字符串比会踩坑：'e_100' < 'e_99' 居然是 true，
   * 于是同样一张图，跑第二遍时（计数器已经推大）线序就变了，
   * 化简规划给出的路线也跟着变 —— 这种不确定性最难查。
   */
  function idNum(id) {
    var m = /_(\d+)$/.exec(String(id == null ? '' : id));
    return m ? parseInt(m[1], 10) : 0;
  }

  function sidePortList(d, blockId, side) {
    var list = [];
    d.edges.forEach(function (e) {
      if (e.to === blockId && sideOf(e.toSide, 'left') === side) list.push({ e: e, dir: 'in' });
      if (e.from === blockId && sideOf(e.fromSide, 'right') === side) list.push({ e: e, dir: 'out' });
    });
    var horiz = (side === 'left' || side === 'right');
    list.sort(function (p, q) {
      var bp = block(d, p.dir === 'in' ? p.e.from : p.e.to);
      var bq = block(d, q.dir === 'in' ? q.e.from : q.e.to);
      var vp = bp ? (horiz ? bp.y + bp.h / 2 : bp.x + bp.w / 2) : 0;
      var vq = bq ? (horiz ? bq.y + bq.h / 2 : bq.x + bq.w / 2) : 0;
      if (vp !== vq) return vp - vq;
      // 同来源/去向时出线排前一点，让线序稳定
      if (p.dir !== q.dir) return p.dir === 'out' ? -1 : 1;
      return idNum(p.e.id) - idNum(q.e.id);
    });
    return list;
  }

  /** 兼容旧写法：只取某一侧的入线或出线 */
  function sideEdges(d, blockId, side, dir) {
    return sidePortList(d, blockId, side)
      .filter(function (it) { return it.dir === dir; })
      .map(function (it) { return it.e; });
  }

  /** 该侧第 idx 个（共 count 个）端口的位置与外法线方向 */
  function portPoint(b, side, idx, count) {
    var t = (idx + 0.5) / Math.max(1, count);
    if (side === 'left')  return { x: b.x,           y: b.y + b.h * t, nx: -1, ny: 0 };
    if (side === 'right') return { x: b.x + b.w,     y: b.y + b.h * t, nx:  1, ny: 0 };
    if (side === 'top')   return { x: b.x + b.w * t, y: b.y,           nx: 0, ny: -1 };
    return                       { x: b.x + b.w * t, y: b.y + b.h,     nx: 0, ny:  1 };
  }

  /** 取一条连线某一端的端口（end: 'from' | 'to'） */
  function portAt(d, edgeId, end) {
    var e = edge(d, edgeId);
    if (!e) return null;
    var isIn = (end === 'to');
    var blockId = isIn ? e.to : e.from;
    var b = block(d, blockId);
    if (!b) return null;
    var side = isIn ? sideOf(e.toSide, 'left') : sideOf(e.fromSide, 'right');
    var list = sidePortList(d, blockId, side);
    var idx = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].e.id === edgeId && list[i].dir === (isIn ? 'in' : 'out')) { idx = i; break; }
    }
    return portPoint(b, side, idx, list.length);
  }

  /** 兼容旧调用：出入端口位置 */
  function outPort(d, b) { return portPoint(b, 'right', 0, 1); }
  function inPort(d, b, edgeId) {
    var p = portAt(d, edgeId, 'to');
    return p || portPoint(b, 'left', 0, 1);
  }

  function inEdges(d, id) { return d.edges.filter(function (e) { return e.to === id; }); }
  function outEdges(d, id) { return d.edges.filter(function (e) { return e.from === id; }); }

  function isType(d, id, t) { var b = block(d, id); return !!b && b.type === t; }

  /* --------------------------- 符号表达式运算 --------------------------- */
  /* 目标：输出接近教材的写法 —— G1G2、(1/G2)、G1/(1+G1G2H) */

  function isAtom(s) {
    return /^[A-Za-z][A-Za-z0-9_]*$/.test(s) || /^-?\d+(\.\d+)?$/.test(s);
  }

  function isOne(s) { return s === '1' || s === '' || s == null; }

  function wrap(s) { return isAtom(s) ? s : '(' + s + ')'; }

  /** 乘法：G1 × G2 -> G1G2 ；遇到分式则用 · 连接 */
  function mul(a, b) {
    if (isOne(a)) return b || '1';
    if (isOne(b)) return a;
    if (isAtom(a) && isAtom(b)) return a + b;
    return wrap(a) + '·' + wrap(b);
  }

  /** 除法：a / b */
  function div(a, b) {
    if (isOne(b)) return a;
    if (isOne(a)) return '1/' + wrap(b);
    return wrap(a) + '/' + wrap(b);
  }

  /** 倒数 1/G */
  function inv(a) { return div('1', a); }

  /** 加减 */
  function add(a, b, sign) {
    if (!a || a === '0') return sign === '-' ? neg(b) : b;
    if (!b) return a;
    return a + (sign === '-' ? ' - ' : ' + ') + wrap(b);
  }

  function neg(a) {
    if (!a) return a;
    if (isAtom(a)) return '-' + a;
    return '-' + wrap(a);
  }

  /**
   * 反馈公式： G/(1 ± GH)
   * sign 是「相加点上的符号」：
   *   '-' 表示负反馈 -> 分母写成 1 + GH
   *   '+' 表示正反馈 -> 分母写成 1 - GH
   */
  function feedback(G, H, sign) {
    var gh = isOne(H) ? G : mul(G, H);
    var den = (sign === '-' ? '1 + ' : '1 - ') + gh;
    return div(G, den);
  }

  BDS.model = {
    BLOCK_DEF: BLOCK_DEF,
    TYPE_CN: TYPE_CN,
    SIDES: SIDES,
    SIDE_CN: SIDE_CN,
    uid: uid,
    resetSeq: resetSeq,
    ensureSeq: ensureSeq,
    idNum: idNum,
    blank: blank,
    clone: clone,
    normalize: normalize,
    addBlock: addBlock,
    setLabel: setLabel,
    block: block,
    removeBlock: removeBlock,
    removeEdge: removeEdge,
    edge: edge,
    connect: connect,
    inEdges: inEdges,
    outEdges: outEdges,
    isType: isType,
    sideOf: sideOf,
    autoSide: autoSide,
    sidePortList: sidePortList,
    sideEdges: sideEdges,
    portPoint: portPoint,
    portAt: portAt,
    outPort: outPort,
    inPort: inPort,
    expr: { mul: mul, div: div, inv: inv, add: add, neg: neg, feedback: feedback, isOne: isOne, wrap: wrap }
  };

  /* --------------------------- 示例题目 --------------------------- */

  /** 经典两环系统：R -> (+) -> G1 -> (+) -> G2 -> C ，内环反馈 H1，外环反馈 H2 */
  function demoTwoLoop() {
    resetSeq();
    var d = blank();
    var r  = addBlock(d, 'input',  40, 240, { label: 'R(s)' });
    var s1 = addBlock(d, 'sum',   150, 240);
    var g1 = addBlock(d, 'gain',  240, 232, { label: 'G1' });
    var t1 = addBlock(d, 'takeoff', 384, 246);
    var s2 = addBlock(d, 'sum',   430, 240);
    var g2 = addBlock(d, 'gain',  520, 232, { label: 'G2' });
    var h1 = addBlock(d, 'gain',  300, 350, { label: 'H1' });
    var h2 = addBlock(d, 'gain',  600, 350, { label: 'H2' });
    var c  = addBlock(d, 'output', 680, 240, { label: 'C(s)' });

    connect(d, r.id, s1.id, '+');
    connect(d, s1.id, g1.id, '+');
    connect(d, g1.id, t1.id, '+');
    connect(d, t1.id, s2.id, '+');
    connect(d, s2.id, g2.id, '+');
    connect(d, g2.id, c.id, '+');
    connect(d, t1.id, h1.id, '+');
    connect(d, h1.id, s1.id, '-');
    connect(d, g2.id, h2.id, '+');
    connect(d, h2.id, s2.id, '-');
    return d;
  }

  /** 需要"移动引出点"才能化简的例子：引出点取在 G2 输出，但 G2 之前还有 G1。 */
  function demoNeedMove() {
    resetSeq();
    var d = blank();
    var r  = addBlock(d, 'input',  40, 200, { label: 'R(s)' });
    var s1 = addBlock(d, 'sum',   160, 200);
    var g1 = addBlock(d, 'gain',  260, 192, { label: 'G1' });
    var g2 = addBlock(d, 'gain',  400, 192, { label: 'G2' });
    var t1 = addBlock(d, 'takeoff', 560, 206);
    var g3 = addBlock(d, 'gain',  640, 192, { label: 'G3' });
    var h1 = addBlock(d, 'gain',  660, 320, { label: 'H1' });
    var c  = addBlock(d, 'output', 800, 200, { label: 'C(s)' });

    connect(d, r.id, s1.id, '+');
    connect(d, s1.id, g1.id, '+');
    connect(d, g1.id, g2.id, '+');
    connect(d, g2.id, t1.id, '+');
    connect(d, t1.id, g3.id, '+');
    connect(d, g3.id, c.id, '+');
    connect(d, t1.id, h1.id, '+');
    connect(d, h1.id, s1.id, '-');
    return d;
  }

  /**
   * 例题三：并联 + 反馈，两条回路共用一个相加点。
   *
   *   R(s) → 引出点 T1
   *          T1 → G1 → ⊕top(+)
   *          T1 → ⊕low(+) → G2 → ⊕top(+)
   *          ⊕top → 引出点 T2 → C(s)，T2 → G3 → ⊕low(−)
   *
   *   C/R = (G1+G2)/(1+G2G3)
   *
   *  考点：G3 的反馈回到 ⊕low，而 G1 又直接灌进 ⊕top，
   *  两路信号在回路内部交汇。必须先「合并相邻相加点」把两个相加点并起来，
   *  回路才认得出来 —— 这是很多同学会卡住的一步。
   */
  function demoParallel() {
    resetSeq();
    var d = blank();
    var r  = addBlock(d, 'input',   40, 200, { label: 'R(s)' });
    var t1 = addBlock(d, 'takeoff', 150, 200);
    var g1 = addBlock(d, 'gain',    280, 140, { label: 'G1' });
    var sl = addBlock(d, 'sum',     200, 300);
    var g2 = addBlock(d, 'gain',    360, 292, { label: 'G2' });
    var st = addBlock(d, 'sum',     500, 200);
    var t2 = addBlock(d, 'takeoff', 620, 200);
    var g3 = addBlock(d, 'gain',    440, 400, { label: 'G3' });
    var c  = addBlock(d, 'output',  760, 200, { label: 'C(s)' });

    connect(d, r.id,  t1.id, '+');
    connect(d, t1.id, g1.id, '+');
    connect(d, t1.id, sl.id, '+');
    connect(d, sl.id, g2.id, '+');
    connect(d, g1.id, st.id, '+');
    connect(d, g2.id, st.id, '+');
    connect(d, st.id, t2.id, '+');
    connect(d, t2.id, c.id,  '+');
    connect(d, t2.id, g3.id, '+');
    connect(d, g3.id, sl.id, '-');
    return d;
  }

  BDS.demos = { twoLoop: demoTwoLoop, needMove: demoNeedMove, parallel: demoParallel };

})(window.BDS);
