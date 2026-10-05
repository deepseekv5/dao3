// gizmo.js — 选中模型的变换手柄：移动 / 旋转 / 缩放（Unity 那三件套）。
//
// 为什么值得做：以前挪一个模型只有两条路——在地面上拖（只能贴着水平面走，
// 高度改不了），或者在属性卡里填数字（精确但要打字）。转方向、改大小同理：
// 属性卡上那两条滑杆给的是"绝对值"，而人手上的动作是"相对量"。
//
// 三条实现约束：
// 1. 事件从 main.js 的 toolDispatch 最前面过一道：`handlePointer(e, fn)` 返回 true
//    就代表这一串指针事件归手柄。不这么做的话，按住箭头往下拖会同时被当成
//    "放置方块"，一次操作改两个地方，是最难查的那类串扰。
// 2. 命中判定用屏幕像素距离，不用网格求交。三个好处：手柄画多大就是多大
//    （缩到远处不会变成一个点）、抓取容差固定（不随相机远近漂），
//    而旋转环这种细长的东西靠射线根本点不稳。
// 3. 尺寸按"屏幕上多长"反算世界长度，跟手的方向也用同一套投影，
//    所以"看着在箭头上"和"抓得住"永远是同一件事。
//
// 松手才 markDirty：拖动中每帧改的是 object 的 transform，
// 存档与撤销记的是"这一次操作"，不是"每一帧"。

import * as THREE from "../vendor/three/three.module.js";

const LEN_PX = 74;          // 移动箭头长度（屏幕像素）
const SCALE_PX = 60;        // 缩放手柄长度
const ROT_R_PX = 54;        // 旋转环半径
const ROT_OUT_PX = 72;      // 外圈（屏幕平面那一个）半径
const HIT_PX = 9;           // 轴/环的抓取容差
const HIT_DOT = 11;         // 中心球与中心立方体的容差
const SNAP_DEG = 15;        // Shift 吸附角度
const SNAP_SCALE = 0.25;    // Shift 吸附倍率
const MODE_KEY = "ly.gizmoMode";
const MODES = ["move", "rotate", "scale"];

export function wireGizmo(E) {
  const r = E.renderer;
  if (!r || !r.scene || !THREE.Vector3) return null;

  const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
  const COLOR = { x: 0xff5b5b, y: 0x7ee06a, z: 0x4b93c9 };
  // 环按"它绕哪根轴转"上色，环面由另外两根轴张成；(u, v, n) 保持右手系，
  // 这样 atan2(v, u) 的增大方向就是绕 n 的正方向，跟手判定只需一次符号翻转。
  const RINGS = [
    { k: "x", n: AX.x, u: AX.y, v: AX.z },
    { k: "y", n: AX.y, u: AX.z, v: AX.x },
    { k: "z", n: AX.z, u: AX.x, v: AX.y },
  ];
  const UP = new THREE.Vector3(0, 1, 0);
  const POSZ = new THREE.Vector3(0, 0, 1);

  const group = new THREE.Group();
  group.renderOrder = 999;
  group.visible = false;
  r.scene.add(group);

  const mat = (color) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
  const lineMat = (color) => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.88 });
  const marks = [];   // 所有可抓元素，各自一份材质：只亮被抓住的那一个
  const tag = (mesh, t) => { mesh.userData.tag = t; marks.push(mesh); return mesh; };

  const gMove = new THREE.Group();
  const gRot = new THREE.Group();
  const gScale = new THREE.Group();
  group.add(gMove, gRot, gScale);

  for (const k of ["x", "y", "z"]) {
    const m = mat(COLOR[k]);
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.82, 10), m);
    shaft.position.y = 0.45;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 14), m);
    head.position.y = 0.96;
    g.add(shaft, head);
    g.quaternion.setFromUnitVectors(UP, AX[k]);
    gMove.add(g);
    tag(shaft, "move:" + k); tag(head, "move:" + k);
  }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), mat(0xe8e8ff));
  gMove.add(tag(ball, "move:center"));

  const circleGeo = (() => {
    const pts = [];
    for (let i = 0; i < 72; i++) {
      const t = (i / 72) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(t), Math.sin(t), 0));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  })();
  for (const ring of RINGS) {
    const line = tag(new THREE.LineLoop(circleGeo, lineMat(COLOR[ring.k])), "rot:" + ring.k);
    line.quaternion.setFromUnitVectors(POSZ, ring.n);
    gRot.add(line);
  }
  // 外圈贴在屏幕上，绕视线轴转——三个世界环侧过来变成一条线时靠它继续能转。
  const outer = tag(new THREE.LineLoop(circleGeo, lineMat(0xb8b2a8)), "rot:outer");
  // 三个世界环共用 gRot 的半径，外圈要再大一圈才不会被它们盖住：
  // 用局部 scale 撑开，几何还是同一个单位圆，不多花一份顶点。
  outer.scale.setScalar(ROT_OUT_PX / ROT_R_PX);
  gRot.add(outer);

  const knobGeo = new THREE.BoxGeometry(0.19, 0.19, 0.19);
  for (const k of ["x", "y", "z"]) {
    const m = mat(COLOR[k]);
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.8, 8), m);
    shaft.position.y = 0.45;
    const knob = new THREE.Mesh(knobGeo, m);
    knob.position.y = 1.0;
    g.add(shaft, knob);
    g.quaternion.setFromUnitVectors(UP, AX[k]);
    gScale.add(g);
    tag(shaft, "scale:" + k); tag(knob, "scale:" + k);
  }
  const allKnob = new THREE.Mesh(knobGeo, mat(0xe8e8ff));
  gScale.add(tag(allKnob, "scale:center"));

  let mode = "move";
  try { if (MODES.includes(localStorage.getItem(MODE_KEY))) mode = localStorage.getItem(MODE_KEY); } catch (e) { /* 读不到就用默认 */ }

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hitPt = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const origin = new THREE.Vector3();     // 拖动的起算锚点
  const startPos = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  let drag = null;      // { kind, tag, axis, ring, base, q0, a0, startClient }
  let hoverTag = null;

  const canvas = () => r.renderer.domElement;
  const cam = () => r.activeCam || r.camera;
  const model = () => E.state.selectedModel;
  const shift = () => !!(E.ctx && E.ctx.shift);

  /** 投影必须拿"现在就绪"的相机矩阵。
   *  渲染循环的顺序是 controls.update() → onRender（本文件的 sync 在这儿）→ render()，
   *  而 camera.matrixWorldInverse 只有 render() 会刷，`Vector3.project()` 读的恰恰是它。
   *  于是"聚焦完模型立刻去点手柄"（以及测试里手动跑一拍 sync 就按下）会拿上一帧的视图矩阵算：
   *  实测按到的位置和画出来的箭头差 200 多像素，症状是"点在中轴线上却抓不住手柄，
   *  反倒把模型拖走了"。这里补一次，投影和屏幕上的那一支才对得上。 */
  function freshCam() {
    const c = cam();
    c.updateMatrixWorld();
    c.matrixWorldInverse.copy(c.matrixWorld).invert();
    return c;
  }

  /** 抓的一定是"画出来的那一支"。
   *  锚点取 group.position、长度取各模式组当下的 scale——这两个就是上一帧渲染用的值。
   *  如果改成按"当前相机"重新反算，那么只要上一帧之后相机动过（聚焦缓动、拖窗口、
   *  或者干脆是循环没跑），抓取判定就和屏幕上的手柄错位：
   *  实测按在中轴线上却抓不住，反倒被模型拖走，差 200 多像素。 */
  const anchorPt = () => (drag ? origin : group.position);
  const armWorld = () => (mode === "move" ? gMove.scale.x : mode === "scale" ? gScale.scale.x : gRot.scale.x);

  /** 屏幕像素 → 该深度上的世界长度。透视按视锥高，正交按 top/bottom。 */
  function worldPerPixel() {
    const c = cam();
    const h = Math.max(1, canvas().clientHeight || window.innerHeight);
    if (c.isOrthographicCamera) return (c.top - c.bottom) / (c.zoom || 1) / h;
    return 2 * Math.tan((c.fov * Math.PI) / 360) * c.position.distanceTo(anchorPt()) / h;
  }

  /** 世界点 → 客户端像素（和事件里的 clientX/Y 同一个坐标系）。 */
  function toClient(v) {
    const rect = canvas().getBoundingClientRect();
    const p = v.clone().project(freshCam());
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  function headPoint(k) {
    if (!group.visible || !model()) return null;
    // 长度取 gMove 的当下 scale：三种模式各有一个子组，父组 scale 恒为 1。
    // 早期版本是往父组上写 scale 的，改成子组之后这里没跟着换，
    // 于是"箭头头部"算出来的其实是模型头顶上方 1 个世界单位——测试照着它去按，
    // 按到的位置根本不是画出来的那支箭头。
    return toClient(group.position.clone().addScaledVector(AX[k], 0.96 * gMove.scale.x));
  }

  function segDist(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;
    const L = vx * vx + vy * vy;
    const t = L ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / L)) : 0;
    return Math.hypot(wx - vx * t, wy - vy * t);
  }

  /** 射线打到"过锚点、法线为 n"的平面上；侧过来打不到时返回 null。 */
  function planeHit(e, n) {
    const rect = canvas().getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, freshCam());
    plane.setFromNormalAndCoplanarPoint(n, anchorPt());
    return ray.ray.intersectPlane(plane, hitPt) ? hitPt : null;
  }

  /** 指针位置抓到的是哪个手柄：返回 { tag, axis, ring }，抓不到返回 null。 */
  function grabAt(e) {
    const P = { x: e.clientX, y: e.clientY };
    const A = anchorPt();
    const O = toClient(A);
    if (mode === "move" || mode === "scale") {
      const arm = armWorld();
      let best = null;
      for (const k of ["x", "y", "z"]) {
        const T = toClient(A.clone().addScaledVector(AX[k], 0.96 * arm));
        const d = segDist(P, O, T);
        if (d <= HIT_PX && (!best || d < best.d)) best = { d, tag: mode + ":" + k, axis: AX[k], ring: null };
      }
      const dc = Math.hypot(P.x - O.x, P.y - O.y);
      // 中心那颗是画在三根轴的原点**上面**的，所以它优先：指针落在它的盘子里就是按中心。
      // 按距离比大小不行——原点也是三段线的起点，取整带来的一两像素偏差会让
      // "到轴线的距离"正好是 0，于是等比缩放永远抢不过单轴。
      if (dc <= HIT_DOT) best = { d: dc, tag: mode + ":center", axis: null, ring: null };
      return best;
    }
    // 旋转：半径和容差都在"画出来的那一支"的单位里比，像素容差按同深度换算。
    cam().getWorldDirection(camDir);
    const wpp = worldPerPixel();
    const rWorld = armWorld(), tol = HIT_PX * wpp;
    let best = null;
    for (const ring of RINGS) {
      const q = planeHit(e, ring.n);
      if (!q) continue;
      tmpA.subVectors(q, A);
      if (Math.abs(Math.hypot(tmpA.dot(ring.u), tmpA.dot(ring.v)) - rWorld) > tol) continue;
      // 两个环同时够得着时，抓正对屏幕那个（看起来最圆的那个才像是能拖的）。
      const face = Math.abs(ring.n.dot(camDir));
      if (!best || face < best.face) best = { face, tag: "rot:" + ring.k, axis: null, ring };
    }
    if (best) return best;
    const q = planeHit(e, camDir);
    if (q) {
      camRight.setFromMatrixColumn(cam().matrixWorld, 0).normalize();
      camUp.setFromMatrixColumn(cam().matrixWorld, 1).normalize();
      tmpA.subVectors(q, A);
      if (Math.abs(Math.hypot(tmpA.dot(camRight), tmpA.dot(camUp)) - rWorld * (ROT_OUT_PX / ROT_R_PX)) <= tol) {
        // 外圈的法线取"指向相机"那一侧，配合右手系 (right, up, -forward)，跟手方向自然正确。
        return { tag: "rot:outer", axis: null, ring: { n: camDir.clone().negate(), u: camRight.clone(), v: camUp.clone(), outer: true, k: "outer" } };
      }
    }
    return null;
  }

  function paintMarks() {
    const live = drag && drag.kind === mode ? drag.tag : hoverTag;
    for (const mesh of marks) {
      const t = mesh.userData.tag;
      if (t.slice(0, t.indexOf(":")) !== mode) continue;
      const on = t === live;
      const baseColor = t.endsWith("center") ? 0xf2ede6
        : t.startsWith("rot:outer") ? 0xb8b2a8
          : COLOR[t.split(":")[1]];
      mesh.material.color.setHex(on ? 0xffffff : baseColor);
      mesh.material.opacity = on ? 1 : (t.startsWith("rot:") ? 0.88 : 0.9);
    }
  }

  function sync() {
    const m = model();
    const show = !!m && !!m.object && !r.fpMode && !document.body.classList.contains("playing");
    group.visible = show;
    if (!show) { hoverTag = null; paintBar(); return; }
    // 拖动期间 origin 钉在按下那一刻的位置上，手柄本身（group）跟着模型走。
    // 每帧拿模型新位置去更新锚点的话，第二次 move 算出来的就是相对新位置的增量，
    // 叠加 startPos 之后等于把第一次的位移丢了。
    if (!drag) origin.copy(m.object.position);
    group.position.copy(m.object.position);
    const wpp = worldPerPixel();
    gMove.scale.setScalar(LEN_PX * wpp);
    gScale.scale.setScalar(SCALE_PX * wpp);
    gRot.scale.setScalar(ROT_R_PX * wpp);
    outer.quaternion.copy(cam().quaternion);
    gMove.visible = mode === "move";
    gRot.visible = mode === "rotate";
    gScale.visible = mode === "scale";
    paintMarks();
    paintBar();
  }

  const oldOnRender = r.onRender;
  r.onRender = (dt) => { sync(); if (oldOnRender) oldOnRender(dt); };

  /** 沿单轴拖：取一个"包含该轴、且尽量正对相机"的平面，交点投影回轴。 */
  function axisDelta(axis, e) {
    cam().getWorldDirection(camDir);
    tmpA.crossVectors(camDir, axis);
    tmpB.crossVectors(axis, tmpA);
    if (tmpB.lengthSq() < 1e-6) tmpB.copy(camDir);       // 轴正对相机时平面退化，用视线当法线
    tmpB.normalize();
    const q = planeHit(e, tmpB);
    if (!q) return null;
    return new THREE.Vector3().subVectors(q, origin).projectOnVector(axis);
  }

  /** 中心球：在屏幕平面里拖（相机朝向当法线）。 */
  function screenDelta(e) {
    cam().getWorldDirection(camDir);
    const q = planeHit(e, camDir);
    return q ? new THREE.Vector3().subVectors(q, origin) : null;
  }

  function doMove(e) {
    const d = drag.axis ? axisDelta(drag.axis, e) : screenDelta(e);
    if (!d) return;
    const p = startPos.clone().add(d);
    const m = model();
    m.pos = [p.x, p.y, p.z];
    m.object.position.copy(p);
  }

  function doRotate(e) {
    const m = model();
    const ring = drag.ring;
    const q = planeHit(e, ring.n);
    if (!q || !m) return;
    tmpA.subVectors(q, origin);
    let ang = Math.atan2(tmpA.dot(ring.v), tmpA.dot(ring.u)) - drag.a0;
    // 环的法线指向屏幕里侧时，屏幕上逆时针对应的是负角：不翻一下，转向跟手相反。
    cam().getWorldDirection(camDir);
    if (!ring.outer && ring.n.dot(camDir) > 0) ang = -ang;
    if (shift()) {
      const step = (SNAP_DEG * Math.PI) / 180;
      ang = Math.round(ang / step) * step;
    }
    m.object.quaternion.copy(drag.q0).premultiply(tmpQ.setFromAxisAngle(ring.n, ang));
    m.orientation = m.object.quaternion.toArray();
  }

  const clampScale = (v) => Math.max(0.02, Math.min(64, v));

  function doScale(e) {
    const m = model();
    if (!m) return;
    let k;
    if (drag.axis) {
      const d = axisDelta(drag.axis, e);
      if (!d) return;
      // 沿轴拖过"一整根手柄的长度"= 变成 2 倍：分母用画出来的那个长度，不是再算一遍。
      k = 1 + d.dot(drag.axis) / armWorld();
    } else {
      k = 1 + (drag.startClient.y - e.clientY) / (SCALE_PX * 0.8);
    }
    if (shift()) k = Math.max(SNAP_SCALE, Math.round(k / SNAP_SCALE) * SNAP_SCALE);
    const idx = drag.axis ? ["x", "y", "z"].findIndex((x) => AX[x] === drag.axis) : -1;
    const s = m.object.scale;
    for (let i = 0; i < 3; i++) s.setComponent(i, clampScale(drag.base[i] * (idx < 0 || i === idx ? k : 1)));
    if (idx < 0) m.scale = s.x;
  }

  /** 返回 true = 这一串指针事件被手柄吃掉了，main.js 不要再走工具。 */
  function handlePointer(e, fn) {
    if (!group.visible) return false;
    if (fn === "onDown" && e.button === 0) {
      const g = grabAt(e);
      if (!g) return false;
      const m = model();
      e.preventDefault();
      // 锚点钉在"屏幕上那一支手柄"的位置上：grabAt 判的就是 group 的画出的几何，
      // 拖动中的投影平面必须过同一个点，否则按下瞬间就会有一个看不见的错位。
      origin.copy(group.position);
      startPos.copy(origin);
      drag = { kind: mode, tag: g.tag, axis: g.axis, ring: g.ring, startClient: { x: e.clientX, y: e.clientY } };
      if (mode === "rotate") {
        cam().getWorldDirection(camDir);
        drag.q0 = m.object.quaternion.clone();
        const q = planeHit(e, g.ring.n);
        drag.a0 = q ? (tmpA.subVectors(q, origin), Math.atan2(tmpA.dot(g.ring.v), tmpA.dot(g.ring.u))) : 0;
      }
      if (mode === "scale") drag.base = [m.object.scale.x, m.object.scale.y, m.object.scale.z];
      paintMarks();
      return true;
    }
    if (fn === "onMove" && drag) {
      // 左键已松开却还在收 move = 那次 up 我们没收到（松在手柄外、或被别的元素吃掉）。
      // 就地收尾并让出这一串事件，别把后面每一次工具拖动都吞掉。
      if (!(e.buttons & 1)) { endDrag(); return false; }
      if (drag.kind === "move") doMove(e);
      else if (drag.kind === "rotate") doRotate(e);
      else doScale(e);
      return true;
    }
    if (fn === "onUp" && drag) { endDrag(); return true; }
    return false;
  }

  function endDrag() {
    if (!drag) return;
    const kind = drag.kind;
    drag = null;
    E.markDirty();
    // 属性卡上的旋转滑杆/缩放滑杆读的是 object 的现在值，
    // 不刷新的话下一次拖滑杆会把刚用手柄改出来的结果覆盖回去。
    if (kind === "rotate" || kind === "scale") E.refreshModelList && E.refreshModelList();
    paintMarks();
  }

  // 兜底：指针在手柄外松开、被别的元素吃掉、或窗口失焦时手势必须结束。
  // 少了这一段 drag 会一直挂着，之后每次工具拖动的 move/up 都被吞掉——
  // 症状是"拆方块和批量建造突然全都不生效"，而且要靠刷新页面才好。
  window.addEventListener("pointerup", () => { if (drag) endDrag(); });
  window.addEventListener("pointercancel", () => { if (drag) endDrag(); });
  window.addEventListener("blur", () => { if (drag) endDrag(); });

  // 悬停高亮：抓取容差只有 9 像素，不给出"这里能抓"的反馈就等于让人瞎摸。
  // 只处理没按住的移动——按住的那一串走 toolDispatch，两条路不重叠。
  canvas().addEventListener("pointermove", (e) => {
    if (drag || (e.buttons & 1) || !group.visible) return;
    const g = grabAt(e);
    const t = g ? g.tag : null;
    if (t !== hoverTag) { hoverTag = t; paintMarks(); }
  });
  canvas().addEventListener("pointerleave", () => { if (hoverTag) { hoverTag = null; paintMarks(); } });

  /* ---------- 模式开关（属性卡头部那一排按钮） ---------- */
  const bar = document.getElementById("gizModes");
  if (bar) bar.querySelectorAll("[data-gm]").forEach((btn) => { btn.onclick = () => setMode(btn.dataset.gm); });

  function paintBar() {
    if (!bar) return;
    if (bar.hidden === group.visible) bar.hidden = !group.visible;
    bar.querySelectorAll("[data-gm]").forEach((btn) => {
      const on = btn.dataset.gm === mode;
      if (btn.classList.contains("on") !== on) btn.classList.toggle("on", on);
    });
  }

  function setMode(next) {
    if (!MODES.includes(next)) return;
    if (next !== mode) {
      endDrag();
      hoverTag = null;
      mode = next;
      try { localStorage.setItem(MODE_KEY, next); } catch (e) { /* 写不进去不影响用 */ }
    }
    paintBar();
    paintMarks();
  }

  // 模式切换的键盘入口：Shift+G 循环。G 单独按是"刷色"工具，不能抢；
  // 而 toolDispatch 里那排工具快捷键本来就不看修饰键，所以这里必须在它之前拦。
  document.addEventListener("keydown", (e) => {
    if (e.key !== "G" && e.key !== "g") return;
    if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.body.classList.contains("playing")) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const i = MODES.indexOf(mode);
    setMode(MODES[(i + 1) % MODES.length]);
    e.preventDefault();
    e.stopPropagation();
  }, true);

  paintBar();

  return {
    handlePointer, sync, headPoint, setMode, grabAt,
    get mode() { return mode; },
    get visible() { return group.visible; },
    get grabbing() { return drag ? { kind: drag.kind, tag: drag.tag } : null; },
    get hovering() { return hoverTag; },
    /** 当前模式下第 k 个手柄的可抓屏幕点：给测试当靶心，也自证"画多大抓多大"。
     *  和 grabAt 用的是同一份几何（group 的位置与当下 scale），不是第二次反算。 */
    grabPoint(k) {
      if (!group.visible || !model()) return null;
      const A = anchorPt(), arm = armWorld();
      if (mode === "rotate") {
        if (k === "outer") {
          cam().getWorldDirection(camDir);
          camRight.setFromMatrixColumn(cam().matrixWorld, 0).normalize();
          return toClient(A.clone().addScaledVector(camRight, arm * (ROT_OUT_PX / ROT_R_PX)));
        }
        const ring = RINGS.find((x) => x.k === k);
        return ring ? toClient(A.clone().addScaledVector(ring.u, arm)) : null;
      }
      if (k === "center") return toClient(A);
      return toClient(A.clone().addScaledVector(AX[k], 0.96 * arm));
    },
  };
}
