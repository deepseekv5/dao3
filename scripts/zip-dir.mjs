#!/usr/bin/env node
// zip-dir.mjs — 生成可分发的 zip：UTF-8 文件名 + Unix 权限位。
//
// 为什么不用系统 zip / ditto：两者写目录条目时都不置 general-purpose bit 11，
// 中文条目名在简体中文 Windows（代码页 936）的资源管理器里会解成乱码。
// 权限位同理必须自己写 external_attr，否则 macOS 解出来的 .command / run.sh 不可执行。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const [src, target] = process.argv.slice(2);
if (!src || !target) {
  console.error("用法: node scripts/zip-dir.mjs <目录> <输出.zip> [zip 内根名]");
  process.exit(2);
}
const ROOT_ABS = path.resolve(src);
const PREFIX = process.argv[4] || path.basename(ROOT_ABS);

const TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c;
}
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const dosStamp = (d) => ({
  time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
  date: (((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
});

// 文本按 0644、脚本/二进制按 0755 太粗，直接沿用磁盘上的模式位。
const modeOf = (st, name) => {
  const m = st.mode & 0o777;
  if (/\.(sh|command|bash|zsh)$/.test(name)) return 0o755;
  return m || 0o644;
};

const entries = [];
const walk = (abs, rel) => {
  for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === ".DS_Store") continue;
    const a = path.join(abs, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(a, r);
    else if (e.isFile()) entries.push({ abs: a, rel: r });
  }
};
walk(ROOT_ABS, "");

const chunks = [];
const central = [];
let offset = 0;
const enc = new TextEncoder();

for (const { abs, rel } of entries) {
  const st = fs.statSync(abs);
  const data = fs.readFileSync(abs);
  const nameBuf = enc.encode(`${PREFIX}/${rel}`); // TextEncoder 恒为 UTF-8，配合 bit 11
  const deflated = data.length > 32 ? zlib.deflateRawSync(data, { level: 9 }) : null;
  const body = deflated && deflated.length < data.length ? deflated : data;
  const method = body === deflated ? 8 : 0;
  const crc = crc32(data);
  const { time, date } = dosStamp(st.mtime);
  const mode = modeOf(st, rel);

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x0800, 6); // UTF-8 文件名
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(time, 10);
  lh.writeUInt16LE(date, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(body.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  chunks.push(lh, nameBuf, body);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x0800, 8);
  ch.writeUInt16LE(method, 10);
  ch.writeUInt16LE(time, 12);
  ch.writeUInt16LE(date, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(body.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt16LE(0, 30);
  ch.writeUInt16LE(0, 32);
  ch.writeUInt8(0, 34);
  ch.writeUInt8(0, 35);
  ch.writeUInt32LE(0, 36);
  ch.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38); // S_IFREG + 权限
  ch.writeUInt32LE(offset, 42);
  central.push(ch, nameBuf);

  offset += lh.length + nameBuf.length + body.length;
}

const cd = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(cd.length, 12);
eocd.writeUInt32LE(offset, 16);
const out = Buffer.concat([...chunks, cd, eocd]);
fs.writeFileSync(path.resolve(target), out);
console.log(JSON.stringify({
  target: path.resolve(target), entries: entries.length,
  sizeMB: +(out.length / 1048576).toFixed(2), root: PREFIX,
}));
