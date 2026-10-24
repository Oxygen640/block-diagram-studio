/* ============================================================================
 *  latex.js  ——  LaTeX 代码生成 + 分式排版
 *
 *  三件事：
 *    1. 把符号串转成 LaTeX（G1 -> G_{1}），拼出标准 \frac{}{} 代码
 *    2. 在页面上画出"分子在上、分母在下"的分式（纯 HTML/CSS，无外部依赖）
 *    3. 用 Canvas 把同一个分式画成图片，尺寸和清晰度可调，用于导出 PNG
 * ==========================================================================*/
window.BDS = window.BDS || {};

(function (BDS) {
  'use strict';

  var SUB_RE = /([A-Za-z])(\d+)/g;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ------------------------------ LaTeX 代码 ------------------------------ */

  /** G1 -> G_{1}（只对"字母紧跟数字"做处理，Ts+1 这种不受影响） */
  function symToLatex(s) {
    return String(s == null ? '' : s).replace(SUB_RE, '$1_{$2}');
  }

  /** G1 -> G<sub>1</sub>（页面显示用） */
  function symToHtml(s) {
    return String(s == null ? '' : s).replace(SUB_RE, '$1<sub>$2</sub>');
  }

  /** 传递函数 -> LaTeX */
  function tfToLatex(num, den) {
    var n = symToLatex(num);
    var d = symToLatex(den);
    if (!d || d === '1') return n;
    return '\\frac{' + n + '}{' + d + '}';
  }

  /** 完整的 LaTeX 表达式（含 C(s)/R(s) =） */
  function fullLatex(num, den, prefixLatex) {
    var p = prefixLatex === undefined ? '\\frac{C(s)}{R(s)} =' : prefixLatex;
    return p + ' ' + tfToLatex(num, den);
  }

  /* --------------------------- 页面上的分式（HTML） --------------------------- */

  function formulaHtml(num, den, prefixText) {
    var p = prefixText === undefined ? 'C(s)/R(s) =' : prefixText;
    if (!den || den === '1') {
      return '<div class="formula"><span class="fx-prefix">' + esc(p) + '</span>' +
             '<span class="fx-single">' + symToHtml(num) + '</span></div>';
    }
    return '<div class="formula">' +
             '<span class="fx-prefix">' + esc(p) + '</span>' +
             '<span class="fx-frac">' +
               '<span class="fx-num">' + symToHtml(num) + '</span>' +
               '<span class="fx-bar"></span>' +
               '<span class="fx-den">' + symToHtml(den) + '</span>' +
             '</span>' +
           '</div>';
  }

  /* --------------------------- Canvas 绘图（导出图片） --------------------------- */

  var FONT_FAMILY = '"Cambria Math","Times New Roman",Georgia,serif';
  function fontStr(px) { return 'italic ' + px + 'px ' + FONT_FAMILY; }

  /** 把 "G1H1 + 2" 切成 [{t:'G'},{t:'1',sub:true},{t:'H'},{t:'1',sub:true},{t:' + 2'}] */
  function tokenize(text) {
    text = String(text == null ? '' : text);
    var out = [], i = 0;
    while (i < text.length) {
      var ch = text[i];
      if (/[A-Za-z]/.test(ch)) {
        out.push({ t: ch, sub: false });
        i++;
        var m = /^\d+/.exec(text.slice(i));
        if (m) { out.push({ t: m[0], sub: true }); i += m[0].length; }
      } else {
        var j = i;
        while (j < text.length && !/[A-Za-z]/.test(text[j])) j++;
        out.push({ t: text.slice(i, j), sub: false });
        i = j;
      }
    }
    return out;
  }

  function measureRun(ctx, toks, fs, subFs) {
    var w = 0;
    for (var i = 0; i < toks.length; i++) {
      ctx.font = fontStr(toks[i].sub ? subFs : fs);
      w += ctx.measureText(toks[i].t).width;
    }
    return w;
  }

  function drawRun(ctx, toks, x, baseline, fs, subFs, color) {
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      ctx.font = fontStr(tk.sub ? subFs : fs);
      ctx.fillText(tk.t, x, baseline + (tk.sub ? fs * 0.20 : 0));
      x += ctx.measureText(tk.t).width;
    }
    return x;
  }

  /**
   * 把分式画到 canvas 上。
   * @param {object} o
   *   o.num, o.den      分子 / 分母（分母为 '1' 时只画分子）
   *   o.prefix          前缀文字，默认 'C(s)/R(s) ='
   *   o.width           逻辑宽度（px），默认自动
   *   o.scale           清晰度倍数（1~4），默认 2
   *   o.background      背景色，null 表示透明
   *   o.color           文字颜色
   *   o.fontSize        基准字号（逻辑单位），默认 44
   * @returns {HTMLCanvasElement}
   */
  function drawFormula(o) {
    o = o || {};
    var num = o.num == null ? '' : String(o.num);
    var den = o.den == null ? '' : String(o.den);
    var prefix = o.prefix === undefined ? 'C(s)/R(s) =' : o.prefix;
    var scale = Math.max(1, Math.min(6, o.scale || 2));
    var color = o.color || '#0f172a';
    var fs = o.fontSize || 44;
    var subFs = Math.round(fs * 0.66);

    var hasDen = !!den && den !== '1';

    // ---------- 量测 ----------
    var probe = document.createElement('canvas').getContext('2d');
    var preTok = prefix ? tokenize(prefix) : [];
    var numTok = tokenize(num);
    var denTok = hasDen ? tokenize(den) : [];

    var preW = prefix ? measureRun(probe, preTok, fs, subFs) : 0;
    var numW = measureRun(probe, numTok, fs, subFs);
    var denW = hasDen ? measureRun(probe, denTok, fs, subFs) : 0;

    var preGap = prefix ? fs * 0.55 : 0;
    var padX = fs * 0.30;                       // 分数线左右伸出量
    var fracW = Math.max(numW, denW) + padX * 2;

    // ---------- 纵向布局 ----------
    var gap = fs * 0.20;
    var barH = Math.max(2, fs * 0.055);
    var lineH = fs * 1.05;

    var numBaseline = fs * 0.92;
    var barY = numBaseline + gap;
    var denBaseline = barY + barH + gap + fs * 0.92;
    var totalH = hasDen ? (denBaseline + fs * 0.28) : (numBaseline + fs * 0.28);
    var totalW = preW + preGap + fracW;

    // ---------- 缩放 ----------
    var targetW = o.width && o.width > 0 ? o.width : Math.round(totalW);
    var s = Math.max(0.1, targetW / totalW);
    var logicalH = totalH * s;

    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(targetW * scale));
    cv.height = Math.max(1, Math.round(logicalH * scale));
    var ctx = cv.getContext('2d');

    if (o.background) {
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, cv.width, cv.height);
    }

    // 用 (scale × s) 作为整体变换，后面都按原始逻辑坐标画
    ctx.setTransform(scale * s, 0, 0, scale * s, 0, 0);

    var fracLeft = preW + preGap;

    if (!hasDen) {
      // 只有分子：整行居中
      drawRun(ctx, preTok, 0, numBaseline, fs, subFs, color);
      drawRun(ctx, numTok, fracLeft, numBaseline, fs, subFs, color);
    } else {
      var barCx = fracLeft + padX + Math.max(numW, denW) / 2;

      // 前缀：纵向对齐分数线
      drawRun(ctx, preTok, 0, barY + barH / 2 + fs * 0.34, fs, subFs, color);

      // 分子、分母各自居中
      drawRun(ctx, numTok, barCx - numW / 2, numBaseline, fs, subFs, color);
      drawRun(ctx, denTok, barCx - denW / 2, denBaseline, fs, subFs, color);

      // 分数线
      ctx.fillStyle = color;
      ctx.fillRect(fracLeft, barY, fracW, barH);
    }

    return cv;
  }

  /** 导出 PNG，回调拿到 Blob */
  function formulaBlob(o, cb) {
    var cv = drawFormula(o);
    if (cv.toBlob) cv.toBlob(cb, 'image/png');
    else cb(null);
  }

  BDS.latex = {
    symToLatex: symToLatex,
    symToHtml: symToHtml,
    tfToLatex: tfToLatex,
    fullLatex: fullLatex,
    formulaHtml: formulaHtml,
    drawFormula: drawFormula,
    formulaBlob: formulaBlob
  };

})(window.BDS);
