// diff.js — 行级 diff 与"这行是谁写的"（blame）。零依赖，服务端与编辑器共用一份。
//
// 为什么要共用：归属必须由**服务端**判定（客户端自报的作者可以伪造），但渲染
// 在编辑器里。两边各写一遍 LCS 的话，早晚会出现服务端算出的作者表在客户端
// 对不上行号的情况——那正是"标注错了人"这种最难查的 bug。

const MAX_LINES = 4000;   // 超过这个长度就不做精确 LCS：O(n²) 会把主线程吃死

/** 两段行序列的最长公共子序列匹配：返回 next 行号 -> prev 行号 的映射。 */
export function lcsMatch(prev, next) {
  const n = prev.length, m = next.length;
  const map = new Map();
  if (!n || !m) return map;
  if (n > MAX_LINES || m > MAX_LINES) return map;   // 交给调用方按"全部重写"处理
  // 滚动数组：只保留上一行，省掉 n×m 的内存（一张 3000 行的脚本能省 9MB）
  let row = new Uint16Array(m + 1);
  const back = new Uint8Array(n * (m + 1));         // 1=左上(匹配) 2=上(删除) 3=左(插入)
  for (let i = 1; i <= n; i++) {
    const diag = row;
    row = new Uint16Array(m + 1);
    for (let j = 1; j <= m; j++) {
      if (prev[i - 1] === next[j - 1]) { row[j] = diag[j - 1] + 1; back[(i - 1) * (m + 1) + j] = 1; }
      else if (diag[j] >= row[j - 1]) { row[j] = diag[j]; back[(i - 1) * (m + 1) + j] = 2; }
      else { row[j] = row[j - 1]; back[(i - 1) * (m + 1) + j] = 3; }
    }
  }
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const dir = back[(i - 1) * (m + 1) + j];
    if (dir === 1) { map.set(j - 1, i - 1); i--; j--; }
    else if (dir === 2) i--;
    else j--;
  }
  return map;
}

/** 一次改动之后，next 的每一行该记在谁头上。
 *  没动的行沿用原作者——这才是"标注是谁写的"：一个人改了第三行，
 *  不该让整份文件都变成他写的。新增/改写的行才算在这次改动的人头上。 */
export function reblame(prevLines, prevAuthors, nextLines, author) {
  const out = new Array(nextLines.length).fill(author);
  const match = lcsMatch(prevLines, nextLines);
  if (match.size) {
    for (const [j, i] of match) if (prevAuthors && prevAuthors[i] != null) out[j] = prevAuthors[i];
  }
  return out;
}

/** 作者表按游程压缩：一行一个 id 的话，一份 2000 行脚本要发 2000 个数。 */
export function rle(list) {
  const out = [];
  for (const v of list || []) {
    const last = out[out.length - 1];
    if (last && last[0] === v) last[1]++;
    else out.push([v, 1]);
  }
  return out;
}

export function unrle(pairs) {
  const out = [];
  for (const [v, n] of pairs || []) for (let i = 0; i < n; i++) out.push(v);
  return out;
}

/** 作者 → 颜色。在线列表、改动流、行号上色必须用同一个函数：
 *  两处各写一遍的话，"甲的行"和"甲的名字"在屏幕上就是两种颜色，标注等于没标。 */
const AUTHOR_COLORS = ["#00e5ff", "#f2c14e", "#9b7bff", "#46d27f", "#ff8f6b", "#5fb0ff", "#e2705f", "#ffd166"];
export function authorColor(id) {
  let h = 0;
  for (const ch of String(id == null ? "" : id)) h += ch.charCodeAt(0);
  return AUTHOR_COLORS[h % AUTHOR_COLORS.length];
}

/** 这次改动加/删了多少行，给改动流列表用。 */
export function diffStats(prevText, nextText) {
  const a = prevText ? prevText.split("\n") : [];
  const b = nextText ? nextText.split("\n") : [];
  const match = lcsMatch(a, b);
  return { added: b.length - match.size, removed: a.length - match.size };
}
