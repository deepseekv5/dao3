import * as THREE from "../vendor/three/three.module.js";
import { modelBytesToSchema, unpackMeshData, unpackTextureData } from "../vendor/box-model-decoder.js";

function mergeParts(list) {
  let vertexCount = 0, indexCount = 0;
  for (const g of list) { vertexCount += g.attributes.position.count; indexCount += g.index.count; }
  const pos = new Float32Array(vertexCount * 3), nor = new Float32Array(vertexCount * 3), uv = new Float32Array(vertexCount * 2);
  const idx = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position.array, n = g.attributes.normal.array, u = g.attributes.uv.array, ix = g.index.array;
    pos.set(p, vo * 3); nor.set(n, vo * 3); uv.set(u, vo * 2);
    for (let i = 0; i < ix.length; i++) idx[io + i] = ix[i] + vo;
    vo += g.attributes.position.count; io += ix.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export function buildBoxModel(bytes) {
  const decoded = modelBytesToSchema(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (!decoded || !decoded.schema) throw new Error("官方模型二进制解析失败");
  const data = decoded.schema;
  const tex = data.texture;
  const height = tex.width ? Math.max(1, Math.round(tex.data.length / tex.width)) : 1;
  const rgb = unpackTextureData(tex, [24, 16, 8]);
  const rgba = new Uint8Array(tex.width * height * 4);
  for (let i = 0, p = 0; i < rgb.length; i += 3, p += 4) {
    rgba[p] = rgb[i]; rgba[p + 1] = rgb[i + 1]; rgba[p + 2] = rgb[i + 2]; rgba[p + 3] = 255;
  }
  const texture = new THREE.DataTexture(rgba, tex.width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  const material = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide });
  const UV = Math.max(tex.width, height) > 255 ? Uint16Array : Uint8Array;
  const geometries = (data.meshes || []).map((groups) => {
    const u = unpackMeshData(groups, Uint16Array, UV);
    const n = u.meshData.length / 4;
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = u.meshData[i * 4];
      pos[i * 3 + 1] = u.meshData[i * 4 + 1];
      pos[i * 3 + 2] = u.meshData[i * 4 + 2];
      uv[i * 2] = u.uvData[i * 2] / tex.width;
      uv[i * 2 + 1] = u.uvData[i * 2 + 1] / height;
    }
    const idx = [];
    for (let i = 0; i < n; i += 4) idx.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  });
  const parts = new Map();
  const walk = (index, parent) => {
    const src = data.nodes[index];
    if (!src) return;
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(src.translation || [0, 0, 0]),
      new THREE.Quaternion().fromArray(src.rotation || [0, 0, 0, 1]),
      new THREE.Vector3().fromArray(src.scale || [1, 1, 1]),
    );
    const world = parent.clone().multiply(local);
    if (src.mesh >= 0 && geometries[src.mesh]) {
      const alpha = src.alpha == null ? 1 : src.alpha;
      if (!parts.has(alpha)) parts.set(alpha, []);
      parts.get(alpha).push(geometries[src.mesh].clone().applyMatrix4(world));
    }
    for (const child of src.children || []) walk(child, world);
  };
  const root = new THREE.Group();
  const rootNode = data.nodes[0];
  if (rootNode) for (const child of rootNode.children || []) walk(child, new THREE.Matrix4());
  for (const [alpha, list] of parts) {
    const merged = mergeParts(list);
    for (const g of list) g.dispose();
    const mat = alpha < 1 ? material.clone() : material;
    if (mat !== material) { mat.transparent = true; mat.opacity = alpha; }
    root.add(new THREE.Mesh(merged, mat));
  }
  root.userData.boxModel = { version: decoded.version, nodes: data.nodes?.length || 0, meshes: data.meshes?.length || 0, animations: data.animations?.length || 0 };
  return root;
}