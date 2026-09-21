#!/usr/bin/env node
// build-docs.mjs — docs/*.md -> docs/*.html for GitHub Pages.
// Pages 上的 Jekyll 会跳过下划线文件、也不会把 .md 渲染成可读页面，
// 所以这里自带一个够用的 markdown 子集解析器，输出与介绍站同一套 site.css。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");

const DOCS_LIST = [
  ["architecture", "架构与数据流"],
  ["api-compat", "官方 API 兼容层"],
  ["data-format", "数据格式"],
  ["physics", "物理与单位制"],
  ["testing", "测试与验证"],
  ["packaging", "便携包与发布"],
  ["windows", "Windows 支持说明"],
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const slug = (s) =>
  s.toLowerCase()
    .replace(/[`*_~()（）【】，。、：；！？"'“”]/g, "")
    .replace(/[\/\s]+/g, "-")
    .replace(/^-+|-+$/g, "") || "s";

const KEYWORDS =
  "const|let|var|function|return|if|else|for|while|of|in|new|class|extends|this|null|true|false|await|async|import|export|from|try|catch|throw|switch|case|break|continue|typeof|instanceof|delete|void|do|super|yield|static|get|set";

const CODE_RE = new RegExp(
  [
    "(\\/\\/[^\\n]*)",
    "(\\/\\*[\\s\\S]*?\\*\\/)",
    "('(?:\\\\.|[^'\\\\\\n])*'|\"(?:\\\\.|[^\"\\\\\\n])*\"|`(?:\\\\.|[^`\\\\])*`)",
    `\\b(${KEYWORDS})\\b`,
    "\\b(\\d+(?:\\.\\d+)?)\\b",
  ].join("|"),
  "g"
);

// 只处理代码块：先按分隔符切片，夹在中间的普通文本整体转义，避免二次转义。
function highlight(raw, lang) {
  const text = esc(raw);
  if (!/^(js|mjs|ts|json|jsdoc)$/.test(lang || "")) return text;
  // 上面已经转义过，这里针对转义后的文本再扫描；实体不含会被误判的引号/斜杠组合。
  let out = "";
  let last = 0;
  CODE_RE.lastIndex = 0;
  const re = new RegExp(CODE_RE.source, "g");
  for (let m; (m = re.exec(text)); ) {
    out += text.slice(last, m.index);
    const cls = m[1] || m[2] ? "c-cm" : m[3] ? "c-st" : m[4] ? "c-kw" : "c-nu";
    out += `<span class="${cls}">${m[0]}</span>`;
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

function inline(src) {
  let s = esc(src);
  const stash = [];
  const keep = (html) => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => {
    const clean = href.replace(/\.md(?=[#?]|$)/, ".html");
    const ext = /^https?:/.test(clean) ? ' target="_blank" rel="noopener"' : "";
    return keep(`<a href="${clean}"${ext}>${t}</a>`);
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
  return s;
}

function parse(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  const toc = [];
  const seen = new Map();
  let i = 0;
  let title = "";

  const uniq = (base) => {
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  const listItems = (block) => {
    const tag = block.ordered ? "ol" : "ul";
    let out = `<${tag} class="lv-${block.depth}">`;
    for (const it of block.items) {
      let inner = `<li>${inline(it.text)}`;
      if (it.child) inner += listItems(it.child);
      out += inner + "</li>";
    }
    return out + `</${tag}>`;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html.push(
        `<div class="code${lang ? ` code-${lang}` : ""}">${
          lang ? `<span class="code-lang">${esc(lang)}</span>` : ""
        }<pre><code>${highlight(buf.join("\n"), lang)}</code></pre></div>`
      );
      continue;
    }

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const raw = h[2].trim();
      if (level === 1 && !title) {
        title = raw;
        i++;
        continue;
      }
      const id = uniq(slug(raw));
      if (level <= 3) toc.push({ level, text: raw.replace(/[`*]/g, ""), id });
      html.push(
        level <= 2
          ? `<h2 id="${id}">${inline(raw)}</h2>`
          : `<h3 id="${id}">${inline(raw)}</h3>`
      );
      i++;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s*\-_]*$/.test(line)) {
      html.push("<hr/>");
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      html.push(`<blockquote>${buf.map((b) => `<p>${inline(b)}</p>`).join("")}</blockquote>`);
      continue;
    }

    // 表格：表头行 + |---| 分隔行
    if (/^\|/.test(line) && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1] || "")) {
      const cells = (row) =>
        row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) body.push(cells(lines[i++]));
      html.push(
        `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`
      );
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const parseItem = (l) => {
        const m = l.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
        return { depth: (l.match(/^\s*/)[0].length / 2) | 0, ordered: /\d/.test(m[1]), text: m[2] };
      };
      const root = { depth: 0, ordered: /^\s*\d+\./.test(line), items: [] };
      const stack = [root];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const raw = lines[i];
        const item = parseItem(raw);
        // 缩进续行属于上一条列表项
        let cur = stack[stack.length - 1];
        while (cur.depth > item.depth && stack.length > 1) {
          stack.pop();
          cur = stack[stack.length - 1];
        }
        if (item.depth > cur.depth) {
          const child = { depth: item.depth, ordered: item.ordered, items: [] };
          cur.items[cur.items.length - 1].child = child;
          stack.push(child);
          cur = child;
        } else if (cur.ordered !== item.ordered && cur.depth === item.depth) {
          cur.ordered = item.ordered;
        }
        cur.items.push({ text: item.text });
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]))
          cur.items[cur.items.length - 1].text += " " + lines[i++].trim();
      }
      html.push(listItems(root));
      continue;
    }

    const buf = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,4}\s|```|>|\||\s*([-*]|\d+\.)\s)/.test(lines[i])
    )
      buf.push(lines[i++]);
    html.push(`<p>${inline(buf.join(" "))}</p>`);
  }

  return { html: html.join("\n"), toc, title };
}

const NAV = `<header class="nav">
  <a class="brand" href="./">
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><path d="M16 2 3 9v14l13 7 13-7V9L16 2z" fill="none" stroke="#fc8308" stroke-width="2.4"/><path d="M16 9l5 12h-3l-1-2.4h-2L14 21h-3l5-12zm0 4.2-1 2.6h2l-1-2.6z" fill="#fc8308"/></svg>
    <span><b>DAO3 编辑器复刻</b><i>开发文档</i></span>
  </a>
  <nav class="links">
    <a href="./#tour">界面</a>
    <a href="./#proof">验证</a>
    <a href="./#start">上手</a>
    <a href="./#matrix">能力</a>
    <a href="./#docs">文档</a>
    <a href="./#download">下载</a>
  </nav>
  <a class="gh" href="https://github.com/deepseekv5/dao3" rel="noopener">
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 .2a8 8 0 0 0-2.5 15.6c.4.1.5-.2.5-.4v-1.4c-2 .4-2.5-.5-2.7-1-.1-.3-.5-1-.8-1.2-.3-.1-.7-.5 0-.6.6-.1 1.1.6 1.3.9.8 1.3 2 .9 2.5.7.1-.6.3-1 .6-1.2-2-.2-4.1-1-4.1-4.4 0-1 .3-1.8.9-2.4-.1-.3-.4-1.2.1-2.5 0 0 .8-.2 2.5 1a7.5 7.5 0 0 1 4.5 0c1.7-1.2 2.5-1 2.5-1 .5 1.3.2 2.2.1 2.5.6.6.9 1.4.9 2.4 0 3.4-2.1 4.2-4.1 4.4.3.3.6.8.6 1.7v2.5c0 .2.1.5.5.4A8 8 0 0 0 8 .2z"/></svg>
    <span>deepseekv5/dao3</span>
  </a>
</header>`;

const FOOT = `<footer class="foot">
  <div>
    <b>DAO3 编辑器复刻</b>
    <span>独立兼容实现 · 代码 Apache-2.0 · 素材版权归 box3lab 及其权利人所有</span>
  </div>
  <div class="fl">
    <a href="./">介绍站</a>
    <a href="https://github.com/deepseekv5/dao3">源码仓库</a>
    <a href="https://github.com/deepseekv5/dao3/releases">下载</a>
    <a href="https://github.com/deepseekv5/dao3/issues">问题反馈</a>
  </div>
  <p class="disc">本页由 scripts/build-docs.mjs 从 docs/*.md 生成；要改内容请编辑 markdown 后重新运行 <code>node scripts/build-docs.mjs</code>。</p>
</footer>`;

function page({ file, title, body, toc, prev, next }) {
  const tocHtml = toc.length
    ? `<nav class="toc"><b>本页内容</b>${toc
        .map((t) => `<a class="t${t.level}" href="#${t.id}">${esc(t.text)}</a>`)
        .join("")}</nav>`
    : "";
  const pager = `<nav class="pager">${
    prev ? `<a href="${prev.file}.html"><small>上一篇</small><b>${esc(prev.text)}</b></a>` : "<span></span>"
  }${next ? `<a class="next" href="${next.file}.html"><small>下一篇</small><b>${esc(next.text)}</b></a>` : "<span></span>"}</nav>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)} · DAO3 编辑器复刻文档</title>
<meta name="description" content="${esc(title)} —— DAO3 编辑器复刻开发文档"/>
<meta name="theme-color" content="#0c0c0d"/>
<link rel="icon" type="image/svg+xml" href="img/arena.svg"/>
<link rel="stylesheet" href="site.css"/>
</head>
<body>
${NAV}
<main class="doc">
  <aside class="doc-side">
    <nav class="doclist"><b>文档目录</b>${DOCS_LIST.map(
      ([f, t]) => `<a${f === file ? ' class="on"' : ""} href="${f}.html">${esc(t)}</a>`
    ).join("")}</nav>
    ${tocHtml}
    <a class="edit" href="https://github.com/deepseekv5/dao3/blob/main/docs/${file}.md">在 GitHub 编辑原文</a>
  </aside>
  <article class="doc-body">
    <p class="crumb"><a href="./">概览</a> / <a href="./#docs">文档</a> / <span>${esc(title)}</span></p>
    <h1>${esc(title)}</h1>
${body}
    ${pager}
  </article>
</main>
${FOOT}
</body>
</html>
`;
}

let built = 0;
for (let n = 0; n < DOCS_LIST.length; n++) {
  const [file, fallback] = DOCS_LIST[n];
  const src = path.join(DOCS, `${file}.md`);
  if (!fs.existsSync(src)) {
    console.warn(`skip ${file}.md (missing)`);
    continue;
  }
  const { html, toc, title } = parse(fs.readFileSync(src, "utf8"));
  const out = page({
    file,
    title: title || fallback,
    body: html,
    toc,
    prev: n > 0 ? { file: DOCS_LIST[n - 1][0], text: DOCS_LIST[n - 1][1] } : null,
    next: n < DOCS_LIST.length - 1 ? { file: DOCS_LIST[n + 1][0], text: DOCS_LIST[n + 1][1] } : null,
  });
  fs.writeFileSync(path.join(DOCS, `${file}.html`), `<!-- Generated by scripts/build-docs.mjs from ${file}.md — do not edit. -->\n` + out);
  built++;
  console.log(`${file}.md -> ${file}.html  (${toc.length} 节, ${Buffer.byteLength(out)}B)`);
}
console.log(`docs: ${built} 页面`);
