// game.js — 官方 GameAPI 运行时（DAO3 / box3 arena 口径）。
// 值类型/枚举/通道在 gapi.js；本文件是引擎本体：tick 时钟、角色控制器、相机、
// 方块玩法、区域触发、实体/玩家 API、脚本沙箱与运行 HUD。
import * as THREE from "../vendor/three/three.module.js";
import {
  TICK_MS, ROT_SCALE, EYE_HEIGHT, ENTITY_QUOTA, PLAYER_DEFAULTS, WORLD_DEFAULTS, STEP_UP,
  GameVector3, GameBounds3, GameRGBColor, GameRGBAColor, GameQuaternion,
  GameCameraMode, GameCameraFreezedAxis, GameInputDirection, GamePlayerMoveState, GamePlayerWalkState,
  GameButtonType, GameDialogType, GameEasing, GameAnimationPlaybackState, GameAnimationDirection,
  GameAssetType, GameLogLevel, GameBodyPart, SocialType, PointerEventBehavior, ImageDisplayMode, UITextFontFamily,
  sleep, randomPick, getEntityBounds, clamp, clamp01, toVec3, packId, baseId, rotOf, rotateVecByTurn,
  luma, rgbHex, pickEnv, sampleRamp, sampleRampNum, newParticle, matchSelector, keyCodeOf, rayHitsBox, rgbaOf, colorTriple,
  attachChannels, makeChannel, consoleDiv, esc, fmt, Sound, GameAnimation, makeMotionController,
} from "./gapi.js";
import { createClientApi, createAudioClass } from "./clientui.js";

export * from "./gapi.js";

/* ============================ 名牌 / 头顶文字层 ============================ */
class TagLayer {
  constructor(host) {
    this.host = host;
    this.items = new Map(); // tag 对象 -> {el, text, until}
  }
  ensure(tag) {
    let it = this.items.get(tag);
    if (it) return it;
    const el = document.createElement("div");
    el.className = "ntag";
    el.innerHTML = '<i class="ntag-hp"></i><span class="ntag-name"></span>';
    this.host.appendChild(el);
    it = { el, name: el.querySelector(".ntag-name"), hp: el.querySelector(".ntag-hp"), float: null };
    this.items.set(tag, it);
    return it;
  }
  remove(tag) {
    const it = this.items.get(tag);
    if (!it) return;
    it.el.remove();
    this.items.delete(tag);
  }
  float(tag, text, dur) {
    const it = this.ensure(tag);
    if (!it.float) {
      const f = document.createElement("div");
      f.className = "ntag-float";
      it.el.appendChild(f);
      it.float = { el: f, until: 0 };
    }
    it.float.el.textContent = text;
    it.float.until = performance.now() + (dur || 2000);
  }
  update(camera, ent, tag, opts) {
    const it = this.items.get(tag);
    if (!it) return;
    const showName = opts.name && !opts.hidden;
    const showFloat = it.float && it.float.until > performance.now();
    if (!showName && !showFloat) { it.el.style.display = "none"; return; }
    const v = new THREE.Vector3(ent.position.x, ent.position.y + (opts.height || 2.0), ent.position.z).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { it.el.style.display = "none"; return; }
    const px = (v.x * 0.5 + 0.5) * innerWidth, py = (-v.y * 0.5 + 0.5) * innerHeight;
    it.el.style.display = "block";
    it.el.style.transform = `translate(-50%,-100%) translate(${px}px,${py}px)`;
    const dist = camera.position.distanceTo(new THREE.Vector3(ent.position.x, ent.position.y, ent.position.z));
    it.el.style.opacity = String(clamp(1 - dist / (opts.radius || 28), 0.25, 1));
    it.name.style.display = showName ? "block" : "none";
    if (showName) {
      it.name.textContent = opts.nameText || "";
      it.name.style.color = opts.nameColor || "#fff";
    }
    it.hp.style.display = opts.health ? "block" : "none";
    if (opts.health) it.hp.style.width = clamp01(opts.hp / (opts.maxHp || 1)) * 100 + "%";
    if (it.float) it.float.el.style.display = showFloat ? "block" : "none";
  }
  clear() { for (const tag of [...this.items.keys()]) this.remove(tag); }
}

/* ============================ 默认角色外观 ============================ */
// 六个命名部件（head/body/armL/armR/legL/legR）是对外契约：PART_SLOT 的 18 个官方
// 挂点归并到它们，addWearable 拿它们当锚点，player.skin 按它们分部位染色，
// _updateAvatar 按它们摆臂摆腿。所以重做外观只能改这六块**内部**长什么样。
//
// 每个部件是一个 Group，原点放在**关节**上（肩、髋），网格往下偏——
// 这样 rotation.x 是绕肩/髋转，而不是绕一块居中盒子的中心转（旧版腿像钟摆就是这么来的）。
// 子网格用 userData.tint 标自己该被哪种染色影响：
//   "cloth" 上衣/裤子类，受 skin[part] 与 player.color 驱动
//   "skin"  露出的皮肤（脸、手），受 skin[part] 驱动
//   不设   头发、眼睛、腰带、鞋、纽扣——永远是自己的颜色，染色不会把五官涂没
function makeAvatar() {
  const g = new THREE.Group();
  // 官方 player.metalness / emissive / shininess 是 PBR 参数，Lambert 材质读不到，
  // 所以人偶统一用 Standard（roughness 1 / metalness 0 时观感接近原来的 Lambert）
  const std = (hex, rough = 0.86) => new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: 0 });
  const C = {
    skin: 0xf0c9a0, skinDark: 0xd3a878, hair: 0x40301f, eye: 0x2b2b33, eyeWhite: 0xf7f9fc,
    shirt: 0x4a86c4, shirtShade: 0x35648f, collar: 0xdfe6ef, pants: 0x3d4560, pantsShade: 0x2c3348,
    belt: 0x2a2d38, buckle: 0xd9b25a, boot: 0x2b241d, bootSole: 0x1a1614, cuff: 0x2f5f8f,
  };
  const part = (name, x, y, z) => { const p = new THREE.Group(); p.position.set(x, y, z); p.name = name; g.add(p); return p; };
  // box 的 y 是相对**关节**的偏移，不是世界高度
  const box = (parent, w, h, d, hex, x, y, z, tint, rough) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(hex, rough));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.baseColor = hex;
    if (tint) m.userData.tint = tint;
    parent.add(m);
    return m;
  };

  const head = part("head", 0, 1.40, 0);
  box(head, 0.40, 0.40, 0.36, C.skin, 0, 0.20, 0, "skin");           // 脸（侧面收一点，避免整颗头都是后脑）
  box(head, 0.42, 0.12, 0.38, C.hair, 0, 0.375, -0.005);             // 头发帽：只比头宽 0.02，多了就像顶着一块板
  box(head, 0.38, 0.20, 0.08, C.hair, 0, 0.255, -0.165);             // 后脑头发（贴着头皮，不外凸）
  box(head, 0.09, 0.05, 0.03, C.hair, -0.14, 0.295, 0.175);          // 左眉
  box(head, 0.09, 0.05, 0.03, C.hair, 0.14, 0.295, 0.175);           // 右眉
  box(head, 0.09, 0.08, 0.03, C.eyeWhite, -0.10, 0.205, 0.18);       // 左眼白
  box(head, 0.09, 0.08, 0.03, C.eyeWhite, 0.10, 0.205, 0.18);        // 右眼白
  box(head, 0.05, 0.05, 0.03, C.eye, -0.09, 0.195, 0.196, null, 0.4); // 左瞳（低 roughness＝有点湿亮）
  box(head, 0.05, 0.05, 0.03, C.eye, 0.09, 0.195, 0.196, null, 0.4);  // 右瞳
  box(head, 0.06, 0.04, 0.05, C.skinDark, 0, 0.135, 0.19, "skin");   // 鼻尖
  box(head, 0.14, 0.025, 0.03, C.skinDark, 0, 0.075, 0.18, "skin");  // 嘴
  box(head, 0.10, 0.10, 0.10, C.skin, 0, 0.14, -0.21, "skin");       // 颈后

  const body = part("body", 0, 0.82, 0);
  box(body, 0.46, 0.50, 0.26, C.shirt, 0, 0.29, 0, "cloth");         // 躯干（比头宽，肩线才撑得住）
  box(body, 0.50, 0.09, 0.29, C.collar, 0, 0.545, 0.01);             // 领口（比肩略宽，读得出是独立一件）
  box(body, 0.48, 0.09, 0.27, C.pants, 0, 0.045, 0, "cloth");        // 胯
  box(body, 0.49, 0.07, 0.28, C.belt, 0, 0.115, 0);                  // 腰带
  box(body, 0.09, 0.06, 0.03, C.buckle, 0, 0.115, 0.15, null, 0.35); // 铜扣（metalness 感靠低 roughness）
  box(body, 0.10, 0.16, 0.02, C.shirtShade, -0.14, 0.33, 0.14);      // 上衣左开襟阴影
  box(body, 0.10, 0.16, 0.02, C.shirtShade, 0.14, 0.33, 0.14);       // 上衣右开襟阴影

  const arm = (name, side) => {
    const a = part(name, side * 0.28, 1.32, 0);                      // 原点在肩
    box(a, 0.15, 0.30, 0.16, C.shirt, 0, -0.16, 0, "cloth");         // 上臂（袖子）
    box(a, 0.155, 0.055, 0.165, C.cuff, 0, -0.315, 0);               // 袖口
    box(a, 0.13, 0.16, 0.14, C.skin, 0, -0.42, 0, "skin");           // 小臂+手
    return a;
  };
  const armL = arm("armL", -1), armR = arm("armR", 1);

  const leg = (name, side) => {
    const l = part(name, side * 0.115, 0.82, 0);                    // 原点在髋
    box(l, 0.185, 0.44, 0.20, C.pants, 0, -0.22, 0, "cloth");       // 大腿
    box(l, 0.175, 0.20, 0.19, C.pantsShade, 0, -0.54, 0, "cloth");  // 小腿（深一档，读得出是两条）
    box(l, 0.19, 0.11, 0.28, C.boot, 0, -0.695, 0.035);             // 鞋（往前伸，有鞋头）
    box(l, 0.195, 0.035, 0.29, C.bootSole, 0, -0.755, 0.04);        // 鞋底
    return l;
  };
  const legL = leg("legL", -1), legR = leg("legR", 1);

  g.userData.parts = { head, body, armL, armR, legL, legR };
  return g;
}

// 官方 GameBodyPart 有 18 个槽位，本地人偶是 6 块盒体，按下表归并到挂点
const PART_SLOT = {
  head: "head", neck: "head", torso: "body", hips: "body",
  leftShoulder: "armL", leftUpperArm: "armL", leftLowerArm: "armL", leftHand: "armL",
  rightShoulder: "armR", rightUpperArm: "armR", rightLowerArm: "armR", rightHand: "armR",
  leftUpperLeg: "legL", leftLowerLeg: "legL", leftFoot: "legL",
  rightUpperLeg: "legR", rightLowerLeg: "legR", rightFoot: "legR",
};
const BODY_PARTS = Object.values(GameBodyPart);
// 皮肤值官方是任意字符串（皮肤资源名）；本地只认颜色字面量，其余按名字记录不改动外观
function skinColorOf(v) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^(#[0-9a-f]{3,8}|0x[0-9a-f]{3,8})$/i.test(s)) return null;
  const c = new THREE.Color();
  try { c.set(s.startsWith("0x") ? "#" + s.slice(2) : s); } catch { return null; }
  return c;
}
// 官方颜色是 {red,green,blue}（0~1）；这里也接受数组与 #rrggbb 写法
function rgbOf(v) {
  if (!v) return null;
  if (typeof v === "string") { const c = skinColorOf(v); return c && { red: c.r, green: c.g, blue: c.b }; }
  if (Array.isArray(v)) return { red: +v[0] || 0, green: +v[1] || 0, blue: +v[2] || 0 };
  if (typeof v === "object") {
    if (v.red != null) return { red: +v.red || 0, green: +v.green || 0, blue: +v.blue || 0 };
    if (v.r != null) return { red: +v.r || 0, green: +v.g || 0, blue: +v.b || 0 };
  }
  return null;
}

// 官方文档规定录音产物是 audio/wav，而 MediaRecorder 给的是 webm/ogg，这里解码后重封装成 16 位 PCM WAV
async function toWavBlob(blob) {
  try {
    const raw = new Uint8Array(await blob.arrayBuffer());
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const audio = await ctx.decodeAudioData(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    ctx.close();
    const ch = audio.numberOfChannels, n = audio.length, rate = audio.sampleRate;
    const total = 44 + n * ch * 2;
    const dv = new DataView(new ArrayBuffer(total));
    const at = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    at(0, "RIFF"); dv.setUint32(4, total - 8, true); at(8, "WAVEfmt ");
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * ch * 2, true);
    dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    at(36, "data"); dv.setUint32(40, n * ch * 2, true);
    const chans = [];
    for (let c = 0; c < ch; c++) chans.push(audio.getChannelData(c));
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
      const v = clamp(chans[c][i], -1, 1);
      dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
    return new Blob([dv.buffer], { type: "audio/wav" });
  } catch { return blob; }
}
/* ============================ GameRuntime ============================ */
export class GameRuntime {
  constructor(editor) {
    this.e = editor;
    this.running = false;
    this.currentTick = 0;
    this.entities = [];
    this.zones = [];
    this.animations = [];
    this.assets = { meshes: {}, audio: {} };
    this._sounds = new Set();
    this._timers = new Map();
    this._timerId = 1;
    this._collisions = [];
    this._warned = new Set();
    this.chatHistory = [];
    this.tagLayer = null;
    Object.assign(this, {
      gravity: WORLD_DEFAULTS.gravity, airFriction: WORLD_DEFAULTS.airFriction, useOBB: WORLD_DEFAULTS.useOBB,
      lightMode: "natural", sunPhase: 0.25, sunFrequency: 0.0002, lunarPhase: 0.75,
      sunDirection: new GameVector3(0, 1, 0), sunLight: new GameRGBColor(1, 0.95, 0.87),
      skyLeftLight: new GameRGBColor(0.6, 0.62, 0.7), skyRightLight: new GameRGBColor(0.6, 0.62, 0.7),
      skyBottomLight: new GameRGBColor(0.4, 0.42, 0.5), skyTopLight: new GameRGBColor(0.4, 0.55, 0.8),
      skyFrontLight: new GameRGBColor(0.6, 0.62, 0.7), skyBackLight: new GameRGBColor(0.6, 0.62, 0.7),
      fogColor: new GameRGBColor(0.75, 0.82, 0.9), fogStartDistance: 80, fogHeightOffset: 0,
      fogHeightFalloff: 1, fogUniformDensity: 0.004, maxFog: 1,
      snowDensity: 0, snowSizeLo: 0.08, snowSizeHi: 0.2, snowFallSpeed: 2, snowSpinSpeed: 1,
      snowColor: new GameRGBAColor(1, 1, 1, 0.9), snowTexture: "",
      rainDensity: 0, rainDirection: new GameVector3(0, -1, 0), rainSpeed: 24, rainSizeLo: 0.02,
      rainSizeHi: 0.06, rainInterference: 0, rainColor: new GameRGBAColor(0.7, 0.8, 1, 0.7),
      globalLight: 0.29, drawDistance: 1024, gamma: 2.2, skyType: 0,
      breakVoxelSound: null, placeVoxelSound: null, playerJoinSound: null, playerLeaveSound: null, ambientSound: null,
    });
    this.time = 6000; this.timeScale = 1; this.thunderDensity = 0;
    this.gameRules = { doDaylightCycle: true, doWeatherCycle: true, keepInventory: true, doMobSpawning: true, doImmediateRespawn: true };
    this._tempChats = new Map();
    this._voxelDirty = new Map();
    this._tempChatSeq = 0;
    this.spawnPoint = null;
    this.soundMuted = false;
    try { this.soundMuted = localStorage.getItem("dao3_muted") === "1"; } catch {}
    this._keys = { w: false, a: false, s: false, d: false, shift: false, ctrl: false, space: false };
    this._joy = { x: 0, y: 0 };
    this._channels = attachChannels({}, ["Tick", "PlayerJoin", "PlayerLeave", "Chat", "Interact", "Click", "Press",
      "Release", "Respawn", "TakeDamage", "Die", "EntityCreate", "EntityDestroy", "EntityContact", "EntitySeparate",
      "VoxelContact", "VoxelSeparate", "FluidEnter", "FluidLeave", "ButtonPressed", "PlayerPurchaseSuccess"]);
    this.world = this._buildWorld();
    this.voxels = this._buildVoxels();
    this.clientWorld = { rendering3d: true };
  }

  /* ---------------- 启动 / 停止 ---------------- */
  start({ scripts = [], assets = {}, spawnIndex = null, player = null } = {}) {
    if (this.running) return;
    this.running = true;
    const e = this.e, r = e.renderer;
    this.assets = {
      meshes: (assets && assets.meshes) || {}, audio: (assets && assets.audio) || {},
      audioBase: (assets && assets.audioBase) || "", audioNames: (assets && assets.audioNames) || [],
      pictureNames: (assets && assets.pictureNames) || [], lutNames: (assets && assets.lutNames) || [],
      partNames: (assets && assets.partNames) || [],
    };
    // 「世界」面板里的官方 GameWorld 参数在脚本执行前生效，脚本仍可覆盖
    const meta = e.state.meta || {};
    const ws = meta.worldSettings || {};
    for (const k of ["gravity", "airFriction", "useOBB", "lightMode", "sunFrequency", "fogUniformDensity", "rainDensity", "snowDensity"]) {
      if (ws[k] !== undefined && ws[k] !== null) this[k] = ws[k];
    }
    if (meta.time != null) this.sunPhase = clamp(Number(meta.time) || 0, 0, 24000) / 24000;
    const amb = meta.ambientSound || {};
    // 官方这 5 个槽都是 GameSoundEffect 对象：半径/增益/音高必须留着，否则衰减与音量参数全丢
    const keep = (slot, cur) => { const s = GameRuntime.soundSpecOf(slot); return s || cur; };
    this.breakVoxelSound = keep(amb.breakVoxel, this.breakVoxelSound);
    this.placeVoxelSound = keep(amb.placeVoxel, this.placeVoxelSound);
    this.playerJoinSound = keep(amb.playerJoin, this.playerJoinSound);
    this.playerLeaveSound = keep(amb.playerLeave, this.playerLeaveSound);
    this.ambientSound = keep(amb.ambient, this.ambientSound);
    const weather = ws.initialWeather || meta.initialWeather;
    if (weather === "rain") this.rainDensity = Math.max(this.rainDensity, 0.75);
    else if (weather === "snow") this.snowDensity = Math.max(this.snowDensity, 0.7);
    else if (weather === "thunder") { this.rainDensity = Math.max(this.rainDensity, 0.9); this.thunderDensity = 0.6; }
    this._camSaved = { pos: r.camera.position.clone(), quat: r.camera.quaternion.clone(), target: r.controls.target.clone(), fov: r.camera.fov };
    this.currentTick = 0;
    this._acc = 0;
    this._last = performance.now();
    r.setFirstPerson(false);
    r.controls.enabled = false;
    r.setBarriersVisible && r.setBarriersVisible(false);
    this._buildRegistry();
    this._client().attach();
    // 编辑器里摆好的触发区域：脚本执行前先注册，world.zones() 立刻能查到
    for (const z of (meta.zones || [])) {
      if (!z || z.enabled === false) continue;
      const b = z.bounds || (z.min && z.max ? { min: z.min, max: z.max } : null); // 官方是 bounds:{min,max}
      if (!b) continue;
      // 环境覆盖键（fog*/rain*/snow*/sky*）必须一起带上，否则区域环境永远不生效
      this._addZone(Object.assign({}, z, { bounds: b, min: b.min, max: b.max }));
    }
    if (r._zoneGroup) r._zoneGroup.visible = false;
    const sx = spawnIndex || [Math.floor(e.world.shape[0] / 2), 0, Math.floor(e.world.shape[2] / 2)];
    const spawn = this.spawnPoint ? this.spawnPoint.slice() : this._topAt(sx[0], sx[2]);
    this._createPlayer(spawn);
    if (player) this._applyPlayerMeta(player);
    this._setupHud();
    this._bindInput();
    document.body.classList.add("playing");
    consoleDiv(this.hud.console, "已载入 " + (scripts || []).length + " 个脚本文件", "info");
    for (const f of scripts || []) this.runScript(f.name || "index.js", f.code || "", f);
    this._channels.PlayerJoin.fire({ tick: 0, entity: this.playerEntity });
    if (this.playerJoinSound) this._playAt(this.playerJoinSound, this.playerEntity.position);
    if (this.ambientSound) this._startAmbient();
    this._channels.Tick.fire(this._tickEvent(0, false));
    this._oldOnRender = r.onRender;
    r.onRender = () => this._frame();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    const e = this.e, r = e.renderer;
    this._channels.PlayerLeave.fire({ tick: this.currentTick, entity: this.playerEntity });
    r.onRender = this._oldOnRender || null;
    if (this._camSaved) {
      r.camera.position.copy(this._camSaved.pos);
      r.camera.quaternion.copy(this._camSaved.quat);
      r.camera.fov = this._camSaved.fov;
      r.camera.updateProjectionMatrix();
      r.controls.target.copy(this._camSaved.target);
      r.controls.update();
      this._camSaved = null;
    }
    this._unbindInput();
    for (const ent of this.entities) ent._dispose && ent._dispose();
    this.entities = [];
    this.zones = [];
    this.animations.length = 0;
    this._timers.clear();
    for (const s of this._sounds) { try { s._audio && s._audio.pause(); } catch {} }
    this._sounds.clear();
    this.player = null;
    this.playerEntity = null;
    this._collisions.length = 0;
    document.exitPointerLock && document.exitPointerLock();
    document.body.classList.remove("playing");
    r.controls.enabled = true;
    r.setBarriersVisible && r.setBarriersVisible(true);
    r.setUnderwater && r.setUnderwater(false);
    this._stopAmbient();
    if (r._zoneGroup) r._zoneGroup.visible = true;
    this._teardownHud();
    if (this._cliApi) { this._cliApi.teardown(); this._cliApi = null; } // 脚本建的 UI 不跨次运行残留
    r.setWeather({ rain: 0, snow: 0, thunder: 0 });
    e.applyTerrain();
  }

  /* ---------------- 实体注册 ---------------- */
  _buildRegistry() {
    const e = this.e;
    for (const ent of this.entities) ent._dispose && ent._dispose();
    this.entities = [];
    // 官方 entitiesTree：场景模型即实体。id 用实体名（脚本以 #名称 选择、并从名字里取序号），
    // bounds 是「半径」= 树里的完整包围盒 × scale ÷ 2。
    const mk = (d, obj) => {
      const sv = Array.isArray(d.scaleVec || d.scale) ? (d.scaleVec || d.scale) : [d.scale ?? 1, d.scale ?? 1, d.scale ?? 1];
      const b = d.bounds || [0, 0, 0];
      const ent = this._makeEntity({
        id: d.name || d.id, tags: d.tags, position: d.position || d.pos,
        bounds: [Math.max(0.05, (b[0] * sv[0]) / 2), Math.max(0.05, (b[1] * sv[1]) / 2), Math.max(0.05, (b[2] * sv[2]) / 2)],
        collides: !!d.collision, obj, mesh: d.meshName || d.mesh || "",
        mass: d.mass, friction: d.friction, restitution: d.restitution,
      });
      ent.gravity = !!d.gravity; ent.fixed = !!d.fixed;
      // 开了碰撞就用真实网格包围盒当物理盒（资产枢轴已归一，量出来的就是看到的），
      // 否则树里的 bounds 与网格尺寸不一致，视觉上会「穿过方块」
      if (Array.isArray(d.anchorOffset)) {
        ent.anchorOffset.set(d.anchorOffset[0], d.anchorOffset[1], d.anchorOffset[2]);
      } else if (obj && obj.isObject3D) {
        try {
          obj.updateWorldMatrix(true, true);
          const box = new THREE.Box3().setFromObject(obj);
          const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
          if (isFinite(sz.x) && sz.x > 0) {
            ent.bounds.set(Math.max(0.05, sz.x / 2), Math.max(0.05, sz.y / 2), Math.max(0.05, sz.z / 2));
            ent.anchorOffset.set(c.x - ent.position.x, sz.y / 2, c.z - ent.position.z);
          } else if (d.collision) {
            ent.anchorOffset.set(0, ent.bounds.y, 0);
          }
        } catch { if (d.collision) ent.anchorOffset.set(0, ent.bounds.y, 0); }
      }
      ent.meshInvisible = d.meshInvisible === true;
      ent.meshEmissive = d.emissive ?? 0; ent.meshMetalness = d.metalness ?? 0; ent.meshShininess = d.shininess ?? 0;
      if (Array.isArray(d.tint)) ent.meshColor = new GameRGBAColor(d.tint[0] / 255, d.tint[1] / 255, d.tint[2] / 255, (d.tint[3] ?? 255) / 255);
      if (d.damage && d.damage.enabled) {
        ent.enableDamage = true; ent.hp = d.damage.hp ?? 100; ent.maxHp = d.damage.maxHp ?? 100;
        ent.showHealthBar = d.damage.showHealth !== false;
        ent.showDamage = d.damage.showDamage !== false;
      }
      if (d.sound) {
        for (const [slot, field] of [["chat", "chatSound"], ["hurt", "hurtSound"], ["die", "dieSound"], ["interact", "interactSound"]]) {
          const sp = GameRuntime.soundSpecOf(d.sound[slot]);
          if (sp) ent[field] = sp;
        }
      }
      const ps = GameRuntime.particleFrom(d.particle);
      if (ps) {
        ent.particleRate = ps.rate; ent.particleRateSpread = ps.rateSpread;
        ent.particleLimit = ps.limit; ent.particleLifetime = ps.lifetime;
        ent.particleLifetimeSpread = ps.lifetimeSpread; ent.particleDamping = ps.damping;
        ent.particleAcceleration = toVec3(ps.acceleration); ent.particleNoise = ps.noise;
        ent.particleNoiseFrequency = ps.noiseFrequency;
        ent.particleVelocity = toVec3(ps.velocity); ent.particleVelocitySpread = toVec3(ps.velocitySpread);
        ent.particleSizeSpread = ps.sizeSpread;
        if (ps.color.length) ent.particleColor = ps.color;
        if (ps.size.length) ent.particleSize = ps.size;
      }
      ent._meshName = d.meshName || d.mesh || "";
      ent._defaultMotionId = d.defaultMotionId || "";
      return ent;
    };
    for (const m of e.state.models || []) {
      if (!m.meshName && !m.tags?.length && !m.entId) continue;
      mk({ ...m, position: m.object ? [m.object.position.x, m.object.position.y, m.object.position.z] : m.pos }, m.object || null);
    }
    for (const d of e.state.entities || []) {
      if ((e.state.models || []).some((m) => (m.name || m.entId) === (d.name || d.id))) continue;
      mk(d, null);
    }
  }

  _makeEntity(cfg = {}) {
    const rt = this, r = this.e.renderer;
    const pos = toVec3(cfg.position || cfg.pos, new GameVector3(...rt._topAt(8, 8)));
    const ent = {
      id: cfg.id != null ? String(cfg.id) : "ent" + rt.entities.length,
      position: pos,
      velocity: toVec3(cfg.velocity, new GameVector3()),
      bounds: toVec3(cfg.bounds, new GameVector3(1, 1, 1)),
      mass: cfg.mass ?? 1, friction: cfg.friction ?? 0, restitution: cfg.restitution ?? 0,
      collides: cfg.collides !== false, gravity: !!cfg.gravity, fixed: cfg.fixed !== false,
      contactForce: new GameVector3(),
      meshInvisible: false, meshColor: new GameRGBAColor(1, 1, 1, 1), meshMetalness: 0,
      meshEmissive: 0, meshShininess: 0, anchorOffset: new GameVector3(),
      enableDamage: false, showHealthBar: true, showDamage: true, hp: cfg.hp ?? 100, maxHp: cfg.maxHp ?? 100,
      enableInteract: !!cfg.enableInteract, interactColor: new GameRGBColor(0, 1, 0),
      interactHint: cfg.interactHint || "", interactRadius: cfg.interactRadius ?? 16,
      showEntityName: !!cfg.showEntityName, customName: cfg.customName || "",
      nameRadius: cfg.nameRadius ?? 24, nameColor: new GameRGBColor(1, 1, 1),
      chatSound: null, hurtSound: null, dieSound: null, interactSound: null,
      particleRate: 0, particleRateSpread: 0, particleLimit: 100, particleColor: [], particleSize: [],
      particleSizeSpread: 0, particleLifetime: 1, particleLifetimeSpread: 0,
      particleVelocity: new GameVector3(), particleVelocitySpread: new GameVector3(),
      particleDamping: 0, particleAcceleration: new GameVector3(), particleNoise: 0,
      particleNoiseFrequency: 1, particleTarget: null, particleTargetWeight: 0,
      destroyed: false, isPlayer: false, player: undefined,
      _tags: new Set(cfg.tags || []), _obj: cfg.obj || null, _external: !!cfg.obj,
      _entityContacts: [], _voxelContacts: [], _fluidContacts: [],
      _prevVoxelContacts: [], _prevFluidContacts: [],
    };
    if (!ent._obj) {
      const g = new THREE.Group();
      g.visible = false;
      r.scene.add(g);
      ent._obj = g;
    }
    ent._channels = attachChannels(ent, ["Destroy", "TakeDamage", "Die", "Click", "EntityContact", "EntitySeparate",
      "VoxelContact", "VoxelSeparate", "FluidEnter", "FluidLeave", "Interact"]);
    ent.tags = () => [...ent._tags];
    ent.addTag = (t) => ent._tags.add(t);
    ent.removeTag = (t) => ent._tags.delete(t);
    ent.hasTag = (t) => ent._tags.has(t);
    ent.destroy = () => {
      if (ent.destroyed) return;
      ent.destroyed = true;
      ent._dispose();
      rt.entities = rt.entities.filter((x) => x !== ent);
      rt._channels.EntityDestroy.fire({ tick: rt.currentTick, entity: ent });
      ent._channels.Destroy.fire({ tick: rt.currentTick, entity: ent });
    };
    ent._dispose = () => {
      if (ent._points) { r.scene.remove(ent._points); ent._points.geometry.dispose(); ent._points = null; }
      rt.tags && rt.tags.remove(ent);
      if (ent._obj && ent._obj.parent && !ent._external) ent._obj.parent.remove(ent._obj);
    };
    ent.hurt = (amount, options) => {
      if (!ent.enableDamage) return;   // 官方：未开伤害的实体不受伤害
      ent.hp = Math.max(0, ent.hp - (amount || 0));
      const ev = {
        tick: rt.currentTick, entity: ent, damage: amount,
        attacker: (options && options.attacker) || null, damageType: (options && options.damageType) || "",
      };
      ent._channels.TakeDamage.fire(ev);
      rt._channels.TakeDamage.fire(ev);
      if (ent.showDamage && amount > 0 && rt.tags) rt.tags.float(ent, "-" + Math.round(amount), 900);
      rt._playAt(ent.hurtSound, ent.position);
      if (ent.hp <= 0) {
        if (ent.player) ent.player.dead = true;
        const dev = { tick: rt.currentTick, entity: ent, attacker: ev.attacker, damageType: ev.damageType };
        ent._channels.Die.fire(dev);
        rt._channels.Die.fire(dev);
        rt._playAt(ent.dieSound, ent.position);
        // 官方 doImmediateRespawn：开了就直接在出生点复活，不再停在死亡遮罩
        if (ent.player && rt.gameRules.doImmediateRespawn !== false) rt._respawn("死亡");
      }
    };
    ent.heal = (amount) => { ent.hp = Math.min(ent.maxHp, ent.hp + (amount || 0)); };
    ent.lookAt = (target, axis = "Y", up) => {
      const t = toVec3(target);
      const dir = new THREE.Vector3(t.x - ent.position.x, axis === "Y" ? 0 : t.y - ent.position.y, t.z - ent.position.z);
      if (dir.lengthSq() < 1e-8) return;
      ent._obj.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
      ent._lookYaw = Math.atan2(dir.x, dir.z);
    };
    ent.rotateLocal = (local, axis, rad) => {
      const v = toVec3(local);
      const tv = new THREE.Vector3(v.x, v.y, v.z).applyAxisAngle(
        new THREE.Vector3(axis === "X" ? 1 : 0, axis === "Y" ? 1 : 0, axis === "Z" ? 1 : 0), rad);
      ent.position.set(tv.x, tv.y, tv.z);
    };
    ent.scaleLocal = (local, vec) => {
      const v = toVec3(local), s = toVec3(vec);
      ent.position.set(v.x * s.x, v.y * s.y, v.z * s.z);
    };
    ent.sound = (spec) => rt._makeSound(spec, ent);
    ent.say = (message, options) => rt._floatSay(ent, message, options);
    ent.animate = (keyframes, playback) => rt._animate(ent, keyframes, playback, "entity");
    ent.getAnimations = () => rt.animations.filter((a) => a.target === ent);
    ent.motion = makeMotionController(ent, rt);
    if (rt.entities.length >= ENTITY_QUOTA) return ent;
    // mesh* 外观属性必须有 setter：官方语义是「赋值即时反映到画面」，
    // 光靠换 mesh / 改 scale 时才顺带刷一次材质，脚本里 entity.meshColor = ... 就不会生效。
    ent._meshColorV = ent.meshColor;
    for (const k of ["meshMetalness", "meshEmissive", "meshShininess"]) ent["_mm_" + k] = ent[k];
    for (const k of ["mesh", "meshInvisible", "meshScale", "meshOrientation", "meshOffset",
      "meshColor", "meshMetalness", "meshEmissive", "meshShininess"]) {
      Object.defineProperty(ent, k, propFor(k, ent, rt));
    }
    // 官方只读接触数组：entityContacts / voxelContacts / fluidContacts
    Object.defineProperty(ent, "entityContacts", { get: () => ent._entityContacts, configurable: true });
    Object.defineProperty(ent, "voxelContacts", { get: () => ent._voxelContacts, configurable: true });
    Object.defineProperty(ent, "fluidContacts", { get: () => ent._fluidContacts, configurable: true });
    rt._initParticles(ent);
    rt.tags && rt.tags.ensure(ent);
    rt.entities.push(ent);
    rt._channels.EntityCreate.fire({ tick: rt.currentTick, entity: ent });
    if (cfg.mesh) ent.mesh = cfg.mesh;
    return ent;
  }

  /* ---------------- 玩家 ---------------- */
  _createPlayer(spawn) {
    const rt = this, e = this.e;
    const ent = this._makeEntity({
      id: "player", tags: ["player"],
      position: [spawn[0] + 0.5, spawn[1] + 0.02, spawn[2] + 0.5],
      bounds: [0.3, 0.9, 0.3], collides: true,
    });
    ent.isPlayer = true;
    ent.fixed = true;
    const saved = (e.state.meta && e.state.meta.player) || {};
    const p = {
      name: saved.name || "玩家", userId: "local-player", userKey: "local-player", boxId: "0", avatar: "",
      url: new URL(location.href),
      spawnPoint: new GameVector3(spawn[0] + 0.5, spawn[1], spawn[2] + 0.5),
      movementBounds: new GameBounds3(new GameVector3(-50, -50, -50),
        new GameVector3(e.world.shape[0] + 50, e.world.shape[1] + 50, e.world.shape[2] + 50)),
      facingDirection: new GameVector3(0, 0, -1),
      scale: 1, color: new GameRGBColor(0.95, 0.76, 0.49), metalness: 0, emissive: 0, shininess: 0,
      invisible: false, showName: true, showIndicator: false, colorLUT: "",
      dead: false,
      canFly: false, flying: false, spectator: false,
      enableJump: true, enableDoubleJump: true, enableCrouch: true, enable3DCursor: false,
      enableAction0: true, enableAction1: true,
      walkSpeed: PLAYER_DEFAULTS.walkSpeed, walkAcceleration: PLAYER_DEFAULTS.walkAcceleration,
      runSpeed: PLAYER_DEFAULTS.runSpeed, runAcceleration: PLAYER_DEFAULTS.runAcceleration,
      crouchSpeed: PLAYER_DEFAULTS.crouchSpeed, crouchAcceleration: PLAYER_DEFAULTS.crouchAcceleration,
      flySpeed: PLAYER_DEFAULTS.flySpeed, flyAcceleration: PLAYER_DEFAULTS.flyAcceleration,
      swimSpeed: PLAYER_DEFAULTS.swimSpeed, swimAcceleration: PLAYER_DEFAULTS.swimAcceleration,
      jumpPower: PLAYER_DEFAULTS.jumpPower, jumpSpeedFactor: PLAYER_DEFAULTS.jumpSpeedFactor,
      jumpAccelerationFactor: PLAYER_DEFAULTS.jumpAccelerationFactor, doubleJumpPower: PLAYER_DEFAULTS.doubleJumpPower,
      moveState: GamePlayerMoveState.FALL, walkState: GamePlayerWalkState.NONE,
      swapInputDirection: false, reverseInputDirection: GameInputDirection.NONE, disableInputDirection: GameInputDirection.NONE,
      walkButton: true, runButton: true, crouchButton: true, jumpButton: true, doubleJumpButton: true, flyButton: true,
      action0Button: true, action1Button: true,
      cameraMode: GameCameraMode.FOLLOW, cameraEntity: ent, cameraTarget: new GameVector3(),
      cameraUp: new GameVector3(0, 1, 0), cameraPosition: new GameVector3(),
      cameraFreezedAxis: GameCameraFreezedAxis.NONE,
      cameraFovY: PLAYER_DEFAULTS.cameraFovY, cameraDistance: PLAYER_DEFAULTS.cameraDistance,
      cameraYaw: 0, cameraPitch: 0, freezedForwardDirection: null,
      muted: false, music: { _sample: "", get sample() { return this._sample; }, set sample(v) { this._sample = v; rt._setMusic(v); } },
      gamepad: {
        joystickBackground: "", joystickController: "", flyButton: "", flyingBackground: "",
        flyingController: "", jump: "", crouch: "", actionA: "", actionB: "",
      },
      jumpSound: null, doubleJumpSound: null, landSound: null, crouchSound: null, stepSound: null,
      swimSound: null, action0Sound: null, action1Sound: null, enterWaterSound: null, leaveWaterSound: null,
      startFlySound: null, stopFlySound: null, spawnSound: null,
      skin: {}, skinInvisible: Object.fromEntries(Object.values(GameBodyPart).map((p) => [p, false])),
      _entity: ent,
    };
    p.isPlayer = true;
    p._channels = attachChannels(p, ["Chat", "Press", "Release", "Respawn", "KeyDown", "KeyUp"]);
    p.directMessage = (message) => rt._chatLine("我 " + message, "#fff7d6");
    p.dialog = (params) => rt._dialog(params || {});
    p.cancelDialogs = () => rt._closeDialog();
    p.forceRespawn = () => rt._respawn("手动");
    p.sound = (spec) => rt._makeSound(spec, ent);
    p.playSound = (spec) => rt._makeSound(typeof spec === "string" ? { sample: spec } : spec, ent);
    p.say = (message, options) => rt._floatSay(ent, message, options);
    p.setCameraYaw = (v) => { rt._tYaw = +v || 0; };
    p.setCameraPitch = (v) => { rt._tPitch = clamp(+v || 0, -1.52, 1.52); };
    p.teleport = (pos) => { const v = toVec3(pos); ent.position.set(v.x, v.y, v.z); rt._vy = 0; };
    p.setRespawnPoint = (pos) => { p.spawnPoint = toVec3(pos).clone(); };
    p.animate = (keyframes, playback) => rt._animate(p, keyframes, playback, "player");
    p.getAnimations = () => rt.animations.filter((a) => a.target === p);
    p.kick = () => rt.toast("本地单人运行，无法移出玩家");
    p.link = () => {};
    p.share = (c) => rt.toast("分享内容：" + String(c).slice(0, 40));
    p.openMarketplace = () => {};
    p.getMiaoShells = () => Promise.resolve(0);
    p.openUserProfileDialog = () => {};
    p.querySocial = () => Promise.resolve([]);
    p.querySocialStatistic = () => Promise.resolve({});
    // —— 可穿戴物品：官方 GameWearable 挂在人偶部位挂点上，跟着角色一起动 ——
    p._wearables = [];
    p.skin = Object.fromEntries(BODY_PARTS.map((k) => [k, null]));
    p.wearables = (bodyPart) => p._wearables.filter((w) => !bodyPart || w.bodyPart === bodyPart);
    p.addWearable = (spec) => {
      const s = spec || {};
      const part = BODY_PARTS.includes(s.bodyPart) ? s.bodyPart : GameBodyPart.TORSO;
      const parts = ent._avatar && ent._avatar.userData.parts;
      const anchor = parts && parts[PART_SLOT[part]];
      if (!anchor) return null;
      const holder = new THREE.Group();
      const base = String(s.mesh || "").replace(/^.*[\\/]/, "").replace(/\.(vb|gltf|glb)$/i, "");
      const asset = base && this.assets.meshes ? this.assets.meshes[base] : null;
      if (asset && asset.object) holder.add(asset.object.clone(true));
      else holder.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshLambertMaterial({ color: 0xffffff })));
      const sc = toVec3(s.scale, new GameVector3(1, 1, 1));
      holder.scale.set(sc.x || 1, sc.y || 1, sc.z || 1);
      const off = toVec3(s.offset);
      holder.position.set(off.x, off.y, off.z);
      const o = s.orientation;
      if (o) holder.quaternion.set(o.x || 0, o.y || 0, o.z || 0, o.w == null ? 1 : o.w);
      const col = s.color == null ? null : rgbOf(s.color);
      holder.traverse((m) => {
        if (!m.isMesh || !m.material) return;
        m.castShadow = true;
        m.material = m.material.clone();
        if (col) m.material.color.setRGB(clamp01(col.red), clamp01(col.green), clamp01(col.blue));
        if (typeof s.emissive === "number" && m.material.emissive) m.material.emissive.setScalar(clamp01(s.emissive));
        if (typeof s.metalness === "number" && "metalness" in m.material) m.material.metalness = clamp01(s.metalness);
        if (typeof s.shininess === "number" && "shininess" in m.material) m.material.shininess = clamp01(s.shininess) * 100;
      });
      anchor.add(holder);
      const w = {
        player: p, bodyPart: part, mesh: s.mesh || "", color: s.color || null, emissive: s.emissive ?? 0,
        metalness: s.metalness ?? 0, shininess: s.shininess ?? 0, orientation: o || null,
        scale: s.scale || null, offset: s.offset || null, _obj: holder, _anchor: anchor,
      };
      p._wearables.push(w);
      return w;
    };
    p.removeWearable = (w) => {
      const i = p._wearables.indexOf(w);
      if (i < 0) return;
      p._wearables.splice(i, 1);
      if (w && w._obj && w._obj.parent) w._obj.parent.remove(w._obj);
    };
    p.setSkinByName = (name) => {
      const v = name == null ? null : String(name);
      for (const k of BODY_PARTS) p.skin[k] = v;
      rt._applySkinLook(p, ent);
    };
    p.resetToDefaultSkin = () => {
      for (const k of BODY_PARTS) p.skin[k] = null;
      rt._applySkinLook(p, ent);
    };
    p.clearSkin = () => {
      for (const k of BODY_PARTS) p.skin[k] = null;
      for (const k of BODY_PARTS) p.skinInvisible[k] = false;
      rt._applySkinLook(p, ent);
    };
    // 官方 PlayerNavigator 是脚本侧事件总线（事件类型 "message"）
    const navL = new Map();
    p.navigator = {
      addEventListener: (type, fn) => { const a = navL.get(type) || []; a.push(fn); navL.set(type, a); },
      emitEvent: (type, value) => {
        for (const fn of (navL.get(type) || []).slice()) rt._guard("navigator", () => fn({ data: value }));
      },
      dispatchEvent: (type, value) => p.navigator.emitEvent(type, value),
    };
    p.runCommand = (cmd) => rt._runCommand(cmd);
    ent.player = p;
    this.player = p;
    this.playerEntity = ent;
    // 默认角色外观（官方第三人称下玩家以可见角色呈现）
    const avatar = makeAvatar();
    avatar.castShadow = true;
    ent._obj.add(avatar);
    ent._avatar = avatar;
    ent._obj.position.set(ent.position.x, ent.position.y, ent.position.z);
    this._meshForPlayer = null;
    this._yaw = 0; this._pitch = 0; this._tYaw = 0; this._tPitch = 0;
    this._vy = 0; this._grounded = false; this._coyote = 0; this._jumpBuf = 0;
    this._doubleJumpUsed = false; this._jumpPhase = false; this._bob = 0; this._landShake = 0;
    this._stepAccum = 0;
    return ent;
  }

  // 「玩家」面板存的是官方字段名与单位；须在脚本执行前套用，让脚本拥有最终覆盖权
  _applyPlayerMeta(raw) {
    const keys = ["name", "walkSpeed", "walkAcceleration", "runSpeed", "runAcceleration", "crouchSpeed",
      "crouchAcceleration", "flySpeed", "swimSpeed", "jumpPower", "doubleJumpPower",
      "cameraDistance", "cameraFovY", "canFly", "invisible", "spectator", "enableJump", "enableDoubleJump",
      "allowFlight", "allowJump", "allowDoubleJump", "allowCrouch", "allowMove", "allowAction0", "allowAction1",
      "mass", "friction", "restitution", "initialYaw"];
    for (const k of keys) if (raw[k] !== undefined && raw[k] !== null) this.player[k] = raw[k];
    if (Object.values(GameCameraMode).includes(raw.cameraMode)) this.player.cameraMode = raw.cameraMode;
    // 官方 project.json 把音效存成 { jump: {sample, gain, gainRange, pitch, pitchRange, radius}, ... }，
    // 运行时用扁平字段名挂载；整份对象要保留，否则 40 个官方音效既听不见也没有衰减
    const pick = (slot) => GameRuntime.soundSpecOf(slot);
    const PS = raw.playerSounds || {}, ES = raw.sounds || {};
    const map = [
      ["jumpSound", PS.jump], ["doubleJumpSound", PS.doubleJump], ["landSound", PS.land],
      ["crouchSound", PS.crouch], ["stepSound", PS.step], ["swimSound", PS.swim],
      ["enterWaterSound", PS.enterWater], ["leaveWaterSound", PS.leaveWater],
      ["startFlySound", PS.startFly], ["stopFlySound", PS.endFly], ["spawnSound", PS.spawn],
      ["action0Sound", PS.action0], ["action1Sound", PS.action1],
      ["hurtSound", ES.hurt], ["dieSound", ES.die], ["chatSound", ES.chat], ["interactSound", ES.interact],
    ];
    for (const [field, slot] of map) { const v = pick(slot); if (v) this.player[field] = v; }
    const music = pick(PS.music);
    if (music) this.player.music.sample = music;
    if (raw.damage && raw.damage.enabled) {
      this.player.enableDamage = true;
      this.playerEntity.enableDamage = true;
      this.playerEntity.hp = raw.damage.hp ?? 100;
      this.playerEntity.maxHp = raw.damage.maxHp ?? 100;
      this.playerEntity.showHealthBar = raw.damage.showHealth !== false;
      this.playerEntity.showDamage = raw.damage.showDamage !== false;
    }
    if (raw.movementBounds) {
      const lo = toVec3(raw.movementBounds.lo), hi = toVec3(raw.movementBounds.hi);
      const mb = new GameBounds3(lo, hi);          // 官方是 GameBounds3，_stepPlayer 会调 .contains()
      this.player.movementBounds = mb;
      this._moveBounds = mb;
    }
    if (raw.initialPosition) {
      const ip = raw.initialPosition;
      this.player.spawnPoint = new GameVector3(ip.x, ip.y, ip.z);
      this.spawnPoint = [ip.x, ip.y, ip.z];
      if (this.playerEntity) this.playerEntity.position.set(ip.x, ip.y, ip.z);
      if (raw.initialYaw != null) { this._yaw = Number(raw.initialYaw) || 0; this.player.cameraYaw = this._yaw; }
    }
    // 官方 project.json 用 noClip 表示穿墙，运行期 API 叫 spectator；颜色是 0..1 的 [r,g,b] 数组
    if (raw.noClip !== undefined) this.player.spectator = !!raw.noClip;
    if (Array.isArray(raw.color)) this.player.color = new GameRGBColor(raw.color[0] ?? 1, raw.color[1] ?? 1, raw.color[2] ?? 1);
    if (typeof raw.scale === "number" && raw.scale > 0) this.player.scale = raw.scale;
    for (const k of ["metalness", "emissive", "shininess"]) if (typeof raw[k] === "number") this.player[k] = raw[k];
    for (const k of ["showName", "showIndicator", "invisible"]) if (typeof raw[k] === "boolean") this.player[k] = raw[k];
    if (typeof raw.colorLUT === "string" && raw.colorLUT) this.player.colorLUT = raw.colorLUT;
    if (raw.skin && typeof raw.skin === "object") this.player.skin = raw.skin;
    if (raw.skinInvisible && typeof raw.skinInvisible === "object") this.player.skinInvisible = raw.skinInvisible;
    if (raw.gamepad && typeof raw.gamepad === "object") this.player.gamepad = Object.assign({}, this.player.gamepad, raw.gamepad);
    this._applySkinLook(this.player, this.playerEntity);
    this._applyGamepad();
  }
  // 官方 Gamepad 图槽：非空就把触屏按钮换成项目内图片（picture/… 走 _assetUrl）
  _applyGamepad() {
    const gp = (this.player && this.player.gamepad) || {};
    const slots = {
      joystickBackground: "joyBase", joystickController: "joyKnob",
      jump: "tJump", crouch: "tCrouch", actionA: "tActionA", actionB: "tActionB",
      flyButton: "tFly", flyingController: "tFly",
    };
    for (const [key, id] of Object.entries(slots)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const v = String(gp[key] || "");
      if (!v) { el.style.removeProperty("background-image"); el.classList.remove("has-icon"); continue; }
      el.style.backgroundImage = `url("${this._assetUrl(v) || v}")`;
      el.classList.add("has-icon");
    }
  }

  /* ---------------- 输入 ---------------- */
  _bindInput() {
    const rt = this;
    this._onKeyDown = (ev) => {
      if (!rt.running || !rt.player) return;
      const tag = (ev.target && ev.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const c = String(ev.code || "").toLowerCase();
      rt._setKey(c, true);
      rt.player._channels.KeyDown.fire({ tick: rt.currentTick, keyCode: keyCodeOf(ev) });
      if (c === "space" || c.startsWith("arrow")) ev.preventDefault();
      if (c === "keye") rt._tryInteract();
      if (c === "keyt" || c === "enter") { ev.preventDefault(); rt.openChat(); return; }
      if (c === "space") {
        rt._jumpBuf = 0.14;
        if (!rt._grounded && rt.player.enableDoubleJump) rt._doubleJumpButton = true;
      }
      if (c === "keyf" && rt.player.canFly) rt._toggleFly();
      if (c === "keyv") {
        rt.player.cameraMode = rt.player.cameraMode === GameCameraMode.FPS ? GameCameraMode.FOLLOW : GameCameraMode.FPS;
        rt.toast(rt.player.cameraMode === GameCameraMode.FPS ? "第一人称 (fps)" : "第三人称 (follow)");
      }
      if (c === "backquote") { const cn = rt.hud.console; cn && cn.classList.toggle("show"); }
      if (c === "keyh") { const s = document.getElementById("gameHudSettings"); s && s.classList.toggle("show"); }
      if (c === "escape" && rt._storeOpen) { rt._toggleStore(false); return; }
      if (c === "escape" && document.pointerLockElement !== rt.e.renderer.renderer.domElement) rt.e.stopPlay && rt.e.stopPlay();
    };
    this._onKeyUp = (ev) => {
      if (!rt.running || !rt.player) return;
      const c = String(ev.code || "").toLowerCase();
      rt._setKey(c, false);
      rt.player._channels.KeyUp.fire({ tick: rt.currentTick, keyCode: keyCodeOf(ev) });
    };
    this._onMouseMove = (ev) => {
      if (!rt.running || !rt.player) return;
      const el = rt.e.renderer.renderer.domElement;
      const locked = document.pointerLockElement === el;
      // 指针锁定失败（Esc 解锁冷却、iframe、浏览器策略）时退化为按住拖拽转视角
      if (!locked && !rt._dragLook) return;
      if (rt.player.freezedForwardDirection) { rt._tPitch = clamp(rt._tPitch - clamp(ev.movementY || 0, -80, 80) * 0.0022, -1.52, 1.52); return; }
      const axis = String(rt.player.cameraFreezedAxis || "");
      // 官方是「冻结哪些轴」的集合：含 y 不能绕行、含 x 不能俯仰，组合值必须逐个命中
      if (!axis.includes("y")) rt._tYaw -= clamp(ev.movementX || 0, -80, 80) * 0.0022;
      if (!axis.includes("x")) rt._tPitch = clamp(rt._tPitch - clamp(ev.movementY || 0, -80, 80) * 0.0022, -1.52, 1.52);
    };
    // 点 HUD / 脚本创建的 UI 不能同时被当成 ACTION0 或抢指针锁（官方不变式）
    const inUi = (ev) => { const t = ev && ev.target; return !!(t && t.closest && t.closest("#clientUiRoot, .uiw-host, #gameStore, #gameHudSettings, #gameUIWidgets, .pe-top")); };
    this._onMouseDown = (ev) => {
      if (!rt.running || inUi(ev)) return;
      const el = rt.e.renderer.renderer.domElement;
      if (document.pointerLockElement !== el) {
        rt._dragLook = true;
        rt._lockRequested = true;
        try {
          const p = el.requestPointerLock && el.requestPointerLock();
          if (p && p.catch) p.catch(() => {});
        } catch {}
        rt._syncLockHint();
        return;
      }
      if (ev.button === 2 && !rt.player.enableAction1) return;
      if (ev.button === 0 && !rt.player.enableAction0) return;
      rt._firePress(ev.button === 2 ? GameButtonType.ACTION1 : GameButtonType.ACTION0, true);
    };
    this._onMouseUp = (ev) => {
      if (!rt.running || inUi(ev)) return;
      if (rt._dragLook) { rt._dragLook = false; return; }
      rt._firePress(ev.button === 2 ? GameButtonType.ACTION1 : GameButtonType.ACTION0, false);
    };
    this._onLockChange = () => {
      if (!rt.running) return;
      rt._locked = document.pointerLockElement === rt.e.renderer.renderer.domElement;
      rt._syncLockHint();
    };
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("mousemove", this._onMouseMove);
    window.addEventListener("mousedown", this._onMouseDown);
    window.addEventListener("mouseup", this._onMouseUp);
    document.addEventListener("pointerlockchange", this._onLockChange);
    this._onLockError = () => { rt._locked = false; rt._syncLockHint(); };
    document.addEventListener("pointerlockerror", this._onLockError);
    this._onCtx = (ev) => { if (rt.running) ev.preventDefault(); };
    document.addEventListener("contextmenu", this._onCtx);
    try {
      const pr = this.e.renderer.renderer.domElement.requestPointerLock && this.e.renderer.renderer.domElement.requestPointerLock();
      if (pr && pr.catch) pr.catch(() => {});
    } catch {}
    this._bindTouch();
  }
  _unbindInput() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("mousemove", this._onMouseMove);
    window.removeEventListener("mousedown", this._onMouseDown);
    window.removeEventListener("mouseup", this._onMouseUp);
    document.removeEventListener("pointerlockchange", this._onLockChange);
    document.removeEventListener("pointerlockerror", this._onLockError);
    document.removeEventListener("contextmenu", this._onCtx);
    this._unbindTouch();
    for (const k in this._keys) this._keys[k] = false;
  }
  _setKey(code, down) {
    const k = this._keys;
    if (code === "keyw" || code === "arrowup") k.w = down;
    else if (code === "keys" || code === "arrowdown") k.s = down;
    else if (code === "keya" || code === "arrowleft") k.a = down;
    else if (code === "keyd" || code === "arrowright") k.d = down;
    else if (code === "shiftleft" || code === "shiftright") k.shift = down;
    else if (code === "controlleft" || code === "controlright") k.ctrl = down;
    else if (code === "space") k.space = down;
  }
  _syncLockHint() {
    const el = document.getElementById("gameLockHint");
    if (!el) return;
    const locked = document.pointerLockElement === this.e.renderer.renderer.domElement;
    el.classList.toggle("show", !!this.running && !locked && !this._isTouch);
  }
  _bindTouch() {
    const rt = this;
    this._isTouch = (window.matchMedia && matchMedia("(pointer: coarse)").matches) || "ontouchstart" in window;
    if (!this._isTouch) return;
    document.body.classList.add("touch");
    const base = document.getElementById("joyBase"), knob = document.getElementById("joyKnob");
    const R = 46;
    let joyId = null;
    const setKnob = (dx, dy) => { if (knob) knob.style.transform = `translate(-50%,-50%) translate(${dx}px,${dy}px)`; };
    const move = (t) => {
      if (!base) return;
      const b = base.getBoundingClientRect();
      let dx = t.clientX - (b.left + b.width / 2), dy = t.clientY - (b.top + b.height / 2);
      const len = Math.hypot(dx, dy) || 1;
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      setKnob(dx, dy);
      rt._joy = { x: dx / R, y: dy / R };
    };
    const end = (ev) => {
      for (const t of ev.changedTouches) if (t.identifier === joyId) {
        joyId = null; rt._joy = { x: 0, y: 0 }; setKnob(0, 0);
      }
    };
    this._ts = (ev) => { ev.preventDefault(); const t = ev.changedTouches[0]; joyId = t.identifier; move(t); };
    this._tm = (ev) => { ev.preventDefault(); for (const t of ev.changedTouches) if (t.identifier === joyId) move(t); };
    this._te = end;
    if (base) {
      base.addEventListener("touchstart", this._ts, { passive: false });
      base.addEventListener("touchmove", this._tm, { passive: false });
      base.addEventListener("touchend", this._te);
      base.addEventListener("touchcancel", this._te);
    }
    this._touchBtns = [];
    const hold = (id, down, up) => {
      const el = document.getElementById(id);
      if (!el) return;
      const dn = (ev) => { ev.preventDefault(); down(); };
      const uf = (ev) => { ev.preventDefault(); up && up(); };
      el.addEventListener("touchstart", dn, { passive: false });
      el.addEventListener("touchend", uf, { passive: false });
      rt._touchBtns.push([el, dn, uf]);
    };
    hold("tJump", () => { rt._jumpBuf = 0.14; rt._firePress(GameButtonType.JUMP, true); }, () => rt._firePress(GameButtonType.JUMP, false));
    hold("tCrouch", () => { rt._keys.ctrl = true; }, () => { rt._keys.ctrl = false; });
    hold("tRun", () => { rt._keys.shift = true; }, () => { rt._keys.shift = false; });
    hold("tFly", () => rt._toggleFly());
    hold("tInteract", () => rt._tryInteract());
    hold("tActionA", () => rt._firePress(GameButtonType.ACTION0, true), () => rt._firePress(GameButtonType.ACTION0, false));
    hold("tActionB", () => rt._firePress(GameButtonType.ACTION1, true), () => rt._firePress(GameButtonType.ACTION1, false));
    const cv = this.e.renderer.renderer.domElement;
    let camId = null, lx = 0, ly = 0;
    this._cts = (ev) => { const t = ev.changedTouches[0]; if (t.clientX > innerWidth * 0.3) { camId = t.identifier; lx = t.clientX; ly = t.clientY; } };
    this._ctm = (ev) => {
      for (const t of ev.changedTouches) if (t.identifier === camId) {
        rt._tYaw -= (t.clientX - lx) * 0.006;
        rt._tPitch = clamp(rt._tPitch - (t.clientY - ly) * 0.006, -1.52, 1.52);
        lx = t.clientX; ly = t.clientY;
      }
    };
    this._cte = () => { camId = null; };
    cv.addEventListener("touchstart", this._cts, { passive: true });
    cv.addEventListener("touchmove", this._ctm, { passive: true });
    cv.addEventListener("touchend", this._cte);
  }
  _unbindTouch() {
    if (!this._isTouch) return;
    document.body.classList.remove("touch");
    const base = document.getElementById("joyBase");
    if (base && this._ts) {
      base.removeEventListener("touchstart", this._ts);
      base.removeEventListener("touchmove", this._tm);
      base.removeEventListener("touchend", this._te);
    }
    for (const [el, dn, uf] of this._touchBtns || []) {
      el.removeEventListener("touchstart", dn);
      el.removeEventListener("touchend", uf);
    }
    const cv = this.e.renderer.renderer.domElement;
    cv.removeEventListener("touchstart", this._cts);
    cv.removeEventListener("touchmove", this._ctm);
    cv.removeEventListener("touchend", this._cte);
  }
  _toggleFly() {
    const p = this.player;
    if (!p.canFly || !p.flyButton) return;
    p.flying = !p.flying;
    this._doubleJumpUsed = false;
    this._playAt(p.flying ? p.startFlySound : p.stopFlySound, this.playerEntity.position);
  }
  _firePress(button, pressed) {
    const rt = this, p = this.player, ent = this.playerEntity;
    if (!p) return;
    const wantRay = button === GameButtonType.ACTION0 || button === GameButtonType.ACTION1;
    const ray = wantRay ? rt.raycastFromEyes(8) : rt._emptyRay();
    const data = { tick: rt.currentTick, entity: ent, position: ent.position.clone(), button, pressed, raycast: ray };
    if (pressed) {
      p._channels.Press.fire(data);
      rt._channels.Press.fire(data);
      rt._channels.ButtonPressed.fire({ tick: rt.currentTick, entity: ent, button });
      if (wantRay && ray.hit && ray.hitEntity) {
        const click = {
          tick: rt.currentTick, entity: ray.hitEntity, clicker: ent, button, distance: ray.distance,
          clickerPosition: ent.position.clone(), raycast: ray,
        };
        ray.hitEntity._channels.Click.fire(click);
        rt._channels.Click.fire(click);
        if (ray.hitEntity.enableInteract) rt._interactWith(ray.hitEntity);
      }
      if (button === GameButtonType.JUMP) this._playAt(p.jumpSound, ent.position);
      if (button === GameButtonType.ACTION0) this._playAt(p.action0Sound, ent.position);
      if (button === GameButtonType.ACTION1) this._playAt(p.action1Sound, ent.position);
    } else {
      p._channels.Release.fire(data);
      rt._channels.Release.fire(data);
    }
  }
  _fireButtonEvent(button) { this._channels.ButtonPressed.fire({ tick: this.currentTick, entity: this.playerEntity, button }); }

  /* ---------------- 帧循环：定步 tick + 渲染态 ---------------- */
  _frame() {
    if (!this.running) return;
    const now = performance.now();
    let real = now - this._last;
    this._last = now;
    if (real > 1000) real = TICK_MS;
    this._acc += real;
    let skip = false;
    const backlog = TICK_MS * 5;
    if (this._acc > backlog) { skip = true; this._acc = backlog; }
    while (this._acc >= TICK_MS) {
      this._acc -= TICK_MS;
      const prev = this.currentTick;
      this.currentTick++;
      // 接触集按帧重算：先清空， simulate 内重新登记，随后据此判定「脱离接触」事件
      for (const e2 of this.entities) { if (e2._voxelContacts && e2._voxelContacts.length) e2._voxelContacts.length = 0; }
      this._guard("物理", () => this._simulate());
      this._guard("方块脱离", () => this._settleVoxelSeparate());
      this._guard("方块脏区", () => this._flushVoxelDirty());
      this._guard("区域", () => this._stepZones());
      this._guard("环境", () => this._stepEnvironment());
      this._guard("定时器", () => this._stepTimers());
      this._guard("onTick", () => this._channels.Tick.fire(this._tickEvent(prev, skip)));
      skip = false;
    }
    const dt = clamp(real / 1000, 0, 0.05);
    this._updateCamera(dt);
    this._updateEntitiesVisual(dt);
    this._updateZonesVisual();
    if (this._oldOnRender) this._oldOnRender(dt);
    this._applyEnvironment();
    this._updateHud(dt);
  }
  _tickEvent(prevTick, skip) {
    return { tick: this.currentTick, prevTick, skip: !!skip, elapsedTimeMS: this.currentTick * TICK_MS };
  }
  _guard(label, fn) {
    try { fn(); } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (!this._guardWarned) this._guardWarned = new Set();
      consoleDiv(this.hud && this.hud.console, `${label} 出错: ${msg}`, "err");
      if (!this._guardWarned.has(msg)) { this._guardWarned.add(msg); console.error(`[GameAPI] ${label}`, err); }
    }
  }

  /* ---------------- 物理（官方逐 tick 单位制） ---------------- */
  _simulate() {
    const p = this.player, ent = this.playerEntity;
    this._rebuildSolids();
    if (p && ent && !ent.destroyed) this._stepPlayer(p, ent);
    for (const e2 of [...this.entities]) {
      if (e2.destroyed || e2.isPlayer || e2.fixed || !e2.collides) continue;
      this._stepBody(e2);
    }
    this._syncEntityContacts();
  }
  // 参与碰撞的实体是实心盒：玩家会被挡住、能站上去，非 fixed 的可被推动。
  // 官方场景模型即实体（本图 199 个），所以每帧只缓存一次 AABB。
  _rebuildSolids() {
    const out = [];
    for (const e2 of this.entities) {
      if (e2.destroyed || e2.isPlayer || !e2.collides) continue;
      const b = e2.bounds;
      if (!b || !b.x || !b.y || !b.z) continue;
      const o = e2.anchorOffset;
      out.push({ ent: e2, x: e2.position.x + (o ? o.x : 0), y: e2.position.y + (o ? o.y : 0), z: e2.position.z + (o ? o.z : 0), bx: Math.abs(b.x), by: Math.abs(b.y), bz: Math.abs(b.z) });
    }
    this._solids = out;
  }
  // 玩家盒：position 是脚底，半宽 half、高 height；实体盒 position 是中心
  // 官方碰撞过滤器：命中的实体对不再互相碰撞。以前只写进数组没人读，属于「看起来已实现的假接口」
  _collisionFiltered(a, b) {
    const list = this._collisions || [];
    if (!list.length || !a || !b) return false;
    for (const [sa, sb] of list) {
      if ((matchSelector(sa, a) && matchSelector(sb, b)) || (matchSelector(sa, b) && matchSelector(sb, a))) return true;
    }
    return false;
  }
  _solidsNear(x, y, z, half, height, exclude) {
    const out = [];
    for (const s of this._solids || []) {
      if (s.ent === exclude) continue;
      if (exclude && this._collisionFiltered(exclude, s.ent)) continue;
      if (Math.abs(s.x - x) > s.bx + half) continue;
      if (Math.abs(s.z - z) > s.bz + half) continue;
      if (y + height <= s.y - s.by || y >= s.y + s.by) continue;
      out.push(s);
    }
    return out;
  }
  // 推动：把实体沿同一轴挪一步；它自己被方块挡住就推不动
  _pushSolid(s, axis, amt) {
    if (s.ent.fixed || !(s.ent.mass > 0)) return false;
    const e2 = s.ent, p = e2.position;
    const nx = axis === "x" ? p.x + amt : p.x;
    const ny = axis === "y" ? p.y + amt : p.y;
    const nz = axis === "z" ? p.z + amt : p.z;
    if (this._boxHitsVoxel(nx, ny - s.by, nz, s.bx, s.by * 2)) return false;
    p.set(nx, ny, nz);
    e2._driven = true;
    return true;
  }
  // 官方 GameEntityContact{other,force,axis} + onEntityContact/onEntitySeparate（世界与实体两级）
  _syncEntityContacts() {
    const list = this.entities.filter((e2) => !e2.destroyed);
    if (list.length < 2) return;
    const now = new Map(list.map((a) => [a, new Set()]));
    const ZERO = new GameVector3();
    // 官方实体可达数百个（场景模型即实体）：先算一次 AABB 再按 X 轴扫描剪枝，避免 O(n²)
    // 盒心与 _rebuildSolids 同口径：position + anchorOffset（漏掉偏移会把接触算到隔壁实体上）
    const c = (a) => { const o = a.anchorOffset; return [a.position.x + (o ? o.x : 0), a.position.y + (o ? o.y : 0), a.position.z + (o ? o.z : 0)]; };
    const box = list.map((a) => { const [px, py, pz] = c(a); return [a, px - a.bounds.x, px + a.bounds.x,
      py - a.bounds.y, py + a.bounds.y, pz - a.bounds.z, pz + a.bounds.z]; });
    box.sort((p, q) => p[1] - q[1]);
    for (let i = 0; i < box.length; i++) {
      const a = box[i];
      for (let j = i + 1; j < box.length; j++) {
        const b = box[j];
        if (b[1] > a[2]) break;
        if (b[3] > a[4] || b[4] < a[3]) continue; // Y 轴不相交
        if (b[5] > a[6] || b[6] < a[5]) continue; // Z 轴不相交
        now.get(a[0]).add(b[0]); now.get(b[0]).add(a[0]);
      }
    }
    for (const a of list) {
      const prev = a._prevEntContacts || new Set();
      const cur = now.get(a);
      const axis = a.velocity.mag() > 0 ? a.velocity.clone().normalize() : ZERO;
      for (const b of cur) if (!prev.has(b)) {
        const force = new GameVector3(Math.abs(b.mass || 1) * Math.abs(a.velocity.x || 0), 0, Math.abs(b.mass || 1) * Math.abs(a.velocity.z || 0));
        a._entityContacts.push({ other: b, force, axis });
        const ev = { tick: this.currentTick, entity: a, other: b, axis, force };
        a._channels.EntityContact.fire(ev);
        this._channels.EntityContact.fire(ev);
      }
      for (const b of prev) if (!cur.has(b)) {
        a._entityContacts = a._entityContacts.filter((c) => c.other !== b);
        const ev = { tick: this.currentTick, entity: a, other: b, axis, force: ZERO };
        a._channels.EntitySeparate.fire(ev);
        this._channels.EntitySeparate.fire(ev);
      }
      a._prevEntContacts = cur;
    }
  }
  _wishVector(p, yaw) {
    const k = this._keys, joy = this._joy || { x: 0, y: 0 };
    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: -fwd.z, z: fwd.x };
    let vf = (k.w ? 1 : 0) - (k.s ? 1 : 0) + (-joy.y);
    let vr = (k.d ? 1 : 0) - (k.a ? 1 : 0) + joy.x;
    if (p.swapInputDirection) { const t = vf; vf = vr; vr = -t; }
    const rev = p.reverseInputDirection;
    if (rev === GameInputDirection.VERTICAL || rev === GameInputDirection.BOTH) vf = -vf;
    if (rev === GameInputDirection.HORIZONTAL || rev === GameInputDirection.BOTH) vr = -vr;
    const dis = p.disableInputDirection;
    if (dis === GameInputDirection.BOTH || dis === GameInputDirection.VERTICAL) vf = 0;
    if (dis === GameInputDirection.BOTH || dis === GameInputDirection.HORIZONTAL) vr = 0;
    let x = fwd.x * vf + right.x * vr, z = fwd.z * vf + right.z * vr;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z, moving: len > 1e-6 };
  }
  _stepPlayer(p, ent) {
    const wish = this._wishVector(p, this._yaw);
    const swimming = this._inFluid(ent, p.scale);
    const flying = !!p.flying && p.canFly && !swimming;
    const sprint = this._keys.shift && !this._keys.ctrl && p.runButton !== false;
    const crouch = this._keys.ctrl && p.enableCrouch && !flying && !swimming;
    const speed = flying ? p.flySpeed : swimming ? p.swimSpeed : crouch ? p.crouchSpeed : sprint ? p.runSpeed : p.walkSpeed;
    const accel = flying ? p.flyAcceleration : swimming ? p.swimAcceleration : crouch ? p.crouchAcceleration
      : sprint ? p.runAcceleration : p.walkAcceleration;
    let vy = this._vy;
    if (flying) {
      const wantY = (this._keys.space ? 1 : 0) - (this._keys.ctrl ? 1 : 0);
      vy += (wantY * speed - vy) * clamp(p.flyAcceleration * 0.25, 0, 1);
    } else if (swimming) {
      vy += this.gravity * 0.22;
      if (this._keys.space) vy += p.swimAcceleration * 0.9;
      vy = clamp(vy, -p.swimSpeed, p.swimSpeed * 1.4);
    } else {
      const rising = vy > 0 && this._jumpPhase;
      vy += this.gravity * (rising ? p.jumpAccelerationFactor : 1);
      vy *= 1 - this.airFriction;
    }
    if (vy < -3) vy = -3; // 终端速度
    const blend = clamp(accel, 0, 1);
    if (wish.moving) {
      ent.velocity.x += (wish.x * speed - ent.velocity.x) * blend;
      ent.velocity.z += (wish.z * speed - ent.velocity.z) * blend;
    } else {
      const damp = flying ? 0.85 : swimming ? 0.85 : crouch ? 0.55 : 0.6;
      ent.velocity.x *= damp;
      ent.velocity.z *= damp;
      if (Math.abs(ent.velocity.x) < 1e-4) ent.velocity.x = 0;
      if (Math.abs(ent.velocity.z) < 1e-4) ent.velocity.z = 0;
    }
    // 跳跃 / 二段跳
    this._coyote = this._grounded ? 0.12 : Math.max(0, this._coyote - TICK_MS / 1000);
    this._jumpBuf = Math.max(0, this._jumpBuf - TICK_MS / 1000);
    if (this._jumpBuf > 0 && !flying && p.enableJump) {
      if ((this._grounded || this._coyote > 0) && p.jumpPower > 0) {
        vy = p.jumpPower;
        this._jumpPhase = true;
        this._jumpBuf = 0;
        this._coyote = 0;
        this._doubleJumpUsed = false;
        ent.velocity.x *= p.jumpSpeedFactor;
        ent.velocity.z *= p.jumpSpeedFactor;
        this._fireButtonEvent(GameButtonType.JUMP);
      } else if (this._doubleJumpButton && p.enableDoubleJump && !this._doubleJumpUsed && p.doubleJumpPower > 0) {
        vy = p.doubleJumpPower;
        this._doubleJumpUsed = true;
        this._fireButtonEvent(GameButtonType.DOUBLE_JUMP);
        this._playAt(p.doubleJumpSound, ent.position);
      } else if ((this._grounded || this._coyote > 0) && p.jumpPower <= 0) {
        // 地图脚本把 jumpPower 设成 0 是合法的官方玩法（赛车模板就用跳跃键吃加速道具）。
        // 但按下去毫无反应会被当成"游戏坏了"，所以说明一句是谁关的、为什么。节流 4 秒。
        this._jumpBuf = 0;
        const now = performance.now();
        if (!this._jumpBlockedAt || now - this._jumpBlockedAt > 4000) {
          this._jumpBlockedAt = now;
          this.toast("这张地图的脚本关掉了跳跃（player.jumpPower = 0）");
        }
      }
    }
    this._doubleJumpButton = false;
    if (vy <= 0) this._jumpPhase = false;
    this._vy = vy;
    ent.velocity.y = vy;
    const half = 0.3 * (p.scale || 1), height = 1.8 * (p.scale || 1);
    const wasGrounded = this._grounded, prevVy = vy;
    const res = this._moveEntity(ent, ent.velocity.x, ent.velocity.y, ent.velocity.z, half, height, p.spectator, p);
    this._grounded = res.grounded;
    if (res.blockedX) ent.velocity.x = 0;
    if (res.blockedZ) ent.velocity.z = 0;
    if (res.blockedY) this._vy = 0;
    // 弹跳垫 / 传送带（须在 blockedY 归零之后应用，否则落地会把弹速清掉）
    const fx = res.footFx;
    if (fx && !p.spectator) {
      if (fx.y) { this._vy = Math.max(this._vy, fx.y); this._jumpPhase = false; this._grounded = false; }
      if (fx.x || fx.z) { ent.position.x += fx.x; ent.position.z += fx.z; }
    }
    ent.velocity.y = this._vy;
    if (this._grounded && !wasGrounded && prevVy < -0.5) {
      this._landShake = Math.min(0.25, Math.abs(prevVy) * 0.06);
      this._playAt(p.landSound, ent.position);
    }
    if (flying) p.moveState = GamePlayerMoveState.FLYING;
    else if (swimming) p.moveState = GamePlayerMoveState.SWIM;
    else if (this._grounded) p.moveState = GamePlayerMoveState.GROUND;
    else if (vy > 0) p.moveState = this._doubleJumpUsed ? GamePlayerMoveState.DOUBLE_JUMP : GamePlayerMoveState.JUMP;
    else p.moveState = GamePlayerMoveState.FALL;
    p.walkState = !wish.moving ? (crouch ? GamePlayerWalkState.CROUCH : GamePlayerWalkState.NONE)
      : crouch ? GamePlayerWalkState.CROUCH : sprint ? GamePlayerWalkState.RUN : GamePlayerWalkState.WALK;
    if (wish.moving && this._grounded && !swimming) {
      this._stepAccum += Math.hypot(ent.velocity.x, ent.velocity.z);
      if (this._stepAccum > 0.55) { this._stepAccum = 0; this._playAt(p.stepSound, ent.position); }
    }
    p.facingDirection = new GameVector3(Math.sin(this._yaw), 0, Math.cos(this._yaw));
    // 官方表现：角色朝实际移动方向转身，没有横向速度时才跟镜头同向。
    // RELATIVE 是「镜头相对身体固定」：身体刚性对齐镜头，否则侧移之后身体与镜头会错开。
    if (ent._lookYaw != null) ent._obj.rotation.y = ent._lookYaw;
    else {
      const vx = ent.velocity.x, vz = ent.velocity.z;
      if (p.cameraMode === GameCameraMode.RELATIVE) ent._faceYaw = this._yaw;
      else if (vx * vx + vz * vz > 1e-4) {
        const want = Math.atan2(vx, vz);
        const cur = ent._faceYaw == null ? want : ent._faceYaw;
        let d = want - cur;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        ent._faceYaw = cur + d * 0.28;
      } else if (ent._faceYaw == null) ent._faceYaw = this._yaw;
      ent._obj.rotation.y = ent._faceYaw;
    }
    if (p.movementBounds) {
      // 官方语义是「移动边界」：越界应当被夹回界内并清掉朝外速度，而不是把人扔回出生点
      const mb = p.movementBounds, q = ent.position;
      let clamped = false;
      for (const ax of ["x", "y", "z"]) {
        if (q[ax] < mb.lo[ax]) { q[ax] = mb.lo[ax]; clamped = true; }
        else if (q[ax] > mb.hi[ax]) { q[ax] = mb.hi[ax]; clamped = true; }
      }
      if (clamped) { ent.velocity.set(0, 0, 0); this._vy = 0; }
    }
    // 掉出世界（y<0，世界底就是 0）立刻回到出生点，与 movementBounds 是两回事
    if (ent.position.y < 0) this._respawn();
  }
  _stepBody(e2) {
    if (e2.gravity) e2.velocity.y += this.gravity;
    e2.velocity.x *= 1 - this.airFriction;
    e2.velocity.z *= 1 - this.airFriction;
    const b = e2.bounds;
    const by = Math.abs(b.y), yOff = -by; // 实体 position 是盒心，碰撞盒底在 position.y - 半高
    const res = this._moveEntity(e2, e2.velocity.x, e2.velocity.y, e2.velocity.z, Math.abs(b.x), by * 2, false, null, yOff);
    const rest = e2.restitution || 0;
    if (res.blockedY) {
      e2.velocity.y = Math.abs(e2.velocity.y) * rest * 0.5 > 0.02 ? -e2.velocity.y * rest : 0;
      e2._groundedVox = true;
    }
    if (res.blockedX) e2.velocity.x = -e2.velocity.x * rest;
    if (res.blockedZ) e2.velocity.z = -e2.velocity.z * rest;
    const foot = this._footFx(e2);
    if (foot) {
      e2.velocity.x += foot.x;
      e2.velocity.y += foot.y;
      e2.velocity.z += foot.z;
    }
  }
  // yOff：碰撞盒底相对 ent.position 的偏移。玩家 position 就是脚底（0），
  // 实体 position 是盒心（-半高），漏掉这个偏移会让实体盒整体上移一格、该挡的不挡。
  _moveEntity(ent, dx, dy, dz, half, height, ghost, player, yOff = 0) {
    const out = { grounded: false, blockedX: false, blockedY: false, blockedZ: false, remX: 0, remZ: 0 };
    if (ghost) {
      ent.position.x += dx; ent.position.y += dy; ent.position.z += dz;
      return out;
    }
    const base = (y) => y + yOff;
    const apply = (axis, amt) => {
      const p = ent.position;
      const nx = axis === "x" ? p.x + amt : p.x;
      const ny = axis === "y" ? p.y + amt : p.y;
      const nz = axis === "z" ? p.z + amt : p.z;
      const hit = this._boxHitsVoxel(nx, base(ny), nz, half, height);
      if (hit) {
        if (player) this._emitVoxelContact(ent, hit, axis, amt);
        return true;
      }
      const solids = this._solidsNear(nx, base(ny), nz, half, height, ent);
      if (solids.length) {
        if (axis !== "y") for (const s of solids) this._pushSolid(s, axis, amt);
        const left = this._solidsNear(nx, base(ny), nz, half, height, ent);
        if (left.length) {
          if (axis === "y" && amt < 0) {
            let top = -Infinity;
            for (const s of left) top = Math.max(top, s.y + s.by);
            p.y = top - yOff;
          }
          return true;
        }
      }
      p.set(nx, ny, nz); return false;
    };
    // 子步推进：返回是否被挡住，并把没走完的余量记进 out，供踏步时续走（而不是重发整段）
    const travel = (axis, amt) => {
      const rem = axis === "x" ? "remX" : axis === "z" ? "remZ" : null; // Y 没有余量语义，别串台
      if (!amt) return false;
      let left = Math.abs(amt);
      const dir = Math.sign(amt);
      while (left > 1e-6) {
        const s = Math.min(left, 0.15);
        if (apply(axis, dir * s)) { if (rem) out[rem] = dir * left; return true; }
        left -= s;
      }
      if (rem) out[rem] = 0;
      return false;
    };
    out.blockedY = travel("y", dy);
    out.grounded = out.blockedY ? dy < 0 : this._groundProbe(ent, half, height, yOff);
    out.blockedX = travel("x", dx);
    out.blockedZ = travel("z", dz);
    if (out.grounded && (out.blockedX || out.blockedZ)) {
      // 自动踏步：抬升同样走子步，撞不到东西才继续；过不去就原样退回，绝不白送高度
      const y0 = ent.position.y, yTop = y0 + STEP_UP;
      let wall = false;
      while (ent.position.y < yTop - 1e-6) {
        if (apply("y", Math.min(0.15, yTop - ent.position.y))) { wall = true; break; }
      }
      if (wall) apply("y", -(ent.position.y - y0));
      else {
        const bx = travel("x", out.remX), bz = travel("z", out.remZ);
        if (bx && bz) apply("y", -(ent.position.y - y0));
        else {
          out.blockedX = bx; out.blockedZ = bz;
          let down = ent.position.y - y0;
          while (down > 1e-6) { if (apply("y", -Math.min(0.1, down))) break; down -= 0.1; }
          out.grounded = this._groundProbe(ent, half, height, yOff);
          if (player && out.grounded) this._vy = Math.max(0, this._vy);
        }
      }
    }
    out.footFx = this._footFx(ent);
    const fluids = this._fluidOverlap(ent, half, height, yOff);
    if (player) this._syncFluidContacts(ent, fluids, player);
    else this._syncFluidContacts(ent, fluids, null);
    return out;
  }
  // 脚下格子的玩法效果：官方 block-spec 的 velocity（弹跳垫 [0,1.25,0]、传送带 [-0.25,0,0]），
  // 方向按方块旋转码绕 Y 旋转；站立接触有 ±0.26 格的容差。
  _footFx(ent) {
    const w = this.e.world;
    const x = Math.floor(ent.position.x), z = Math.floor(ent.position.z);
    for (const d of [0.02, 0.14, 0.26]) {
      const y = Math.floor(ent.position.y - d);
      if (!w.inBounds(x, y, z)) continue;
      const id = w.get(x, y, z);
      if (!id) continue;
      const b = this._block(id);
      if (b && b.velocity) {
        const v = rotateVecByTurn(b.velocity, w.getRot(x, y, z));
        return { x: v[0], y: v[1], z: v[2] };
      }
      return null;
    }
    return null;
  }
  _boxHitsVoxel(x, y, z, half, height) {
    const w = this.e.world;
    const x0 = Math.floor(x - half), x1 = Math.floor(x + half);
    const y0 = Math.floor(y + 0.001), y1 = Math.floor(y + height - 0.001);
    const z0 = Math.floor(z - half), z1 = Math.floor(z + half);
    for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) {
      const id = this._solidAt(bx, by, bz);
      if (id) return { x: bx, y: by, z: bz, id };
    }
    return null;
  }
  _solidAt(x, y, z) {
    const w = this.e.world;
    if (x < 0 || y < 0 || z < 0 || x >= w.shape[0] || y >= w.shape[1] || z >= w.shape[2]) return 0;
    const id = w.get(x, y, z);
    if (!id) return 0;
    const b = this._block(id);
    if (!b) return id;
    return b.fluid ? 0 : id; // 官方 block-spec：glass/ice/barrier 都是 transparent 却挡人，只有 fluid（含 air）不挡
  }
  _fluidAt(x, y, z) {
    const w = this.e.world;
    if (x < 0 || y < 0 || z < 0 || x >= w.shape[0] || y >= w.shape[1] || z >= w.shape[2]) return 0;
    const id = w.get(x, y, z);
    if (!id) return 0;
    const b = this._block(id);
    return b && b.fluid ? id : 0;
  }
  _fluidOverlap(ent, half, height, yOff = 0) {
    const out = [], seen = new Set();
    const fy = ent.position.y + yOff;
    const x0 = Math.floor(ent.position.x - half), x1 = Math.floor(ent.position.x + half);
    const y0 = Math.floor(fy), y1 = Math.floor(fy + height);
    const z0 = Math.floor(ent.position.z - half), z1 = Math.floor(ent.position.z + half);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const id = this._fluidAt(x, y, z);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ x, y, z, voxel: id, volume: 1 });
    }
    return out;
  }
  _inFluid(ent, scale) {
    const s = scale || 1;
    return this._fluidAt(Math.floor(ent.position.x), Math.floor(ent.position.y + 0.9 * s), Math.floor(ent.position.z)) > 0;
  }
  _syncFluidContacts(ent, fluids, player) {
    const prevIds = new Set(ent._prevFluidContacts.map((c) => c.voxel));
    const nowIds = new Set(fluids.map((c) => c.voxel));
    for (const c of fluids) if (!prevIds.has(c.voxel)) {
      const ev = { tick: this.currentTick, entity: ent, voxel: c.voxel };
      ent._channels.FluidEnter.fire(ev);
      this._channels.FluidEnter.fire(ev);
      if (player) this._playAt(player.enterWaterSound, ent.position);
    }
    for (const c of ent._prevFluidContacts) if (!nowIds.has(c.voxel)) {
      const ev = { tick: this.currentTick, entity: ent, voxel: c.voxel };
      ent._channels.FluidLeave.fire(ev);
      this._channels.FluidLeave.fire(ev);
      if (player) this._playAt(player.leaveWaterSound, ent.position);
    }
    ent._fluidContacts = fluids;
    ent._prevFluidContacts = fluids;
  }
  _emitVoxelContact(ent, hit, axis, amt) {
    const a = { x: 0, y: 0, z: 0 };
    a[axis] = -Math.sign(amt);
    const key = `${hit.x},${hit.y},${hit.z}`;
    if (!ent._voxelContacts.some((v) => `${v.x},${v.y},${v.z}` === key)) {
      const c = { x: hit.x, y: hit.y, z: hit.z, voxel: hit.id, force: new GameVector3(0, Math.abs(amt) * (ent.mass || 1), 0), axis: new GameVector3(a.x, a.y, a.z) };
      ent._voxelContacts.push(c);
      const ev = { tick: this.currentTick, entity: ent, ...c };
      ent._channels.VoxelContact.fire(ev);
      this._channels.VoxelContact.fire(ev);
    }
    ent._voxelContacts = ent._voxelContacts.slice(-16);
    ent._voxelSeen = ent._voxelSeen || new Set();
    ent._voxelSeen.add(key);
  }
  // 官方 onVoxelSeparate：曾经接触过的方块这一帧不再接触才算脱离；不做追踪就是条死通道
  _settleVoxelSeparate() {
    for (const ent of this.entities) {
      if (!ent._voxelSeen || !ent._voxelSeen.size) continue;
      const live = new Set(ent._voxelContacts.map((c) => `${c.x},${c.y},${c.z}`));
      for (const key of [...ent._voxelSeen]) {
        if (live.has(key)) continue;
        ent._voxelSeen.delete(key);
        const [x, y, z] = key.split(",").map(Number);
        const ev = { tick: this.currentTick, entity: ent, x, y, z, voxel: this.e.world.get(x, y, z) };
        ent._channels.VoxelSeparate.fire(ev);
        this._channels.VoxelSeparate.fire(ev);
      }
    }
  }
  _groundProbe(ent, half, height, yOff = 0) {
    const y = ent.position.y + yOff;
    if (this._boxHitsVoxel(ent.position.x, y - 0.02, ent.position.z, half, height)) return true;
    return this._solidsNear(ent.position.x, y - 0.02, ent.position.z, half, height, ent).length > 0;
  }
  _block(id) { return this.e.atlas.byId(baseId(id)); }
  _respawn(reason) {
    const p = this.player, ent = this.playerEntity;
    const sp = p.spawnPoint;
    const top = this._topAt(sp.x, sp.z);
    ent.position.set(sp.x || top[0] + 0.5, sp.y || top[1] + 0.02, sp.z || top[2] + 0.5);
    this._vy = 0;
    this._grounded = false;
    ent.velocity.set(0, 0, 0);
    ent.hp = ent.maxHp;
    p.dead = false;
    this._playAt(p.spawnSound, ent.position);
    this._chatLine(reason === "死亡" ? "你倒下了，已回到出生点" : reason === "手动" ? "已回到出生点" : "掉出世界，已回到出生点", "#ffd9a8");
    const ev = { tick: this.currentTick, entity: ent };
    p._channels.Respawn.fire(ev);
    this._channels.Respawn.fire(ev);
  }

  /* ---------------- 相机 ---------------- */
  _updateCamera(dt) {
    const r = this.e.renderer, p = this.player, ent = this.playerEntity;
    if (!p || !ent) return;
    const k = clamp(dt * 22, 0, 1);
    this._yaw += (this._tYaw - this._yaw) * k;
    this._pitch += (this._tPitch - this._pitch) * k;
    const euler = new THREE.Euler(this._pitch, this._yaw, 0, "YXZ");
    r.camera.quaternion.setFromEuler(euler);
    p.cameraYaw = this._yaw;
    p.cameraPitch = this._pitch;
    const eye = EYE_HEIGHT * (p.scale || 1);
    let cx = ent.position.x, cy = ent.position.y + eye, cz = ent.position.z;
    if (this._grounded && p.walkState === GamePlayerWalkState.RUN) { this._bob += dt * 11; cy += Math.sin(this._bob) * 0.03; }
    else if (this._grounded && p.walkState === GamePlayerWalkState.WALK) { this._bob += dt * 8; cy += Math.sin(this._bob) * 0.016; }
    if (this._landShake > 0.004) {
      cy += (Math.random() - 0.5) * this._landShake;
      this._landShake *= Math.pow(0.02, dt);
    }
    const mode = p.cameraMode;
    if (mode === GameCameraMode.FOLLOW || mode === GameCameraMode.RELATIVE) {
      const dir = new THREE.Vector3();
      r.camera.getWorldDirection(dir);
      const tgt = (p.cameraEntity && p.cameraEntity !== ent && p.cameraEntity.position)
        ? p.cameraEntity.position : new GameVector3(cx, cy, cz);
      let dist = p.cameraDistance;
      const back = this._raycast(tgt, { x: -dir.x, y: -dir.y, z: -dir.z }, { maxDistance: dist + 0.6, ignoreFluid: true });
      // 贴墙时把镜头收到墙外：0.8 的硬下限会让镜头留在几何体里（穿模），只保留一个很小的贴身下限。
      // 收得越紧就越往上抬成「过肩」，否则人物会顶满画面、看不见前面的路。
      let lift = 0;
      if (back.hit) {
        dist = Math.min(dist, Math.max(0.22, back.distance - 0.24));
        lift = clamp((2.4 - dist) * 0.34, 0, 0.85);
      }
      r.camera.position.set(tgt.x - dir.x * dist, tgt.y - dir.y * dist + lift, tgt.z - dir.z * dist);
      if (lift > 0.02) r.camera.lookAt(tgt.x, tgt.y + lift * 0.55, tgt.z);
    } else if (mode === GameCameraMode.FPS) {
      r.camera.position.set(cx, cy, cz);
    } else if (mode === GameCameraMode.FIXED) {
      const cp = toVec3(p.cameraPosition), ct = toVec3(p.cameraTarget), up = toVec3(p.cameraUp, new GameVector3(0, 1, 0));
      r.camera.position.set(cp.x, cp.y, cp.z);
      r.camera.up.set(up.x, up.y, up.z);
      r.camera.lookAt(ct.x, ct.y, ct.z);
    }
    if (mode !== GameCameraMode.FIXED) {
      // cameraFovY 官方默认 0.25（垂直视场角），按半圈比例换算为度：0.25 → 45°
      const deg = clamp((p.cameraFovY || PLAYER_DEFAULTS.cameraFovY) * 180, 20, 150);
      if (Math.abs(r.camera.fov - deg) > 0.02) { r.camera.fov = deg; r.camera.updateProjectionMatrix(); }
    }
    const headId = this._fluidAt(Math.floor(r.camera.position.x), Math.floor(r.camera.position.y), Math.floor(r.camera.position.z));
    this._underWater = !!headId;
    // 官方表现：镜头浸到哪种流体就用哪种颜色染色（岩浆红、水蓝、牛奶白…）
    const fb = headId ? this._block(baseId(headId)) : null;
    const fc = fb && fb.fluidColor ? (fb.fluidColor[0] << 16 | fb.fluidColor[1] << 8 | fb.fluidColor[2]) : null;
    r.setUnderwater && r.setUnderwater(this._underWater, fc == null ? 0x1b6f8f : fc);
  }
  raycastFromEyes(maxDist) {
    const r = this.e.renderer;
    const dir = new THREE.Vector3();
    r.camera.getWorldDirection(dir);
    const o = r.camera.position;
    return this._raycast({ x: o.x, y: o.y, z: o.z }, { x: dir.x, y: dir.y, z: dir.z }, { maxDistance: maxDist || 6 });
  }
  _updateEntitiesVisual(dt) {
    for (const e2 of this.entities) {
      if (e2.destroyed || !e2._obj) continue;
      // 编辑器里的场景模型由编辑器摆位；一旦被运行时驱动（重力/被推动）就跟随实体位置
      if (!e2._external || e2._driven) e2._obj.position.set(e2.position.x, e2.position.y, e2.position.z);
      if (e2._mixer) e2._mixer.update(dt);
      else if (e2._motionPlaying && !e2._external) e2._obj.rotation.y += dt * 1.2;
      this._stepParticles(e2, dt);
      this._syncEntityVisibility(e2);
      this._updateAvatar(e2, dt);
    }
  }
  _updateAvatar(ent, dt) {
    const av = ent._avatar;
    if (!av) return;
    const parts = av.userData.parts;
    const p = ent.player;
    const st = p ? p.walkState : "";
    this._animT = (this._animT || 0) + dt * (st === GamePlayerWalkState.RUN ? 11 : 7);
    const amp = st === GamePlayerWalkState.RUN ? 0.7 : st === GamePlayerWalkState.WALK ? 0.45 : 0;
    const s = Math.sin(this._animT) * amp;
    parts.legL.rotation.x = s;
    parts.legR.rotation.x = -s;
    parts.armL.rotation.x = -s * 0.8;
    parts.armR.rotation.x = s * 0.8;
    if (p && p.moveState === GamePlayerMoveState.FLYING) { parts.armL.rotation.z = -1.4; parts.armR.rotation.z = 1.4; }
    else { parts.armL.rotation.z = 0; parts.armR.rotation.z = 0; }
    // 官方把 color/metalness/emissive/shininess 归到「显示」类：脚本里赋值就要立刻看到
    if (p) {
      const cc = p.color ? colorTriple(p.color) : [1, 1, 1];
      const key = `${cc[0]},${cc[1]},${cc[2]}|${p.metalness || 0}|${p.emissive || 0}|${p.shininess || 0}`;
      if (av.userData._lookKey !== key) { av.userData._lookKey = key; this._applySkinLook(p, ent); }
    }
  }
  _syncEntityVisibility(ent) {
    if (!ent._obj) return;
    if (ent.isPlayer) {
      const p = this.player;
      // 第一/固定镜头看不见自己的身体；player.invisible 只隐藏人物本体，
      // 换成载具 mesh 之后载具仍要可见 —— 否则「上车」就变成凭空消失
      const camHides = p.cameraMode === GameCameraMode.FPS || p.cameraMode === GameCameraMode.FIXED;
      const hasMesh = !!(ent._meshName && ent._meshHolder && ent._meshHolder.children.length);
      if (ent._avatar) {
        ent._avatar.visible = !p.invisible && !camHides && !hasMesh;
        // player.scale 只作用于人物本体；载具 mesh 用 meshScale 独立控制，不能被二次缩放
        const ps = p.scale || 1;
        if (Math.abs(ent._avatar.scale.x - ps) > 1e-4) ent._avatar.scale.setScalar(ps);
      }
      if (ent._meshHolder) ent._meshHolder.visible = !ent.meshInvisible && !camHides;
      const av = ent._avatar ? ent._avatar.visible : false;
      const mh = ent._meshHolder ? ent._meshHolder.visible : false;
      ent._obj.visible = av || mh;
      ent._obj.position.set(ent.position.x, ent.position.y, ent.position.z);
      return;
    }
    ent._obj.visible = !ent.meshInvisible;
    if (!ent._external) ent._obj.position.set(ent.position.x, ent.position.y, ent.position.z);
    if (ent._obj.visible && !ent._external && ent._lookYaw != null) ent._obj.rotation.y = ent._lookYaw;
  }

  /* ---------------- 区域 ---------------- */
  _addZone(cfg) {
    const rt = this;
    const z = {
      bounds: cfg.bounds instanceof GameBounds3 ? cfg.bounds : new GameBounds3(toVec3(cfg.min || cfg.lo), toVec3(cfg.max || cfg.hi)),
      selector: cfg.selector || "player",
      massScale: cfg.massScale ?? 1,
      force: toVec3(cfg.force, new GameVector3()),
      _occupants: new Set(),
      _removed: false,
    };
    // 官方 GameZoneConfig 的环境覆盖键很多且会增补，按前缀通配带上，避免白名单漏键
    for (const k of Object.keys(cfg)) if (/^(fog|rain|snow|sky)[A-Z]/.test(k)) z[k] = cfg[k];
    if (cfg.name != null) z.name = cfg.name;
    if (cfg.id != null) z.id = cfg.id;
    z._channels = attachChannels(z, ["Enter", "Leave"]);
    z.entities = () => [...z._occupants];
    z.remove = () => {
      if (z._removed) return;
      z._removed = true;
      rt.zones = rt.zones.filter((x) => x !== z);
    };
    rt.zones.push(z);
    return z;
  }
  _stepZones() {
    if (!this.zones.length) return;
    const tick = this.currentTick;
    for (const z of this.zones) {
      if (z._removed) continue;
      const list = this._query(z.selector);
      const inside = new Set();
      for (const e2 of list) {
        if (!z.bounds.intersects(getEntityBounds(e2))) continue;
        inside.add(e2);
        if (!z._occupants.has(e2)) {
          z._occupants.add(e2);
          z._channels.Enter.fire({ tick, entity: e2 });
        }
        const f = z.force;
        if (f && (f.x || f.y || f.z)) {
          // massScale=0 像重力（与质量无关），1 像风（力除以质量）
          const m = z.massScale === 0 ? 1 : Math.max(0.05, (e2.mass || 1) * (z.massScale ?? 1));
          if (e2.isPlayer) {
            if (f.y) this._vy = (this._vy || 0) + f.y / m;
            e2.velocity.x += f.x / m;
            e2.velocity.z += f.z / m;
          } else {
            e2.velocity.x += f.x / m;
            e2.velocity.y += f.y / m;
            e2.velocity.z += f.z / m;
          }
        }
      }
      for (const e2 of [...z._occupants]) if (!inside.has(e2)) {
        z._occupants.delete(e2);
        z._channels.Leave.fire({ tick, entity: e2 });
      }
      z._inside = inside;
    }
  }
  _updateZonesVisual() {
    let env = null;
    for (const z of this.zones) if (z._inside && z._inside.size) env = pickEnv(z) || env;
    this._zoneEnv = env;
  }

  // call/callAsync 的本地落点：没有平台桥接时记一次并回传 undefined，保持官方返回形状
  _bridgeCall(key, value) {
    this._calls = this._calls || [];
    this._calls.push({ key: String(key), value, tick: this.currentTick });
    return undefined;
  }
  // 脚本属于服务端还是客户端，官方由 scriptAssets 的 type 决定（1=服务端、7=客户端）
  _isClientScript(name, entry) {
    if (entry && typeof entry === "object") {
      if (entry.client === true) return true;
      if (entry.type === 7 || entry.type === "client") return true;
      if (entry.type === 1 || entry.type === "server") return false;
    }
    return /client/i.test(String(name));
  }
  // API 批量写方块（官方示例里有 127×127 的循环）不能每格重建一次网格、每格响一次放置音
  _flushVoxelDirty() {
    if (!this._voxelDirty || !this._voxelDirty.size) return;
    const cells = [...this._voxelDirty.values()];
    this._voxelDirty.clear();
    for (const c of cells) this.e.renderer.markDirty(c[0], c[1], c[2]);
  }
  // 引擎托管计时器：随运行结束统一回收，避免脚本回调打到已销毁实体
  _addTimer(fn, ms, repeat) {
    if (typeof fn !== "function") return 0;
    const id = this._timerId++;
    this._timers.set(id, { fn, at: performance.now() + (+ms || 0), repeat: +repeat || 0 });
    return id;
  }
  /* ---------------- 环境 ---------------- */
  // 官方 sunPhase 是 0..1 归一量（0=06:00、0.25=12:00、0.5=18:00、0.75=子夜），
  // 官方推进公式 timeOfDay = (sunPhase + sunFrequency * tick) % 1；太阳方向由相位派生，不用弧度存
  _stepEnvironment() {
    if (this.lightMode === "natural" && this.gameRules.doDaylightCycle !== false) {
      this.sunPhase = ((this.sunPhase + this.sunFrequency * (this.timeScale || 1)) % 1 + 1) % 1;
      this.lunarPhase = (this.sunPhase + 0.5) % 1;
      this.time = ((this.sunPhase + 0.25) * 24000) % 24000;
    }
    if (!this._sunDirFixed) {
      const th = (this.sunPhase - 0.25) * Math.PI * 2;
      this.sunDirection = new GameVector3(Math.sin(th) * 0.55, Math.cos(th), Math.sin(th * 0.5) * 0.3);
    }
    if (this.gameRules.doWeatherCycle !== false) this._stepWeather();
  }
  // doWeatherCycle：每约 60 秒换一次天气目标，雨/雪/雷的密度线性过渡
  _stepWeather() {
    const WX = { clear: [0, 0, 0], rain: [0.8, 0, 0], snow: [0, 0.7, 0], thunder: [0.9, 0, 0.6] };
    if (!this._wx) {
      this._wx = { kind: this.rainDensity > 0.4 ? (this.thunderDensity > 0.2 ? "thunder" : "rain") : this.snowDensity > 0.4 ? "snow" : "clear", next: this.currentTick + 3600 };
    }
    const want = WX[this._wx.kind] || WX.clear;
    this.rainDensity += (want[0] - this.rainDensity) * 0.004;
    this.snowDensity += (want[1] - this.snowDensity) * 0.004;
    this.thunderDensity += (want[2] - this.thunderDensity) * 0.004;
    if (this.currentTick < this._wx.next) return;
    const pool = ["clear", "rain", "snow", "thunder"];
    let k = this._wx.kind;
    while (k === this._wx.kind) k = pool[(Math.random() * pool.length) | 0];
    this._wx.kind = k;
    this._wx.next = this.currentTick + 3600;
    this.say({ clear: "天气放晴", rain: "开始下雨了", snow: "开始下雪了", thunder: "雷阵雨来了" }[k]);
  }
  _applyEnvironment() {
    const r = this.e.renderer;
    const env = this._zoneEnv || {};
    const night = clamp(1 - Math.max(0, this.sunDirection.y) * 2.4, 0, 1);
    r.setTerrain({
      sunDir: [this.sunDirection.x, Math.max(0.05, this.sunDirection.y), this.sunDirection.z],
      sunIntensity: luma(this.sunLight) * (1 - night * 0.9) * 2.6,
      ambient: Number.isFinite(+this.globalLight) ? Math.max(0, Math.min(1, +this.globalLight)) : 0.1 + (1 - night) * 0.18,
      skyTop: rgbHex(this.skyTopLight, night),
      skyBottom: rgbHex(this.skyBottomLight, night),
      skyLeft: rgbHex(this.skyLeftLight, night), skyRight: rgbHex(this.skyRightLight, night),
      skyFront: rgbHex(this.skyFrontLight, night), skyBack: rgbHex(this.skyBackLight, night),
      globalLight: this.globalLight,
      fogColor: rgbHex(this.fogColor, night),
      fogDensity: env.fogEnabled ? (env.fogUniformDensity ?? env.fogDensity ?? this.fogUniformDensity) : this.fogUniformDensity,
      fogStartDistance: env.fogEnabled ? (env.fogStartDistance ?? this.fogStartDistance) : this.fogStartDistance,
      maxFog: env.fogEnabled ? (env.fogMax ?? this.maxFog) : this.maxFog,
      fogHeightOffset: this.fogHeightOffset, fogHeightFalloff: this.fogHeightFalloff,
      glow: 0.9 + night * 0.5,
    });
    r.setWeather({
      rain: env.rainEnabled ? env.rainDensity : this.rainDensity,
      snow: env.snowEnabled ? env.snowDensity : this.snowDensity,
      thunder: this.thunderDensity,
      // 官方雨雪的尺寸/颜色/速度/方向都得进画面，不能只剩密度一个旋钮
      rainColor: env.rainEnabled ? env.rainColor : this.rainColor,
      rainSizeLo: this.rainSizeLo, rainSizeHi: this.rainSizeHi,
      rainSpeed: env.rainSpeed ?? this.rainSpeed, rainDirection: this.rainDirection, rainInterference: this.rainInterference,
      snowColor: env.snowEnabled ? env.snowColor : this.snowColor,
      snowSizeLo: this.snowSizeLo, snowSizeHi: this.snowSizeHi,
      snowFallSpeed: this.snowFallSpeed, snowSpinSpeed: this.snowSpinSpeed, snowTexture: this.snowTexture,
    });
    for (const s of this._sounds) s._applyVolume();
  }

  // 把 skin / skinInvisible 两份官方状态真正落到人偶的 6 块挂点上
  _applySkinLook(p, ent) {
    const av = ent && ent._avatar;
    const parts = av && av.userData && av.userData.parts;
    if (!parts) return;
    const cc = p && p.color ? colorTriple(p.color) : null;
    const tint = cc ? new THREE.Color(cc[0], cc[1], cc[2]) : null;
    const mm = (p && p.metalness) || 0, em = (p && p.emissive) || 0, sh = (p && p.shininess) || 0;
    const state = {};
    for (const part of BODY_PARTS) {
      const slot = PART_SLOT[part];
      if (!slot || !parts[slot]) continue;
      const st = (state[slot] = state[slot] || { hidden: false, color: null });
      if (p.skinInvisible && p.skinInvisible[part]) st.hidden = true;
      const c = skinColorOf(p.skin && p.skin[part]);
      if (c) st.color = c;
    }
    for (const [slot, node] of Object.entries(parts)) {
      const st = state[slot] || {};
      node.visible = !st.hidden;
      // 部件是 Group：染色要落到里面标了 tint 的子网格上。
      // 头发、眼睛、腰带、鞋不带 tint，永远保持自己的颜色——否则 player.color 会把五官涂成一片。
      // 优先级：官方 skin 分部位配色 > player.color（人偶本体色，只作用于上衣）> 材质自带色
      node.traverse((mesh) => {
        if (!mesh.isMesh || !mesh.material) return;
        const mt = mesh.material;
        const kind = mesh.userData.tint;
        // skin[part] 是**具名换肤**，按官方语义整块替换；
        // player.color 是「人偶本体色」，官方默认 [1,1,1]＝不染色，所以只能**叠乘**到
        // 布料底色上。旧写法直接 copy(tint)，于是默认值白色把蓝衬衫冲成灰白——
        // 也就是说这个参数从来没起过它该起的作用，只是悄悄毁掉了原色。
        const base = mesh.userData.baseColor != null ? new THREE.Color(mesh.userData.baseColor) : null;
        let col = null;
        if (st.color && kind) col = st.color.clone();
        else if (slot === "body" && kind === "cloth" && tint && base) col = base.clone().multiply(tint);
        else if (base) col = base;
        if (col) mt.color.copy(col);
        if (!mt.isMeshStandardMaterial) return;
        mt.metalness = mm;
        mt.roughness = clamp01(1 - sh);
        if (mt.emissive) {
          // 材质本身没有自发光色时，只改 emissiveIntensity 是看不见的，得先把颜色点亮
          if (mt.userData._baseEmissive === undefined) mt.userData._baseEmissive = (mt.emissive.r + mt.emissive.g + mt.emissive.b) > 0.001;
          if (!mt.userData._baseEmissive) mt.emissive.setScalar(em > 0 ? 1 : 0);
          mt.emissiveIntensity = em > 0 ? em : 1;
        }
      });
    }
  }

  /* ---------------- 粒子 ---------------- */
  // 官方 particleSize / particleColor 都是「把存活期五等分」的阶段取值（文档默认 [1,1,1,1,1]
  // 与 5×GameRGBColor(1,1,1)），所以尺寸/颜色要按每个粒子自己的生命比例插值。
  // PointsMaterial 只有一个全局 size 做不到，故自带一个极简点精灵 shader（尺寸单位＝屏幕像素）。
  _initParticles(ent) {
    if (ent._points) { // 重复初始化要先回收，否则旧点云会留在场景里继续画
      ent._points.removeFromParent();
      ent._points.geometry.dispose();
      ent._points.material.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uRatio: { value: Math.max(1, window.devicePixelRatio || 1) } },
      vertexShader: `
attribute vec3 aCol;
attribute float aSize;
uniform float uRatio;
varying vec3 vCol;
void main() {
  vCol = aCol;
  gl_PointSize = clamp(aSize * uRatio, 1.0, 256.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: `
varying vec3 vCol;
void main() {
  float a = smoothstep(0.5, 0.28, length(gl_PointCoord - vec2(0.5)));
  if (a < 0.02) discard;
  gl_FragColor = vec4(vCol, a);
}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, mat);
    pts.visible = false;
    pts.frustumCulled = false;
    this.e.renderer.scene.add(pts);
    ent._points = pts;
    ent._pbuf = [];
    ent._pAcc = 0;
  }
  _stepParticles(ent, dt) {
    const pts = ent._points;
    if (!pts) return;
    const rate = ent.particleRate || 0;
    if (rate <= 0) {
      pts.visible = false;
      if (ent._pbuf.length) ent._pbuf.length = 0;
      return;
    }
    pts.visible = true;
    const limit = Math.min(800, ent.particleLimit || 100);
    const buf = ent._pbuf;
    // 官方：每秒产生 [rate, rate+rateSpread) 个；用累加器，否则低速率会被每帧向上取整放大
    ent._pAcc = (ent._pAcc || 0) + (rate + Math.random() * (ent.particleRateSpread || 0)) * dt;
    let make = Math.floor(ent._pAcc);
    ent._pAcc -= make;
    while (make-- > 0 && buf.length < limit) buf.push(newParticle(ent));
    while (buf.length > limit) buf.shift();
    const acc = toVec3(ent.particleAcceleration), damp = ent.particleDamping || 0;
    const noise = ent.particleNoise || 0, nf = ent.particleNoiseFrequency || 1;
    const target = ent.particleTarget, tw = ent.particleTargetWeight || 0;
    const n = buf.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), siz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pr = buf[i];
      pr.t += dt;
      if (pr.t > pr.life) Object.assign(pr, newParticle(ent));
      const k = pr.t / pr.life;
      pr.vx += acc.x * dt; pr.vy += acc.y * dt; pr.vz += acc.z * dt;
      if (noise) {
        const s = Math.sin(pr.t * nf + pr.seed) * noise * dt;
        pr.vx += s; pr.vz -= s;
      }
      if (tw && target && target.position) {
        pr.vx += (target.position.x - pr.x - ent.position.x) * tw * dt;
        pr.vy += (target.position.y - pr.y - ent.position.y) * tw * dt;
        pr.vz += (target.position.z - pr.z - ent.position.z) * tw * dt;
      }
      if (damp) { const d = Math.max(0, 1 - damp * dt); pr.vx *= d; pr.vy *= d; pr.vz *= d; }
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
      pos[i * 3] = ent.position.x + pr.x;
      pos[i * 3 + 1] = ent.position.y + pr.y;
      pos[i * 3 + 2] = ent.position.z + pr.z;
      const c = sampleRamp(ent.particleColor, k) || [1, 0.6, 0.2];
      col[i * 3] = clamp01(c[0]); col[i * 3 + 1] = clamp01(c[1]); col[i * 3 + 2] = clamp01(c[2]);
      const sz = sampleRampNum(ent.particleSize, k);
      siz[i] = Math.max(1, (sz == null ? 6 : sz) + (pr.sizeAdd || 0));
    }
    const g = pts.geometry;
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aCol", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(siz, 1));
    g.setDrawRange(0, n);
  }

  /* ---------------- 网格 / 外观 ---------------- */
  _setMesh(ent, name) {
    ent._meshName = name || "";
    if (!ent._obj) return;
    if (!ent._meshHolder) { ent._meshHolder = new THREE.Group(); ent._obj.add(ent._meshHolder); }
    while (ent._meshHolder.children.length) ent._meshHolder.remove(ent._meshHolder.children[0]);
    ent._mixer = null;
    ent._clips = null;
    if (!name) { this._syncEntityVisibility(ent); return; }
    const base = String(name).replace(/.*[\\/]/, "").replace(/\.(vb|vox|glb|gltf|fbx|obj)$/i, "");
    const asset = (this.assets.meshes || {})[base];
    if (asset && asset.object) {
      const clone = asset.object.clone(true);
      ent._meshHolder.add(clone);
      if (clone.animations && clone.animations.length) {
        ent._clips = clone.animations;
        ent._mixer = new THREE.AnimationMixer(clone);
      }
      this._applyMeshTransform(ent);
      this._syncEntityVisibility(ent);
      return;
    }
    const ph = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshBasicMaterial({ color: 0xfc8308, wireframe: true }));
    ent._meshHolder.add(ph);
    if (!this._warned.has("mesh:" + base)) {
      this._warned.add("mesh:" + base);
      consoleDiv(this.hud && this.hud.console, "未找到资产 mesh/" + base + ".vb，已用占位显示（需先导入项目包或上传模型）", "warn");
    }
    this._syncEntityVisibility(ent);
  }
  _applyMeshTransform(ent) {
    const holder = ent._meshHolder;
    if (!holder || !holder.children.length) return;
    const s = toVec3(ent.meshScale, new GameVector3(1, 1, 1));
    holder.scale.set(s.x, s.y, s.z);
    const o = toVec3(ent.meshOffset);
    holder.position.set(o.x, o.y, o.z);
    const q = ent.meshOrientation;
    if (q && q.w != null) holder.quaternion.set(q.x || 0, q.y || 0, q.z || 0, q.w);
    const col = ent.meshColor;
    holder.traverse((m) => {
      if (!m.isMesh || !m.material) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mt of mats) {
        if (mt.color && col && col.red !== undefined) mt.color.setRGB(clamp01(col.red), clamp01(col.green), clamp01(col.blue));
        if (mt.isMeshStandardMaterial) {
          mt.metalness = ent.meshMetalness || 0;
          mt.roughness = clamp01(1 - (ent.meshShininess || 0));
          if (mt.emissive) {
            // 材质自带全黑 emissive 时，只调 emissiveIntensity 是看不见的，得先把颜色点亮
            if (mt.userData._baseEmissive === undefined) {
              const be = mt.emissive.getHex();
              mt.userData._baseEmissive = (mt.emissive.r + mt.emissive.g + mt.emissive.b) > 0.001 ? be : null;
            }
            const em = ent.meshEmissive || 0;
            if (mt.userData._baseEmissive == null) mt.emissive.setScalar(em > 0 ? 1 : 0);
            mt.emissiveIntensity = em > 0 ? em : 1;
          }
        }
      }
    });
  }

  /* ---------------- 脚本沙箱 ---------------- */
  runScript(name, code, entry) {
    const rt = this;
    const g = this._globals(this._isClientScript(name, entry || code));
    const keys = Object.keys(g);
    const vals = keys.map((k) => g[k]);
    try {
      const fn = new Function(...keys, String(code) + "\n//# sourceURL=" + encodeURIComponent(name));
      fn(...vals);
      consoleDiv(this.hud.console, "脚本 " + name + " 运行成功", "ok");
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      let where = "";
      if (err && err.stack) {
        const m = String(err.stack).match(/(index|clientIndex|[\w.-]+)\.js:(\d+):(\d+)/);
        if (m) where = ` @ ${m[1]}.js:${m[2]}`;
      }
      consoleDiv(this.hud.console, `[${name}] ${msg}${where}`, "err");
      window.__errs && window.__errs.push && window.__errs.push(`[${name}] ${msg}`);
    }
  }
  // 客户端脚本沙箱（ui 节点树 / input / screen / Audio / 向量），DOM 承载，随运行启停挂载
  _client() {
    if (this._cliApi) return this._cliApi;
    const rt = this;
    const api = createClientApi({
      getCanvas: () => rt.e.renderer.renderer.domElement,
      lockPointer: () => { try { rt.e.renderer.renderer.domElement.requestPointerLock(); } catch {} },
      unlockPointer: () => document.exitPointerLock && document.exitPointerLock(),
      render3dChanged: (on) => { rt._render3d = on; rt.e.renderer.setRender3d(on); },
      resolveSrc: (s) => rt._assetUrl(s),
    });
    api.Audio = createAudioClass();
    this._cliApi = api;
    return api;
  }
  _globals(isClient) {
    const rt = this;
    const cli = this._client();
    const g = Object.assign({
      world: isClient ? cli.world : this.world, voxels: this.voxels,
      GameVector3, GameBounds3, GameRGBColor, GameRGBAColor, GameQuaternion,
      GameCameraMode, GameCameraFreezedAxis, GameInputDirection, GamePlayerMoveState, GamePlayerWalkState,
      GameButtonType, GameDialogType, GameEasing, GameAnimationPlaybackState, GameAnimationDirection,
      GameAssetType, GameLogLevel, GameBodyPart, SocialType, PointerEventBehavior, ImageDisplayMode, UITextFontFamily,
      sleep, randomPick, getEntityBounds,
      resources: this._resources(), storage: this._storage("storage"), db: this._storage("db"),
      http: { fetch: (u, o) => fetch(u, o) },
      remoteChannel: this._remoteChannel(),
      rtc: { createPeer: () => null, joinRoom: () => Promise.resolve() },
      analytics: { log: (k, v) => consoleDiv(rt.hud.console, "analytics " + k, "info") },
      gui: { toast: (m) => rt.toast(m) },
      process: { env: {}, platform: "browser", version: "dao3-clone" },
      __dirname: "/",
      console: {
        clear: () => { const c = rt.hud.console; if (c) c.innerHTML = ""; },
        log: (...a) => consoleDiv(rt.hud.console, a.map(fmt).join(" ")),
        info: (...a) => consoleDiv(rt.hud.console, a.map(fmt).join(" "), "info"),
        warn: (...a) => consoleDiv(rt.hud.console, a.map(fmt).join(" "), "warn"),
        error: (...a) => consoleDiv(rt.hud.console, a.map(fmt).join(" "), "err"),
        debug: (...a) => consoleDiv(rt.hud.console, a.map(fmt).join(" "), "info"),
      },
      screen: cli.screen,
      input: cli.input,
      media: {
        // 官方契约：playAudio({blob,gain}) / stopPlayAudio() / startRecording() / stopRecording()→audio/wav Blob
        playAudio: (spec) => rt._playBlob(spec),
        stopPlayAudio: () => rt._stopBlobAudio(),
        startRecording: () => rt._startRecording(),
        stopRecording: () => rt._stopRecording(),
      },
      navigator: { userAgent: navigator.userAgent, language: navigator.language, getDeviceInfo: () => ({ deviceType: rt._isTouch ? "Mobile" : "Desktop", screen: { width: innerWidth, height: innerHeight } }) },
      ui: cli.ui,
      UiBox: cli.UiBox, UiText: cli.UiText, UiInput: cli.UiInput, UiImage: cli.UiImage,
      UiScrollBox: cli.UiScrollBox, UiScreen: cli.UiScreen, UiScale: cli.UiScale,
      Vec2: cli.Vec2, Vec3: cli.Vec3, Coord2: cli.Coord2, Audio: cli.Audio,
      EventEmitter: cli.EventEmitter, MediaError: cli.MediaError, MediaErrorCode: cli.MediaErrorCode,
      // 官方客户端全局计时器由引擎托管（停止运行即回收）；无平台桥时 call/callAsync 按未命中返回
      setTimeout: (fn, ms) => rt._addTimer(fn, ms, 0), clearTimeout: (id) => rt._timers.delete(id),
      setInterval: (fn, ms) => rt._addTimer(fn, ms, +ms || 50), clearInterval: (id) => rt._timers.delete(id),
      call: (key, value, cb) => { const r = rt._bridgeCall(key, value); if (typeof cb === "function") cb(r); return r; },
      callAsync: (key, value) => Promise.resolve(rt._bridgeCall(key, value)),
      screenWidth: innerWidth, screenHeight: innerHeight,
    }, {
      Math, JSON, Date, Number, String, Boolean, Array, Object, Promise, Set, Map, WeakMap, WeakSet, RegExp, Symbol,
      BigInt, Error, TypeError, RangeError, Infinity, NaN, undefined, parseInt, parseFloat, isNaN, isFinite,
      encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, ArrayBuffer, DataView,
      Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
      Proxy, Reflect,
    });
    // 两端全局面按官方 d.ts 裁剪：服务端脚本不该看到 ui/input/media/Ui*，客户端不该看到 voxels/storage/Game*
    const allow = new Set(isClient ? GameRuntime.CLIENT_GLOBALS : GameRuntime.SERVER_GLOBALS);
    for (const k of Object.keys(g)) if (!allow.has(k)) delete g[k];
    return g;
  }
  _resources() {
    const rt = this;
    const list = (dir, names, type) => [...new Set(names || [])].map((n) => ({ path: n.includes("/") ? n : dir + "/" + n, type }));
    return {
      ls: (p) => {
        const key = String(p || "").replace(/\/+$/, "");
        if (!key || key === "mesh") return Object.keys(rt.assets.meshes || {}).map((n) => ({ path: "mesh/" + n + ".vb", type: GameAssetType.VOXEL_MESH }));
        if (key === "audio" || key === "sound") return list("audio", [...Object.keys(rt.assets.audio || {}), ...(rt.assets.audioNames || [])], GameAssetType.SOUND);
        if (key === "picture" || key === "image") return list("picture", rt.assets.pictureNames, GameAssetType.PICTURE);
        if (key === "lut") return list("lut", rt.assets.lutNames, GameAssetType.COLOR_LUT);
        if (key === "snow" || key === "part") return list("snow", rt.assets.partNames, GameAssetType.PARTICLE_TEXTURE);
        if (key === "js" || key === "script") return (rt.e.state.scripts || []).map((s) => ({ path: "script/" + s.name, type: GameAssetType.JS_SCRIPT }));
        return [{ path: key, type: GameAssetType.DIRECTORY }];
      },
    };
  }
  // 项目内相对路径 → 可加载 URL。官方脚本里 UiImage.image / colorLUT 写 "picture/xxx.png"，
  // 本地资产落在 /assets/worlds/<id>/ 下；音频仍走 _audioUrl（随包 URL 或内联字节）。
  _assetUrl(src) {
    const s = String(src == null ? "" : src).trim();
    if (!s) return "";
    if (/^(https?:|data:|blob:)/i.test(s)) return s;
    if (/^(https?:|data:|blob:|\/)/i.test(s)) return s;
    const rel = s.replace(/^\.\//, "");
    const pics = this.assets.pictureNames || [];
    const auds = this.assets.audioNames || [];
    if (/^audio\//i.test(rel) || pics.length === 0 && auds.includes(rel.replace(/^.*[\\/]/, ""))) {
      const au = this._audioUrl(rel);
      if (au) return au;
    }
    const root = (this.e.state.meta && this.e.state.meta.assetRoot) || "";
    if (pics.includes(rel)) return root + rel;
    if (pics.includes("picture/" + rel)) return root + "picture/" + rel;
    // 名单里没有时：带目录的按原样用，光板文件名按官方惯例落在 picture/ 下
    return root + (rel.includes("/") ? rel : "picture/" + rel);
  }
  _storage(ns) {
    const rt = this;
    const key = (k) => `dao3_${ns}:${(rt.e.worldId) || "local"}:${k}`;
    const all = () => {
      const out = [];
      try {
        const pre = `dao3_${ns}:`;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(pre)) out.push({ key: k.split(":").slice(2).join(":"), value: localStorage.getItem(k) });
        }
      } catch {}
      return out;
    };
    return {
      get: (k) => { try { const v = localStorage.getItem(key(k)); return Promise.resolve(v == null ? null : JSON.parse(v)); } catch { return Promise.resolve(null); } },
      set: (k, v) => { try { localStorage.setItem(key(k), JSON.stringify(v)); return Promise.resolve(true); } catch { return Promise.resolve(false); } },
      remove: (k) => { try { localStorage.removeItem(key(k)); } catch {} return Promise.resolve(true); },
      has: (k) => Promise.resolve(localStorage.getItem(key(k)) != null),
      page: (o) => {
        const offset = (o && o.offset) || 0, limit = (o && o.limit) || 100;
        return Promise.resolve(all().slice(offset, offset + limit));
      },
    };
  }
  _remoteChannel() {
    const rt = this;
    const srv = makeChannel(), cli = makeChannel();
    return {
      sendClientEvent: (entities, clientEvent) => {
        cli.fire({ tick: rt.currentTick, entity: Array.isArray(entities) ? entities[0] : entities, args: clientEvent });
        return true;
      },
      broadcastClientEvent: (clientEvent) => {
        cli.fire({ tick: rt.currentTick, entity: rt.playerEntity, args: clientEvent });
        return true;
      },
      onClientEvent: cli.on,
      sendServerEvent: (serverEvent) => {
        srv.fire({ tick: rt.currentTick, entity: rt.playerEntity, args: serverEvent });
        return true;
      },
      onServerEvent: srv.on,
      events: {
        on: cli.on,
        sub: cli.on,
        emit: (payload) => { cli.fire({ tick: rt.currentTick, entity: rt.playerEntity, args: payload }); return true; },
        off: (h) => { const rec = cli.handlers.find((x) => x.h === h); if (rec) rec.active = false; },
      },
    };
  }

  /* ---------------- GameWorld ---------------- */
  _buildWorld() {
    const rt = this;
    const w = {
      url: new URL(location.href),
      serverId: "local-dev",
      projectName: (this.e.state.meta && this.e.state.meta.name) || "世界",
      useOBB: false,
      entityQuota: () => Math.max(0, ENTITY_QUOTA - rt.entities.length),
      entities: () => rt.entities.filter((e2) => !e2.destroyed && !e2.isPlayer),
      createEntity: (cfg) => {
        if (rt.entities.length >= ENTITY_QUOTA) return null;
        // 官方支持「复制一个现有实体」：传实体时深拷贝其可复制属性并弃用原 id，否则会把两个实体绑成同一个名字
        const src = rt.entities.includes(cfg) ? cfg : null;
        const c = src ? {
          tags: [...(src._tags || [])], position: [src.position.x, src.position.y, src.position.z],
          bounds: [src.bounds.x, src.bounds.y, src.bounds.z], velocity: [src.velocity.x, src.velocity.y, src.velocity.z],
          collides: src.collides, mass: src.mass, friction: src.friction, restitution: src.restitution,
          gravity: src.gravity, fixed: src.fixed, mesh: src._meshName || src.mesh,
          enableInteract: src.enableInteract, interactHint: src.interactHint, interactRadius: src.interactRadius,
          hp: src.hp, maxHp: src.maxHp,
          meshColor: src.meshColor, meshMetalness: src.meshMetalness, meshEmissive: src.meshEmissive,
          meshShininess: src.meshShininess, meshScale: src.meshScale, meshOrientation: src.meshOrientation,
          meshOffset: src.meshOffset, anchorOffset: src.anchorOffset, showEntityName: src.showEntityName,
          customName: src.customName, nameColor: src.nameColor, nameRadius: src.nameRadius,
          showHealthBar: src.showHealthBar, showDamage: src.showDamage, enableDamage: src.enableDamage,
          particleRate: src.particleRate, particleLifetime: src.particleLifetime,
          particleColor: src.particleColor, particleSize: src.particleSize, interactColor: src.interactColor,
        } : (cfg || {});
        const ent = rt._makeEntity({
          id: src ? undefined : c.id, tags: c.tags, position: c.position, bounds: c.bounds, velocity: c.velocity,
          collides: c.collides, mass: c.mass, friction: c.friction, restitution: c.restitution,
          gravity: c.gravity, fixed: c.fixed, mesh: c.mesh, enableInteract: c.enableInteract,
          interactHint: c.interactHint, interactRadius: c.interactRadius, hp: c.hp, maxHp: c.maxHp,
        });
        for (const k of ["meshColor", "meshMetalness", "meshEmissive", "meshShininess", "meshScale", "meshOrientation",
          "meshOffset", "anchorOffset", "showEntityName", "customName", "nameColor", "nameRadius", "showHealthBar",
          "showDamage", "enableDamage",
          "particleRate", "particleLifetime", "particleColor", "particleSize", "interactColor"]) if (c[k] !== undefined) ent[k] = c[k];
        return ent;
      },
      querySelector: (sel) => rt._query(sel)[0] || null,
      querySelectorAll: (sel) => rt._query(sel),
      testSelector: (sel, ent) => rt._query(sel).includes(ent),
      addCollisionFilter: (a, b) => { rt._collisions.push([String(a), String(b)]); },
      removeCollisionFilter: (a, b) => {
        const i = rt._collisions.findIndex((c) => c[0] === String(a) && c[1] === String(b));
        if (i >= 0) rt._collisions.splice(i, 1);
      },
      clearCollisionFilters: () => { rt._collisions.length = 0; },
      collisionFilters: () => rt._collisions.map((c) => [...c]),
      raycast: (o, d, options) => rt._raycast(o, d, options),
      // 官方 searchBox：只返回盒子被「完全包含」的实体（GameBounds3.contains 收点，故量两角）
      searchBox: (bounds) => rt.entities.filter((e2) => {
        if (e2.destroyed) return false;
        const gb = getEntityBounds(e2);
        return bounds.contains(gb.lo) && bounds.contains(gb.hi);
      }),
      entitiesInArea: (a, b) => rt.entities.filter((e2) => getEntityBounds(e2).intersects(new GameBounds3(toVec3(a), toVec3(b)))),
      entitiesInRadius: (a, b, c) => {
        const pos = (a && typeof a === "object") ? toVec3(a) : new GameVector3(a, b, c);
        const rad = (a && typeof a === "object") ? b : (c ?? b);
        return rt.entities.filter((e2) => e2.position.distance(pos) <= rad);
      },
      zones: () => rt.zones.filter((z) => !z._removed),
      addZone: (cfg) => rt._addZone(cfg || {}),
      removeZone: (z) => z && z.remove && z.remove(),
      // 官方 world.say 是全服广播，不是玩家发言：绝不能 fire Chat，
      // 否则「onChat → say」这类回声脚本会自我触发直至栈溢出
      say: (message) => {
        const text = String(message);
        rt._chatLine(text, "#fff7d6");
        return true;
      },
      createTempChat: (userIds) => {
        const id = "chat" + (++rt._tempChatSeq);
        rt._tempChats.set(id, new Set((userIds || []).map(String)));
        return Promise.resolve(id);
      },
      destroyTempChat: (ids) => {
        const one = Array.isArray(ids) ? ids : [ids];
        const done = [];
        for (const id of one) if (rt._tempChats.delete(id)) done.push(String(id));
        return Promise.resolve(done);
      },
      addTempChatPlayer: (id, userIds) => {
        const c = rt._tempChats.get(String(id));
        const added = [];
        for (const u of (userIds || [])) { const k = String(u); if (c && !c.has(k)) { c.add(k); added.push(k); } }
        return Promise.resolve(added);
      },
      removeTempChatPlayer: (id, userIds) => {
        const c = rt._tempChats.get(String(id));
        const gone = [];
        for (const u of (userIds || [])) { const k = String(u); if (c && c.delete(k)) gone.push(k); }
        return Promise.resolve(gone);
      },
      getTempChats: () => Promise.resolve([...rt._tempChats.keys()]),
      getTempChatUsers: (id) => Promise.resolve(id == null ? [...rt._tempChats.keys()].map((k) => [...rt._tempChats.get(k)]) : [...(rt._tempChats.get(String(id)) || [])]),
      sound: (spec) => rt._makeSound(spec, null),
      // 官方签名 Promise<{serverId}>：本地没有图组，未知地图必须 reject 而不是假装成功
      teleport: (mapId, players, serverId) => {
        const cur = String(rt.e.worldId || "");
        const target = String(mapId || "");
        if (!target || (target !== cur && !/^\d+$/.test(target))) {
          rt.toast("本地运行只支持当前世界，跨世界传送未实现");
          return Promise.reject(new Error("teleport: unknown map " + target));
        }
        rt.toast("本地运行不支持跨世界传送");
        return Promise.resolve({ serverId: serverId || "local" });
      },
      animate: (kf, playback) => rt._animate(rt.world, kf, playback, "world"),
      getAnimations: () => rt.animations.filter((a) => a.target === rt.world),
      getEntityAnimations: () => rt.animations.filter((a) => a.kind === "entity"),
      getPlayerAnimations: () => rt.animations.filter((a) => a.kind === "player"),
      setTimeout: (fn, ms) => rt._addTimer(fn, ms, 0),
      setInterval: (fn, ms) => rt._addTimer(fn, ms, +ms || 50),
      clearTimeout: (id) => rt._timers.delete(id),
      clearInterval: (id) => rt._timers.delete(id),
      setWorldSpawn: (pos) => { const v = toVec3(pos); rt.spawnPoint = [v.x, v.y, v.z]; },
      products: () => (((rt.e.state.meta || {}).products) || []).filter((x) => x && x.enabled !== false).map((x) => Object.assign({}, x)),
      // 本地没有平台结算，purchase() 用于手动触发一次「购买成功」，方便验证 onPlayerPurchaseSuccess
      purchase: (productId, target) => rt._purchase(productId, target),
      runCommand: (cmd) => rt._runCommand(cmd),
      getGameRule: (n) => (n in rt.gameRules ? rt.gameRules[n] : null),
      setGameRule: (n, v) => { rt.gameRules[n] = v; },
      onUIPress: (id, h) => { rt._uiPress = rt._uiPress || new Map(); rt._uiPress.set(id, h); return { cancel: () => rt._uiPress.delete(id), resume: () => {}, active: () => true }; },
      setWidgetText: (id, text) => {
        const el = document.querySelector(`#gameUIWidgets [data-wid="${id}"]`);
        if (el) el.textContent = text;
      },
    };
    for (const n of ["Tick", "PlayerJoin", "PlayerLeave", "Chat", "Click", "Press", "Release", "Respawn", "TakeDamage",
      "Die", "EntityCreate", "EntityDestroy", "EntityContact", "EntitySeparate", "VoxelContact", "VoxelSeparate",
      "FluidEnter", "FluidLeave", "Interact", "PlayerPurchaseSuccess"]) {
      w["on" + n] = (h) => rt._channels[n].on(h);
      w["next" + n] = (f) => rt._channels[n].next(f);
    }
    w.onPlayerJoin = (h) => {
      const tok = rt._channels.PlayerJoin.on(h);
      if (rt.running && rt.playerEntity) { try { h({ tick: rt.currentTick, entity: rt.playerEntity }); } catch (err) { consoleDiv(rt.hud.console, "onPlayerJoin: " + err.message, "err"); } }
      return tok;
    };
    const scalars = ["currentTick", "gravity", "airFriction", "useOBB", "lightMode", "sunPhase", "sunFrequency",
      "lunarPhase", "sunDirection", "sunLight", "skyLeftLight", "skyRightLight", "skyBottomLight", "skyTopLight",
      "skyFrontLight", "skyBackLight", "fogColor", "fogStartDistance", "fogHeightOffset", "fogHeightFalloff",
      "fogUniformDensity", "maxFog", "snowDensity", "snowSizeLo", "snowSizeHi", "snowFallSpeed", "snowSpinSpeed",
      "snowColor", "snowTexture", "rainDensity", "rainDirection", "rainSpeed", "rainSizeLo", "rainSizeHi",
      "rainInterference", "rainColor", "breakVoxelSound", "placeVoxelSound", "playerJoinSound", "playerLeaveSound",
      "ambientSound", "time", "timeScale", "thunderDensity", "globalLight", "drawDistance", "gamma", "skyType"];
    for (const k of scalars) {
      Object.defineProperty(w, k, {
        get: () => (k === "currentTick" ? rt.currentTick : rt[k]),
        // 脚本显式给 sunDirection 赋值后就要以它为准（以前每帧又被相位覆盖，manual 模式形同虚设）
        set: (v) => { rt[k] = v; if (k === "sunDirection") rt._sunDirFixed = true; },
        configurable: true, enumerable: true,
      });
    }
    Object.defineProperty(w, "spawnPoint", {
      get: () => {
        const s = rt.spawnPoint || rt._topAt(Math.floor(rt.e.world.shape[0] / 2), Math.floor(rt.e.world.shape[2] / 2));
        return new GameVector3(s[0], s[1], s[2]);
      },
      set: (v) => { const p = toVec3(v); rt.spawnPoint = [p.x, p.y, p.z]; },
      configurable: true, enumerable: true,
    });
    return w;
  }

  /* ---------------- 全局 voxels ---------------- */
  _buildVoxels() {
    const rt = this, w = this.e.world, at = this.e.atlas;
    return {
      get shape() { return new GameVector3(w.shape[0], w.shape[1], w.shape[2]); },
      get VoxelTypes() { return at.list().map((b) => b.name); },
      id: (name) => { const b = at.get(name); return b ? b.id : 0; },
      name: (id) => { const b = at.byId(baseId(id)); return b ? b.name : ""; },
      getVoxel: (x, y, z) => w.get(Math.floor(x), Math.floor(y), Math.floor(z)) | 0,
      getVoxelId: (x, y, z) => {
        x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
        return packId(w.get(x, y, z) | 0, w.getRot(x, y, z));
      },
      getVoxelRotation: (x, y, z) => w.getRot(Math.floor(x), Math.floor(y), Math.floor(z)) | 0,
      getVoxelName: (x, y, z) => { const b = at.byId(w.get(Math.floor(x), Math.floor(y), Math.floor(z))); return b ? b.name : ""; },
      setVoxelId: (x, y, z, v) => rt._setVox(x, y, z, v, typeof v === "number" && v >= ROT_SCALE ? rotOf(v) : 0),
      setVoxel: (x, y, z, v, rot) => rt._setVox(x, y, z, v, rot === undefined ? null : rot),
      fillVoxel: (a, b, v) => {
        const p1 = toVec3(a), p2 = toVec3(b);
        const lo = p1.min(p2), hi = p1.max(p2);
        for (let x = Math.floor(lo.x); x <= Math.floor(hi.x); x++)
          for (let y = Math.floor(lo.y); y <= Math.floor(hi.y); y++)
            for (let z = Math.floor(lo.z); z <= Math.floor(hi.z); z++) rt._setVox(x, y, z, v, null);
        rt.e.renderer.rebuildAll();
      },
      countVoxel: (id) => {
        const base = baseId(Number(id));
        let n = 0;
        for (const c of w.map.values()) if (c.id === base) n++;
        return n;
      },
    };
  }
  _setVox(x, y, z, v, rot) {
    const w = this.e.world;
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (!w.inBounds(x, y, z)) return 0;
    // 官方：voxel 里带的旋转码无效，朝向只由 rotation 参数决定（未传即 0）
    const r = rot == null ? 0 : (rot & 3);
    let id = 0;
    if (typeof v === "string") {
      if (v === "air" || !v) { this._clearVox(x, y, z); return 0; }
      const b = this.e.atlas.get(v);
      if (!b) return 0;
      id = b.id;
    } else if (typeof v === "number") {
      id = v >= ROT_SCALE ? baseId(v) : v | 0;
    } else return 0;
    if (!id) { this._clearVox(x, y, z); return 0; }
    w.set(x, y, z, id, r);
    this._voxelDirty.set(`${x},${y},${z}`, [x, y, z]);
    return packId(id, r);
  }
  _clearVox(x, y, z) {
    this.e.world.set(x, y, z, 0, 0);
    this.e.renderer.markDirty(x, y, z);
    this._playAt(this.breakVoxelSound, new GameVector3(x + 0.5, y + 0.5, z + 0.5));
  }

  /* ---------------- 查询 / 射线 ---------------- */
  _query(sel) {
    const s = String(sel == null ? "*" : sel).trim();
    return this.entities.filter((e2) => !e2.destroyed && matchSelector(s, e2, this));
  }
  _emptyRay() {
    return {
      hit: false, hitEntity: null, hitVoxel: 0, origin: new GameVector3(), direction: new GameVector3(0, 0, -1),
      distance: 0, hitPosition: new GameVector3(), normal: new GameVector3(), voxelIndex: new GameVector3(),
    };
  }
  _raycast(origin, direction, options) {
    const o = toVec3(origin), d = toVec3(direction);
    const opts = typeof options === "number" ? { maxDistance: options } : (options || {});
    const maxDist = opts.maxDistance ?? 5;
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const dir = new THREE.Vector3(d.x / len, d.y / len, d.z / len);
    const w = this.e.world;
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const step = [dir.x > 0 ? 1 : -1, dir.y > 0 ? 1 : -1, dir.z > 0 ? 1 : -1];
    const tDelta = [Math.abs(1 / (dir.x || 1e-9)), Math.abs(1 / (dir.y || 1e-9)), Math.abs(1 / (dir.z || 1e-9))];
    const tMax = [
      Math.abs(((x + (step[0] > 0 ? 1 : 0)) - o.x) / (dir.x || 1e-9)),
      Math.abs(((y + (step[1] > 0 ? 1 : 0)) - o.y) / (dir.y || 1e-9)),
      Math.abs(((z + (step[2] > 0 ? 1 : 0)) - o.z) / (dir.z || 1e-9)),
    ];
    const ignoreFluid = opts.ignoreFluid !== false;
    const ignoreVoxel = !!opts.ignoreVoxel;
    // 官方 ignoreEntities 是 boolean（整体跳过实体），同时容忍数组形式（只忽略列表内实体）
    const ignAll = opts.ignoreEntities === true;
    const ignList = Array.isArray(opts.ignoreEntities) ? opts.ignoreEntities : null;
    const list = this.entities.filter((e2) => !e2.destroyed && !ignAll && !(ignList && ignList.includes(e2))
      && !(opts.ignoreSelector && matchSelector(opts.ignoreSelector, e2, this)));
    const mk = (t, ent, hit, normalV, cell) => ({
      hit: true, hitEntity: ent || null, hitVoxel: hit || 0,
      origin: new GameVector3(o.x, o.y, o.z), direction: new GameVector3(dir.x, dir.y, dir.z),
      distance: t, hitPosition: new GameVector3(o.x + dir.x * t, o.y + dir.y * t, o.z + dir.z * t),
      normal: normalV || new GameVector3(), voxelIndex: cell || new GameVector3(),
    });
    let axis = 0, t = 0;
    for (let i = 0; i < 512; i++) {
      const entHit = list.map((e2) => ({ e2, t: rayHitsBox(e2, o, dir, maxDist) })).find((h) => h.t >= 0);
      if (entHit) {
        // 命中距离用射线与盒子的入射点，而不是盒心投影（否则半透明的近盒会被算到更远处）
        if (entHit.t <= t) return mk(entHit.t, entHit.e2, 0, new GameVector3(-dir.x, -dir.y, -dir.z));
      }
      if (!ignoreVoxel) {
        const id = w.get(x, y, z);
        if (id) {
          const b = this._block(id);
          const solidHit = b ? !b.fluid : true; // 与 _solidAt 同判据：只有 fluid（含 air）射线可穿过
          if (solidHit && !(b && b.fluid && ignoreFluid)) {
            return mk(t, null, packId(id, w.getRot(x, y, z)),
              new GameVector3(axis === 0 ? -step[0] : 0, axis === 1 ? -step[1] : 0, axis === 2 ? -step[2] : 0),
              new GameVector3(x, y, z));
          }
        }
      }
      axis = tMax[0] <= tMax[1] && tMax[0] <= tMax[2] ? 0 : tMax[1] <= tMax[2] ? 1 : 2;
      t = tMax[axis];
      if (t > maxDist) break;
      tMax[axis] += tDelta[axis];
      if (axis === 0) x += step[0]; else if (axis === 1) y += step[1]; else z += step[2];
      if (x < 0 || y < 0 || z < 0 || x >= w.shape[0] || y >= w.shape[1] || z >= w.shape[2]) break;
    }
    return this._emptyRay();
  }
  _topAt(x, z) {
    const w = this.e.world;
    x = clamp(Math.floor(x), 0, w.shape[0] - 1);
    z = clamp(Math.floor(z), 0, w.shape[2] - 1);
    for (let y = w.shape[1] - 1; y >= 0; y--) {
      const id = w.get(x, y, z);
      if (!id) continue;
      const b = this._block(id);
      if (b && b.name === "barrier") continue; // 隐形空气墙不该把出生点顶到墙上方
      return [x, y + 1, z];
    }
    return [x, 1, z];
  }

  /* ---------------- 交互 / 弹窗 / 文字 ---------------- */
  _tryInteract() {
    const t = this._nearestInteractable();
    if (t) this._interactWith(t);
  }
  _nearestInteractable() {
    const P = this.playerEntity.position;
    let best = null, bestD = 1e9;
    for (const e2 of this.entities) {
      if (e2.destroyed || !e2.enableInteract || e2.isPlayer) continue;
      const d = e2.position.distance(P);
      if (d <= (e2.interactRadius || 2) && d < bestD) { best = e2; bestD = d; }
    }
    return best;
  }
  _interactWith(ent) {
    const now = performance.now();
    if (now - (this._lastInteractAt || 0) < 220) return;
    this._lastInteractAt = now;
    const ev = { tick: this.currentTick, entity: this.playerEntity, targetEntity: ent };
    ent._channels.Interact.fire(ev);
    this._channels.Interact.fire(ev);
    this._playAt(ent.interactSound, ent.position);
  }
  _dialog(params) {
    const el = this.hud && this.hud.dialog;
    if (!el) return Promise.resolve(null);
    const type = params.type || GameDialogType.TEXT;
    return new Promise((resolve) => {
      el.classList.add("show");
      const title = params.title ? `<div class="d-title">${esc(params.title)}</div>` : "";
      el.innerHTML = `<div class="d-box">${title}<div class="d-content">${esc(params.content || "")}</div></div>`;
      const box = el.querySelector(".d-box");
      const finish = (v) => { el.classList.remove("show"); el.innerHTML = ""; this._dialogResolve = null; resolve(v); };
      this._dialogResolve = finish;
      if (type === GameDialogType.SELECT) {
        const opts = document.createElement("div");
        opts.className = "d-options";
        (params.options || []).forEach((label) => {
          const b = document.createElement("button");
          b.className = "playbtn";
          b.textContent = label;
          b.onclick = () => finish(String(label));
          opts.appendChild(b);
        });
        box.appendChild(opts);
      } else if (type === GameDialogType.INPUT) {
        const inp = document.createElement("input");
        inp.className = "d-input";
        inp.placeholder = params.placeholder || "";
        const b = document.createElement("button");
        b.className = "playbtn";
        b.textContent = params.confirmText || "确认";
        b.onclick = () => finish(inp.value || null);
        box.appendChild(inp);
        box.appendChild(b);
        setTimeout(() => inp.focus(), 80);
      } else {
        const b = document.createElement("button");
        b.className = "playbtn";
        b.textContent = params.confirmText || "好的";
        b.onclick = () => finish(params.content != null ? String(params.content) : null);
        box.appendChild(b);
      }
    });
  }
  _closeDialog() {
    if (this._dialogResolve) { const r = this._dialogResolve; this._dialogResolve = null; r(null); }
  }
  _floatSay(ent, message, options) {
    const o = options || {};
    this.tags && this.tags.float(ent, String(message), o.duration ?? 2000);
    if (!o.hideFloat) this._chatLine((ent.player ? ent.player.name : ent.id) + ": " + message, "#ffffff");
    this._playAt(ent.chatSound, ent.position);
  }
  openChat() {
    const el = this.hud && this.hud.chatInput, box = this.hud && this.hud.chatBox;
    if (!el || !box) return;
    el.classList.add("show");
    this._chatOpen = true;
    setTimeout(() => box.focus(), 0);
  }
  closeChat() {
    const el = this.hud && this.hud.chatInput, box = this.hud && this.hud.chatBox;
    if (el) el.classList.remove("show");
    if (box) { box.value = ""; box.blur(); }
    this._chatOpen = false;
  }
  // 官方聊天链路：本地发送 → player.onChat + world.onChat → 屏幕回显
  sendChat(text) {
    const msg = String(text).slice(0, 200);
    const ev = { tick: this.currentTick, entity: this.playerEntity, message: msg };
    if (this.player) this.player._channels.Chat.fire(ev);
    this._channels.Chat.fire(ev);
    this._chatLine(`${this.player ? this.player.name : "玩家"}: ${msg}`, "#ffffff");
  }
  _chatLine(text, color) {
    const el = this.hud && this.hud.chat;
    if (!el) return;
    const d = document.createElement("div");
    if (color) d.style.color = color;
    d.textContent = text;
    el.appendChild(d);
    while (el.children.length > 10) el.removeChild(el.firstChild);
    clearTimeout(this._chatFade);
    this._chatFade = setTimeout(() => { if (el) el.innerHTML = ""; }, 15000);
  }
  say(message) { this.world.say(message); }
  toast(msg) { this.e.toast && this.e.toast(msg); }

  /* ---------------- 音效 ---------------- */
  _makeSound(spec, owner) {
    if (!spec) return null;
    const s = typeof spec === "string" ? { sample: spec } : Object.assign({}, spec);
    if (!s.sample) return null;
    const origin = s.position ? { position: toVec3(s.position) } : (owner && owner.position ? owner : null);
    const snd = new Sound(this, s, origin);
    this._sounds.add(snd);
    return snd;
  }
  _purchase(productId, target) {
    const list = (this.e.state.meta && this.e.state.meta.products) || [];
    const p = list.find((x) => String(x.productId) === String(productId));
    if (!p) { consoleDiv(this.hud && this.hud.console, "未找到商品 " + productId, "warn"); return false; }
    const ent = (target && target._entity) || target || this.playerEntity;
    const counts = this._purchases = this._purchases || {};
    const key = String(p.productId);
    const cap = Math.floor(Number(p.limited) || 0);
    const used = counts[key] || 0;
    if (cap > 0 && used >= cap) {
      if (ent && ent.player) ent.player.directMessage(`「${p.name}」限购 ${cap} 件，已购满`);
      this._renderStore();
      return false;
    }
    counts[key] = used + 1;
    this._channels.PlayerPurchaseSuccess.fire({
      tick: this.currentTick, entity: ent, productId: p.productId,
      productName: p.name, price: p.price, currency: p.currency,
    });
    if (ent && ent.player) ent.player.directMessage(`已购买「${p.name}」`);
    this._renderStore();
    return true;
  }
  /* ------- 运行模式商店：world.products() 的可视化购买入口 ------- */
  _storeList() {
    return ((((this.e.state.meta || {}).products) || []).filter((x) => x && x.enabled !== false));
  }
  _toggleStore(on) {
    const panel = this.hud && this.hud.store;
    if (!panel) return;
    const want = on === undefined ? !this._storeOpen : !!on;
    this._storeOpen = want;
    const p = this.player;
    if (want) {
      this._storePrevInput = p ? p.disableInputDirection : null;
      if (p) p.disableInputDirection = GameInputDirection.BOTH;
      document.exitPointerLock && document.exitPointerLock();
    } else if (p) {
      p.disableInputDirection = this._storePrevInput || GameInputDirection.NONE;
    }
    this._renderStore();
  }
  _renderStore() {
    const btn = this.hud && this.hud.storeBtn, panel = this.hud && this.hud.store;
    if (!btn || !panel) return;
    const items = this._storeList();
    btn.hidden = items.length === 0;
    if (!this._storeWired) {
      this._storeWired = true;
      // HUD 浮层里的点击不能被 window 上的游戏输入监听当成动作键
      const swallow = (ev) => ev.stopPropagation();
      for (const el of [btn, panel]) for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup"]) el.addEventListener(t, swallow);
      btn.onclick = () => this._toggleStore();
    }
    btn.textContent = "商店";
    panel.classList.toggle("show", this._storeOpen && items.length > 0);
    if (!this._storeOpen) { panel.innerHTML = ""; return; }
    panel.innerHTML = "";
    const counts = this._purchases = this._purchases || {};
    for (const p of items) {
      const key = String(p.productId);
      const cap = Math.floor(Number(p.limited) || 0);
      const used = counts[key] || 0;
      const soldOut = cap > 0 && used >= cap;
      const item = document.createElement("div"); item.className = "gs-item";
      if (p.icon) {
        const im = document.createElement("img"); im.className = "gs-ico"; im.alt = "";
        im.onerror = () => im.remove();
        im.src = /^(https?:|\/|\.)/.test(p.icon) ? p.icon : this._assetUrl(p.icon) || p.icon;
        item.appendChild(im);
      }
      const body = document.createElement("div"); body.className = "gs-body";
      const nm = document.createElement("div"); nm.className = "gs-name";
      nm.textContent = p.name || "未命名商品";
      body.appendChild(nm);
      const desc = document.createElement("div"); desc.className = "gs-desc";
      desc.textContent = [p.describe, cap > 0 ? `限购 ${cap}（已购 ${used}）` : ""].filter(Boolean).join(" · ");
      body.appendChild(desc);
      item.appendChild(body);
      const buy = document.createElement("button"); buy.className = "gs-buy";
      buy.textContent = soldOut ? "已购满" : `${p.price == null ? 0 : p.price} ${p.currency || ""}`.trim();
      buy.disabled = soldOut;
      buy.onclick = () => { if (this._purchase(p.productId)) this.say(`购买成功：${p.name || key}`); };
      item.appendChild(buy);
      panel.appendChild(item);
    }
  }
  _startAmbient() {
    if (this._ambientAudio) return;
    this._ambientAudio = this._openAudio(this.ambientSound, { loop: true, volume: 0.35 });
  }
  _stopAmbient() {
    if (this._ambientAudio) { try { this._ambientAudio.pause(); } catch {} this._ambientAudio = null; }
  }
  _playAt(spec, pos) {
    // 占位与形状判定只在 soundSpecOf 一处收口，避免字符串/对象两条路各说各话
    const s = GameRuntime.soundSpecOf(spec);
    if (!s) return null;
    const snd = new Sound(this, Object.assign({}, s, { position: pos }), { position: toVec3(pos) });
    this._sounds.add(snd);
    return snd;
  }
  // 保留官方声音对象（含衰减半径与增益），只在 sample 为空/占位时视为未设置
  // 两端全局面按官方 d.ts 划分（GameAPI.d.ts 有 voxels/Game* 而 ClientAPI.d.ts 有 ui/input/Vec*/ImageDisplayMode）。
  // 混着注入会让脚本用到另一端其实不存在的全局，本地跑得通、上官方就跑不通。
  static BUILTIN_GLOBALS = ["Math", "JSON", "Date", "Number", "String", "Boolean", "Array", "Object", "Promise",
    "Set", "Map", "WeakMap", "WeakSet", "RegExp", "Symbol", "BigInt", "Error", "TypeError", "RangeError",
    "Infinity", "NaN", "undefined", "parseInt", "parseFloat", "isNaN", "isFinite",
    "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "ArrayBuffer", "DataView",
    "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
    "Float32Array", "Float64Array", "Proxy", "Reflect",
    "console", "process", "__dirname", "http", "remoteChannel", "sleep",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval"];
  static SERVER_GLOBALS = [...GameRuntime.BUILTIN_GLOBALS,
    "world", "voxels", "resources", "storage", "db", "rtc", "analytics", "gui", "randomPick", "getEntityBounds",
    "GameVector3", "GameBounds3", "GameRGBColor", "GameRGBAColor", "GameQuaternion", "GameCameraMode",
    "GameCameraFreezedAxis", "GameInputDirection", "GamePlayerMoveState", "GamePlayerWalkState", "GameButtonType",
    "GameDialogType", "GameEasing", "GameAnimationPlaybackState", "GameAnimationDirection", "GameAssetType",
    "GameLogLevel", "GameBodyPart", "SocialType"];
  static CLIENT_GLOBALS = [...GameRuntime.BUILTIN_GLOBALS,
    "world", "navigator", "screenWidth", "screenHeight", "ui", "input", "screen", "media", "call", "callAsync",
    "UiBox", "UiText", "UiInput", "UiImage", "UiScrollBox", "UiScreen", "UiScale",
    "Vec2", "Vec3", "Coord2", "Audio", "EventEmitter", "MediaError", "MediaErrorCode",
    "PointerEventBehavior", "ImageDisplayMode", "UITextFontFamily"];
  static soundSpecOf(v) {    if (!v) return null;
    const s = typeof v === "string" ? { sample: v } : v;
    const sample = typeof s.sample === "string" ? s.sample : "";
    if (!sample || /\/\.\w+$/.test(sample) || /^\.mp3$/.test(sample.split("/").pop() || "")) return null;
    return Object.assign({ gain: 1, gainRange: 0, pitch: 1, pitchRange: 0, radius: 32 }, s, { sample });
  }
  // 官方 entitiesTree 的 particle 持久块 → GameEntity 的 particle* 属性。
  // color0..4 / size0..4 是「把存活期五等分」的阶段取值；颜色是 ×1000 的定点数
  // （官方默认白色 = {r:1000,g:1000,b:1000} → GameRGBColor(1,1,1)），尺寸本身就是 1。
  // 未使用的阶段官方写全 0，若照单收成 5 档，粒子会按 白→黑 渐变掉，所以只收有值的档。
  static particleFrom(p) {
    if (!p || (!p.rate && !p.rateSpread)) return null;
    const colors = [0, 1, 2, 3, 4].map((i) => p["color" + i])
      .filter((c) => c && (c.r || c.g || c.b)).map((c) => [c.r / 1000, c.g / 1000, c.b / 1000]);
    const sizes = [0, 1, 2, 3, 4].map((i) => p["size" + i]).filter((s) => typeof s === "number" && s > 0);
    return {
      rate: p.rate || 0, rateSpread: p.rateSpread || 0, limit: p.limit || 100,
      lifetime: p.lifetime ?? 1, lifetimeSpread: p.lifetimeSpread || 0, damping: p.damping || 0,
      acceleration: p.acceleration, noise: p.noiseAmpl || 0, noiseFrequency: p.noiseFreq || 1,
      velocity: p.velocity, velocitySpread: p.velocitySpread,
      color: colors, size: sizes, sizeSpread: p.sizeSpread || 0,
    };
  }
  /* ---------------- 录音与录音回放（官方 client.media） ---------------- */
  async _playBlob(spec) {
    const s = spec || {};
    if (!s.blob) return;
    this._stopBlobAudio();
    const url = URL.createObjectURL(s.blob);
    const a = new Audio(url);
    a.volume = clamp(s.gain == null ? 1 : s.gain, 0, 1);
    this._blobAudio = a;
    a.onended = () => { URL.revokeObjectURL(url); if (this._blobAudio === a) this._blobAudio = null; };
    try { await a.play(); } catch {}
  }
  _stopBlobAudio() {
    const a = this._blobAudio;
    if (!a) return;
    this._blobAudio = null;
    try { a.pause(); URL.revokeObjectURL(a.src); } catch {}
  }
  async _startRecording() {
    if (this._recorder) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.start();
    this._recorder = rec;
    this._recChunks = chunks;
  }
  async _stopRecording() {
    const rec = this._recorder;
    if (!rec) return null;
    this._recorder = null;
    const blob = await new Promise((res) => {
      rec.onstop = () => res(new Blob(this._recChunks || [], { type: rec.mimeType || "audio/webm" }));
      try { rec.stop(); } catch { res(null); }
    });
    try { rec.stream.getTracks().forEach((t) => t.stop()); } catch {}
    this._recChunks = [];
    return blob ? await toWavBlob(blob) : null;
  }
  _openAudio(sample, opts = {}) {
    if (this.soundMuted || !sample) return null;
    const url = this._audioUrl(sample);
    if (!url) return null;
    try {
      const a = new Audio(url);
      a.loop = !!opts.loop;
      a.volume = clamp(opts.volume ?? 1, 0, 1);
      if (opts.rate) { try { a.playbackRate = opts.rate; } catch {} }
      a.play().catch(() => {});
      return a;
    } catch { return null; }
  }
  // 音频专用解析：内联字节 → blob URL，否则随包 URL 流式取用（避免为 40 个音效预读字节）
  _audioUrl(path) {
    const stripped = String(path).replace(/\.[a-z0-9]+$/i, "");
    const base = stripped.replace(/.*[\\/]/, "");
    const a = this.assets && this.assets.audio;
    const u8 = a && (a[base] || a[stripped] || a[String(path)]);
    if (u8) return URL.createObjectURL(new Blob([u8], { type: "audio/mpeg" }));
    const root = this.assets && this.assets.audioBase;
    const file = String(path).replace(/.*[\\/]/, "");
    if (root && file) return root + encodeURIComponent(file);
    return null;
  }
  _setMusic(sample) {
    if (this._music) { try { this._music.pause(); } catch {} this._music = null; }
    if (!sample) return;
    this._music = this._openAudio(sample, { loop: true, volume: 0.5 });
  }
  setMuted(m) {
    this.soundMuted = !!m;
    try { localStorage.setItem("dao3_muted", m ? "1" : "0"); } catch {}
    if (m) for (const s of this._sounds) s.pause();
    else for (const s of this._sounds) s.resume();
  }

  /* ---------------- 动画 / 定时器 ---------------- */
  _animate(target, keyframes, playback, kind) {
    if (!Array.isArray(keyframes) || keyframes.length < 2) return null;
    const a = new GameAnimation(this, target, keyframes, playback || {}, kind);
    this.animations.push(a);
    return a;
  }
  _stepTimers() {
    const now = performance.now();
    for (const [id, t] of [...this._timers]) {
      if (now >= t.at) {
        try { t.fn(); } catch (err) { consoleDiv(this.hud.console, "定时器错误: " + err.message, "err"); }
        if (t.repeat) t.at = now + t.repeat;
        else this._timers.delete(id);
      }
    }
    for (const a of [...this.animations]) a._update();
  }

  /* ---------------- 兼容命令（非官方 arena） ---------------- */
  _runCommand(cmd) {
    const m = String(cmd || "").match(/(\w+)\s+([\w\s:.-]*)/);
    if (!m) return;
    const key = m[1], val = (m[2] || "").trim();
    if (key === "time") {
      const frac = val.includes("sunrise") ? 0.0 : val.includes("day") ? 0.25 : val.includes("noon") ? 0.5
        : val.includes("sunset") ? 0.75 : val.includes("night") ? 0.9 : null;
      if (frac != null) this.sunPhase = clamp(+frac || 0, 0, 1);
      else { const t = parseFloat(val); if (!isNaN(t)) this.sunPhase = clamp(t / 24000, 0, 1); }
    } else if (key === "weather") {
      this.rainDensity = val.includes("rain") ? 0.8 : 0;
      this.snowDensity = val.includes("snow") ? 0.7 : 0;
      this.thunderDensity = val.includes("thunder") ? 0.6 : 0;
      if (val.includes("thunder")) this.rainDensity = 0.9;
    } else if (key === "say") this._chatLine(val, "#fff7d6");
    else if (key === "give") this.toast("本地运行无背包系统");
    else consoleDiv(this.hud.console, "命令 /" + key + " 未实现", "warn");
  }
  get gameRulesObj() { return this.gameRules; }

  /* ---------------- HUD ---------------- */
  _setupHud() {
    const $ = (id) => document.getElementById(id);
    this.hud = {
      entry: $("playEntry"), cross: $("gameCross"), chat: $("gameChat"), interact: $("gameInteract"),
      dialog: $("gameDialog"), console: $("gameConsole"), title: $("gameTitle"), stop: $("gameStop"),
      coords: $("gameCoords"), tags: $("gameNameTags"), state: $("gameState"), widgets: $("gameUIWidgets"),
      vitals: $("gameVitals"), vitName: $("vitName"), vitHp: $("vitHp"), vitState: $("vitState"),
      chatBox: $("chatBox"), chatInput: $("gameChatInput"), dead: $("gameDead"), respawn: $("btnRespawn"),
      storeBtn: $("gameStoreBtn"), store: $("gameStore"),
    };
    this._storeOpen = false;
    this._purchases = {};
    if (this.hud.respawn) this.hud.respawn.onclick = () => { this.player.forceRespawn(); this.hud.dead.classList.remove("show"); };
    if (this.hud.chatBox) {
      this.hud.chatBox.onkeydown = (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") { const v = this.hud.chatBox.value.trim(); this.closeChat(); if (v) this.sendChat(v); }
        else if (ev.key === "Escape") this.closeChat();
      };
    }
    if (this.hud.entry) this.hud.entry.classList.add("show");
    if (this.hud.cross) this.hud.cross.classList.add("show");
    if (this.hud.console) { this.hud.console.innerHTML = ""; this.hud.console.classList.remove("show"); }
    if (this.hud.title) this.hud.title.textContent = (this.e.state.meta && this.e.state.meta.name) || "运行中";
    if (this.hud.tags) this.hud.tags.innerHTML = "";
    this.tags = new TagLayer(this.hud.tags || document.createElement("div"));
    for (const ent of this.entities) this.tags.ensure(ent);
    this._renderWidgets();
    this._renderStore();
    this._bindHudControls();
  }
  _teardownHud() {
    const h = this.hud || {};
    if (h.entry) h.entry.classList.remove("show");
    if (h.cross) h.cross.classList.remove("show");
    if (h.chat) h.chat.innerHTML = "";
    if (h.interact) h.interact.textContent = "";
    if (h.dialog) { h.dialog.classList.remove("show"); h.dialog.innerHTML = ""; }
    if (h.tags) h.tags.innerHTML = "";
    if (h.widgets) { h.widgets.innerHTML = ""; h.widgets.classList.remove("show"); }
    if (h.vitals) h.vitals.classList.remove("show");
    if (h.dead) h.dead.classList.remove("show");
    this._storeOpen = false;
    if (h.store) { h.store.classList.remove("show"); h.store.innerHTML = ""; }
    if (h.storeBtn) h.storeBtn.hidden = true;
    if (h.chatInput) h.chatInput.classList.remove("show");
    if (h.lockHint) document.getElementById("gameLockHint")?.classList.remove("show");
    this.tags && this.tags.clear();
    const s = document.getElementById("gameHudSettings");
    if (s) s.classList.remove("show");
  }
  _bindHudControls() {
    const h = this.hud, rt = this;
    if (h.stop) h.stop.onclick = () => (rt.e.stopPlay ? rt.e.stopPlay() : rt.stop());
    const settings = document.getElementById("gameHudSettings");
    if (!settings) return;
    const bind = (id, get, set) => {
      const el = document.getElementById(id);
      if (!el) return;
      const out = el.nextElementSibling;
      const sync = () => { el.value = get(); if (out) out.textContent = el.value; };
      el.oninput = () => { set(parseFloat(el.value)); sync(); };
      sync();
    };
    bind("ghSun", () => rt.e.renderer.sun.intensity.toFixed(2), (v) => rt.e.renderer.setTerrain({ sunIntensity: v }));
    bind("ghAmbient", () => rt.e.renderer.ambient.intensity.toFixed(2), (v) => rt.e.renderer.setTerrain({ ambient: v }));
    bind("ghExposure", () => rt.e.renderer.renderer.toneMappingExposure, (v) => rt.e.renderer.setTerrain({ exposure: v }));
    bind("ghFov", () => rt.player.cameraFovY.toFixed(2), (v) => { rt.player.cameraFovY = v; });
    bind("ghDist", () => rt.player.cameraDistance, (v) => { rt.player.cameraDistance = v; });
    const spawn = document.getElementById("ghSpawn");
    if (spawn) spawn.onclick = () => {
      const p = rt.playerEntity.position;
      rt.player.spawnPoint = new GameVector3(p.x, p.y, p.z);
      rt.say("出生点已设为当前位置");
    };
    const day = document.getElementById("ghDay");
    if (day) day.onclick = () => { rt.sunPhase = 0.25; };
    const night = document.getElementById("ghNight");
    if (night) night.onclick = () => { rt.sunPhase = 0.75; };
    const reset = document.getElementById("ghReset");
    if (reset) reset.onclick = () => { rt.e.applyTerrain(); rt.say("已恢复世界设置"); };
    const snd = document.getElementById("ghSound");
    if (snd) {
      const sync = () => { snd.textContent = "声音:" + (rt.soundMuted ? "关" : "开"); };
      snd.onclick = () => { rt.setMuted(!rt.soundMuted); sync(); };
      sync();
    }
    const dbg = document.getElementById("ghConsole");
    if (dbg) dbg.onclick = () => h.console && h.console.classList.toggle("show");
  }
  _renderWidgets() {
    const host = this.hud.widgets;
    if (!host) return;
    host.innerHTML = "";
    const widgets = (this.e.state.meta && this.e.state.meta.ui) || [];
    for (const w of widgets) {
      if (w.type === "image") {
        const im = document.createElement("img");
        im.dataset.wid = w.id;
        im.className = "uiw uiw-image";
        im.src = this._assetUrl(w.image || w.text || "");
        im.style.cssText = `left:${w.x}%;top:${w.y}%;width:${w.w}%;height:${w.h}%`;
        host.appendChild(im);
        continue;
      }
      const el = document.createElement(w.type === "button" ? "button" : "div");
      el.dataset.wid = w.id;
      el.className = "uiw uiw-" + (w.type || "text");
      el.textContent = w.text || (w.type === "button" ? "按钮" : "");
      el.style.cssText = `left:${w.x}%;top:${w.y}%;width:${w.w}%;height:${w.h}%;font-size:${w.size || 14}px;color:${w.color || "#fff"};${w.bg ? "background:" + w.bg + ";" : ""}`;
      if (w.type === "button") {
        el.onclick = () => {
          const h = this._uiPress && this._uiPress.get(w.id);
          if (h) { try { h({ id: w.id, player: this.playerEntity && this.playerEntity.player }); } catch (err) { consoleDiv(this.hud.console, "onUIPress: " + err.message, "err"); } }
        };
      }
      host.appendChild(el);
    }
    host.classList.toggle("show", widgets.length > 0);
  }
  _syncHudSettings() {
    const cam = document.getElementById("plCam");
    if (cam) cam.value = this.player.cameraMode;
  }
  _updateHud(dt) {
    const p = this.player, ent = this.playerEntity;
    if (!p || !ent) return;
    const t = this._nearestInteractable();
    if (this.hud.interact) {
      this.hud.interact.textContent = t ? "[E] " + (t.interactHint || t.id) : "";
      if (t && t.interactColor) {
        const c = t.interactColor;
        this.hud.interact.style.color = `rgb(${Math.round(clamp01(c.red) * 255)},${Math.round(clamp01(c.green) * 255)},${Math.round(clamp01(c.blue) * 255)})`;
      }
    }
    if (this.hud.coords) {
      const pos = ent.position;
      this.hud.coords.textContent = `X ${pos.x.toFixed(1)}  Y ${pos.y.toFixed(1)}  Z ${pos.z.toFixed(1)}`;
    }
    if (this.hud.state) {
      this.hud.state.textContent = `${p.moveState} · ${p.walkState || "IDLE"} · tick ${this.currentTick}`;
    }
    // 血量 / 状态角标 / 死亡遮罩（官方 enableDamage、showHealthBar、dead、forceRespawn）
    const showVit = ent.enableDamage || ent.showHealthBar || p.dead || ent.hp < ent.maxHp;
    if (this.hud.vitals) this.hud.vitals.classList.toggle("show", !!showVit);
    if (showVit) {
      if (this.hud.vitName) this.hud.vitName.textContent = p.name;
      if (this.hud.vitHp) this.hud.vitHp.style.width = clamp(p.dead ? 0 : ent.hp / (ent.maxHp || 1), 0, 1) * 100 + "%";
      if (this.hud.vitState) {
        const chips = [];
        if (p.flying) chips.push("飞行");
        if (p.walkState === GamePlayerWalkState.RUN) chips.push("奔跑");
        if (p.walkState === GamePlayerWalkState.CROUCH) chips.push("蹲行");
        if (p.moveState === GamePlayerMoveState.SWIM) chips.push("游泳");
        if (p.spectator) chips.push("幽灵");
        this.hud.vitState.textContent = chips.join(" · ");
      }
    }
    if (this.hud.dead) this.hud.dead.classList.toggle("show", !!p.dead);
    const cam = this.e.renderer.camera;
    for (const e2 of this.entities) {
      if (e2.destroyed || !this.tags) continue;
      const firstPerson = p.cameraMode === GameCameraMode.FPS;
      const isSelf = e2 === ent;
      const nameOpt = e2.isPlayer ? (p.showName && !isSelf ? p.name : "") : (e2.showEntityName ? (e2.customName || e2.id) : "");
      this.tags.update(cam, e2, e2, {
        name: nameOpt,
        nameText: nameOpt,
        nameColor: e2.isPlayer ? "#fff" : rgbHex(e2.nameColor, 0),
        hidden: isSelf || firstPerson || e2.meshInvisible || (e2.isPlayer && p.invisible),
        health: e2.showHealthBar,
        hp: e2.hp, maxHp: e2.maxHp,
        height: Math.abs(e2.bounds.y) * 2 + 0.3,
        radius: e2.nameRadius,
      });
    }
    this._renderWidgetsIfChanged();
  }
  _renderWidgetsIfChanged() {
    const n = ((this.e.state.meta && this.e.state.meta.ui) || []).length;
    if (n !== this._widgetCount) { this._widgetCount = n; this._renderWidgets(); }
  }
}

/* ---------------- prop 工厂（mesh* 系列） ---------------- */
function propFor(key, ent, rt) {
  if (key === "mesh") {
    return {
      get: () => ent._meshName || "",
      set: (v) => rt._setMesh(ent, v),
      configurable: true, enumerable: true,
    };
  }
  if (key === "meshInvisible") {
    return {
      get: () => !!ent._meshHidden,
      set: (v) => { ent._meshHidden = !!v; if (ent._meshHolder) ent._meshHolder.visible = !v; rt._syncEntityVisibility(ent); },
      configurable: true, enumerable: true,
    };
  }
  if (key === "meshScale") {
    return {
      get: () => ent._meshScaleV || (ent._meshScaleV = new GameVector3(1, 1, 1)),
      set: (v) => { ent._meshScaleV = toVec3(v); rt._applyMeshTransform(ent); },
      configurable: true, enumerable: true,
    };
  }
  if (key === "meshOrientation") {
    return {
      get: () => ent._meshOriQ || (ent._meshOriQ = new GameQuaternion()),
      set: (v) => { ent._meshOriQ = v; rt._applyMeshTransform(ent); },
      configurable: true, enumerable: true,
    };
  }
  if (key === "anchorOffset") {
    // 官方语义是「几何中心相对锚点的偏移」，影响实心盒而非网格摆放，别和 meshOffset 混掉
    return {
      get: () => ent.anchorOffset,
      set: (v) => { const t = toVec3(v); ent.anchorOffset.set(t.x, t.y, t.z); },
      configurable: true, enumerable: true,
    };
  }
  if (key === "meshColor") {
    return {
      get: () => ent._meshColorV || (ent._meshColorV = new GameRGBAColor(1, 1, 1, 1)),
      set: (v) => { ent._meshColorV = rgbaOf(v, ent._meshColorV); rt._applyMeshTransform(ent); },
      configurable: true, enumerable: true,
    };
  }
  if (key === "meshMetalness" || key === "meshEmissive" || key === "meshShininess") {
    const bk = "_mm_" + key;
    return {
      get: () => ent[bk] || 0,
      set: (v) => { ent[bk] = Number(v) || 0; rt._applyMeshTransform(ent); },
      configurable: true, enumerable: true,
    };
  }
  return {
    get: () => ent._meshOffV || (ent._meshOffV = new GameVector3()),
    set: (v) => { ent._meshOffV = toVec3(v); rt._applyMeshTransform(ent); },
    configurable: true, enumerable: true,
  };
}

/* ---------------- 全局错误转发 ---------------- */
export function logGameError(msg) {
  const el = document.getElementById("gameConsole");
  if (el) consoleDiv(el, String(msg), "err");
}
