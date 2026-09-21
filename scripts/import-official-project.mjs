// 把官方 project 数据（static.dao3.fun/block/<CID> 取回的 entitiesTree / player / physics /
// environment / ambientSound）写回本地种子世界，替换此前根据几何推断的模型摆放与实体。
// 用法: node scripts/import-official-project.mjs [worldId]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORLD_ID = process.argv[2] || "216d665d3ca92bd1b9a2";
const OFF = path.join(ROOT, "official-project/racing-template");
const SEED = path.join(ROOT, "server/data/worlds", WORLD_ID + ".json.gz");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const readSeed = (p) => JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString("utf8"));
const entitiesTree = readJson(path.join(OFF, "entitiesTree.raw"));
const player = readJson(path.join(OFF, "player.raw"));
const physics = readJson(path.join(OFF, "physics.raw"));
const environment = readJson(path.join(OFF, "environment.raw"));
const ambientSound = readJson(path.join(OFF, "ambientSound.raw"));
const info = readJson(path.join(OFF, "info.raw"));

const meshOf = (m) => (m || "").replace(/^mesh\//, "").replace(/\.vb$/, "");
const groups = [];
const entities = [];
for (const [id, node] of Object.entries(entitiesTree)) {
  if (node.type === 2) { groups.push({ id, name: node.name, parentId: node.parentId, childrenIds: node.childrenIds }); continue; }
  if (node.type !== 1) continue;
  const v = node.value || {};
  entities.push({
    id, name: node.name, parentId: node.parentId,
    tags: v.tags || [],
    mesh: meshOf(v.mesh), meshId: v.meshId ?? null,
    position: v.position, orientation: v.orientation || [0, 0, 0, 1], scale: v.scale || [1, 1, 1],
    bounds: v.bounds || [0, 0, 0],
    collision: !!v.collision, fixed: !!v.fixed, gravity: !!v.gravity,
    mass: v.mass ?? 1, friction: v.friction ?? 1, restitution: v.restitution ?? 0,
    emissive: v.emissive ?? 0, metalness: v.metalness ?? 0, shininess: v.shininess ?? 0,
    meshInvisible: v.meshInvisible === true,
    tint: v.tint || [255, 255, 255, 255],
    damage: v.damage || null, particle: v.particle || null, sound: v.sound || null,
    defaultMotionId: v.defaultMotionId || "",
  });
}
entities.sort((a, b) => (a.parentId === "ROOT_ID" ? 0 : 1) - (b.parentId === "ROOT_ID" ? 0 : 1) || a.name.localeCompare(b.name, "zh"));

const world = readSeed(SEED);
const meta = world.meta || (world.meta = {});
const usedMeshes = [...new Set(entities.map((e) => e.mesh).filter(Boolean))];
const haveMeshes = new Set(meta.meshNames || []);
const missing = usedMeshes.filter((m) => !haveMeshes.has(m));

meta.displayName = info.displayName;
  meta.name = info.displayName || meta.name;
  meta.description = info.description || meta.description || "";
meta.entities = entities;
meta.groups = groups;
meta.models = []; // 场景模型已并入 entities（官方只有一张实体表）
meta.player = { ...player, _units: "official" };
meta.worldSettings = {
  gravity: physics.gravity,
  useOBB: !!physics.useOBB,
  airFriction: physics.velocityDamping,
  lightMode: "natural",
  sunFrequency: environment.sky.sunFrequency,
  sunPhase: environment.sky.sunPhase,
  globalLight: environment.sky.globalLight,
  gamma: environment.sky.gamma,
  skyType: environment.sky.skyType,
  drawDistance: environment.drawDistance,
  fogUniformDensity: environment.fog.fogDensity,
  fogStartDistance: environment.fog.fogStartDistance,
  fogHeightOffset: environment.fog.fogHeightOffset,
  fogHeightFalloff: environment.fog.fogHeightFalloff,
  maxFog: environment.fog.maxFog,
  rainDensity: environment.rain.density,
  snowDensity: environment.snow.density,
  initialWeather: environment.rain.density > 0 ? "rain" : environment.snow.density > 0 ? "snow" : "clear",
};
meta.ambientSound = ambientSound;
// 官方 uiTree 的 DEFAULT_SCREEN 没有子控件，种子里的界面部件一律视为编辑残留
const uiTree = readJson(path.join(OFF, "uiTree.raw"));
const screenChildren = (uiTree.DEFAULT_SCREEN_ID || {}).childrenIds || [];
if (!screenChildren.length) meta.ui = [];

// 地图脚本不是 CID 可寻址的（cids.json 里没有它），所以只能等用户自己带进来：
// 官方编辑器导出的项目包 .zip 解出的 code-index.js / code-clientIndex.js 放这儿即可。
// 之前这里完全不读，导致 fetch 出来的地图永远 0 脚本，竞速逻辑整段消失。
const scripts = [];
for (const [file, name] of [["code-index.js", "index.js"], ["code-clientIndex.js", "clientIndex.js"]]) {
  const p = path.join(OFF, file);
  if (!fs.existsSync(p)) continue;
  const code = fs.readFileSync(p, "utf8");
  if (code.trim()) scripts.push({ name, code });
}
if (scripts.length) meta.scripts = scripts;
else console.warn("未找到地图脚本（code-index.js / code-clientIndex.js）——"
  + "官方项目包 .zip 里带着两个文件，导入项目包即可一并恢复竞速逻辑。");

fs.writeFileSync(SEED, zlib.gzipSync(Buffer.from(JSON.stringify(world), "utf8"), { level: 9 }));
console.log(JSON.stringify({
  world: WORLD_ID, entities: entities.length, groups: groups.length,
  tagged: entities.filter((e) => e.tags.length).map((e) => e.name + ":" + e.tags.join("|")),
  meshesUsed: usedMeshes.length, missingMeshFiles: missing, scripts: scripts.map((s) => s.name),
  spawn: meta.player.initialPosition, gravity: physics.gravity, airFriction: physics.velocityDamping,
}, null, 1));
