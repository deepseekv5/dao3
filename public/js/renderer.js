// renderer.js — Three.js 场景：分块面剔除网格 + 图集材质 + 发光层 + 相机 + 拾取。
import * as THREE from "../vendor/three/three.module.js";
import { nightFromElev } from "./sun.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : +v || 0);
// 官方颜色既可能是 {red,green,blue}(0~1)，也可能是 {r,g,b}，统一成 THREE.Color
function colorOf(c, fallbackHex) {
  const out = new THREE.Color(fallbackHex);
  if (!c || typeof c !== "object") return out;
  const r = c.red ?? c.r, g = c.green ?? c.g, b = c.blue ?? c.b;
  if (r == null && g == null && b == null) return out;
  out.setRGB(clamp01(r), clamp01(g), clamp01(b));
  return out;
}

const CHUNK = 16;
// 面表：dir 法线, corners 4 顶点(单位立方体偏移), uv 每角 (su,sv)。槽位见 atlas.faceOrder
// FirstPersonControls — 第一人称视角控制（WASD 移动 + 鼠标视角）
class FirstPersonControls {
  constructor(camera, canvas, atlas) {
    this.camera = camera;
    this.canvas = canvas;
    this.atlas = atlas || null;
    this.enabled = false;
    this.moveSpeed = 8.0;
    this.lookSpeed = 0.0018;
    this.yaw = 0;
    this.pitch = 0;
    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();
    this.keys = { w: false, a: false, s: false, d: false, shift: false, ctrl: false, space: false };
    this.pointerLocked = false;
    this.prevTime = performance.now();
    this.world = null;
    this.flyMode = true;
    this.walkSpeed = 5.4;   // 行走速度（格/秒），飞行用 moveSpeed
    this._fpGrounded = false;
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
  }
  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.canvas.addEventListener('click', this._onClick);
    this.canvas.addEventListener('contextmenu', this._onContextMenu);
    this.canvas.style.cursor = 'none';
    this._updateYawPitchFromCamera();
  }
  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.canvas.removeEventListener('click', this._onClick);
    this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    document.exitPointerLock();
    this.pointerLocked = false;
    this.canvas.style.cursor = '';
    this.keys = { w: false, a: false, s: false, d: false, shift: false, ctrl: false, space: false };
    this.velocity.set(0, 0, 0);
  }
  _updateYawPitchFromCamera() {
    const q = new THREE.Quaternion().copy(this.camera.quaternion).normalize();
    const v = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    this.yaw = Math.atan2(v.x, v.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, v.y)));
  }
  _onMouseMove(e) {
    // FP 编辑模式：未锁定也允许转视角（否则"移动时无法拖动视角"）；锁定时同样生效
    if (!this.enabled) return;
    const mx = Math.max(-60, Math.min(60, e.movementX || e.mozMovementX || e.webkitMovementX || 0));
    const my = Math.max(-60, Math.min(60, e.movementY || e.mozMovementY || e.webkitMovementY || 0));
    this.yaw -= mx * this.lookSpeed;
    this.pitch -= my * this.lookSpeed;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    this._updateCameraRotation();
  }
  _updateCameraRotation() {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.camera.quaternion.copy(q);
  }
  _onKeyDown(e) {
    const k = e.code.toLowerCase();
    if (k === 'keyw' || k === 'arrowup') this.keys.w = true;
    if (k === 'keys' || k === 'arrowdown') this.keys.s = true;
    if (k === 'keya' || k === 'arrowleft') this.keys.a = true;
    if (k === 'keyd' || k === 'arrowright') this.keys.d = true;
    if (k === 'shiftleft' || k === 'shiftright') this.keys.shift = true;
    if (k === 'controlleft' || k === 'controlright') this.keys.ctrl = true;
    if (k === 'space') { this.keys.space = true; e.preventDefault(); }
  }
  _onKeyUp(e) {
    const k = e.code.toLowerCase();
    if (k === 'keyw' || k === 'arrowup') this.keys.w = false;
    if (k === 'keys' || k === 'arrowdown') this.keys.s = false;
    if (k === 'keya' || k === 'arrowleft') this.keys.a = false;
    if (k === 'keyd' || k === 'arrowright') this.keys.d = false;
    if (k === 'shiftleft' || k === 'shiftright') this.keys.shift = false;
    if (k === 'controlleft' || k === 'controlright') this.keys.ctrl = false;
    if (k === 'space') this.keys.space = false;
  }
  _onClick() {
    if (!this.pointerLocked) this.canvas.requestPointerLock();
  }
  _onContextMenu(e) { e.preventDefault(); }
  setWorld(w) { this.world = w; }
  setFlyMode(on) { this.flyMode = !!on; }
  _collideAxes(pos, velX, velY, velZ) {
    const w = this.world; if (!w) return false;
    this._fpGrounded = false;
    const half = 0.3, height = 1.8;
    // step：无碰撞时应用位移并返回 false；有碰撞时保持原位并返回 true
    const boxHits = (np) => {
      const x0 = Math.floor(np.x - half), x1 = Math.floor(np.x + half);
      const y0 = Math.floor(np.y), y1 = Math.floor(np.y + height);
      const z0 = Math.floor(np.z - half), z1 = Math.floor(np.z + half);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        if (x < 0 || y < 0 || z < 0 || x >= w.shape[0] || y >= w.shape[1] || z >= w.shape[2]) continue;
        const id = w.get(x, y, z); if (!id) continue;
        const b = this.atlas ? this.atlas.byId(id) : null;
        if (b ? !b.fluid : true) return true; // 官方只有 fluid（含 air）不挡人；transparent 只是渲染标记
      }
      return false;
    };
    const step = (axis, amt) => {
      if (!amt) return false;
      const np = { x: pos.x, y: pos.y, z: pos.z };
      np[axis] += amt;
      if (boxHits(np)) return true;   // 碰撞：不移动
      pos[axis] = np[axis];           // 自由：应用位移
      return false;
    };
    const yBlocked = step("y", velY);
    if (yBlocked) {
      if (velY < 0) { this.velocity.y = 0; this._fpGrounded = true; }
      else if (velY > 0) this.velocity.y = 0; // 顶头
    }
    const xBlocked = step("x", velX);
    const zBlocked = step("z", velZ);
    if (xBlocked) this.velocity.x = 0;
    if (zBlocked) this.velocity.z = 0;
    // 地面贴墙自动上台阶（1 格）：抬升成功且水平位移成功才保留，否则回滚
    if ((xBlocked || zBlocked) && !yBlocked && this._fpGrounded) {
      const saved = { x: pos.x, y: pos.y, z: pos.z };
      if (!step("y", 1.0)) {
        const mx = xBlocked ? !step("x", velX) : true;
        const mz = zBlocked ? !step("z", velZ) : true;
        if (mx || mz) this.velocity.y = Math.max(this.velocity.y, 0);
        else { pos.x = saved.x; pos.y = saved.y; pos.z = saved.z; }
      }
    }
    return yBlocked || xBlocked || zBlocked;
  }
  update(delta) {
    if (!this.enabled) return;
    const sprint = this.keys.shift ? 1.8 : 1.0;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const wish = new THREE.Vector3();
    if (this.keys.w) wish.add(forward);
    if (this.keys.s) wish.sub(forward);
    if (this.keys.a) wish.sub(right);
    if (this.keys.d) wish.add(right);
    if (wish.lengthSq() > 0) wish.normalize();
    const pos = this.camera.position;
    if (this.flyMode) {
      // 飞行：直接位移，不做体素碰撞（编辑器飞行相机不参与碰撞，也避免嵌在方块里卡死）
      const speed = this.moveSpeed * sprint;
      const vy = (this.keys.space ? speed * 0.8 : 0) + (this.keys.ctrl ? -speed * 0.8 : 0);
      pos.addScaledVector(wish, speed * delta);
      pos.y += vy * delta;
      this.velocity.set(0, 0, 0);
    } else {
      // 行走：重力 + 跳跃 + 地面检测（与运行模式手感一致）
      const speed = this.walkSpeed * sprint;
      if (this._fpGrounded && this.keys.space) { this.velocity.y = 8.4; this._fpGrounded = false; }
      this.velocity.x = wish.x * speed;
      this.velocity.z = wish.z * speed;
      this.velocity.y = Math.max(-40, this.velocity.y - 28 * delta);
      this._collideAxes(pos, this.velocity.x * delta, this.velocity.y * delta, this.velocity.z * delta);
      if (pos.y < 1.7) { pos.y = 1.7; this.velocity.y = 0; this._fpGrounded = true; }
    }
  }
}

const FACES = [
  // 绕序均为从面外侧看逆时针（几何法线 = dir）。槽位沿用图集 faceOrder：0左 1右 2底 3顶 4前 5后
  // 官方约定「方块正面朝北（-z）」，所以 front(4) 贴在 -Z 面、back(5) 贴在 +Z 面。
  { dir: [1, 0, 0], slot: 1, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { dir: [-1, 0, 0], slot: 0, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { dir: [0, 1, 0], slot: 3, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]] },
  { dir: [0, -1, 0], slot: 2, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { dir: [0, 0, 1], slot: 5, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { dir: [0, 0, -1], slot: 4, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
];

// 旋转码：0=正面朝北(-Z)，每顺时针 90° 记 1（官方每格 +16384）。整格立方只需换「贴图来源」：
// 某个世界面上看到的，是方块旋转前被转到这个方向的那个面。顶/底不受绕 Y 旋转影响。
const SLOT_DIR = { 4: 0, 1: 1, 5: 2, 0: 3 }; // 水平槽位 → 方向序号（0北 1东 2南 3西）
const DIR_SLOT = [4, 1, 5, 0];
const ROT_FACE = [0, 1, 2, 3].map((t) => {
  const m = [0, 1, 2, 3, 4, 5];
  for (const s of [0, 1, 4, 5]) m[s] = DIR_SLOT[(SLOT_DIR[s] - t + 4) % 4];
  return m;
});


export class VoxelRenderer {
  constructor(canvas, atlas) {
    this.atlas = atlas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000);
    this.camera.position.set(60, 55, 70);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(24, 10, 24);
    this.controls.maxPolarAngle = Math.PI * 0.495;
    // 第一人称控制
    this.fpControls = new FirstPersonControls(this.camera, canvas, atlas);
    this.fpMode = false;

    // 灯光：暖色主光 + 反向补光 + 半球天光 + 低环境光
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 600;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.fill = new THREE.DirectionalLight(0xbcd4ff, 0.5);
    this.scene.add(this.fill);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x6b5a44, 0.65);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.22);
    this.scene.add(this.ambient);

    // 材质：PBR 标准材质，粗糙表面，配合色调映射更自然
    // map 在图集加载完成后由 main.js 赋值为共享的 atlas.texture
    this.opaqueMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0 });
    this.transparentMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.6, roughness: 0.5, metalness: 0.0, depthWrite: false });
    // 水面单独一条材质：程序化地形的海/湖要靠它才读得出"是水"。
    // 与通用透明方块共用 transparentMat 时，水只是"淡了一档的贴图"，
    // 实测整片群岛看着像毛玻璃平台。这里压暗底色 + 降粗糙度，让水面吃高光。
    // 只认 water：图集里 11 个 fluid 有 10 个是牛奶/果汁/酱油，统一染蓝就错了。
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.78, roughness: 0.12, metalness: 0.05, depthWrite: false });
    this.glowMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    // 空气墙材质：编辑器半透明绿罩（运行时整层隐藏，见 setBarriersVisible）
    this.barrierMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.28, color: 0x6fdc7f, depthWrite: false });
    this._barriersVisible = true;

    // 网格容器
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.models = new THREE.Group(); this.scene.add(this.models);
    this.edgeGroup = new THREE.Group(); this.scene.add(this.edgeGroup);
    this.chunkMeshes = new Map(); // key -> {opaque,trans,glow}

    // 接地底板 + 网格（尺寸随世界调整）
    this.baseplate = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 1, metalness: 0 })
    );
    this.baseplate.rotation.x = -Math.PI / 2; this.baseplate.receiveShadow = true;
    this.baseplate.position.y = -0.02; this.scene.add(this.baseplate);
    this.grid = new THREE.GridHelper(1, 1, 0x5a6b5a, 0x455145);
    this.grid.material.opacity = 0.28; this.grid.material.transparent = true;
    this.grid.position.y = 0.002; this.scene.add(this.grid);

    // 天空：渐变 + 太阳圆盘 + 昼夜
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x2f6fb0) }, bot: { value: new THREE.Color(0xbfe0ff) },
        sunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3) }, sunCol: { value: new THREE.Color(0xfff2cc) },
        night: { value: 0.0 }, uTime: { value: 0 },
      },
      vertexShader: "varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader: `
        uniform vec3 top; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 sunCol;
        uniform float night; uniform float uTime;
        varying vec3 vP;
        float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main(){
          vec3 d = normalize(vP);
          float h = clamp(d.y*0.5+0.5, 0.0, 1.0);
          vec3 sd3 = normalize(sunDir);
          vec3 sky = mix(bot, top, pow(h, 0.55));
          float sd = max(dot(d, sd3), 0.0);
          // 太阳只在天顶以上才画圆盘；落到地平线以下就该消失，而不是从脚下透出来
          float sunUp = smoothstep(-0.03, 0.05, sd3.y);
          sky += sunCol * pow(sd, 220.0) * 1.2 * sunUp;   // 太阳圆盘
          sky += sunCol * pow(sd, 6.0) * 0.18 * sunUp;    // 日晕
          // 晨昏带：太阳贴着地平线那一段，天底烧出一条暖色。没有它日出日落就是"啪"地切换
          float twilight = exp(-abs(sd3.y) * 7.0) * smoothstep(0.85, 0.0, night);
          float az = pow(max(dot(d, normalize(vec3(sd3.x, 0.0, sd3.z) + 1e-5)), 0.0), 3.0);
          sky += vec3(0.95, 0.42, 0.16) * twilight * az * smoothstep(0.62, 0.0, h) * 0.85;
          vec3 nightTop = vec3(0.02,0.035,0.09), nightBot = vec3(0.06,0.08,0.15);
          vec3 nsky = mix(nightBot, nightTop, pow(h,0.5));
          // 星空：方向量化成格子，每格按哈希决定有没有星、多亮、闪多快。
          // 只在天顶半球出现（贴地平线的星是雾里看花），并随 night 淡入。
          // 格子密度与星点半径是配出来的：150 格/半径 0.16 时星点只有 0.06°，
          // 在 1280px 画布上不足一个像素，实测整片夜空一颗星都看不见。
          // 70 格 + 半径 0.22 格 ≈ 0.18°，约 3~4px，才是肉眼读得到的星。
          vec3 q = d * 70.0;
          vec3 cell = floor(q);
          vec3 rr = fract(q);
          float present = step(0.94, h31(cell));
          vec3 off = vec3(h31(cell + 1.7), h31(cell + 3.3), h31(cell + 5.1));
          float dd = length(rr - off);
          float mag = h31(cell + 9.2);
          float twk = 0.72 + 0.28 * sin(uTime * (0.7 + mag * 2.2) + mag * 40.0);
          float star = present * smoothstep(0.22, 0.0, dd) * (0.35 + mag * 0.65) * twk;
          star *= smoothstep(0.02, 0.28, d.y) * night;
          nsky += vec3(0.88, 0.92, 1.0) * star * 2.4;
          // 月亮在太阳的反方向，夜里才看得见
          vec3 md = normalize(-sd3 + 1e-5);
          float mup = smoothstep(-0.02, 0.08, md.y) * night;
          float mdd = dot(d, md);
          nsky += vec3(0.92, 0.94, 1.0) * smoothstep(0.99965, 0.99990, mdd) * 2.2 * mup;  // 月盘
          nsky += vec3(0.55, 0.62, 0.80) * pow(max(mdd, 0.0), 220.0) * 0.16 * mup;        // 月晕
          sky = mix(sky, nsky, night);
          gl_FragColor = vec4(sky, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), this.skyMat);
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(0xbfe0ff, 120, 520);

    // 拾取
    this.raycaster = new THREE.Raycaster();
    this._build = new Map(); // 脏块去抖
    this.world = null;
    this.showEdges = true;
    // 方块接缝线 + 序列帧动画（官方 15 个动画方块：传送带/岩浆/灯牌/彩虹方块…）
    // 两者都由 uniform 驱动，切换或播放不触发重编译。
    this._edgeU = { value: 1 };
    this._anim = { uTime: { value: 0 }, uCells: { value: 32 }, uCell: { value: 18 }, uPad: { value: 1 }, uTile: { value: 16 }, uAtlasW: { value: 576 } };
    this.setAtlasParams = (a) => {
      if (!a) return;
      this._anim.uCells.value = a.cellsPerRow || 32;
      this._anim.uCell.value = a.cell || a.cellSize || 18;
      this._anim.uPad.value = a.pad == null ? 1 : a.pad;
      this._anim.uTile.value = a.tileSize || 16;
      this._anim.uAtlasW.value = a.atlasWidth || 576;
    };
    const HEAD_V = `
attribute vec4 aAnim;
varying vec4 vAnim;
uniform float uCells; uniform float uCell; uniform float uPad; uniform float uTile; uniform float uAtlasW;
vec2 vxTileRect(float t){
  float col = mod(t, uCells);
  float row = floor(t / uCells);
  float px = col * uCell + uPad;
  float py = row * uCell + uPad;
  return vec2(px / uAtlasW, 1.0 - (py + uTile) / uAtlasW);
}
`;
    const HEAD_F = `
varying vec4 vAnim;
uniform float uCells; uniform float uCell; uniform float uPad; uniform float uTile; uniform float uAtlasW; uniform float uTime;
uniform float uEdge;
vec2 fxTileRect(float t){
  float col = mod(t, uCells);
  float row = floor(t / uCells);
  float px = col * uCell + uPad;
  float py = row * uCell + uPad;
  return vec2(px / uAtlasW, 1.0 - (py + uTile) / uAtlasW);
}
`;
    const BODY_F = `
  vec2 fxA = vMapUv;
  #ifdef USE_MAP
  if (vAnim.x > 1.5) {
    vec2 fxSpan = vec2(uTile / uAtlasW);
    vec2 fxLocal = (vMapUv - fxTileRect(vAnim.z)) / fxSpan;
    float fxFrame = mod(floor(uTime / max(vAnim.y, 0.02)), vAnim.x);
    fxA = fxTileRect(vAnim.z + fxFrame) + fxLocal * fxSpan;
  }
  diffuseColor *= texture2D( map, fxA );
  #endif
  {
    vec2 fxEc = fxA * uAtlasW / uCell;
    vec2 fxF = fract(fxEc);
    vec2 fxW = fwidth(fxEc) * 1.7;
    float fxE = step(fxF.x, fxW.x) + step(1.0 - fxW.x, fxF.x) + step(fxF.y, fxW.y) + step(1.0 - fxW.y, fxF.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.05, 0.06), clamp(fxE, 0.0, 1.0) * uEdge * 0.8);
  }
`;
    const patch = (mat) => {
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, { uEdge: this._edgeU }, this._anim);
        shader.vertexShader = HEAD_V + shader.vertexShader.replace("void main() {", "void main() {\n  vAnim = aAnim;");
        shader.fragmentShader = HEAD_F + shader.fragmentShader.replace("#include <map_fragment>", BODY_F);
      };
      mat.customProgramCacheKey = () => "dao3-anim";
      mat.needsUpdate = true;
    };
    patch(this.opaqueMat);
    patch(this.transparentMat);
    patch(this.waterMat);
    patch(this.glowMat);
    this.setEdges = (on) => { this.showEdges = !!on; this._edgeU.value = on ? 1 : 0; };
    this.showGrid = true;

    // 天气：雨 / 雪粒子 + 雷暴闪电
    this.weather = { rain: 0, snow: 0, thunder: 0 };
    this._weatherInit = false;
    this._flashT = 0; this._thunderT = 0;

    this._raf = null;
    this.onRender = null;
  }

  setWeather(w) {
    const X = this.wx || (this.wx = { rainSpeed: 24, rainDirection: [0, -1, 0], rainInterference: 0.04, snowFallSpeed: 2, snowSpinSpeed: 1 });
    for (const k of ["rainColor", "rainSizeLo", "rainSizeHi", "rainSpeed", "rainDirection", "rainInterference",
      "snowColor", "snowSizeLo", "snowSizeHi", "snowFallSpeed", "snowSpinSpeed", "snowTexture"]) {
      if (w[k] !== undefined) X[k] = w[k];
    }
    this.weather.rain = w.rain ?? this.weather.rain;
    this.weather.snow = w.snow ?? this.weather.snow;
    this.weather.thunder = w.thunder ?? this.weather.thunder;
    if (!this._weatherInit && (this.weather.rain > 0 || this.weather.snow > 0)) this._initWeather();
    if (!this._weatherInit) return;
    this._rainPts.visible = this.weather.rain > 0;
    this._snowPts.visible = this.weather.snow > 0;
    const span = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
    if (this._rain) {
      const R = this._rain;
      R.pts.material.color.copy(colorOf(X.rainColor, 0xa8c8ff));
      R.pts.material.size = span(X.rainSizeLo, 0.07);
      R.pts.material.opacity = clamp01(0.45 + this.weather.rain * 0.5);
      this._setPointCount(R, Math.round(200 + this.weather.rain * 2400));
    }
    if (this._snow) {
      const S = this._snow;
      S.pts.material.color.copy(colorOf(X.snowColor, 0xffffff));
      S.pts.material.size = span(X.snowSizeLo, 0.16);
      S.pts.material.opacity = clamp01(0.5 + this.weather.snow * 0.45);
      this._setPointCount(S, Math.round(150 + this.weather.snow * 1900));
    }
  }
  // 密度控制粒子数：按需扩缩缓冲区，避免为了调密度而每次重建几何
  _setPointCount(R, want) {
    const n = Math.max(1, Math.min(R.max, want | 0));
    R.n = n;
    if (R.geo.attributes.position.count !== n) R.geo.setDrawRange(0, n);
  }
  _initWeather() {
    this._weatherInit = true;
    const mk = (n, size, color, opacity) => {
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 70;
        pos[i * 3 + 1] = -16 + Math.random() * 40;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ size, color, transparent: true, opacity, depthWrite: false, sizeAttenuation: true });
      const pts = new THREE.Points(geo, mat);
      pts.visible = false;
      pts.frustumCulled = false;
      this.scene.add(pts);
      return { pts, pos, geo, n, max: n };
    };
    this._rain = mk(1800, 0.07, 0xa8c8ff, 0.8);
    this._snow = mk(1400, 0.16, 0xffffff, 0.95);
    this._rainPts = this._rain.pts; this._snowPts = this._snow.pts;
  }
  updateWeather(dt) {
    if (!this._weatherInit) return;
    const X = this.wx || {};
    const c = this.camera.position;
    if (this.weather.rain > 0) {
      const R = this._rain, p = R.pos, n = R.n;
      const dir = Array.isArray(X.rainDirection) ? X.rainDirection : [0, -1, 0];
      const sp = (X.rainSpeed || 24) * (0.6 + this.weather.rain * 0.9);
      const fall = sp * dt * (dir[1] < 0 ? 1 : -1);
      const side = sp * dt * Math.abs(dir[0] || 0) * 0.6;
      const interference = X.rainInterference == null ? 0.04 : X.rainInterference;
      for (let i = 0; i < n; i++) {
        p[i * 3 + 1] -= fall;
        p[i * 3] += (side + (Math.random() - 0.5) * interference) * 0.3;
        if (p[i * 3 + 1] < c.y - 16) {
          p[i * 3 + 1] = c.y + 26;
          p[i * 3] = c.x + (Math.random() - 0.5) * 72;
          p[i * 3 + 2] = c.z + (Math.random() - 0.5) * 72;
        }
      }
      R.geo.attributes.position.needsUpdate = true;
    }
    if (this.weather.snow > 0) {
      const S = this._snow, p = S.pos, n = S.n;
      const fall = (X.snowFallSpeed || 2) * (0.6 + this.weather.snow * 0.8);
      const spin = X.snowSpinSpeed == null ? 1 : X.snowSpinSpeed;
      for (let i = 0; i < n; i++) {
        p[i * 3] += Math.sin(performance.now() / 600 + i) * dt * 1.4 * spin;
        p[i * 3 + 1] -= fall * dt;
        if (p[i * 3 + 1] < c.y - 16) {
          p[i * 3 + 1] = c.y + 30;
          p[i * 3] = c.x + (Math.random() - 0.5) * 72;
          p[i * 3 + 2] = c.z + (Math.random() - 0.5) * 72;
        }
      }
      S.geo.attributes.position.needsUpdate = true;
    }
    // 雷暴闪电：随机闪烁
    if (this.weather.thunder > 0) {
      this._thunderT -= dt;
      if (this._thunderT <= 0) {
        if (Math.random() < this.weather.thunder * 0.6) {
          // 闪电触发
          this._flashT = 0.3;
          this._hemiBase = this.hemi.intensity;
          this._fillBase = this.fill.intensity;
          this._thunderT = 1.5 + Math.random() * 3.5;
        } else {
          this._thunderT = 0.3 + Math.random() * 0.6;
        }
      }
    }
    if (this._flashT > 0) {
      this._flashT -= dt;
      const k = Math.max(0, this._flashT / 0.3);
      this.fill.intensity = (this._fillBase ?? 0.5) + 2.4 * k;
      this.hemi.intensity = (this._hemiBase ?? 0.65) + 1.1 * k;
      this.skyMat.uniforms.night.value = Math.max(0, this.skyMat.uniforms.night.value - k * 0.6);
    }
  }
  strikeLightning(x, y, z) {
    // 闪电落雷：垂直劈叉闪光线 + 强闪光
    this._flashT = Math.max(this._flashT, 0.5);
    this._hemiBase = this.hemi.intensity;
    this._fillBase = this.fill.intensity;
    const pts = [[x, y, z]];
    let cy = y;
    for (let i = 0; i < 5; i++) {
      cy += 6 + Math.random() * 8;
      pts.push([x + (Math.random() - 0.5) * 2.4, cy, z + (Math.random() - 0.5) * 2.4]);
    }
    const g = new THREE.BufferGeometry();
    const arr = [];
    for (let i = 0; i < pts.length - 1; i++) arr.push(...pts[i], ...pts[i + 1]);
    g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    const bolt = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.95 }));
    this.scene.add(bolt);
    setTimeout(() => { this.scene.remove(bolt); g.dispose(); bolt.material.dispose(); }, 220);
  }

  setWorld(world) {
    this.world = world;
    const [X, Y, Z] = world.shape;
    const size = Math.max(X, Z);
    this.baseplate.geometry.dispose();
    this.baseplate.geometry = new THREE.PlaneGeometry(size + 8, size + 8);
    this.baseplate.position.set(X / 2, -0.02, Z / 2);
    this.grid.geometry.dispose();
    this.grid.geometry = new THREE.BufferGeometry();
    const g = new THREE.GridHelper(size, size, 0x5a6b5a, 0x455145);
    this.grid.geometry = g.geometry;
    this.grid.position.set(X / 2, 0.002, Z / 2);
    // 阴影相机贴合世界
    const s = size * 0.75;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, far: size * 4 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.controls.target.set(X / 2, 0, Z / 2);
    this.frameCamera();
    this.rebuildAll();
  }
  frameCamera() {
    const [X, , Z] = this.world.shape;
    const d = Math.max(X, Z) * 1.5;
    this.camera.position.set(X / 2 + d * 0.6, d * 0.7, Z / 2 + d * 0.7);
    this.controls.target.set(X / 2, 0, Z / 2);
    this.controls.update();
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w || c.height !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }
  }

  setOrtho(on) {
    if (on && !this._ortho) {
      const d = 60; const a = this.camera.aspect;
      this._ortho = new THREE.OrthographicCamera(-d * a, d * a, d, -d, 0.1, 2000);
      this._ortho.position.copy(this.camera.position);
      this._ortho.quaternion.copy(this.camera.quaternion);
      this.activeCam = this._ortho;
      this.controls.object = this._ortho;
    } else if (!on && this._ortho) {
      this.camera.position.copy(this._ortho.position);
      this.activeCam = this.camera; this.controls.object = this.camera; this._ortho = null;
    }
  }

  markChunk(cx, cy, cz) {
    this._build.set(cx + "," + cy + "," + cz, [cx, cy, cz]);
    if (!this._buildQueued) { this._buildQueued = true; queueMicrotask(() => this.flushChunks()); }
  }
  markDirty(x, y, z) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), cz = Math.floor(z / CHUNK);
    this.markChunk(cx, cy, cz);
    const lx = x - cx * CHUNK, ly = y - cy * CHUNK, lz = z - cz * CHUNK;
    if (lx === 0) this.markChunk(cx - 1, cy, cz);
    if (lx === CHUNK - 1) this.markChunk(cx + 1, cy, cz);
    if (ly === 0) this.markChunk(cx, cy - 1, cz);
    if (ly === CHUNK - 1) this.markChunk(cx, cy + 1, cz);
    if (lz === 0) this.markChunk(cx, cy, cz - 1);
    if (lz === CHUNK - 1) this.markChunk(cx, cy, cz + 1);
  }
  rebuildAll() {
    // 彻底清空 group（含任何未被 chunkMeshes 追踪的孤儿网格），杜绝残留
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const m = this.group.children[i];
      this.group.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    this.chunkMeshes.clear();
    this._build.clear(); this._buildQueued = false;
    if (!this.world) return;
    const [X, Y, Z] = this.world.shape;
    for (let cx = 0; cx < Math.ceil(X / CHUNK); cx++)
      for (let cy = 0; cy < Math.ceil(Y / CHUNK); cy++)
        for (let cz = 0; cz < Math.ceil(Z / CHUNK); cz++)
          this._build.set(cx + "," + cy + "," + cz, [cx, cy, cz]);
    this.flushChunks();
  }
  flushChunks() {
    this._buildQueued = false;
    for (const [key, [cx, cy, cz]] of this._build) this.buildChunk(cx, cy, cz, key);
    this._build.clear();
  }
  disposeMesh(m) { this.group.remove(m); m.geometry.dispose(); }

  buildChunk(cx, cy, cz, key) {
    const old = this.chunkMeshes.get(key);
    if (old) { if (old.opaque) this.disposeMesh(old.opaque); if (old.trans) this.disposeMesh(old.trans); if (old.water) this.disposeMesh(old.water); if (old.glow) this.disposeMesh(old.glow); if (old.barrier) this.disposeMesh(old.barrier); }
    const w = this.world; if (!w) { this.chunkMeshes.delete(key); return; }
    const A = this.atlas;
    const pos = [], nor = [], uv = [], idx = [], av = [];
    const tpos = [], tnor = [], tuv = [], tidx = [], tav = [];
    const wpos = [], wnor = [], wuv = [], widx = [], wav = [];
    const gpos = [], gnor = [], guv = [], gidx = [], gav = [];
    const bpos = [], bnor = [], buv = [], bidx = [], bav = [];
    const ox = cx * CHUNK, oy = cy * CHUNK, oz = cz * CHUNK;
    let vc = 0, tvc = 0, wvc = 0, gvc = 0, bvc = 0;
    for (let y = 0; y < CHUNK; y++) for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const wx = ox + x, wy = oy + y, wz = oz + z;
      const id = w.get(wx, wy, wz); if (!id) continue;
      let block = A.byId(id);
      if (!block) {
        // atlats 缺失该 id：用公共占位块（tile 0）兜底，避免整块不渲染/侧面消失
        block = { id, name: "missing_" + id, transparent: false, emissive: [0,0,0], faces: [0,0,0,0,0,0] };
      }
      const selfTrans = block.transparent;
      const isBarrier = block.name === "barrier"; // 空气墙：编辑器显示，运行时隐藏但实心
      const em = Array.isArray(block.emissive) ? block.emissive : [0,0,0];
      const isGlow = (em[0] + em[1] + em[2]) > 0.05;
      if (!Array.isArray(block.emissive)) {
        console.warn("[renderer] block missing emissive id=" + block.id + " name=" + block.name + " type=" + typeof block);
      }
      // 空气墙进独立桶；水单独一桶；其余按透明/不透明分桶
      const isWater = selfTrans && !isBarrier && block.name === "water";
      const useT = selfTrans && !isBarrier && !isWater;
      const useW = isWater;
      const rot = w.getRot ? (w.getRot(wx, wy, wz) & 3) : 0;
      const fmap = rot ? ROT_FACE[rot] : null; // 旋转只换贴图来源，面的几何与剔除不变
      const P = useW ? wpos : useT ? tpos : isBarrier ? bpos : pos, N = useW ? wnor : useT ? tnor : isBarrier ? bnor : nor, U = useW ? wuv : useT ? tuv : isBarrier ? buv : uv;
      let base = useW ? wvc : useT ? tvc : isBarrier ? bvc : vc;
      for (const f of FACES) {
        const nx = wx + f.dir[0], ny = wy + f.dir[1], nz = wz + f.dir[2];
        const nid = w.get(nx, ny, nz);
        const nb = nid ? A.byId(nid) : null;
        const nTrans = nb ? nb.transparent : true;
        if (nid && !nTrans) continue; // 邻居不透明，剔除
        if (selfTrans && nid === id) continue; // 同类透明体内部面剔除
        const src = fmap ? fmap[f.slot] : f.slot;
        const tile = block.faces[src];
        const [u0, v0, u1, v1] = A.tileUV(tile);
        // aAnim = (帧数, 每帧秒数, 首帧瓦片索引, 0)；非动画方块为 0
        const an = block.anim && block.anim.length ? block.anim.find((a) => a.face === src) : null;
        const a4 = an && an.frames && an.frames.length > 1
          ? [an.frames.length, (an.duration || 200) / 1000, an.frames[0], 0]
          : [0, 0, 0, 0];
        const AV = useW ? wav : useT ? tav : isBarrier ? bav : av;
        for (let c = 0; c < 4; c++) {
          const co = f.corners[c];
          P.push(wx + co[0], wy + co[1], wz + co[2]);
          N.push(f.dir[0], f.dir[1], f.dir[2]);
          const [su, sv] = f.uv[c];
          U.push(u0 + su * (u1 - u0), v0 + sv * (v1 - v0));
          AV.push(a4[0], a4[1], a4[2], a4[3]);
        }
        (useW ? widx : useT ? tidx : isBarrier ? bidx : idx).push(base, base + 1, base + 2, base, base + 2, base + 3);
        base += 4;
        if (useW) wvc += 4; else if (useT) tvc += 4; else if (isBarrier) bvc += 4; else vc += 4;
        if (isGlow) {
          for (let c = 0; c < 4; c++) {
            const co = f.corners[c];
            gpos.push(wx + co[0], wy + co[1], wz + co[2]);
            gnor.push(f.dir[0], f.dir[1], f.dir[2]);
            const [su, sv] = f.uv[c];
            guv.push(u0 + su * (u1 - u0), v0 + sv * (v1 - v0));
            gav.push(a4[0], a4[1], a4[2], a4[3]);
          }
          gidx.push(gvc, gvc + 1, gvc + 2, gvc, gvc + 2, gvc + 3); gvc += 4;
        }
      }
    }
    const rec = {};
    const build = (P, N, U, I, mat, shadow, AV) => {
      if (!P.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
      g.setAttribute("aAnim", new THREE.Float32BufferAttribute(AV && AV.length ? AV : new Float32Array(P.length / 3 * 4), 4));
      g.setIndex(I); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.castShadow = !!shadow; m.receiveShadow = !!shadow;
      m.userData.chunk = true;
      this.group.add(m); return m;
    };
    rec.opaque = build(pos, nor, uv, idx, this.opaqueMat, true, av);
    rec.trans = build(tpos, tnor, tuv, tidx, this.transparentMat, false, tav);
    rec.water = build(wpos, wnor, wuv, widx, this.waterMat, false, wav);
    rec.glow = build(gpos, gnor, guv, gidx, this.glowMat, false, gav);
    // 空气墙：半透明网格（编辑器里看得到、可拾取），运行时整体隐藏；不投影避免暴露位置
    if (!bpos.length && !bvc) rec.barrier = null;
    else {
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.Float32BufferAttribute(bpos, 3));
      bg.setAttribute("normal", new THREE.Float32BufferAttribute(bnor, 3));
      bg.setAttribute("uv", new THREE.Float32BufferAttribute(buv, 2));
      bg.setIndex(bidx); bg.computeBoundingSphere();
      rec.barrier = new THREE.Mesh(bg, this.barrierMat);
      rec.barrier.userData.chunk = true;
      rec.barrier.visible = this._barriersVisible !== false;
      rec.barrier.renderOrder = 4;
      this.group.add(rec.barrier);
    }
    if (rec.glow) rec.glow.renderOrder = 3;
    if (rec.trans) rec.trans.renderOrder = 2;
    if (rec.water) rec.water.renderOrder = 2;
    this.chunkMeshes.set(key, rec);
  }
  // 空气墙可见性（运行模式隐藏）
  setBarriersVisible(v) {
    this._barriersVisible = v !== false;
    for (const rec of this.chunkMeshes.values()) if (rec && rec.barrier) rec.barrier.visible = this._barriersVisible;
  }

  // 区域触发器预览：编辑器里画半透明盒 + 描边，运行模式整体隐藏（由脚本 world.addZone 生效）
  setZones(zones) {
    if (!this._zoneGroup) {
      this._zoneGroup = new THREE.Group();
      this._zoneGroup.userData.zone = true;
      this.scene.add(this._zoneGroup);
    }
    const g = this._zoneGroup;
    for (let i = g.children.length - 1; i >= 0; i--) {
      const c = g.children[i];
      g.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose && m.dispose());
    }
    for (const z of zones || []) {
      const b = z && (z.bounds || z);
      if (!z || !b.min || !b.max) continue;
      const x0 = Math.min(b.min[0], b.max[0]), x1 = Math.max(b.min[0], b.max[0]);
      const y0 = Math.min(b.min[1], b.max[1]), y1 = Math.max(b.min[1], b.max[1]);
      const z0 = Math.min(b.min[2], b.max[2]), z1 = Math.max(b.min[2], b.max[2]);
      const w = Math.max(0.02, x1 - x0), h = Math.max(0.02, y1 - y0), d = Math.max(0.02, z1 - z0);
      const geo = new THREE.BoxGeometry(w, h, d);
      const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x4cc2ff, transparent: true, opacity: 0.1, depthWrite: false }));
      fill.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      fill.renderOrder = 5;
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x4cc2ff, transparent: true, opacity: 0.85 }));
      edge.position.copy(fill.position);
      g.add(fill); g.add(edge);
    }
  }

  // 镜头进入流体：官方表现是水体染色 + 视距骤减
  setUnderwater(on, color) {
    if (on === this._underwater) return;
    this._underwater = on;
    const f = this.scene.fog;
    if (on) {
      const c = color == null ? 0x1b6f8f : color;
      this._fogSave = f ? { hex: f.color.getHex(), near: f.near, far: f.far } : null;
      this._bgSave = this.scene.background;
      if (f) { f.color.setHex(c); f.near = 0.2; f.far = 34; }
      this.scene.background = new THREE.Color(c);
      if (this.sky) this.sky.visible = false;
    } else {
      if (f && this._fogSave) { f.color.setHex(this._fogSave.hex); f.near = this._fogSave.near; f.far = this._fogSave.far; }
      this.scene.background = this._bgSave === undefined ? null : this._bgSave;
      if (this.sky) this.sky.visible = true;
      this._fogSave = null; this._bgSave = undefined;
    }
  }

  // 拾取：返回 { x,y,z, nx,ny,nz } 命中体素与相邻法线；或落在地面 { x,y,z, ground:true }
  pick(ndcX, ndcY) {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.activeCam || this.camera);
    const meshes = [];
    for (const m of this.chunkMeshes.values()) if (m.opaque) meshes.push(m.opaque);
    for (const m of this.chunkMeshes.values()) if (m.trans) meshes.push(m.trans);
    for (const m of this.chunkMeshes.values()) if (m.water) meshes.push(m.water);
    for (const m of this.chunkMeshes.values()) if (m.barrier) meshes.push(m.barrier);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      const h = hits[0];
      const n = h.face.normal;
      const p = h.point;
      // 命中体素中心
      let ix = Math.floor(p.x - n.x * 0.01), iy = Math.floor(p.y - n.y * 0.01), iz = Math.floor(p.z - n.z * 0.01);
      let ax = Math.floor(p.x + n.x * 0.51), ay = Math.floor(p.y + n.y * 0.51), az = Math.floor(p.z + n.z * 0.51);
      return { x: ix, y: iy, z: iz, ax, ay, az, nx: n.x, ny: n.y, nz: n.z, point: p, dist: h.distance };
    }
    // 地面
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, pt)) {
      const gx = Math.floor(pt.x), gz = Math.floor(pt.z);
      if (gx >= 0 && gz >= 0 && gx < this.world.shape[0] && gz < this.world.shape[2])
        return { x: gx, y: -1, z: gz, ax: gx, ay: 0, az: gz, ground: true, point: pt };
    }
    return null;
  }

  // 幽灵预览方块
  setGhost(x, y, z, color = 0x66ccff) {
    if (x == null) { if (this._ghost) this._ghost.visible = false; return; }
    if (!this._ghost) {
      this._ghost = new THREE.Mesh(new THREE.BoxGeometry(1.001, 1.001, 1.001),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false }));
      this._ghost.renderOrder = 5; this.scene.add(this._ghost);
    }
    this._ghost.visible = true; this._ghost.position.set(x + 0.5, y + 0.5, z + 0.5);
  }
  setHighlight(x, y, z) {
    if (x == null) { if (this._hl) this._hl.visible = false; return; }
    if (!this._hl) {
      this._hl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
        new THREE.LineBasicMaterial({ color: 0xffffff }));
      this.scene.add(this._hl);
    }
    this._hl.visible = true; this._hl.position.set(x + 0.5, y + 0.5, z + 0.5);
  }
  setSelectionBox(min, max) {
    if (!min) { if (this._sel) this._sel.visible = false; return; }
    if (!this._sel) {
      this._sel = new THREE.LineSegments(new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0x00e0ff, depthTest: false }));
      this._sel.renderOrder = 6; this.scene.add(this._sel);
    }
    const [a, b] = [min, max];
    const g = boxEdges(a[0], a[1], a[2], b[0] + 1, b[1] + 1, b[2] + 1);
    this._sel.geometry.dispose();
    this._sel.geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(g, 3));
    this._sel.visible = true;
  }
  setTerrain(t) {
    const u = this.skyMat.uniforms;
    if (t.skyTop != null) u.top.value.set(t.skyTop);
    if (t.skyBottom != null) { u.bot.value.set(t.skyBottom); if (!this._underwater) this.scene.fog.color.set(t.skyBottom); this.baseplate.material.color.setHex(this._groundFromSky(t.skyBottom)); }
    if (t.sunDir) {
      const d = new THREE.Vector3(...t.sunDir).normalize();
      u.sunDir.value.copy(d);
      const dist = (this.world ? Math.max(...this.world.shape) : 60) * 2;
      this.sun.position.copy(this.controls.target).add(d.clone().multiplyScalar(dist));
      this.sun.target.position.copy(this.controls.target);
      this.fill.position.copy(this.controls.target).add(d.clone().multiplyScalar(-dist));
      const elev = d.y;
      // 运行时会把它自己算好的 night 传进来（官方六面天光与雾色就是按那个值调的），
      // 那种情况下必须用同一个值，否则"天空的夜"和"灯光的夜"会各说各话。
      const night = t.night == null ? nightFromElev(elev) : THREE.MathUtils.clamp(+t.night, 0, 1);
      u.night.value = night;
      this.sun.intensity = (t.sunIntensity ?? 2.4) * (1 - night * 0.85);
      this.hemi.intensity = (t.hemi ?? 0.65) * (1 - night * 0.6);
      this.ambient.intensity = (t.ambient ?? 0.22) * (1 - night * 0.4) + night * 0.08;
    } else {
      if (t.sunIntensity != null) this.sun.intensity = t.sunIntensity;
      if (t.ambient != null) this.ambient.intensity = t.ambient;
      if (t.hemi != null) this.hemi.intensity = t.hemi;
    }
    // 官方雾参数：颜色 / 起始距离 / 密度 / 上限 都要真的改变画面（以前只有 fogDensity 折算过一次 far）
    const span = this.world ? Math.max(...this.world.shape) : 60;
    if (t.fogColor != null && !this._underwater) this.scene.fog.color.set(t.fogColor);
    if (t.fogStartDistance != null) this._fogNear = +t.fogStartDistance;
    if (t.maxFog != null) this._fogMax = +t.maxFog;
    if (t.fogDensity != null) this._fogDensity = +t.fogDensity;
    if (t.fogHeightOffset != null && this.skyMat.uniforms.fogY0) this.skyMat.uniforms.fogY0.value = +t.fogHeightOffset;
    if (t.fogHeightFalloff != null && this.skyMat.uniforms.fogFall) this.skyMat.uniforms.fogFall.value = +t.fogHeightFalloff;
    if (!this._underwater && (t.fogDensity != null || t.fogStartDistance != null || t.maxFog != null || t.fogColor != null)) {
      const near = this._fogNear == null ? span * 1.2 : Math.max(0, this._fogNear);
      const d = Math.max(0, Math.min(1, (this._fogDensity || 0) * 120));
      const cap = Math.max(0, Math.min(1, this._fogMax || 0));
      const far = near + Math.max(4, span * 4 * (1 - d) * (1 - cap * 0.85));
      this.scene.fog.near = Math.max(0.5, Math.min(near, far - 1));
      this.scene.fog.far = far;
    }
    // 六面天光：上下喂半球光，左右前后平均后作为补光颜色与强度，globalLight 作为环境光基准
    if (t.skyTop != null) this.hemi.color.set(t.skyTop);
    if (t.skyBottom != null) this.hemi.groundColor.set(t.skyBottom);
    const sides = [t.skyLeft, t.skyRight, t.skyFront, t.skyBack].filter((v) => v != null);
    if (sides.length) {
      const avg = new THREE.Color(0, 0, 0);
      sides.forEach((s) => avg.add(new THREE.Color(s)));
      avg.multiplyScalar(1 / sides.length);
      this.fill.color.copy(avg);
      this.fill.intensity = Math.min(2.2, (avg.r + avg.g + avg.b) / 3 * 2.4);
    }
    if (t.globalLight != null) this._ambientBase = Math.max(0, Math.min(1, +t.globalLight));
    if (t.shadows != null) { this.sun.castShadow = t.shadows; this.renderer.shadowMap.enabled = t.shadows; }
    if (t.grid != null) { this.showGrid = t.grid; this.grid.visible = t.grid; this.baseplate.visible = t.grid; }
    if (t.glow != null) { this.glowMat.opacity = t.glow; }
    // 曝光：夜里在用户设定值上再抬一档。ACES 会把暗部压得更狠，
    // 不补偿的话子夜场景里玩家根本看不清脚下的路。
    if (t.exposure != null) this._exposureBase = +t.exposure;
    const base = this._exposureBase == null ? 1.12 : this._exposureBase;
    this.renderer.toneMappingExposure = base * (1 + u.night.value * 0.42);
  }
  _groundFromSky(skyHex) { const c = new THREE.Color(skyHex); const g = c.clone().multiplyScalar(0.45); g.offsetHSL(0, -0.1, -0.15); return g.getHex(); }
  // 官方 world.rendering3d=false：暂停提交新帧，画面停在最后一帧（不是藏起画布）
  setRender3d(on) { this._render3d = on !== false; }
  setFirstPerson(on, spawn) {
    this.fpMode = on;
    if (on) {
      this.controls.enabled = false;
      if (spawn) this.camera.position.set(spawn[0] + 0.5, spawn[1] + 1.7, spawn[2] + 0.5);
      this.fpControls.setWorld(this.world);
      this.fpControls.setFlyMode(this.fpControls.flyMode);
      this.fpControls.enable();
    } else {
      this.fpControls.disable();
      this.controls.enabled = true;
      this.controls.target.set(this.camera.position.x, 0, this.camera.position.z);
      this.controls.update();
    }
  }
  start() {
    let prev = performance.now();
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const now = performance.now();
      const delta = Math.min((now - prev) / 1000, 0.1);
      prev = now;
      this.resize();
      this._anim.uTime.value = now / 1000;
      this.skyMat.uniforms.uTime.value = now / 1000;   // 星星闪烁
      if (this.fpMode) this.fpControls.update(delta);
      else this.controls.update();
      this.updateWeather(delta);
      if (this.onRender) this.onRender(delta);
      // rendering3d=false 时不再提交新帧，画布保留最后一帧（官方语义）
      if (this._render3d === false) return;
      this.renderer.render(this.scene, this.activeCam || this.camera);
    };
    loop();
  }
}
function boxEdges(x0, y0, z0, x1, y1, z1) {
  const e = [];
  const pts = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const seg = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (const [a, b] of seg) { e.push(...pts[a], ...pts[b]); }
  return e;
}
