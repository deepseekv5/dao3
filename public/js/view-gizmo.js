// view-gizmo.js — 视口右下角的坐标罗盘 + 点它切换标准视角。
//
// 这是 Unity / Roblox Studio 都有的那块东西，作用比它看起来大：
// 在俯仰翻滚之后，人是会丢方向的——"哪边是北"没有别的线索，只能拖动一下试试。
// 有了罗盘，方向变成一个可以读、也可以直接点的东西。
//
// 三条实现约束：
// 1. 纯 SVG 投影，不开第二个 three.js 视口。要算的只是"世界三根轴在屏幕上的朝向"，
//    多一个 renderer 就多一份 resize、清晰度与合成器的账要还。
// 2. 更新挂在 controls 的 change 事件上，不占每帧：不转镜头就什么都不做。
// 3. 轴的颜色按行业惯例（X 红 / Y 绿 / Z 蓝），不跟主题色。
//    这不是审美保守：颜色在这里是"哪根轴"的唯一编码，换成霓虹青就没人读得出来了。

const R = 17;          // 轴长（SVG 单位，viewBox 是 -32..32）
const AXES = [
  { k: "x", v: [1, 0, 0], label: "X", color: "#ff5b5b" },
  { k: "y", v: [0, 1, 0], label: "Y", color: "#7ee06a" },
  { k: "z", v: [0, 0, 1], label: "Z", color: "#5aa8ff" },
];

export function wireViewGizmo(E) {
  const stage = document.getElementById("stage");
  const r = E.renderer;
  if (!stage || !r || !r.controls || !r.camera) return;

  const host = document.createElement("div");
  host.className = "view-gizmo";
  host.title = "当前视角朝向 · 点轴名切到那个标准视角";
  host.innerHTML = `<svg viewBox="-32 -32 64 64" width="64" height="64" aria-hidden="true"></svg>`;
  stage.appendChild(host);
  const svg = host.querySelector("svg");

  const parts = new Map();
  for (const a of AXES) {
    for (const sign of [1, -1]) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.dataset.k = a.k; g.dataset.s = String(sign);
      g.innerHTML = `<line x1="0" y1="0" stroke="${a.color}" stroke-width="2" stroke-linecap="round"></line>
        <circle r="8.5" fill="${a.color}" opacity="0" style="cursor:pointer"></circle>
        <text text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700" fill="#fff" style="pointer-events:none">${a.label}${sign > 0 ? "" : ""}</text>`;
      svg.appendChild(g);
      const hit = g.querySelector("circle");
      hit.addEventListener("click", () => lookAlong(a.v.map((n) => n * sign)));
      parts.set(a.k + sign, { g, a, sign });
    }
  }

  /** 世界轴向量投到屏幕上：把相机朝向反过来作用到单位轴上就够了。 */
  function update() {
    const q = r.camera.quaternion.clone().conjugate();
    const rows = [];
    for (const [, p] of parts) {
      const s = applyQuat(q, { x: p.a.v[0] * p.sign, y: p.a.v[1] * p.sign, z: p.a.v[2] * p.sign });
      const sx = s.x * R, sy = -s.y * R;
      const line = p.g.querySelector("line"), text = p.g.querySelector("text"), hit = p.g.querySelector("circle");
      line.setAttribute("x2", sx.toFixed(1)); line.setAttribute("y2", sy.toFixed(1));
      text.setAttribute("x", (sx * 1.42).toFixed(1)); text.setAttribute("y", (sy * 1.42).toFixed(1));
      hit.setAttribute("cx", sx.toFixed(1)); hit.setAttribute("cy", sy.toFixed(1));
      // 指向屏幕里侧的那半根压暗，读起来才有前后关系
      p.g.style.opacity = s.z > -0.02 ? "1" : "0.38";
      rows.push({ g: p.g, z: s.z });
    }
    // 近处的后画（盖住远处的轴杆）
    rows.sort((m, n) => m.z - n.z).forEach((row) => svg.appendChild(row.g));
  }

  /** v' = v + w·t + q.xyz × t，其中 t = 2·(q.xyz × v)。手写一遍是为了不每帧造 Vector3。 */
  function applyQuat(q, v) {
    const cx = q.y * v.z - q.z * v.y, cy = q.z * v.x - q.x * v.z, cz = q.x * v.y - q.y * v.x;
    const tx = 2 * cx, ty = 2 * cy, tz = 2 * cz;
    return {
      x: v.x + q.w * tx + (q.y * tz - q.z * ty),
      y: v.y + q.w * ty + (q.z * tx - q.x * tz),
      z: v.z + q.w * tz + (q.x * ty - q.y * tx),
    };
  }

  /** 站到 target 沿 dir 的方向上看过去。 */
  function lookAlong(dir) {
    const d = normalize(dir);
    const t = r.controls.target;
    const dist = r.camera.position.distanceTo(t) || 60;
    const vertical = Math.abs(d[1]) > 0.99;
    // 顶视/底视必须换 up：up 还指着 +Y 的话视线与 up 平行，
    // OrbitControls 会给出一个乱转的朝向。
    r.camera.up.set(0, vertical ? 0 : 1, vertical ? (d[1] > 0 ? -1 : 1) : 0);
    r.camera.position.set(t.x + d[0] * dist, t.y + d[1] * dist, t.z + d[2] * dist);
    r.controls.update();
    update();
  }
  const normalize = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  r.controls.addEventListener("change", update);
  update();
}
