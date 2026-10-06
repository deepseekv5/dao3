// code-metrics.js — 脚本编辑框的几何量。
//
// 为什么要单独一份：complete.js 以前自己写 `LH=20, PAD_T=12, PAD_L=14`，
// script-ide.js 又写了一遍 `LH=20, PAD=12`，查找框还要第三份。三处数值对得上
// 纯属没改过字号——CSS 里动一下 font-size 或 line-height，补全弹窗就会贴偏、
// 诊断波浪线会标到隔壁行、查找命中框会盖错地方，而且每一处都"看起来是别人的 bug"。
// 现在一律从 textarea 的计算样式量出来。
const cache = new WeakMap();
let probe = null;

/** 等宽字体下一个字符多宽。量 40 个再除，比量 1 个准（亚像素）。 */
function charWidth(cs, sample, n) {
  if (!probe) {
    probe = document.createElement("span");
    probe.style.cssText = "position:absolute;left:-9999px;top:0;white-space:pre";
    document.body.appendChild(probe);
  }
  // 长写而不是一条 font 简写：计算样式里的 font 简写在某些组合下会取空，
  // 取空就等于量到 0，症状是弹窗永远贴在左边缘。
  probe.style.fontFamily = cs.fontFamily;
  probe.style.fontSize = cs.fontSize;
  probe.style.fontWeight = cs.fontWeight;
  probe.style.fontStyle = cs.fontStyle;
  probe.textContent = sample.repeat(n);
  return probe.getBoundingClientRect().width / n;
}

// 中文与全角标点在这套等宽字体里占两格。只按 col × 字宽算的话，
// 一行注释里只要有一个汉字，后面的命中框就会整体往左跑——
// 而脚本注释全是中文，这不是边角情况，是日常。
const WIDE_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** @returns {{lh:number,padT:number,padL:number,charW:number,wideW:number}} */
export function metrics(ta) {
  const cs = getComputedStyle(ta);
  const key = [cs.fontSize, cs.lineHeight, cs.paddingTop, cs.paddingLeft, cs.fontWeight].join("|");
  const hit = cache.get(ta);
  if (hit && hit.key === key) return hit;
  const fs = parseFloat(cs.fontSize) || 12.5;
  const m = {
    key,
    lh: parseFloat(cs.lineHeight) || Math.round(fs * 1.6),
    padT: parseFloat(cs.paddingTop) || 0,
    padL: parseFloat(cs.paddingLeft) || 0,
    charW: charWidth(cs, "0", 40),
    wideW: charWidth(cs, "方", 40),
  };
  cache.set(ta, m);
  return m;
}

/** 一段文本在这个字体里占多少像素。逐字符加，避免每次都去量 DOM。 */
export function textAdvance(m, text) {
  let w = 0;
  for (const ch of text) w += WIDE_RE.test(ch) ? m.wideW : m.charW;
  return w;
}

/** 字符下标 → {line 0 基, col 0 基}。整份文本一次扫出来，别在循环里 split。 */
export function posOf(text, index) {
  const upto = text.slice(0, index);
  const nl = upto.lastIndexOf("\n");
  return { line: (upto.match(/\n/g) || []).length, col: index - nl - 1 };
}

/** 把 textarea 滚到让第 line（0 基）那行落在视口中间偏上。 */
export function scrollToLine(ta, line, lh) {
  const top = line * lh - ta.clientHeight / 3;
  ta.scrollTop = Math.max(0, top);
}
