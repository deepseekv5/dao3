// site-showcase.js — 官网首屏那排地图卡。
//
// 为什么不让设计师"选一张最好看的贴上去"：官网挂的是写死的一张截图，
// 等于替所有作者决定"这个产品长什么样"是哪一张图，而且改了 UI 之后它就过期。
// 这里读实际数据：社区广场有已发布的图就用那些，还没有就用本机的世界。
const host = document.getElementById("spShowcase");
const countEl = document.getElementById("scCount");
if (!host) throw new Error("缺少 #spShowcase");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const kfmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "K" : String(n || 0);

async function json(url) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** 社区优先：那是真的"发出去、别人能玩"的东西。空广场也要有内容可看，
    所以退一步用本机世界——但只取有封面的，没封面的卡片在展厅里就是一块黑。 */
async function source() {
  const feed = await json("/api/community/feed?sort=hot&limit=6");
  const pubs = (feed && feed.rows || []).filter((p) => p.kind !== "model");
  if (pubs.length) {
    return {
      label: pubs.length + " 张已发布",
      items: pubs.map((p) => ({
        href: "/p/" + p.id, img: `/api/community/pubs/${p.id}/cover`,
        title: p.title, sub: (p.author && p.author.name) || "作者", meta: kfmt(p.plays || p.views || 0) + " 次游玩",
      })),
    };
  }
  const worlds = await json("/api/worlds");
  const seen = new Set();
  const list = (Array.isArray(worlds) ? worlds : (worlds && worlds.worlds) || [])
    .filter((w) => w.cover)
    // 同名多半是同一张图被复制过（fork / 导入都会留一份），展厅并排放两张一样的很难看
    .filter((w) => !seen.has(w.name) && seen.add(w.name));
  return {
    label: list.length + " 张本机地图",
    items: list.slice(0, 6).map((w) => ({
      href: "/edit/" + encodeURIComponent(w.id) + "?play=1",
      img: "/assets/worlds/" + encodeURIComponent(w.id) + "/cover.png",
      title: w.name, sub: w.shape || "", meta: kfmt(w.blockCount) + " 体素",
    })),
  };
}

const card = (m) => `<a class="sc-card" href="${esc(m.href)}">
  <span class="sc-img"><img src="${esc(m.img)}" alt="" loading="lazy" onerror="this.remove()"/></span>
  <span class="sc-line"><b>${esc(m.title)}</b></span>
  <span class="sc-sub">${esc(m.sub)}${m.meta ? " · " + esc(m.meta) : ""}</span>
</a>`;

const s = await source();
if (!s.items.length) {
  host.innerHTML = `<a class="sc-empty" href="/community">广场还没有地图 —— 去工作台造一张，点发布就有了</a>`;
} else {
  host.innerHTML = s.items.map(card).join("");
  if (countEl) countEl.textContent = s.label;
}
