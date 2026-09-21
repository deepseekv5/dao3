// scripts/decode-official-chunks.mjs
//
// 目标：破解官方体素分块 (official-project/racing-template/chunks/<CID>.bin) 的二进制编码。
// 本脚本是"解码器 + 收口自测"二合一：对每条编码假设尝试逐字节精确解码，并逐一验证
// 上一轮定义的 4 条收口判据。运行： node scripts/decode-official-chunks.mjs
//
// 无外部依赖，只读取仓库内文件（不修改 public/ 或 vendor/）。
// 结论（当前）：未解开 —— 见文末打印的反证。核心原因：这些 .bin 不是"逐体素 (index,id)"
// 列表，字节量 (~24KB/72 文件) 与方块总数 (~1.52M) 相差约 100 倍，且大文件带 protobuf 味
// (0x08/0x12/0x0a/0x10 tag 与高频续字节) 与 `_Y\0`(5f 59 00) 分段标记，符合
// vendor/.../AL-ChunkSystem.md "Chunk=把方块烘焙成合并网格(Mesh)" 的描述，即烘焙后的几何体。

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PKG = path.join(ROOT, "official-project/racing-template");
const DIR = path.join(PKG, "chunks");

// ---- 有效方块 id 集合（关键更正：官方 id 稀疏分布在 0..767，不是 0..383）----
const atlas = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/block-atlas.json"), "utf8"));
const VALID_IDS = new Set(Object.keys(atlas.byId).map(Number));
VALID_IDS.add(0); // air
const MAX_ID = Math.max(...VALID_IDS);

// ---- 占用图 (voxels.raw) 与共享 CID 分组 ----
const voxIdx = JSON.parse(fs.readFileSync(path.join(PKG, "voxels.raw"), "utf8"));
const SLOT_CIDS = voxIdx.chunks; // 256 槽位
const SHAPE = voxIdx.shape; // {x:256,y:128,z:256}
const byCid = {};
SLOT_CIDS.forEach((c, i) => (byCid[c] ||= []).push(i));
const EMPTY_CID = Object.entries(byCid).find(([c]) => fs.statSync(path.join(DIR, c + ".bin")).size === 2)[0];
const NONEMPTY = Object.keys(byCid).filter((c) => c !== EMPTY_CID);
const SHARED = Object.entries(byCid).find(([, s]) => s.length === 16 && s[0] !== 0);

function readChunk(cid) { return fs.readFileSync(path.join(DIR, cid + ".bin")); }

// ---- varint 读取 ----
function readVarint(b, p) {
  let s = 0, v = 0, i = p;
  while (i < b.length) { const x = b[i++]; v += (x & 0x7f) * 2 ** s; s += 7; if (!(x & 0x80)) return { v, i }; if (s > 56) return null; }
  return null; // 越界 / 未终止
}

// ================= 假设解码器 =================
// 返回 {ok, voxels, consumed, firstFail:{at,why}}
function decodeIdIndexPairs(b) { // (id, index) 变长对
  let i = 0, n = 0;
  while (i < b.length) { const a = readVarint(b, i); if (!a) return fail(i, "id越界"); i = a.i; if (a.v === 0) break; if (!VALID_IDS.has(a.v)) return fail(i, "非法id " + a.v); const c = readVarint(b, i); if (!c) return fail(i, "index越界"); i = c.i; n++; }
  return done(i === b.length, n, i, b.length);
}
function decodeIndexIdPairs(b) { // (index, id)
  let i = 0, n = 0;
  while (i < b.length) { const a = readVarint(b, i); if (!a) return fail(i, "index越界"); i = a.i; if (a.v === 0) break; const c = readVarint(b, i); if (!c) return fail(i, "id越界"); i = c.i; if (!VALID_IDS.has(c.v)) return fail(i, "非法id " + c.v); n++; }
  return done(i === b.length, n, i, b.length);
}
function decodeDeltaZigzag(b) { // (delta-index zigzag, id)
  let i = 0, idx = 0, n = 0;
  while (i < b.length) { const a = readVarint(b, i); if (!a) return fail(i, "delta越界"); i = a.i; idx += (a.v >>> 1) ^ -(a.v & 1); const c = readVarint(b, i); if (!c) return fail(i, "id越界"); i = c.i; if (!VALID_IDS.has(c.v)) return fail(i, "非法id " + c.v); n++; if (a.v === 0 && c.v === 0) break; }
  return done(i === b.length, n, i, b.length);
}
function decodePerIdIndexList(b) { // id -> (0 终止的 index 列表)
  let i = 0, n = 0;
  while (i < b.length) { const id = readVarint(b, i); if (!id) return fail(i, "id越界"); i = id.i; if (!VALID_IDS.has(id.v) || id.v === 0) return fail(i, "非法组id " + id.v); while (i < b.length) { const ix = readVarint(b, i); if (!ix) return fail(i, "index越界"); i = ix.i; if (ix.v === 0) break; n++; } }
  return done(i === b.length, n, i, b.length);
}
function decodeMaskOctree(b, maxDepth) { // 节点=1字节掩码; 0x00=叶(后跟id varint)
  const st = { i: 0 }; let vox = 0;
  function node(dp) {
    if (st.i >= b.length) return false;
    const m = b[st.i++];
    if (m === 0) { const id = readVarint(b, st.i); if (!id || !VALID_IDS.has(id.v)) return false; st.i = id.i; vox += 2 ** (3 * (maxDepth - dp)); return true; }
    if (dp >= maxDepth) return false;
    for (let k = 0; k < 8; k++) if (m >> k & 1) if (!node(dp + 1)) return false;
    return true;
  }
  const ok = node(0) && st.i === b.length;
  return { ok, voxels: vox, consumed: st.i, firstFail: ok ? null : { at: st.i, why: "掩码分叉无法在剩余字节内耗尽" } };
}
const fail = (at, why) => ({ ok: false, voxels: 0, consumed: at, firstFail: { at, why } });
const done = (ok, n, at, len) => ({ ok, voxels: n, consumed: at, firstFail: ok ? null : { at, why: `残字节 ${len - at}` } });

// ================= 收口判据评估 =================
function evaluate(name, dec) {
  let exact = 0, badId = 0, sumVox = 0, firstFail = null;
  for (const cid of NONEMPTY) {
    const b = readChunk(cid);
    const r = dec(b);
    sumVox += r.voxels;
    if (r.ok) exact++; else if (!firstFail) firstFail = { cid: cid.slice(0, 10), size: b.length, ...r.firstFail };
  }
  // 判据 c：16 槽共享 CID -> 同一文件 -> 内容逐字节相同（平凡成立）
  const sharedIdentical = SHARED ? fs.readFileSync(path.join(DIR, SHARED[0] + ".bin")).equals(fs.readFileSync(path.join(DIR, SHARED[0] + ".bin"))) : false;
  // 判据 d：与已知总数对齐（允许说明差异）
  const TARGET = 1523566;
  return { name, exact, files: NONEMPTY.length, sumVox, target: TARGET, ratio: (sumVox / TARGET).toFixed(4), firstFail, sharedIdentical };
}

console.log("=== 素材画像 ===");
console.log(`shape ${SHAPE.x}×${SHAPE.y}×${SHAPE.z} · 256 槽 · 空块CID=${EMPTY_CID.slice(0,8)}(2B) · 非空唯一CID=${NONEMPTY.length} · 16槽共享=${SHARED ? SHARED[0].slice(0,8) : "无"}`);
console.log(`有效方块 id：${VALID_IDS.size} 个（含 air），数值范围 0..${MAX_ID} —— 判据(b)的 "≤383" 是错的`);
const totalBytes = NONEMPTY.reduce((s, c) => s + readChunk(c).length, 0);
console.log(`72 个非空分块总字节 = ${totalBytes}；粗估可编码的最大记录数 ≈ ${NONEMPTY.reduce((s, c) => s + [...readChunk(c)].filter((x) => VALID_IDS.has(x)).length, 0)} —— 与 ${1523566} 相差 >${Math.round(1523566 / 9000)}×`);

console.log("\n=== 假设 × 收口判据 (a精确耗尽 / b合法id / d总数≈1.52M) ===");
const results = [
  evaluate("(id,index) varint对", decodeIdIndexPairs),
  evaluate("(index,id) varint对", decodeIndexIdPairs),
  evaluate("delta-zigzag (index,id)", decodeDeltaZigzag),
  evaluate("id→0终止 index列表", decodePerIdIndexList),
  evaluate("稀疏八叉树 掩码 depth5", (b) => decodeMaskOctree(b, 5)),
];
for (const r of results) {
  const verdict = (r.exact === r.files && r.sumVox > 1_000_000) ? "✅解开" : "❌不成立";
  console.log(`\n[${verdict}] ${r.name}`);
  console.log(`   (a)精确耗尽: ${r.exact}/${r.files}  (d)解出方块总数≈${r.sumVox} (${r.ratio}× of ${r.target})`);
  if (r.firstFail) console.log(`   首个反证: 文件 ${r.firstFail.cid}(${r.firstFail.size}B) @offset ${r.firstFail.at} -> ${r.firstFail.why}`);
}

const solved = results.some((r) => r.exact === r.files && r.sumVox > 1_000_000 && r.sharedIdentical);
console.log("\n=== 结论 ===");
console.log(solved ? "解开。" : "未解开：任何逐体素 (index,id) 类框架都无法同时满足 (a)精确耗尽 与 (d)总数≈1.52M。证据指向这些 .bin 是烘焙 Mesh 的 protobuf 分段容器(含 `_Y\\0`=5f5900 标记)，而非方块索引列表。");
