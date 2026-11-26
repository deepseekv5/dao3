import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(ROOT, "public/js/voxel-worker.js"), "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); cond ? pass++ : fail++; };

function run(shape, records) {
  const meta = Buffer.from(JSON.stringify({ name: "worker-test" }));
  const out = Buffer.allocUnsafe(4 + meta.length + 16 + records.length * 7);
  let p = 0;
  out.writeUInt32LE(meta.length, p); p += 4; meta.copy(out, p); p += meta.length;
  for (const n of shape) { out.writeUInt32LE(n, p); p += 4; }
  out.writeUInt32LE(records.length, p); p += 4;
  for (const [index, id, rot] of records) { out.writeUInt32LE(index, p); out.writeUInt16LE(id, p + 4); out.writeUInt8(rot, p + 6); p += 7; }
  const buffer = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  let result = null;
  const context = { self: { postMessage: (message) => { if (message.type === "done") result = message; } }, TextDecoder, JSON, Math, Uint8Array, Uint16Array, Uint32Array, DataView, ArrayBuffer };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.self.onmessage({ data: { buffer } });
  return result;
}

const denseRecords = Array.from({ length: 10000 }, (_, i) => [i * 17, (i % 383) + 1, i % 97 === 0 ? 3 : 0]);
const dense = run([256, 256, 256], denseRecords);
ok("Worker 返回密集零拷贝结果", dense?.format === "dense" && dense.count === denseRecords.length && dense.ids.byteLength === 256 ** 3 * 2, JSON.stringify({ format: dense?.format, count: dense?.count, bytes: dense?.ids?.byteLength }));
const denseIds = new Uint16Array(dense.ids);
ok("密集 ID 与旋转索引正确", denseIds[0] === 1 && denseIds[17] === 2 && denseIds[169983] === denseRecords[9999][1] && dense.rotIndices.byteLength === Math.ceil(denseRecords.length / 97) * 4, JSON.stringify({ first: denseIds[17], rotations: dense.rotIndices.byteLength / 4 }));

const sparse = run([64, 64, 64], [[5, 7, 0], [99, 8, 2]]);
ok("Worker 稀疏回退路径无命名冲突", sparse?.format === "sparse" && sparse.indices.byteLength === 8 && sparse.data.byteLength === 4, JSON.stringify({ format: sparse?.format, indices: sparse?.indices?.byteLength }));

console.log(`\nPASS: ${pass}  FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
