// boot-ui.js — 启动遮罩：真实阶段 + 进度，失败要说清楚卡在哪一步。
//
// 为什么不用现成的 #loading：那条滚动条没有百分比、没有阶段，
// 而且 main.js 在启动末尾无条件 remove 掉它——慢机器上它其实一直在转，
// 用户却看不到任何"正在做什么"。这里改成显式打点：每个真实步骤报一次。
// 提示不能写死某一张图的玩法：加载遮罩每打开一张图都会转一遍，
// 而绝大多数图没有报名点、没有车、也没有机关。只留通用操作。
const TIPS = [
  "WASD 移动 · Shift 跑 · 空格跳",
  "滚轮拉近拉远 · 右键按住转视角",
  "H 设置 · Esc 游戏内菜单 · V 切换视角 · R 回正",
  "社区地图是发布那一刻的快照",
  "自己造的图点发布就进广场",
];

let el = null, pctEl = null, barEl = null, stageEl = null, titleEl = null, tipEl = null;
let pct = 0, tipTimer = 0;

function ensure() {
  if (el && document.body.contains(el)) return;
  el = document.createElement("div");
  el.className = "boot";
  el.id = "boot";
  el.innerHTML = `
    <div class="boot-inner">
      <img class="boot-mark" src="/img/laoyou.svg" alt=""/>
      <div class="boot-name">老攸元宇宙<small>LAOYOU METAVERSE</small></div>
      <div class="boot-title" id="bootTitle"></div>
      <div class="boot-stage" id="bootStage">正在准备…</div>
      <div class="boot-rail">
        <div class="boot-bar"><i id="bootBar"></i></div>
        <span class="boot-pct" id="bootPct">0%</span>
      </div>
      <div class="boot-tip" id="bootTip"></div>
    </div>`;
  document.body.appendChild(el);
  pctEl = el.querySelector("#bootPct");
  barEl = el.querySelector("#bootBar");
  stageEl = el.querySelector("#bootStage");
  titleEl = el.querySelector("#bootTitle");
  tipEl = el.querySelector("#bootTip");
  const roll = () => { tipEl.innerHTML = "提示 · <b>" + TIPS[(Math.random() * TIPS.length) | 0] + "</b>"; };
  roll();
  clearInterval(tipTimer);
  tipTimer = setInterval(roll, 5200);
}

/** 打一个点：to 是 0..100 的目标进度，label 说明在做什么。 */
export function stage(to, label) {
  ensure();
  pct = Math.max(pct, Math.min(100, to));
  barEl.style.width = pct + "%";
  pctEl.textContent = Math.round(pct) + "%";
  if (label) stageEl.textContent = label;
}

export function title(text) {
  ensure();
  titleEl.textContent = text || "";
}

export function fail(err) {
  ensure();
  const msg = String((err && (err.message || err)) || "未知错误");
  stageEl.textContent = "";
  const box = document.createElement("span");
  box.className = "boot-err";
  // 错误文本可能回显用户输入或远端响应，一律走 textContent，不拼进 HTML
  box.append("启动失败：" + msg);
  box.append(document.createElement("br"));
  box.append("本地服务没在跑的话，先执行 ./run.sh 再刷新。");
  const a = document.createElement("a");
  a.href = "/"; a.textContent = "回到工作台";
  box.append(" · "); a.append(""); box.append(a);
  stageEl.append(box);
}

export function done() {
  if (!el) return;
  clearInterval(tipTimer);
  stage(100, "就绪");
  const node = el;
  el = null;
  node.classList.add("gone");
  // 先清掉模块级的 el 再延时摘节点：以前写成闭包引用 el，而 el 在同一轮里就被置 null,
  // 于是 520ms 后这句必然抛 "Cannot read properties of null (reading 'remove')"。
  setTimeout(() => node.remove(), 520);
}

// 已经存在的旧遮罩（editor.html 里的 #loading）由这里统一接管，避免两层遮罩叠着。
export function adoptOld() {
  const old = document.getElementById("loading");
  if (old) old.remove();
}
