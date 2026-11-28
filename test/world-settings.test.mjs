import { applyCompletion, fromOfficialEnvironment, toOfficialPhysics, auditOfficialWorldConfig } from "../public/js/io.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      → " + extra : "")); }
};

const amb = { ambient: { sample: "audio/theme.mp3", gain: 0.8, pitch: 1, radius: 32 } };
const res = { entities: [], projectCfg: {}, warnings: [] };
const done = applyCompletion(res, { ambientSound: amb });
ok("CID 补齐的背景音乐直接进入 projectCfg", res.projectCfg.ambientSound === amb);
ok("背景音乐不再被列为 deferred", !done.deferred.includes("ambientSound") && done.applied.includes("ambientSound"), JSON.stringify(done));

const env = fromOfficialEnvironment({
  fog: { fogColor: { r: 0.2, g: 0.3, b: 0.4 }, fogDensity: 0.01, fogStartDistance: 20, maxFog: 0.6 },
  rain: { density: 0.25, speed: 2 },
  sky: { sunPhase: 0.75, sunFrequency: 0.0004, globalLight: 0.2 },
});
ok("官方嵌套环境映射到运行时扁平字段", env.fogUniformDensity === 0.01 && env.fogStartDistance === 20 && env.maxFog === 0.6 && env.rainDensity === 0.25 && env.sunPhase === 0.75, JSON.stringify(env));
ok("官方物理映射保留 gravity/useOBB/velocityDamping", JSON.stringify(toOfficialPhysics({ gravity: -0.2, useOBB: true, airFriction: 0.02 })) === JSON.stringify({ gravity: -0.2, useOBB: true, velocityDamping: 0.02 }));
const audit = auditOfficialWorldConfig({ environment: {}, physics: {}, ambientSound: amb, zones: [{}, {}] }, { worldSettings: { gravity: -0.1 } });
ok("导入对账报告环境/物理/音乐/区域与缺失项", audit.environment && audit.physics && audit.ambientSound && audit.zones === 2 && audit.missing.length === 0, JSON.stringify(audit));

console.log(`\nworld-settings: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
