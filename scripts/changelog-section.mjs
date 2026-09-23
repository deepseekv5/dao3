#!/usr/bin/env node
// scripts/changelog-section.mjs — 从 CHANGELOG.md 里取出某个版本的小节，供 Release 正文用。
//
// 为什么要脚本而不是在 workflow 里手拼字符串：那样 Release 说明、CHANGELOG、
// 介绍站三处各写一份，改一漏二，而且漏掉的那份看起来完全正常。
// 现在只有 CHANGELOG.md 一个来源。
//
//   node scripts/changelog-section.mjs v1.0.8      # 该版本小节
//   node scripts/changelog-section.mjs --latest    # 最新一个已发布版本
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "CHANGELOG.md");

const want = process.argv[2] || "--latest";
const text = fs.readFileSync(FILE, "utf8");
// 版本小节以 "## [x.y.z]" 开头（"## [未发布]" 也是同一种标题，靠名字排除）
const heads = [...text.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => ({ name: m[1], at: m.index }));
if (!heads.length) { console.error("CHANGELOG.md 里找不到任何 '## [版本]' 小节"); process.exit(1); }

let target;
if (want === "--latest") target = heads.find((h) => h.name !== "未发布");
else target = heads.find((h) => h.name === want.replace(/^v/, ""));
if (!target) {
  console.error(`CHANGELOG.md 里没有版本 ${want}；已有：${heads.map((h) => h.name).join(", ")}`);
  process.exit(1);
}
const end = heads[heads.indexOf(target) + 1];
const section = text.slice(target.at, end ? end.at : text.length).trim();
if (!/\n###/.test(section)) { console.error(`版本 ${target.name} 的小节是空的`); process.exit(1); }
// Release 页面自己就是标题，正文里那个 "## [1.0.8]" 去掉，避免重复
console.log(section.replace(/^## \[[^\]]+\]\s*-?\s*[0-9-]*\n+/, "").trim());
