// panels.js — 三条分隔条：右栏、方块库、脚本页控制台。
//
// 为什么值得做：面板宽度写死的时候，"导览树看不清长名字"和"方块库太挤"
// 这两类抱怨只能靠改代码发版解决；能拖之后它们是用户自己一句话的事。
//
// 三条约定：
// 1. 几何的唯一真相是 :root 上的 CSS 变量。JS 只写变量，不去碰任何元素的 style——
//    .prop-card 的 right、工具条的居中公式、控制台宽度都从这几个变量派生，
//    所以拖完不会出现"属性卡还停在旧位置"。
// 2. 事件挂法跟运行时浮标（game.js 的 _floatDrag*）一致：pointerdown 在把手上，
//    move/up 在 window 上。两处实现各写一套，将来只会漂移成"一个能拖一个不能拖"。
// 3. 一个把手三种用法：拖、双击复位、方向键微调（Shift 加大步长）。
//    只做鼠标拖的话，键盘用户和触控板手滑的人都够不到它。

const KEY = "ly.panelSizes";
const VAR = { rp: "--rp-w", lib: "--lib-w", console: "--console-w" };
const DEF = { rp: 300, lib: 238, console: 300 };
const MIN = { rp: 220, lib: 180, console: 180 };
// 上限不是"能给多宽"，是"画布还剩多少"：面板拖到吃掉半个视口就不叫调布局了。
const MAX = { rp: 620, lib: 460, console: 720 };
// 右栏与控制台的把手在面板**左边**，往左拖才是变宽。
const SIGN = { rp: -1, lib: 1, console: -1 };
const GRIP = { rp: "gripRight", lib: "gripLib", console: "gripConsole" };

function load() {
  try { return { ...DEF, ...(JSON.parse(localStorage.getItem(KEY) || "{}") || {}) }; }
  catch { return { ...DEF }; }
}
function save(sizes) {
  try { localStorage.setItem(KEY, JSON.stringify(sizes)); } catch { /* 隐私模式下存不进，不影响本次会话 */ }
}

const root = document.documentElement;
const sizes = load();
// 上限不是"能给多宽"，是"画布还剩多少"：面板拖到吃掉半个视口就不叫调布局了。
const cap = (k) => Math.max(MIN[k], Math.min(MAX[k], Math.floor(window.innerWidth * (k === "console" ? 0.55 : 0.42))));
const clamp = (k, v) => Math.round(Math.min(cap(k), Math.max(MIN[k], v)));
const put = (k) => root.style.setProperty(VAR[k], clamp(k, sizes[k]) + "px");

// 尺寸在模块加载时就贴上去，不等 initFeatures：后者要等 150 万格的默认图 load 完
// （冷启动实测 60s 开外），那段时间里布局是默认值，然后"啪"地跳一下——
// 布局跳脸是 IDE 最廉价也最明显的掉价方式。
for (const k of Object.keys(DEF)) put(k);

export function wirePanels(E) {
  for (const k of Object.keys(DEF)) {
    const el = document.getElementById(GRIP[k]);
    if (!el) continue;
    put(k);
    el.setAttribute("aria-valuenow", String(Math.round(sizes[k])));
    let from = 0, origin = 0, moved = false;

    const nudge = (k, dx) => {
      sizes[k] = clamp(k, origin + dx);
      put(k);
      el.setAttribute("aria-valuenow", String(sizes[k]));
    };

    el.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      from = ev.clientX; origin = sizes[k]; moved = false;
      el.classList.add("on");
      // 拖控制台把手时若控制台正收成一根竖条，先展开：
      // 收着的状态下"宽度"这个概念不存在，拖了没反馈会被当成坏了。
      if (k === "console") document.getElementById("scriptConsole")?.classList.remove("is-closed");
      const move = (e2) => {
        moved = true;
        nudge(k, (e2.clientX - from) * SIGN[k]);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        el.classList.remove("on");
        if (moved) save(sizes);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });

    el.addEventListener("dblclick", () => { origin = sizes[k]; sizes[k] = DEF[k]; put(k); save(sizes); el.setAttribute("aria-valuenow", String(DEF[k])); });
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      origin = sizes[k];
      // 右箭头 = 把手本身往右走。右栏/控制台的把手在面板左边，所以往右是变窄；
      // 方块库相反。方向语义跟着 SIGN 走，别两边各写一套。
      nudge(k, (ev.key === "ArrowRight" ? 1 : -1) * SIGN[k] * (ev.shiftKey ? 40 : 10));
      save(sizes);
    });
  }

  // 视口变窄时上限会收紧（比如外接屏拔掉），已存的宽度要跟着收，
  // 否则面板会把画布挤成一条缝，而且这时候人是拖不回来的。
  window.addEventListener("resize", () => { for (const k of Object.keys(DEF)) put(k); });

  // 命令面板要能一键回到默认布局：拖乱了要能回去，不然"可拖"是个只进不退的操作。
  E.resetPanels = () => {
    for (const k of Object.keys(DEF)) { sizes[k] = DEF[k]; put(k); }
    save(sizes);
    E.toast("面板宽度已回到默认");
  };
  return sizes;
}
