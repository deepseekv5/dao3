// scrub.js — 按住属性名横向拖就能改数值（Unity / Blender 的那个手感）。
//
// 为什么值得做：数值框打字慢且容易打错，而调参本质上是在"试"——
// 拖两下就能看到效果，比"点进去、全选、输入、回车"快一个数量级。
// 位置滑杆旁边的 X/Y/Z 框、玩家面板那 41 个字段，全都吃这一条。
//
// 两个取舍：
// · 拖的是**标签**，不是输入框本身。输入框还要用来打字，
//   把它整个变成拖拽目标就会变成"点不进去编辑"，那是倒退。
// · 拖动只改 DOM 里的值并派发 input/change，不自己写回 state：
//   写回的那条路已经存在（每个面板都挂了自己的 input 处理），
//   在这里再写一遍就是第二份真相，两边迟早对不上。

const FMT = (input, v) => {
  const step = Number(input.step) || 1;
  const dec = step >= 1 ? 0 : String(step).split(".")[1]?.length || 2;
  return v.toFixed(dec);
};

// 位置那三个框是 type=text（浏览器自带的 number 步进按钮在这里太碍事），
// 所以判"能不能拖"看的是它像不像数值框，而不是 type 属性。
const NUMISH = 'input[type="number"]:not([disabled]), input.posnum:not([disabled])';

export function wireScrub() {
  const numFor = (el) => {
    if (!el || !el.closest) return null;
    const lb = el.closest("label, .poslbl");
    if (!lb) return null;
    const host = lb.parentElement;
    return (host && host.querySelector(NUMISH)) || null;
  };

  // 悬停时把光标换成左右箭头：这条操作没有按钮可看，靠光标告知
  document.body.addEventListener("pointerover", (ev) => {
    const lb = ev.target.closest && ev.target.closest("label, .poslbl");
    if (lb && numFor(ev.target)) lb.style.cursor = "ew-resize";
  });
  document.body.addEventListener("pointerout", (ev) => {
    const lb = ev.target.closest && ev.target.closest("label, .poslbl");
    if (lb && lb.style.cursor) lb.style.cursor = "";
  });

  /** 滚轮改值：指针停在**数值框上**才生效，停在列表里就是正常滚动。
   *  不做成"停在标签上也滚"——那会让人翻文件列表时突然改掉一个参数。 */
  document.body.addEventListener("wheel", (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;
    const cell = t.closest(".pp-cell, .frow, .poscol, .zrow, .ztriple");
    const input = t.matches && t.matches(NUMISH) ? t : (cell && cell.querySelector(NUMISH));
    if (!input || input.disabled) return;
    ev.preventDefault();
    const step = Number(input.step) || 1;
    const min = input.min !== "" ? Number(input.min) : -Infinity;
    const max = input.max !== "" ? Number(input.max) : Infinity;
    const k = (ev.shiftKey ? 0.1 : 1) * step * (ev.deltaY < 0 ? 1 : -1);
    const v = Math.max(min, Math.min(max, (Number(input.value) || 0) + k));
    input.value = FMT(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { passive: false });

  document.body.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const lb = ev.target.closest && ev.target.closest("label, .poslbl");
    const input = numFor(ev.target);
    if (!lb || !input) return;
    ev.preventDefault();
    // 不做 setPointerCapture：move/up 本来就挂在 window 上，捕获只会把事件重定向到
    // 标签自己，而合成事件（测试、辅助技术）拿不到 active pointerId，
    // 那一句会抛 NotFoundError，把整个处理器打断。
    const step = Number(input.step) || 1;
    const min = input.min !== "" ? Number(input.min) : -Infinity;
    const max = input.max !== "" ? Number(input.max) : Infinity;
    const x0 = ev.clientX, v0 = Number(input.value) || 0;
    let last = v0;
    const move = (e2) => {
      // 一格 = 一个 step；Shift 走 0.1 个 step 做微调
      const k = (e2.shiftKey ? 0.1 : 1) * step;
      const v = Math.max(min, Math.min(max, v0 + (e2.clientX - x0) * k));
      if (v === last) return;
      last = v;
      input.value = FMT(input, v);
      // input 与 change 都发：有些面板挂在 input（要实时预览），
      // 有些挂在 change（位置滑杆那三个框就是），只发一个的话
      // 拖起来"数字在跳、东西不动"，正是要避免的半截反馈。
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
}
