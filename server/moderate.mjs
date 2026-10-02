/**
 * moderate.mjs — 全局文本审查：昵称、简介、标题、评论、聊天都过这一道。
 *
 * 为什么放在服务端而不是前端：前端过滤只是给老实人看的装饰，任何一次
 * curl 都能绕过。规则要生效，必须在写库之前。
 *
 * 三档结果：
 *   block  直接拒绝，不落库（HTML 注入、控制字符、明确违规词）
 *   flag   落库但打标记，进管理员的审核队列（疑似广告、联系方式、外链）
 *   ok     正常
 * 词表在 community/mute-words.json，管理员可改；改完不用重启（按 mtime 重载）。
 */
import fs from "node:fs";
import path from "node:path";

const TAG_RE = /<\s*\/?\s*(script|iframe|object|embed|link|style|img|svg|form|meta)[^>]*>/i;
const ANY_TAG_RE = /<[^>]{0,200}>/;
const CTRL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\ufeff]/;
const URL_RE = /(https?:\/\/|www\.)[^\s]{4,}/i;
const CONTACT_RE = /(qq\s*[:：]?\s*\d{5,}|微信\s*[:：]?\s*[A-Za-z0-9_-]{4,}|vx\s*[:：]?\s*[A-Za-z0-9_-]{4,}|\b1[3-9]\d{9}\b|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
const SPAM_RE = /(加群|私聊我|代练|代刷|低价出售|返利|刷单|博彩|彩票|菠菜|棋牌|赌钱|加微信|关注公众号)/;
const REPEAT_RE = /(.)\1{11,}/;          // 同字符刷屏
const WORD_RE = /(傻逼|煞笔|尼玛|滚蛋|狗东西|王八蛋|去死|废物东西|贱人)/;

const DEFAULTS = { block: [], flag: [] };

export function createModeration({ file } = {}) {
  let cached = { mtime: 0, block: [], flag: [] };
  function load() {
    if (!file) return cached;
    let st;
    try { st = fs.statSync(file); } catch { return cached; }
    if (st.mtimeMs === cached.mtime) return cached;
    let j = DEFAULTS;
    try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch { j = DEFAULTS; }
    cached = { mtime: st.mtimeMs, block: j.block || [], flag: j.flag || [] };
    return cached;
  }
  if (file && !fs.existsSync(file)) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ block: [], flag: ["外挂", "透视", "自瞄"], note: "block 命中即拒绝；flag 命中会进管理员审核队列" }, null, 2));
    } catch { /* 只读目录时用内置规则，不影响判定 */ }
  }

  /** @returns {{level:"ok"|"flag"|"block", reason:string}} */
  function check(raw, { field = "text", max = 2000 } = {}) {
    const text = String(raw == null ? "" : raw);
    if (text.length > max) return { level: "block", reason: `${field}最长 ${max} 字` };
    if (CTRL_RE.test(text)) return { level: "block", reason: `${field}里有不可见控制字符` };
    if (TAG_RE.test(text)) return { level: "block", reason: `${field}不允许 HTML 标签` };
    if (ANY_TAG_RE.test(text) && field !== "bio") return { level: "flag", reason: `${field}里出现了尖括号内容` };
    const { block, flag } = load();
    for (const w of block) if (w && text.toLowerCase().includes(String(w).toLowerCase())) return { level: "block", reason: `${field}包含不允许的内容` };
    if (WORD_RE.test(text)) return { level: "block", reason: `${field}包含辱骂内容` };
    const reasons = [];
    if (URL_RE.test(text)) reasons.push("外链");
    if (CONTACT_RE.test(text)) reasons.push("联系方式");
    if (SPAM_RE.test(text)) reasons.push("疑似广告");
    if (REPEAT_RE.test(text)) reasons.push("重复刷屏");
    for (const w of flag) if (w && text.toLowerCase().includes(String(w).toLowerCase())) reasons.push("敏感词");
    return reasons.length ? { level: "flag", reason: `${field}：` + reasons.join("、") } : { level: "ok", reason: "" };
  }

  /** 展示用的兜底清洗：任何地方都不该把用户文本当 HTML 塞进去。 */
  const sanitize = (raw) => String(raw == null ? "" : raw).replace(CTRL_RE, "").slice(0, 4000);

  return { check, sanitize, reload: () => { cached.mtime = 0; return load(); }, file };
}
