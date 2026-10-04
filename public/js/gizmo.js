// gizmo.js — 选中模型上的平移手柄（Unity 那根三色箭头）。
//
// 为什么值得做：以前挪一个模型只有两条路——在地面上拖（只能贴着水平面走，
// 高度改不了），或者在属性卡里填 X/Y/Z 数字（精确但要打字）。
// 沿单轴推、把东西抬起来、往屏幕里侧挪，这三件事在 3D 里最常用，
// 却恰好是"拖 + 打字"都别扭的操作。手柄把它们变成一次拖动。
//
// 三条实现约束：
// 1. 事件从 main.js 的 toolDispatch 最前面过一道：`gizmo.handlePointer(e, fn)`
//    返回 true 就代表这一串指针事件归手柄。不这么做的话，按住箭头往下拖
//    会同时被当成"放置方块"，一次拖动改两个地方，是最难查的那类串扰。
// 2. 尺寸按"屏幕上多长"反算，而不是固定世界长度。否则拉近了手柄比模型大、
//    拉远了就变成一个点，等于没有。
// 3. depthTest 关掉 + renderOrder 拉高：手柄要一直看得见。
//    被方块挡住的手柄不能拖，而"明明选中了却拖不动"正是用户会以为坏了的那种。

import * as THREE from "../vendor/three/three.module.js";

const LEN_PX = 74;          // 手柄在屏幕上的目标长度（像素）
const AXIS = [
  { k: "x", v: new THREE.Vector3(1, 0, 0), color: 0xff5b5b },
  { k: "y", v: new THREE.Vector3(0, 1, 0), color: 0x7ee06a },
  { k: "z", v: new THREE.Vector3(0, 0, 1), color: 0x5aa8ff },
];

export function wireGizmo(E) {
  const r = E.renderer;
  if (!r || !r.scene || !THREE.Vector3) return null;

  const group = new THREE.Group();
  group.renderOrder = 999;
  group.visible = false;
  r.scene.add(group);

  const mat = (color) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.96 });
  const handles = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const a of AXIS) {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.82, 10), mat(a.color));
    shaft.position.y = 0.45;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 14), mat(a.color));
    head.position.y = 0.96;
    g.add(shaft, head);
    g.quaternion.setFromUnitVectors(up, a.v);
    group.add(g);
    shaft.userData.axis = a.v; head.userData.axis = a.v;
    handles.push(shaft, head);
  }
  // 中心球 = 屏幕平面内自由移动
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), mat(0xe8e8ff));
  ball.userData.axis = null;
  group.add(ball);
  handles.push(ball);

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmpPlane = new THREE.Plane();
  const hitPt = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const startPos = new THREE.Vector3();
  let drag = null;      // { axis, startClient:[x,y] }

  const canvas = () => r.renderer.domElement;

  function pickHandle(e) {
    const rect = canvas().getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, r.activeCam || r.camera);
    const hits = ray.intersectObjects(handles, false);
    return hits.length ? hits[0].object : null;
  }

  /** 屏幕长度换算成世界长度：透视按视锥高，正交按 camera.top/bottom。 */
  function worldScale() {
    const cam = r.activeCam || r.camera;
    const h = Math.max(1, canvas().clientHeight || window.innerHeight);
    const d = cam.position.distanceTo(origin);
    if (cam.isOrthographicCamera) return ((cam.top - cam.bottom) / (cam.zoom || 1)) * LEN_PX / h;
    return 2 * Math.tan((cam.fov * Math.PI) / 360) * d * LEN_PX / h;
  }

  function sync() {
    const m = E.state.selectedModel;
    const show = !!m && !!m.object && !r.fpMode && !document.body.classList.contains("playing");
    group.visible = show;
    if (!show) { drag = null; return; }
    // 拖动期间 origin 是"起算锚点"，必须钉在按下那一刻的位置上；
    // 手柄本身（group）跟着模型走，看起来才是Unity那样"握着物体拖"。
    // 每帧都拿模型新位置去更新锚点的话，第二次 move 算出来的就是
    // 相对新位置的增量，叠加 startPos 之后等于把第一次的位移丢了。
    if (!drag) origin.copy(m.object.position);
    group.position.copy(m.object.position);
    const s = worldScale();
    group.scale.setScalar(s);
  }

  const oldOnRender = r.onRender;
  r.onRender = (dt) => { sync(); if (oldOnRender) oldOnRender(dt); };

  /** 沿单轴拖：取一个"包含该轴、且尽量正对相机"的平面，射线打到它上面再投影回轴。 */
  function axisDelta(axis, e) {
    const cam = r.activeCam || r.camera;
    cam.getWorldDirection(camDir);
    const n = new THREE.Vector3().crossVectors(axis, new THREE.Vector3().crossVectors(camDir, axis));
    if (n.lengthSq() < 1e-6) n.copy(camDir);
    n.normalize();
    tmpPlane.setFromNormalAndCoplanarPoint(n, origin);
    const rect = canvas().getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    if (!ray.ray.intersectPlane(tmpPlane, hitPt)) return null;
    return new THREE.Vector3().subVectors(hitPt, origin).projectOnVector(axis);
  }

  /** 中心球：在屏幕平面里拖（相机朝向当法线）。 */
  function screenDelta(e) {
    const cam = r.activeCam || r.camera;
    cam.getWorldDirection(camDir);
    tmpPlane.setFromNormalAndCoplanarPoint(camDir, origin);
    const rect = canvas().getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    if (!ray.ray.intersectPlane(tmpPlane, hitPt)) return null;
    return new THREE.Vector3().subVectors(hitPt, origin);
  }

  function moveTo(p) {
    const m = E.state.selectedModel;
    if (!m) return;
    m.pos = [p.x, p.y, p.z];
    m.object.position.copy(p);
  }

  /** 返回 true = 这一串指针事件被手柄吃掉了，main.js 不要再走工具。 */
  function handlePointer(e, fn) {
    if (!group.visible) return false;
    if (fn === "onDown" && e.button === 0) {
      const h = pickHandle(e);
      if (!h) return false;
      e.preventDefault();
      const m = E.state.selectedModel;
      startPos.copy(m.object.position);
      drag = { axis: h.userData.axis ? h.userData.axis.clone() : null };
      return true;
    }
    if (fn === "onMove" && drag) {
      // axisDelta 已经把交点投影到轴上了（projectOnVector），所以这里直接加；
      // 再自己挑"哪个分量"是第二份算法，两处一漂移就会拖出斜线。
      const d = drag.axis ? axisDelta(drag.axis, e) : screenDelta(e);
      if (d) moveTo(startPos.clone().add(d));
      return true;
    }
    if (fn === "onUp" && drag) { drag = null; E.markDirty(); return true; }
    return false;
  }

  /** 某个手柄头部的屏幕坐标。给测试用，也是以后做"第一次选中时指着箭头说句话"
   *  这类提示的唯一正确来源——自己按公式推一遍，就会和真正画出来的位置对不上。
   *  注意取的是 group 的位置（手柄画在哪）而不是 origin（拖动的起算锚点）：
   *  拖动期间两者是分开的，锚点钉在按下的那一刻，手柄跟着模型走。 */
  function headPoint(k) {
    const a = AXIS.find((x) => x.k === k);
    if (!a || !group.visible) return null;
    const p = group.position.clone().addScaledVector(a.v, 0.96 * group.scale.x);
    p.project(r.activeCam || r.camera);
    const rect = canvas().getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  return { handlePointer, sync, headPoint, get visible() { return group.visible; } };
}
