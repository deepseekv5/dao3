// backend.play.js — 体验版（纯静态 Pages）里的那一份 backend。
//
// build-play.mjs 在拷 js/backend.js 时换成这份：运行时其余代码原样不动，
// 但产物里一个 api 取用、一个根绝对跳转都不会出现——静态站上这些必然 404，
// 与其让人点一下转圈报错，不如直接告诉他这里没有服务端。
// 放在 scripts/ 下而不是 play-src/：play-src/ 是 1:1 镜像进产物的页面与样式，
// 这份是**替换**用的源码，直接镜像过去会留下一份永远用不到的 js/backend.play.js。
//
// 导出的名字与签名必须和 public/js/backend.js 一致，否则运行时会在
// "只有体验版才走得到的路径"上崩，那种 bug 本地永远测不出来。

export const serverBacked = false;

export async function listWorlds() { return []; }
export async function findWorld() { return null; }
export async function findPub() { return null; }

export function gotoWorld() { /* 没有编辑器可去 */ }
export async function gotoPub() { throw new Error("体验版是纯静态站点，没有社区与存档服务，去不了别的图"); }

export async function runSql() {
  throw new Error("db.sql 需要本地服务在跑；体验版是纯静态站点，用不了数据库");
}

export function openProfile() { /* 没有账号页可去 */ }

/* 社交层整块不在体验版里：social.js / auth.js 连产物都不会出现。
   调用方（game.js 的世界频道、那颗好友按钮）都先看 serverBacked，
   所以这几个函数在体验版里正常根本走不到——走到就说明 UI 漏了道闸门，
   宁可抛得明明白白，也别静默返回一个"看起来像没消息"的空数组。 */
export async function chatSend() { throw new Error("体验版没有世界频道，只有同图的人能听见"); }
export async function chatPull() { return []; }
export function openMessages() { /* 没有好友面板可开 */ }
