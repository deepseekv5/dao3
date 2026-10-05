// md.js — 够小、够安全的 markdown 渲染器（浏览器端）。
//
// 为什么不用现成的 marked / markdown-it：
//   1) 本项目零构建、零运行时依赖，vendor 里只有 three；
//   2) 这里的输入是**模型返回的文本**。任何把 markdown 转成 HTML 字符串
//      再赋给 innerHTML 的做法，都等于把 XSS 面开给模型输出。
// 所以这个解析器**只产出 DOM 节点**（createElement + textContent），
// 全程不出现 innerHTML——模型写 <script>、写 onerror= 只会变成字面文本。
//
// 支持的子集（模型实际会写的那些）：围栏代码块、#~###### 标题、
// -/*/+ 与 1. 列表（缩进≥2 视为子项，只嵌一层）、> 引用、--- 分隔线、
// | 表格 |、段落，以及行内的 `代码`、**粗体**、*斜体*、~~删除线~~、[文字](链接)。
// 链接只放行 http/https/mailto，其余协议退回纯文本。

function safeHref(raw) {
  const url = String(raw || "").trim().replace(/[<>]/g, "");
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

/** 行内解析 → 节点数组。code 段先用 \0 占位，避免里面的 * 被当成强调。 */
function inlineNodes(text) {
  const kids = [];
  const codes = [];
  const src = String(text).replace(/`([^`\n]+)`/g, (_m, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // 刻意**不**支持 _下划线_ 式强调：这个界面里的文本满是 particle_blueCrystal、
  // respawn_delay 这类标识号，一旦认下划线，标识符中间就会被劈出一片斜体。
  // 模型写强调实际用的都是 **，损失可以接受。
  const RE = /\*\*(?=\S)([\s\S]*?\S)\*\*|\*(?=\S)([\s\S]*?\S)\*|~~(?=\S)([\s\S]*?\S)~~|\u0000(\d+)\u0000|\[([^\]]*)\]\(\s*([^)\s]*)(?:\s+["'][^"']*["'])?\s*\)/g;
  const push = (t) => { if (t) kids.push(document.createTextNode(t)); };
  const wrap = (tag, inner) => { const n = document.createElement(tag); n.append(...inner); return n; };
  let last = 0;
  let m;
  while ((m = RE.exec(src))) {
    push(src.slice(last, m.index));
    if (m[1] != null) kids.push(wrap("strong", inlineNodes(m[1])));
    else if (m[2] != null) kids.push(wrap("em", inlineNodes(m[2])));
    else if (m[3] != null) kids.push(wrap("s", inlineNodes(m[3])));
    else if (m[4] != null) kids.push(wrap("code", [document.createTextNode(codes[+m[4]])]));
    else if (m[5] != null) {
      const href = safeHref(m[6]);
      if (href) {
        const a = wrap("a", inlineNodes(m[5]));
        a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer nofollow";
        kids.push(a);
      } else push(`${m[5]}(${m[6]})`);
    }
    last = RE.lastIndex;
  }
  push(src.slice(last));
  return kids;
}

const isTableSep = (l) => l.includes("|") && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(l);
const cells = (l) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
const LI = /^(\s*)([-*+]\s+|\d+[.)]\s+)(.*)$/;

/** markdown 文本 → DocumentFragment。 */
export function renderMd(text) {
  const frag = document.createDocumentFragment();
  const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
  const el = (tag, cls, kids) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (kids) n.append(...kids);
    return n;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 围栏代码块：内容一律字面文本，不做行内解析（代码里的 * 不该变斜体）
    const fence = line.match(/^\s*(```+|~~~+)\s*([A-Za-z0-9_+.-]*)\s*$/);
    if (fence) {
      const close = new RegExp(`^\\s*${fence[1][0] === "`" ? "`" : "~"}{3,}\\s*$`);
      const buf = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) buf.push(lines[i++]);
      i++;
      const pre = el("pre", "md-pre", [el("code", null, [document.createTextNode(buf.join("\n"))])]);
      if (fence[2]) pre.appendChild(el("span", "md-lang", fence[2]));
      frag.appendChild(pre);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      // # 映射到 h3 起：这些标题只出现在小窗/抽屉里，语义上不该抢页面大标题
      frag.appendChild(el("h" + Math.min(6, h[1].length + 2), "md-h", inlineNodes(h[2])));
      i++;
      continue;
    }
    if (/^\s*(?:\*\s*\*\s*\*|-\s*-\s*-|_\s*_\s*_)\s*$/.test(line)) { frag.appendChild(document.createElement("hr")); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      frag.appendChild(el("blockquote", "md-quote", inlineNodes(buf.join(" "))));
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      const mk = (tag, txt) => el(tag, null, inlineNodes(txt));
      frag.appendChild(el("table", "md-table", [
        el("thead", null, [el("tr", null, head.map((c) => mk("th", c)))]),
        el("tbody", null, rows.map((r) => el("tr", null, r.map((c) => mk("td", c))))),
      ]));
      continue;
    }
    const li = line.match(LI);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const list = el(ordered ? "ol" : "ul", "md-list");
      while (i < lines.length) {
        const cur = lines[i].match(LI);
        if (!cur || /\d/.test(cur[2]) !== ordered) break;
        if (cur[1].length >= 2 && list.lastChild) {
          const sub = list.lastChild.querySelector("ul,ol") || el(ordered ? "ol" : "ul", "md-sub");
          if (!list.lastChild.querySelector("ul,ol")) list.lastChild.appendChild(sub);
          sub.appendChild(el("li", null, inlineNodes(cur[3])));
        } else list.appendChild(el("li", null, inlineNodes(cur[3])));
        i++;
      }
      frag.appendChild(list);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim()
      && !LI.test(lines[i]) && !/^\s*(?:#{1,6}\s|>)/.test(lines[i])
      && !/^\s*(?:```+|~~~+)/.test(lines[i])) buf.push(lines[i++]);
    frag.appendChild(el("p", "md-p", inlineNodes(buf.join(" "))));
  }
  return frag;
}

/** 把 markdown 直接填进一个节点（替换其全部内容）。 */
export function mdInto(node, text) {
  node.replaceChildren(renderMd(text));
  return node;
}

/** 新建一个带 .md 作用域的容器并填进渲染结果——调用方基本都该用这个。 */
export function mdEl(text, cls, tag) {
  const n = document.createElement(tag || "div");
  n.className = "md" + (cls ? " " + cls : "");
  n.appendChild(renderMd(text));
  return n;
}

// 共用样式：小窗与抽屉都注入这一份。**每条选择器都以 .md 开头**——
// 因为它会被注进全局 <style>，任何裸元素选择器（hr、a、li code）都会漏出去
// 改掉编辑器其它面板的观感，那种"改了 AI 窗口结果主页变样"的回归最难查。
export const MD_CSS = `
.md .md-p{margin:2px 0;line-height:1.6}
.md .md-h{margin:6px 0 3px;font-size:12.5px;font-weight:700;color:#e6edf6;letter-spacing:.2px}
.md .md-list{margin:2px 0;padding-left:17px;line-height:1.62}
.md .md-list li{margin:1px 0}
.md .md-quote{margin:3px 0;padding:2px 0 2px 8px;border-left:2px solid #33415a;color:#93a3b8}
.md .md-table{border-collapse:collapse;margin:4px 0;font-size:11.5px;width:100%}
.md .md-table th,.md .md-table td{border:1px solid #232c3a;padding:2px 6px;text-align:left}
.md .md-table th{background:#0f141b;color:#a9b6c8;font-weight:600}
.md hr{border:0;border-top:1px solid #232c3a;margin:6px 0}
.md .md-pre{margin:4px 0;position:relative;background:#0b0f15;border:1px solid #1e2733;border-radius:6px;
  padding:6px 8px;overflow:auto;max-height:220px}
.md .md-pre code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.5;
  color:#c8d4e4;white-space:pre}
.md .md-lang{position:absolute;right:7px;top:4px;font-size:10px;color:#43506a;text-transform:uppercase}
.md code{background:#1a2230;border-radius:3px;padding:0 4px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:#ffd9a0}
.md .md-pre code{background:none;padding:0;color:#c8d4e4}
.md a{color:#7fb3ff;text-decoration:underline;cursor:pointer}
.md strong{color:#f6f1e8}
.md em{color:#b9c7da}
`;
