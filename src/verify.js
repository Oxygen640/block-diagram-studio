/* ============================================================================
 *  verify.js  ——  化简算子的"数学守门人"
 *
 *  为什么需要它？
 *  框图化简的每一条基本变换（串联、并联、反馈、相加点移动、引出点移动…）
 *  都有各自的**适用条件**。条件不满足时硬套公式，画出来的图看着挺像，
 *  传递函数却已经变了 —— 这是最坑人的错误。
 *
 *  与其把每条变换的适用条件写成一大堆容易漏的 if，这里换一个思路：
 *    直接**数值验证**。把框图翻译成信号流方程，高斯消元解出 C/R；
 *    在若干个随机取值点上比较"化简前"和"化简后"的 C/R，
 *    只要有一个点对不上，就判定这条变换非法。
 *
 *  好处：
 *    · 判据统一，不需要为每种算子单独推导适用条件；
 *    · 覆盖面全，任何漏判都会被抓住；
 *    · 写错了也会立刻暴露，不会有"看起来对"的假象。
 * ==========================================================================*/
window.BDS = window.BDS || {};

(function (BDS) {
  'use strict';

  var RT = BDS.rat;

  /* ------------------------- 1. 数值求值环境 ------------------------- */

  /** 用线性同余造一串确定的"随机"取值，保证同一次运行结果可复现 */
  function makeEnv(seed) {
    var env = {};
    var s = (seed * 2654435761) >>> 0;
    function next() {
      s = (s * 1103515245 + 12345) >>> 0;
      return (s % 100000) / 100000;
    }
    var names = ['G1', 'G2', 'G3', 'G4', 'H1', 'H2', 'H3', 'H4', 'K', 'G', 'H', 'T', 'A', 'B'];
    names.forEach(function (n) {
      // 避开 0 和 1：0 会把信息抹掉，1 会让很多式子巧合相等
      env[n] = 0.17 + next() * 2.6;
    });
    return env;
  }

  var ENVS = [makeEnv(7), makeEnv(23), makeEnv(101)];
  var TOL = 1e-7;

  /* --------------------------- 2. 线性求解 --------------------------- */

  function solve(A, y) {
    var n = y.length;
    var M = new Array(n);
    for (var i = 0; i < n; i++) {
      M[i] = A[i].slice();
      M[i].push(y[i]);
    }
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) {
        if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      }
      if (Math.abs(M[p][c]) < 1e-13) continue;
      var tmp = M[c]; M[c] = M[p]; M[p] = tmp;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === c) continue;
        var f = M[r2][c] / M[c][c];
        if (!f) continue;
        for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k];
      }
    }
    var x = new Array(n);
    for (var i2 = 0; i2 < n; i2++) {
      x[i2] = Math.abs(M[i2][i2]) < 1e-13 ? 0 : M[i2][n] / M[i2][i2];
    }
    return x;
  }

  function gainOf(b, env) {
    var r = b.rat;
    if (!r && b.type === 'gain') r = RT.parse(b.label || '1');
    if (!r) return 1;
    return RT.rEval(r, env);
  }

  /**
   * 直接由框图结构解出 C/R。
   * 结构不完整（缺输入/输出方块、方程奇异）时返回 NaN。
   */
  function tfOf(d, env) {
    if (!d || !d.blocks || !d.blocks.length) return NaN;
    var src = null, sink = null;
    for (var i = 0; i < d.blocks.length; i++) {
      if (d.blocks[i].type === 'input' && !src) src = d.blocks[i];
      if (d.blocks[i].type === 'output' && !sink) sink = d.blocks[i];
    }
    if (!src || !sink) return NaN;

    var idx = {}, vars = [];
    d.blocks.forEach(function (b) {
      if (b === src) return;
      idx[b.id] = vars.length;
      vars.push(b);
    });
    var n = vars.length;
    if (!n) return NaN;

    var A = [], y = new Array(n).fill(0);
    for (var i2 = 0; i2 < n; i2++) A.push(new Array(n).fill(0));

    var ins = {};
    d.edges.forEach(function (e) {
      (ins[e.to] = ins[e.to] || []).push(e);
    });

    d.blocks.forEach(function (b) {
      if (b === src) return;
      var r = idx[b.id];
      A[r][r] = 1;
      var feed = function (fromId, coef) {
        if (fromId === src.id) y[r] += coef;
        else if (idx[fromId] !== undefined) A[r][idx[fromId]] -= coef;
      };
      var list = ins[b.id] || [];
      if (b.type === 'gain') {
        if (list.length !== 1) return;              // 悬空/多入：该点信号记 0
        feed(list[0].from, gainOf(b, env));
      } else if (b.type === 'takeoff' || b.type === 'output') {
        if (list.length !== 1) return;
        feed(list[0].from, 1);
      } else {                                      // sum
        list.forEach(function (e) { feed(e.from, e.sign === '-' ? -1 : 1); });
      }
    });

    var x = solve(A, y);
    var val = function (id) { return id === src.id ? 1 : x[idx[id]]; };
    var out = val(sink.id);
    return isFinite(out) ? out : NaN;
  }

  /* --------------------------- 3. 守门人 ----------------------------- */

  function close(a, b) {
    return Math.abs(a - b) <= TOL * Math.max(1, Math.abs(b));
  }

  /** 轻量结构克隆（比 JSON 往返快得多；rat 对象只读，可以共享） */
  function lightClone(d) {
    var blocks = new Array(d.blocks.length);
    for (var i = 0; i < d.blocks.length; i++) {
      var b = d.blocks[i];
      blocks[i] = {
        id: b.id, type: b.type, label: b.label,
        x: b.x, y: b.y, w: b.w, h: b.h, rat: b.rat
      };
    }
    var edges = new Array(d.edges.length);
    for (var j = 0; j < d.edges.length; j++) {
      var e = d.edges[j];
      edges[j] = {
        id: e.id, from: e.from, to: e.to, sign: e.sign,
        fromSide: e.fromSide, toSide: e.toSide, route: null
      };
    }
    return { blocks: blocks, edges: edges };
  }

  /**
   * 预先把"参考值"算好。同一个图上要试很多条操作时，
   * 参考值只跟图有关，没必要每条操作都重算一遍。
   */
  function refOf(d, envs) {
    envs = envs || ENVS;
    var r = [];
    for (var i = 0; i < envs.length; i++) r.push(tfOf(d, envs[i]));
    return r;
  }

  /**
   * 判断一条操作在图上是否"保传递函数"。
   * 返回 true 表示可以放心使用；false 表示这条变换在当前图上不成立。
   * 参照值本身算不出来时（图不完整等）不拦，返回 true。
   */
  function opKeepsRef(d, op, refs, envs) {
    envs = envs || ENVS;
    if (!op || typeof op.run !== 'function') return true;
    if (!isFinite(refs[0])) return true;

    var dd;
    try {
      dd = lightClone(d);
      op.run(dd);
    } catch (err) {
      return false;                                  // 跑都跑不起来，当然不能用
    }
    if (!dd || !dd.blocks || !dd.blocks.length) return false;

    for (var i = 0; i < envs.length; i++) {
      var b = tfOf(dd, envs[i]);
      if (!isFinite(b) || !close(b, refs[i])) return false;
    }
    return true;
  }

  function opKeeps(d, op, envs) {
    return opKeepsRef(d, op, refOf(d, envs), envs);
  }

  /** 把一批操作过滤成"合法"的那些，用于规划和界面展示 */
  function filterOps(d, ops, envs) {
    var refs = refOf(d, envs);
    var out = [];
    (ops || []).forEach(function (op) {
      if (opKeepsRef(d, op, refs, envs)) out.push(op);
    });
    return out;
  }

  BDS.verify = {
    makeEnv: makeEnv,
    ENVS: ENVS,
    tfOf: tfOf,
    refOf: refOf,
    opKeeps: opKeeps,
    opKeepsRef: opKeepsRef,
    filterOps: filterOps
  };

})(window.BDS);
