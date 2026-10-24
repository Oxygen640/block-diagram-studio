/* ============================================================================
 *  rat.js  ——  符号多项式 / 有理函数运算（用于输出"展开式"）
 *
 *  《自动控制原理》里的传递函数是符号的有理分式，比如
 *        G1G2 / ((1 + G1H1)(1 + G2H2))
 *  考试更愿意看展开后的形式
 *        G1G2 / (1 + G1H1 + G2H2 + G1H1G2H2)
 *  这个小引擎就是干这个的。
 *
 *  数据表示：
 *    多项式  Poly = { 单项式键: 系数 }
 *      单项式键 = 若干"原子"按字典序用 \u0001 连接；空串代表常数项
 *      例：{ '': 1, 'G1\u0001H1': 2 }  表示 1 + 2G1H1
 *    有理式  Rat  = { n: Poly, d: Poly }
 * ==========================================================================*/
window.BDS = window.BDS || {};

(function (BDS) {
  'use strict';

  var SEP = '\u0001';
  var EPS = 1e-10;

  function isSimpleAtom(name) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name); }

  function monoAtoms(key) { return key ? key.split(SEP) : []; }

  /**
   * 原子在单项式里的排列顺序。
   * 按"编号优先、再按名字"排，这样 G1H1G2H2 会写成 G1H1G2H2 而不是 G1G2H1H2，
   * 和教材里"一个回路一组"的写法一致。
   */
  function atomOrder(a) {
    var m = /^(.*?)(\d+)$/.exec(a);
    if (m) return [parseInt(m[2], 10), m[1] + '\u0002' + m[2]];
    return [0, a];
  }
  function monoKey(atoms) {
    return atoms.slice().sort(function (x, y) {
      var kx = atomOrder(x), ky = atomOrder(y);
      if (kx[0] !== ky[0]) return kx[0] - ky[0];
      return kx[1] < ky[1] ? -1 : (kx[1] > ky[1] ? 1 : 0);
    }).join(SEP);
  }

  /* ------------------------------ 多项式 ------------------------------ */

  function pConst(k) {
    var t = {};
    if (Math.abs(k) > EPS) t[''] = k;
    return t;
  }
  function pAtom(name) {
    var t = {};
    t[name] = 1;
    return t;
  }
  function pIsZero(p) { return Object.keys(p).length === 0; }
  function pIsConst(p) {
    return Object.keys(p).every(function (k) { return k === ''; });
  }
  function pConstValue(p) { return p[''] || 0; }

  function pClean(p) {
    var o = {};
    Object.keys(p).forEach(function (k) {
      if (Math.abs(p[k]) > EPS) o[k] = p[k];
    });
    return o;
  }

  function pMul(a, b) {
    var r = {};
    Object.keys(a).forEach(function (ka) {
      Object.keys(b).forEach(function (kb) {
        var key = (ka && kb) ? monoKey(monoAtoms(ka).concat(monoAtoms(kb))) : (ka || kb);
        r[key] = (r[key] || 0) + a[ka] * b[kb];
      });
    });
    return pClean(r);
  }

  function pAdd(a, b, sign) {
    var r = {};
    Object.keys(a).forEach(function (k) { r[k] = (r[k] || 0) + a[k]; });
    Object.keys(b).forEach(function (k) { r[k] = (r[k] || 0) + (sign === -1 ? -1 : 1) * b[k]; });
    return pClean(r);
  }

  function pScale(a, k) {
    var r = {};
    Object.keys(a).forEach(function (key) { r[key] = a[key] * k; });
    return pClean(r);
  }

  /** 排序：次数升序，同次按字典序（常数项排最前） */
  function sortedKeys(p) {
    return Object.keys(p).sort(function (a, b) {
      var da = monoAtoms(a).length, db = monoAtoms(b).length;
      if (da !== db) return da - db;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
  }

  function numToStr(v) {
    var r = Math.round(v);
    if (Math.abs(v - r) < 1e-9) return String(r);
    return String(Math.round(v * 1e6) / 1e6);
  }

  /** 多项式 -> 展开式字符串，例如 1 + G1H1 + G2H2 + G1H1G2H2 */
  function pToStr(p) {
    if (pIsZero(p)) return '0';
    var keys = sortedKeys(p);
    var out = '';
    keys.forEach(function (k, i) {
      var c = p[k];
      var atoms = monoAtoms(k);       // 已按 atomOrder 排好，不要再排序
      var mag = Math.abs(c);
      var body;
      if (!atoms.length) {
        body = numToStr(mag);
      } else {
        var allSimple = atoms.every(isSimpleAtom);
        var s = allSimple ? atoms.join('') : atoms.join('·');
        body = (Math.abs(mag - 1) < EPS) ? s : (numToStr(mag) + (allSimple ? '' : '·') + s);
      }
      var neg = c < 0;
      if (i === 0) out += (neg ? '-' : '') + body;
      else out += ' ' + (neg ? '-' : '+') + ' ' + body;
    });
    return out;
  }

  /** 所有项都含有的公共原子（多重集交） */
  function commonAtoms(p) {
    var keys = Object.keys(p);
    if (!keys.length) return [];
    var common = null;
    var ok = true;
    keys.forEach(function (k) {
      if (!ok) return;
      var atoms = monoAtoms(k);
      if (common === null) { common = atoms.slice(); return; }
      var counts = {};
      atoms.forEach(function (a) { counts[a] = (counts[a] || 0) + 1; });
      var next = [];
      common.forEach(function (a) {
        if (counts[a] > 0) { next.push(a); counts[a]--; }
      });
      common = next;
      if (!common.length) ok = false;
    });
    return common || [];
  }

  function pDivMono(p, atoms) {
    var drop = {};
    atoms.forEach(function (a) { drop[a] = (drop[a] || 0) + 1; });
    var r = {};
    Object.keys(p).forEach(function (k) {
      var remaining = {};
      Object.keys(drop).forEach(function (a) { remaining[a] = drop[a]; });
      var rest = [];
      monoAtoms(k).forEach(function (a) {
        if (remaining[a] > 0) { remaining[a]--; return; }
        rest.push(a);
      });
      var nk = monoKey(rest);
      r[nk] = (r[nk] || 0) + p[k];
    });
    return pClean(r);
  }

  /** 最大公约数（整数系数时有效） */
  function gcdInt(a, b) {
    a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
    while (b) { var t = a % b; a = b; b = t; }
    return a;
  }

  /* ---------------------- 多项式的整除（用于约分） ---------------------- */

  /*
   *  为什么需要它？
   *
   *  反馈化简会不断产出 G/(1+GH) 这样的分式，下一步又把它乘回去。
   *  比如 (G1G2G3/(1+G3H3)) × ((1+G3H3)/(G2G3))，明明是 G1，
   *  但如果只会约"单项式公因子"（G2、G3 这种），(1+G3H3) 就约不掉，
   *  分子分母上会一路堆积成 (1+G3H3)²、(1+G3H3)³……
   *  最后展开式就变成 3G3H3、2G1G2G3G3H3 这种谁看都以为算错了的东西。
   *
   *  所以这里加一个"精确整除"：能整除就除，除不尽就返回 null（绝不硬除）。
   *  用多元多项式的长除法，单项式序取"先比总次数、再比字典序"。
   */

  function monoCmp(a, b) {
    var aa = monoAtoms(a), bb = monoAtoms(b);
    if (aa.length !== bb.length) return aa.length - bb.length;
    var sa = aa.slice().sort(), sb = bb.slice().sort();
    for (var i = 0; i < sa.length; i++) {
      if (sa[i] !== sb[i]) return sa[i] < sb[i] ? -1 : 1;
    }
    return 0;
  }

  /** 多项式里的首项（按 monoCmp 排序最大的那一项） */
  function pLeadKey(p) {
    var best = null;
    Object.keys(p).forEach(function (k) {
      if (best === null || monoCmp(k, best) > 0) best = k;
    });
    return best;
  }

  /** x / y（单项式），除不尽返回 null */
  function monoDivide(x, y) {
    var counts = {};
    var ys = monoAtoms(y);
    for (var i = 0; i < ys.length; i++) counts[ys[i]] = (counts[ys[i]] || 0) + 1;
    var xs = monoAtoms(x);
    var rest = [];
    for (var j = 0; j < xs.length; j++) {
      if (counts[xs[j]] > 0) { counts[xs[j]]--; continue; }
      rest.push(xs[j]);
    }
    for (var k in counts) if (counts[k] > 0) return null;
    return monoKey(rest);
  }

  /** 精确整除：b 整除 a 就返回商，否则返回 null（也就是绝不硬除） */
  function pDivExact(a, b) {
    if (pIsZero(b)) return null;
    if (pIsZero(a)) return pConst(0);
    var bk = pLeadKey(b), bc = b[bk];
    var r = {};
    Object.keys(a).forEach(function (k) { r[k] = a[k]; });
    var q = {};
    var guard = 0;

    while (!pIsZero(r)) {
      if (guard++ > 500) return null;
      var rk = pLeadKey(r), rc = r[rk];
      var remKey = monoDivide(rk, bk);
      if (remKey === null) return null;              // 首项都除不尽，肯定不整除
      var coef = rc / bc;
      q[remKey] = (q[remKey] || 0) + coef;

      // r -= coef · remKey · b
      var sub = {};
      Object.keys(b).forEach(function (k2) {
        var nk = (remKey && k2) ? monoKey(monoAtoms(remKey).concat(monoAtoms(k2)))
                                : (remKey || k2);
        sub[nk] = (sub[nk] || 0) + coef * b[k2];
      });
      r = pAdd(r, sub, -1);
    }
    return pClean(q);
  }

  /**
   * 消掉分子分母之间的公共因子。
   * 只会做"确定成立"的约分（一边整除另一边），除不尽就原样返回，不会出错。
   */
  function cancelCommon(n, d) {
    if (pIsZero(n) || pIsZero(d)) return { n: n, d: d };
    if (pIsConst(d) || pIsConst(n)) return { n: n, d: d };

    var q = pDivExact(n, d);
    if (q && !pIsZero(q)) return { n: q, d: pConst(1) };

    q = pDivExact(d, n);
    if (q && !pIsZero(q)) return { n: pConst(1), d: q };

    return { n: n, d: d };
  }

  /* ------------------------------ 有理式 ------------------------------ */

  function rConst(k) { return { n: pConst(k), d: pConst(1) }; }
  function rAtom(name) { return { n: pAtom(name), d: pConst(1) }; }

  /**
   * 乘法。乘之前先**交叉约分**：
   *     (A·C)/B  ×  B/(D·C)  里的 C 和 B 应该先互相抵消掉。
   * 不这么做的话，反馈化简来回一乘，多项式公因子会一路堆积，
   * 最后展开式里全是约不掉的高次项。
   */
  function rMul(a, b) {
    var an = a.n, ad = a.d, bn = b.n, bd = b.d;
    if (!pIsConst(bd)) {
      var q1 = pDivExact(an, bd);
      if (q1) { an = q1; bd = pConst(1); }
    }
    if (!pIsConst(bn)) {
      var q2 = pDivExact(ad, bn);
      if (q2) { ad = q2; bn = pConst(1); }
    }
    return rSimplify({ n: pMul(an, bn), d: pMul(ad, bd) });
  }

  /** 两个多项式是否完全相同 */
  function pEq(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      var k = ka[i];
      if (b[k] === undefined) return false;
      if (Math.abs(a[k] - b[k]) > 1e-9) return false;
    }
    return true;
  }

  /**
   * 除法。特别处理"分母相同"的情况 —— 这是嵌套反馈化简里最常见的形状：
   *     (A/B) / (C/B) = A/C
   * 只靠单项式公因子约不掉 B（B 是多项式），这里直接约掉。
   */
  function rDiv(a, b) {
    if (pEq(a.d, b.d)) return rSimplify({ n: a.n, d: b.n });
    var an = a.n, ad = a.d, bn = b.n, bd = b.d;
    // 交叉约分：a 的分子和 b 的分子、a 的分母和 b 的分母，都可能带公因子
    if (!pIsConst(bn)) {
      var q1 = pDivExact(an, bn);
      if (q1) { an = q1; bn = pConst(1); }
    }
    if (!pIsConst(ad)) {
      var q2 = pDivExact(bd, ad);
      if (q2) { bd = q2; ad = pConst(1); }
    }
    return rSimplify({ n: pMul(an, bd), d: pMul(ad, bn) });
  }
  function rNeg(a) { return rSimplify({ n: pScale(a.n, -1), d: a.d }); }
  function rInv(a) { return rSimplify({ n: a.d, d: a.n }); }
  function rAdd(a, b, sign) {
    return rSimplify({
      n: pAdd(pMul(a.n, b.d), pMul(b.n, a.d), sign === -1 ? -1 : 1),
      d: pMul(a.d, b.d)
    });
  }
  /** 反馈公式 G/(1 ± GH) */
  function rFeedback(G, H, sign) {
    var GH = rMul(G, H);
    var den = rAdd(rConst(1), GH, sign === '-' ? 1 : -1);
    return rDiv(G, den);
  }

  /** 约分：分母只剩常数则并进分子；再约掉公因子（单项式）与公因数 */
  function rSimplify(r) {
    var n = pClean(r.n), d = pClean(r.d);
    if (pIsZero(d)) return { n: n, d: pConst(1) };

    // 分母是常数 → 除进分子
    if (pIsConst(d)) {
      var c = pConstValue(d);
      if (Math.abs(c) < EPS) return { n: n, d: pConst(1) };
      return { n: pScale(n, 1 / c), d: pConst(1) };
    }

    // 约掉公共单项式因子
    if (!pIsZero(n)) {
      var cn = commonAtoms(n), cd = commonAtoms(d);
      var counts = {};
      cd.forEach(function (a) { counts[a] = (counts[a] || 0) + 1; });
      var cancel = [];
      cn.forEach(function (a) {
        if (counts[a] > 0) { cancel.push(a); counts[a]--; }
      });
      if (cancel.length) {
        n = pDivMono(n, cancel);
        d = pDivMono(d, cancel);
      }
    }

    // 再试一次"多项式整除"约分（反馈化简来回乘出来的公因子全靠这一步清掉）
    var cc = cancelCommon(n, d);
    n = cc.n; d = cc.d;

    // 分母首项系数归一到 1（只处理整数系数）
    if (!pIsZero(d)) {
      var keys = sortedKeys(d);
      var lead = d[keys[keys.length - 1]];
      var allInt = Object.keys(d).every(function (k) { return Math.abs(d[k] - Math.round(d[k])) < 1e-9; }) &&
                   Object.keys(n).every(function (k) { return Math.abs(n[k] - Math.round(n[k])) < 1e-9; });
      if (allInt && Math.abs(lead) > EPS) {
        var g = Math.abs(Math.round(lead));
        Object.keys(d).forEach(function (k) { g = gcdInt(g, d[k]); });
        Object.keys(n).forEach(function (k) { g = gcdInt(g, n[k]); });
        if (g > 1) { n = pScale(n, 1 / g); d = pScale(d, 1 / g); }
      }
    }

    return { n: n, d: d };
  }

  /** 分子、分母的展开式字符串 */
  function rParts(r) {
    var s = rSimplify(r);
    var numerator = pToStr(s.n);
    var denominator = pToStr(s.d);
    var compact;
    if (s.d && Object.keys(s.d).length === 1 && s.d[''] !== undefined && Math.abs(s.d[''] - 1) < EPS) {
      compact = numerator;
    } else {
      compact = numerator + ' / (' + denominator + ')';
    }
    return { numerator: numerator, denominator: denominator, compact: compact };
  }

  function rToStr(r) { return rParts(r).compact; }

  /** 判断两个有理式是否相等（数值抽样比较） */
  function rEquals(a, b) {
    var sa = rSimplify(a), sb = rSimplify(b);
    var samples = [0.37, 1.3, 2.9, 5.1];
    for (var i = 0; i < samples.length; i++) {
      var va = evalPoly(sa.n, samples[i]) / evalPoly(sa.d, samples[i]);
      var vb = evalPoly(sb.n, samples[i]) / evalPoly(sb.d, samples[i]);
      if (!isFinite(va) || !isFinite(vb)) continue;
      if (Math.abs(va - vb) > 1e-6 * Math.max(1, Math.abs(va))) return false;
    }
    return true;
  }

  var SAMPLE_VALUES = { G1: 2, G2: 3, G3: 4, H1: 0.1, H2: 0.2, H3: 0.3, K: 5, G: 1.5, H: 0.4 };
  function atomValue(name, x) {
    if (SAMPLE_VALUES[name] !== undefined) return SAMPLE_VALUES[name];
    // 未知原子：给一个稳定的伪随机值
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 1000;
    return 0.5 + (h % 100) / 50 + x * 0;
  }
  function evalPoly(p, x) {
    var sum = 0;
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      monoAtoms(k).forEach(function (a) { v *= atomValue(a); });
      sum += v;
    });
    return sum;
  }

  /**
   * 数值求值：把有理式在某组原子取值下算成一个数。
   * 用于"每一步化简之后传递函数其实没变"的独立校验（不依赖 Mason 公式）。
   * 刻意不做约分 —— 求值结果与约分无关，省下的时间在搜索里很关键。
   */
  function rEval(r, env) {
    if (!r) return 1;
    function pv(p) {
      var sum = 0;
      var keys = Object.keys(p);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = p[k];
        if (k) {
          // 绝大多数项就是单个原子（G1、H2 这种），直接查表即可，
          // 只有真正的乘积项才需要 split —— 这个快路径能省掉一大半时间
          var c = k.indexOf(SEP);
          if (c < 0) {
            var x0 = env[k];
            v *= (x0 === undefined ? 1.7 : x0);
          } else {
            var atoms = k.split(SEP);
            for (var j = 0; j < atoms.length; j++) {
              var x = env[atoms[j]];
              if (x === undefined) x = 1.7;   // 未知原子给个固定值，保证可比
              v *= x;
            }
          }
        }
        sum += v;
      }
      return sum;
    }
    // 快路径：分母就是常数 1（化简后最常见的情形）
    var dk = Object.keys(r.d);
    var dv;
    if (dk.length === 1 && dk[0] === '') dv = r.d[''];
    else if (dk.length === 0) dv = 0;
    else dv = pv(r.d);
    if (Math.abs(dv) < 1e-12) return NaN;
    return pv(r.n) / dv;
  }

  /** 从用户输入的方块名字得到有理式 */
  function parse(label) {
    var s = String(label == null ? '' : label).trim();
    if (!s || s === '1') return rConst(1);
    if (/^-?\d+(\.\d+)?$/.test(s)) return rConst(parseFloat(s));
    if (isSimpleAtom(s)) return rAtom(s);
    // 其它写法（例如 1/(Ts+1)、a+b）整体当作一个不可分割的"原子"
    return rAtom(s);
  }

  BDS.rat = {
    SEP: SEP,
    pConst: pConst,
    pAtom: pAtom,
    pMul: pMul,
    pAdd: pAdd,
    pScale: pScale,
    pToStr: pToStr,
    pIsConst: pIsConst,
    pIsZero: pIsZero,
    rConst: rConst,
    rAtom: rAtom,
    rMul: rMul,
    rDiv: rDiv,
    rNeg: rNeg,
    rInv: rInv,
    rAdd: rAdd,
    rFeedback: rFeedback,
    rSimplify: rSimplify,
    rParts: rParts,
    rToStr: rToStr,
    rEquals: rEquals,
    rEval: rEval,
    parse: parse,
    isSimpleAtom: isSimpleAtom
  };

})(window.BDS);
