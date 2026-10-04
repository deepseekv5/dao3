// console.js — 脚本控制台：从"一行状态文字"变成一份日志。
//
// 原来所有输出都往 #scriptOut 的 textContent 上写，一条覆盖上一条，
// 报错还顺手把颜色改成红的、把刚才那批 log 抹掉。也就是说那个"控制台"
// 其实是一行状态栏：看不了历史，就没法拿两条输出互相比对。
//
// 这一版按 Unity 的控制台来：条目化、按严重度筛、重复的折成 ×N、能清空。
// 三条实现约束：
// 1. 筛选状态写成容器上的 data 属性，可见性交给 CSS——不在每次点筛选项时
//    重排 400 行 DOM，也不会出现"筛选说只剩错误、屏幕上还留着 log"。
// 2. 计数是 push 时增量更新的，不是渲染时数出来的：数一遍要遍历全部行，
//    而 push 每秒可能来几十次。
// 3. 只有这一个写入口。旧路径是 out.textContent = 一整块文本，它会连着
//    把已有条目一起抹掉、还得靠 MutationObserver 事后抢救——与其兼容它，
//    不如把那几个写入点都改过来（features.js 的沙箱、game.js 的运行态 console）。
// 4. 运行态的 console.* 与 _guard 报错也灌进来（见 game.js 的 consoleDiv）。
//    跑完一局回到编辑器，那几行报错还在——不然"刚才那一局崩在哪"只能重跑一遍。

const MAX = 400;
const KIND = { log: "log", info: "log", warn: "warn", error: "error", err: "error" };
const MARK = { log: "›", warn: "▲", error: "●" };

let box = null, list = null, ed = null;
const counts = { log: 0, warn: 0, error: 0 };

function chip(kind) { return box ? box.querySelector(`.cs-chip[data-k="${kind}"]`) : null; }
function setCount(kind, n) {
  const c = chip(kind);
  if (c) c.querySelector("b").textContent = n ? String(n) : "";
}

/** 追加一条。kind 认 log/info/warn/error/err；text 是已经拼好的纯文本。 */
export function pushConsole(kind, text, at = null) {
  if (!list) return;
  const k = KIND[kind] || "log";
  const s = String(text == null ? "" : text);
  // 计数先加：徽标报的是"来过几条"，不是"现在有几行"。
  // 折叠之后只剩一行 ×27，人要知道的是那 27 条确实发生过。
  counts[k]++; setCount(k, counts[k]);
  const last = list.lastElementChild;
  // 折叠只看最后一条：脚本每 tick 打同一行时，重复一定是连续的，
  // 往全表里找相同文本会把早就滚走的旧消息也算进来。
  if (last && last.dataset.k === k && last.dataset.t === s) {
    const n = (Number(last.dataset.n) || 1) + 1;
    last.dataset.n = String(n);
    last.querySelector(".cs-n").textContent = "×" + n;
    list.scrollTop = list.scrollHeight;
    return;
  }
  const row = document.createElement("div");
  row.className = `cs-row cs-${k}`;
  row.dataset.k = k; row.dataset.t = s; row.dataset.n = "1";
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  row.innerHTML = `<span class="cs-time">${time}</span><i class="cs-ico">${MARK[k]}</i>` +
    `<span class="cs-txt"></span><em class="cs-n"></em>`;
  row.querySelector(".cs-txt").textContent = s;
  if (at && at.line >= 1) {
    const go = document.createElement("button");
    go.className = "cs-at"; go.type = "button"; go.textContent = "第 " + at.line + " 行";
    go.onclick = () => ed && ed.ideGoto && ed.ideGoto(at.line);
    row.appendChild(go);
  }
  list.appendChild(row);
  while (list.childElementCount > MAX) {
    // 只丢最旧的那一行，徽标上的计数不动——它报的是"来过几条"。
    // 一起减的话，长跑一局之后计数会变成"最多 400"，那就不是计数而是行数了。
    const d = list.firstElementChild;
    if (!d) break;
    d.remove();
  }
  list.scrollTop = list.scrollHeight;
}

export function clearConsole() {
  if (!list) return;
  list.innerHTML = "";
  for (const k of Object.keys(counts)) { counts[k] = 0; setCount(k, 0); }
}

/** 挂到脚本页的控制台盒子上。没有这个盒子（比如纯运行页）就什么都不做。 */
export function wireConsole(E) {
  ed = E;
  box = document.getElementById("scriptConsole");
  list = document.getElementById("scriptOut");
  if (!box || !list) { box = null; list = null; return; }
  if (box.querySelector(".cs-bar")) return;      // 幂等：重复挂载会出两条筛选栏
  const bar = document.createElement("div");
  bar.className = "cs-bar";
  bar.innerHTML = `
    <button class="cs-chip on" data-k="log" type="button" title="只显示/隐藏普通输出">输出<b></b></button>
    <button class="cs-chip on" data-k="warn" type="button" title="只显示/隐藏警告">警告<b></b></button>
    <button class="cs-chip on" data-k="error" type="button" title="只显示/隐藏错误">错误<b></b></button>
    <span class="cs-spacer"></span>
    <button class="cs-act" id="csClear" type="button" title="清空控制台">清空</button>`;
  list.before(bar);
  bar.onclick = (ev) => {
    const c = ev.target.closest(".cs-chip");
    if (c) {
      const on = !c.classList.contains("on");
      c.classList.toggle("on", on);
      box.setAttribute("data-f-" + c.dataset.k, on ? "1" : "0");
      return;
    }
    if (ev.target.closest("#csClear")) clearConsole();
  };
}
