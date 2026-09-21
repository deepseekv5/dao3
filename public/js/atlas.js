// atlas.js — 加载构建期合成的 block 图集，提供方块查询与 UV 计算。
import * as THREE from "../vendor/three/three.module.js";

export class BlockAtlas {
  constructor() {
    this.byName = new Map();
    this.idMap = new Map();
    this.categories = [];
    this.ready = false;
  }
  async load(base = "/data") {
    const resp = await fetch(`${base}/block-atlas.json`);
    const j = await resp.json();
    this.data = j;
    this.tileSize = j.tileSize; this.cell = j.cellSize; this.pad = j.pad;
    this.cellsPerRow = j.cellsPerRow; this.atlasWidth = j.atlasWidth;
    this.faceOrder = j.faceOrder;
    // 优先使用 byId（对象映射）；idMap 仅为兼容旧数据（值为名称字符串）
    const srcMap = j.byId || j.idMap;
    if (srcMap) {
      for (const [k, v] of Object.entries(srcMap)) this.idMap.set(Number(k), v);
    }
    if (j.blocks) {
      for (const b of j.blocks) { this.byName.set(b.name, b); if (!this.idMap.has(b.id)) this.idMap.set(b.id, b); }
    }
    console.log("[atlas] idMap size", this.idMap.size, "blocks", (j.blocks || []).length, "has byId", !!j.byId);
    this.categories = j.categories;
    const tex = new THREE.TextureLoader().load(`${base}/block-atlas.png`);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapNearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.flipY = true;
    this.texture = tex;
    this.ready = true;
    console.log("[atlas] loaded blocks=" + (j.blocks || []).length + " idMap=" + this.idMap.size + " hasByIdJson=" + !!j.byId);
    return this;
  }
  get(name) { return this.byName.get(name); }
  byId(id) { return this.idMap.get(id); }
  // 面槽位 0..5 = [left,right,bottom,top,front,back]
  faceTile(block, slot) { return block.faces[slot]; }
  // 返回 tile 索引对应的 UV 矩形 [u0,v0,u1,v1]（Three.js UV 原点左下，图集左上为原点）
  tileUV(tileIndex) {
    const col = tileIndex % this.cellsPerRow, row = Math.floor(tileIndex / this.cellsPerRow);
    const px = col * this.cell + this.pad, py = row * this.cell + this.pad;
    const inv = 1 / this.atlasWidth;
    const u0 = px * inv, u1 = (px + this.tileSize) * inv;
    const v0 = 1 - (py + this.tileSize) * inv, v1 = 1 - py * inv; // 翻转 Y
    return [u0, v0, u1, v1];
  }
  isTransparent(id) { const b = this.byId.get(id); return b ? b.transparent : false; }
  isEmissive(id) { const b = this.byId.get(id); return b ? (b.emissive[0] + b.emissive[1] + b.emissive[2]) > 0.05 : false; }
  emissiveColor(id) {
    const b = this.byId.get(id); if (!b) return [0, 0, 0];
    const [r, g, bl] = b.emissive; const m = Math.max(r, g, bl, 1e-3);
    return [Math.min(1, r / m + 0.2), Math.min(1, g / m + 0.2), Math.min(1, bl / m + 0.2)];
  }
  list() { return this.data.blocks; }
  listByCategory(cat) { return this.data.blocks.filter((b) => b.category === cat); }
}
