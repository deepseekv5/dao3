#!/usr/bin/env node
// build-docs.mjs — docs/*.md -> docs/*.html for GitHub Pages.
// Pages 上的 Jekyll 会跳过下划线文件、也不会把 .md 渲染成可读页面，
// 所以这里自带一个够用的 markdown 子集解析器，输出与介绍站同一套 site.css。
// 三件事：docs/*.md -> 各篇正文页；docs/index.src.html -> index.html；
// docs/documentation.src.html -> documentation.html（文档中心，侧边栏与卡片摘要由这里注入）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");

// 文档清单的唯一来源：[文件名, 中文标题, 分组]。
// 数组顺序既是侧边栏顺序，也是"上一篇/下一篇"的阅读顺序，所以同一个分组的条目必须连着写。
// 每篇的一句话摘要不在这里，它在介绍站首页的 .dc 卡片里（见 readDocCards）。
const DOCS_LIST = [
  ["architecture", "架构与数据流", "入门"],
  ["testing", "测试与验证", "入门"],
  ["api-compat", "官方 API 兼容层", "内核"],
  ["api-reference", "API 参考", "内核"],
  ["data-format", "数据格式", "内核"],
  ["map-format", "标准地图格式", "内核"],
  ["physics", "物理与单位制", "内核"],
  ["packaging", "便携包与发布", "交付"],
  ["playground", "网页体验版", "交付"],
  ["dependencies", "依赖清单", "交付"],
  ["credits", "致谢", "交付"],
  ["windows", "Windows 支持说明", "交付"],
  ["changelog", "更新日志", "交付", "CHANGELOG.md"],
];

// 文档中心的分组小标题（id 用作锚点，note 是分组导读）。
const DOC_GROUPS = [
  ["start", "入门", "先看清整体结构，再学会怎么在真实浏览器里验证自己拿到的一切。"],
  ["core", "内核", "接口、数据、物理三块——「兼容」具体落在这些判据上。"],
  ["ship", "交付", "打包、依赖、授权与平台边界：能拿走什么，拿不走什么。"],
];

const GROUP_IDS = new Map(DOC_GROUPS.map(([id, name]) => [name, id]));

// 分组没写导读、清单里漏了或多出条目，都是生成页与清单对不上——直接失败，别默默产出半套导航。
{
  const listed = DOCS_LIST.map(([, , g]) => g);
  for (const [, g] of DOC_GROUPS) if (!listed.includes(g)) throw new Error(`DOC_GROUPS 里的「${g}」没有任何文档`);
  for (const g of listed) if (!GROUP_IDS.has(g)) throw new Error(`「${g}」分组没有对应的 DOC_GROUPS 条目`);
}

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

// 顶栏：文档区所有页面（含文档中心）共用这一份，"文档"指向文档中心而不是介绍站的锚点，
// 并从视觉上标出当前所在区段（.links a.on）。
const NAV = `<header class="nav">
  <a class="brand" href="./">
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><path d="M16 2 3 9v14l13 7 13-7V9L16 2z" fill="none" stroke="#fc8308" stroke-width="2.4"/><path d="M16 9l5 12h-3l-1-2.4h-2L14 21h-3l5-12zm0 4.2-1 2.6h2l-1-2.6z" fill="#fc8308"/></svg>
    <span><b>DAO3 编辑器复刻</b><i>开发文档</i></span>
  </a>
  <nav class="links">
    <a class="play-link" href="https://deepseekv5.github.io/dao3play/" rel="noopener">在线体验</a>
    <a href="#top">概览</a>
    <a href="./#tour">界面</a>
    <a href="./#proof">验证</a>
    <a href="./#start">上手</a>
    <a href="./#matrix">能力</a>
    <a class="on" href="documentation.html">文档</a>
    <a href="./#download">下载</a>
  </nav>
  <a class="home" href="/" hidden>返回工作台</a>
  <a class="gh" href="https://github.com/deepseekv5/dao3" rel="noopener">
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M8 .2a8 8 0 0 0-2.5 15.6c.4.1.5-.2.5-.4v-1.4c-2 .4-2.5-.5-2.7-1-.1-.3-.5-1-.8-1.2-.3-.1-.7-.5 0-.6.6-.1 1.1.6 1.3.9.8 1.3 2 .9 2.5.7.1-.6.3-1 .6-1.2-2-.2-4.1-1-4.1-4.4 0-1 .3-1.8.9-2.4-.1-.3-.4-1.2.1-2.5 0 0 .8-.2 2.5 1a7.5 7.5 0 0 1 4.5 0c1.7-1.2 2.5-1 2.5-1 .5 1.3.2 2.2.1 2.5.6.6.9 1.4.9 2.4 0 3.4-2.1 4.2-4.1 4.4.3.3.6.8.6 1.7v2.5c0 .2.1.5.5.4A8 8 0 0 0 8 .2z"/></svg>
    <span>deepseekv5/dao3</span>
  </a>
</header>`;

const NAV_JS = `<script>
// 本站同时是 GitHub Pages 站点和本地应用里的 /docs。Pages 上 "/" 是用户主页不是工作台，
// 所以"返回工作台"只在本地服务里出现。
if (!/github\\.io$/i.test(location.hostname)) { const a = document.querySelector(".nav .home"); if (a) a.hidden = false; }
</script>`;

// 顶栏 + 那段显隐脚本永远成对出现，所以打包成一个模板给所有页面用。
const TOP = `${NAV}\n${NAV_JS}`;

const FOOT = `<footer class="foot">
  <div>
    <b>DAO3 编辑器复刻</b>
    <span>独立兼容实现 · 代码 Apache-2.0 · 素材版权归 box3lab 及其权利人所有</span>
  </div>
  <div class="fl">
    <a href="./">介绍站</a>
    <a href="documentation.html">文档中心</a>
    <a href="https://github.com/deepseekv5/dao3">源码仓库</a>
    <a href="https://github.com/deepseekv5/dao3/releases">下载</a>
    <a href="https://github.com/deepseekv5/dao3/issues">问题反馈</a>
  </div>
  <p class="disc">本页由 scripts/build-docs.mjs 从 docs/*.md 生成；要改内容请编辑 markdown 后重新运行 <code>node scripts/build-docs.mjs</code>。</p>
</footer>`;

// 常驻侧边栏的目录部分：文档中心 + 按分组排开的全部条目，当前页高亮。
// 文档中心页与各篇正文页共用这个函数，所以侧边栏在任何一页都长得一样。
function docListHtml(current) {
  const title = new Map(DOCS_LIST.map(([f, t]) => [f, t]));
  let out = `<nav class="doclist"><b>文档目录</b>`;
  out += `<a${current === "documentation" ? ' class="on"' : ""} href="documentation.html">文档中心</a>`;
  let last = null;
  for (const [f, , group] of DOCS_LIST) {
    if (group !== last) {
      out += `<b class="grp">${esc(group)}</b>`;
      last = group;
    }
    out += `<a${f === current ? ' class="on"' : ""} href="${f}.html">${esc(title.get(f))}</a>`;
  }
  return out + "</nav>";
}

// 摘要的唯一来源是介绍站首页的 .dc 卡片文案（不另写一套，免得两处各说各话）。
function readDocCards(indexSrc) {
  const map = new Map();
  const re = /<a class="dc" href="([^"]+)"><b>([\s\S]*?)<\/b><span>([\s\S]*?)<\/span><\/a>/g;
  for (let m; (m = re.exec(indexSrc)); ) map.set(m[1].replace(/\.html$/, ""), { title: m[2].trim(), summary: m[3].trim() });
  return map;
}

function docSections(cards) {
  const note = new Map(DOC_GROUPS.map(([, name, text]) => [name, text]));
  let out = "";
  let last = null;
  for (const [file, title, group] of DOCS_LIST) {
    const card = cards.get(file);
    if (!card) {
      throw new Error(`${file} 在 docs/index.src.html 里没有 .dc 卡片——文档中心的摘要就没处取，请加卡片或从 DOCS_LIST 删掉这篇`);
    }
    if (card.title !== title) {
      throw new Error(`${file} 的标题两处不一致：DOCS_LIST="${title}" vs docs/index.src.html="${card.title}"`);
    }
    if (group !== last) {
      if (last !== null) out += "    </div>\n";
      out += `    <h2 id="${GROUP_IDS.get(group)}">${esc(group)}</h2>\n`;
      out += `    <p>${esc(note.get(group))}</p>\n`;
      out += `    <div class="docs">\n`;
      last = group;
    }
    out += `      <a class="dc" href="${file}.html"><b>${esc(title)}</b><span>${card.summary}</span></a>\n`;
  }
  return out ? out + "    </div>\n" : "";
}

function page({ file, title, body, toc, prev, next, srcRel }) {
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
${TOP}
<main class="doc">
  <aside class="doc-side">
    ${docListHtml(file)}
    ${tocHtml}
    <a class="edit" href="https://github.com/deepseekv5/dao3/blob/main/${srcRel || `docs/${file}.md`}">在 GitHub 编辑原文</a>
  </aside>
  <article class="doc-body">
    <p class="crumb"><a href="./">概览</a> / <a href="documentation.html">文档中心</a> / <span>${esc(title)}</span></p>
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
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

// index.src.html → index.html：下载区的三个链接里带版本号，
// 手写一次就会在下一次发版后变成死链。占位符 + 构建期替换是唯一不会腐烂的写法。
const indexSrcPath = path.join(DOCS, "index.src.html");
let indexSrc = "";
if (fs.existsSync(indexSrcPath)) {
  indexSrc = fs.readFileSync(indexSrcPath, "utf8");
  const html = indexSrc.replace(/\{\{VER\}\}/g, VERSION).replace(/\{\{DOCS_N\}\}/g, String(DOCS_LIST.length));
  for (const ph of ["{{VER}}", "{{DOCS_N}}"]) if (html.includes(ph)) throw new Error(`index.src.html 替换后仍残留 ${ph}`);
  fs.writeFileSync(path.join(DOCS, "index.html"), `<!-- Generated from index.src.html by scripts/build-docs.mjs (v${VERSION}) — do not edit. -->\n` + html);
  console.log(`index.src.html -> index.html  (v${VERSION})`);
}

// documentation.src.html → documentation.html：独立的文档中心落地页。
// 侧边栏目录、分组卡片、卡片摘要全部由 DOCS_LIST + 介绍站卡片现场注入，
// 这份页面手写只会和生成页跑偏；占位符缺失直接失败，不产出半套导航。
const hubSrcPath = path.join(DOCS, "documentation.src.html");
if (fs.existsSync(hubSrcPath)) {
  if (!indexSrc) throw new Error("documentation.src.html 需要 index.src.html 提供各篇摘要");
  const cards = readDocCards(indexSrc);
  const body = () =>
    fs
      .readFileSync(hubSrcPath, "utf8")
      .replace(/\{\{VER\}\}/g, VERSION)
      .replace("{{NAV}}", () => TOP)
      .replace("{{FOOT}}", () => FOOT)
      .replace("{{DOC_COUNT}}", String(DOCS_LIST.length))
      .replace("{{DOC_SECTIONS}}", () => docSections(cards));
  const pre = body();
  // 本页内容的目录从正文里扫 h2，分组改动时不用两处维护。
  const items = [...pre.matchAll(/<h2 id="([^"]+)">([^<]+)<\/h2>/g)].map(
    ([, id, text]) => `<a class="t2" href="#${id}">${text}</a>`
  );
  const tocHtml = items.length ? `<nav class="toc"><b>本页内容</b>${items.join("")}</nav>` : "";
  // 侧边栏：缩进跟着 src 里的占位符走，换行时对齐 src 已有的层级而不是硬写 4 空格。
  const srcText = fs.readFileSync(hubSrcPath, "utf8");
  const indent = (srcText.match(/^([ \t]*)\{\{SIDEBAR\}\}\n/m) || [, "    "])[1] || "    ";
  const sidebar = [
    docListHtml("documentation"),
    tocHtml,
    `<a class="edit" href="https://github.com/deepseekv5/dao3/tree/main/docs">在 GitHub 查看 docs/</a>`,
  ]
    .filter(Boolean)
    .join(`\n${indent}`);
  const html = body().replace("{{SIDEBAR}}", () => sidebar);
  const left = html.match(/\{\{[A-Z_]+\}\}/g);
  if (left) throw new Error(`documentation.src.html 有未替换的占位符：${[...new Set(left)].join(", ")}`);
  fs.writeFileSync(
    path.join(DOCS, "documentation.html"),
    `<!-- Generated from documentation.src.html by scripts/build-docs.mjs (v${VERSION}) — do not edit. -->\n` + html
  );
  console.log(`documentation.src.html -> documentation.html  (${DOCS_LIST.length} 篇 / ${DOC_GROUPS.length} 组)`);
}

for (let n = 0; n < DOCS_LIST.length; n++) {
  const [file, fallback, , srcRel] = DOCS_LIST[n];
  // 有第四个字段就从仓库根取源（CHANGELOG.md 属于根，不该在 docs/ 里再存一份副本），
  // 否则默认 docs/<file>.md
  const src = srcRel ? path.join(ROOT, srcRel) : path.join(DOCS, `${file}.md`);
  if (!fs.existsSync(src)) {
    // 以前这里只 console.warn 然后 continue——结果某次加了一篇文档，
    // 名字对不上就静默不出页面，构建照样"成功"。缺源必须硬失败。
    throw new Error(`${file} 的源文件不存在：${path.relative(ROOT, src)}（新增文档请同时放好 .md 或在 DOCS_LIST 里删掉这条）`);
  }
  const { html, toc, title } = parse(fs.readFileSync(src, "utf8").replace(/\{\{VER\}\}/g, VERSION));
  const out = page({
    file,
    srcRel,
    title: title || fallback,
    body: html,
    toc,
    prev: n > 0 ? { file: DOCS_LIST[n - 1][0], text: DOCS_LIST[n - 1][1] } : null,
    next: n < DOCS_LIST.length - 1 ? { file: DOCS_LIST[n + 1][0], text: DOCS_LIST[n + 1][1] } : null,
  });
  fs.writeFileSync(path.join(DOCS, `${file}.html`), `<!-- Generated by scripts/build-docs.mjs from ${srcRel || `.md`} — do not edit. -->\n` + out);
  built++;
  console.log(`${file}.md -> ${file}.html  (${toc.length} 节, ${Buffer.byteLength(out)}B)`);
}
console.log(`docs: ${built} 页面`);
