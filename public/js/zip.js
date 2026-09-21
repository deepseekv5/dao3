// zip.js — 纯浏览器 ZIP 读取器（store + deflate），依赖 DecompressionStream('deflate-raw')。
// 用于导入 Box3/dao3 项目包（code/、project/、build/ 等）。

export async function readZipEntries(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // 从尾部找 EOCD (0x06054b50)
  let eocd = -1;
  const scanFrom = Math.max(0, u8.length - 66000);
  for (let i = u8.length - 22; i >= scanFrom; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("不是有效的 ZIP 文件");
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const entries = [];
  const td = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = td.decode(u8.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
    // 读本地头取得数据起点（本地头 extra 长度可能与中央目录不同）
    if (dv.getUint32(localOff, true) !== 0x04034b50) continue;
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = u8.subarray(dataStart, dataStart + compSize);
    if (name.endsWith("/")) { continue; }
    entries.push({ name, method, raw });
  }
  return { entries, async extract(entry) {
    if (entry.method === 0) return entry.raw;
    if (entry.method === 8) {
      const ds = new DecompressionStream("deflate-raw");
      const stream = new Blob([entry.raw]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error("不支持的压缩方法 " + entry.method);
  } };
}

// 便捷：按路径模式取第一个匹配的条目
export function findEntry(entries, ...patterns) {
  for (const p of patterns) {
    if (p instanceof RegExp) { const m = entries.find((e) => p.test(e.name)); if (m) return m; }
    else { const m = entries.find((e) => e.name === p || e.name.endsWith("/" + p)); if (m) return m; }
  }
  return null;
}

/* ------------------------------- 写包 ------------------------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function deflateRaw(u8) {
  try {
    const cs = new CompressionStream("deflate-raw");
    const out = new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(cs)).arrayBuffer());
    return out.length < u8.length ? out : null;
  } catch { return null; }
}
// files: [{ name, data: Uint8Array | string }]；优先 deflate-raw，压不动则 store
export async function writeZip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const name = enc.encode(f.name);
    const deflated = raw.length > 24 ? await deflateRaw(raw) : null;
    const body = deflated || raw;
    const method = deflated ? 8 : 0;
    const crc = crc32(raw);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, method, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, body);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true); ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true);
    ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);

    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true);
  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of [...parts, ...central, new Uint8Array(eocd.buffer)]) { out.set(b, p); p += b.length; }
  return out;
}
