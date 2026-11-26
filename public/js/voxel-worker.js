self.onmessage = ({ data: message }) => {
  try {
    const bytes = new Uint8Array(message.buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const metaLen = view.getUint32(0, true);
    let p = 4 + metaLen;
    if (p + 16 > bytes.byteLength) throw new Error("世界二进制头不完整");
    const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + metaLen)) || "{}");
    const shape = [view.getUint32(p, true), view.getUint32(p + 4, true), view.getUint32(p + 8, true)];
    const count = view.getUint32(p + 12, true);
    p += 16;
    if (p + count * 7 > bytes.byteLength) throw new Error("世界二进制数据不完整");
    const cells = shape[0] * shape[1] * shape[2];
    if (cells >= 16 * 1024 * 1024 && cells <= 160 * 1024 * 1024) {
      const ids = new Uint16Array(cells), rotIndices = [], rotValues = [];
      let used = 0;
      for (let i = 0; i < count; i++) {
        const idx = view.getUint32(p, true), id = view.getUint16(p + 4, true), rot = bytes[p + 6];
        if (id) { ids[idx] = id; used++; if (rot) { rotIndices.push(idx); rotValues.push(rot); } }
        p += 7;
        if ((i & 0x7ffff) === 0x7ffff) self.postMessage({ type: "progress", value: (i + 1) / count });
      }
      const ri = Uint32Array.from(rotIndices), rv = Uint8Array.from(rotValues);
      self.postMessage({ type: "done", format: "dense", shape, meta, count: used, ids: ids.buffer, rotIndices: ri.buffer, rotValues: rv.buffer }, [ids.buffer, ri.buffer, rv.buffer]);
      return;
    }
    const indices = new Uint32Array(count), ids = new Uint16Array(count), rot = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      indices[i] = view.getUint32(p, true); ids[i] = view.getUint16(p + 4, true); rot[i] = bytes[p + 6];
      p += 7;
      if ((i & 0x7ffff) === 0x7ffff) self.postMessage({ type: "progress", value: (i + 1) / count });
    }
    self.postMessage({ type: "done", format: "sparse", shape, meta, indices: indices.buffer, data: ids.buffer, rot: rot.buffer }, [indices.buffer, ids.buffer, rot.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", message: err && err.message || String(err) });
  }
};
