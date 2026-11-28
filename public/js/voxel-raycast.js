// Amanatides–Woo voxel DDA. 纯函数，便于逐格对拍与回归。
export function raycastVoxelWorld(world, classify, origin, direction, { maxDistance = 6000 } = {}) {
  const shape = world.shape;
  const o = origin, d = direction;
  let tMin = 0, tMax = maxDistance, entryAxis = -1;
  const axes = ["x", "y", "z"];
  for (let a = 0; a < 3; a++) {
    const v = axes[a];
    if (Math.abs(d[v]) < 1e-12) {
      if (o[v] < 0 || o[v] > shape[a]) return null;
      continue;
    }
    let t1 = (0 - o[v]) / d[v], t2 = (shape[a] - o[v]) / d[v];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tMin) { tMin = t1; entryAxis = a; }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (tMax < 0) return null;
  const startT = Math.max(0, tMin) + 1e-6;
  const p = [o.x + d.x * startT, o.y + d.y * startT, o.z + d.z * startT];
  let x = Math.floor(p[0]), y = Math.floor(p[1]), z = Math.floor(p[2]);
  const step = [d.x > 0 ? 1 : -1, d.y > 0 ? 1 : -1, d.z > 0 ? 1 : -1];
  const delta = [Math.abs(d.x) < 1e-12 ? Infinity : 1 / Math.abs(d.x), Math.abs(d.y) < 1e-12 ? Infinity : 1 / Math.abs(d.y), Math.abs(d.z) < 1e-12 ? Infinity : 1 / Math.abs(d.z)];
  const nextBoundary = (i, s) => s > 0 ? i + 1 : i;
  const tMaxAxis = [
    Math.abs(d.x) < 1e-12 ? Infinity : (nextBoundary(x, step[0]) - o.x) / d.x,
    Math.abs(d.y) < 1e-12 ? Infinity : (nextBoundary(y, step[1]) - o.y) / d.y,
    Math.abs(d.z) < 1e-12 ? Infinity : (nextBoundary(z, step[2]) - o.z) / d.z,
  ];
  const maxSteps = shape[0] + shape[1] + shape[2] + 12;
  let lastAxis = entryAxis, lastT = startT;
  for (let n = 0; n < maxSteps; n++) {
    if (x < 0 || y < 0 || z < 0 || x >= shape[0] || y >= shape[1] || z >= shape[2]) return null;
    const id = world.get(x, y, z);
    if (id) {
      const info = classify(id) || {};
      if (info.pickable !== false) {
        const axis = lastAxis >= 0 ? lastAxis : (tMaxAxis[0] < tMaxAxis[1] ? (tMaxAxis[0] < tMaxAxis[2] ? 0 : 2) : (tMaxAxis[1] < tMaxAxis[2] ? 1 : 2));
        const normal = [0, 0, 0]; normal[axis] = -step[axis];
        const cell = [x, y, z];
        const adjacent = [x, y, z]; adjacent[axis] -= step[axis];
        const dist = lastAxis >= 0 ? lastT : Math.max(startT, tMaxAxis[axis]);
        return { x, y, z, ax: adjacent[0], ay: adjacent[1], az: adjacent[2], nx: normal[0], ny: normal[1], nz: normal[2], point: [o.x + d.x * dist, o.y + d.y * dist, o.z + d.z * dist], dist };
      }
    }
    const axis = tMaxAxis[0] < tMaxAxis[1] ? (tMaxAxis[0] < tMaxAxis[2] ? 0 : 2) : (tMaxAxis[1] < tMaxAxis[2] ? 1 : 2);
    lastAxis = axis; lastT = tMaxAxis[axis];
    tMaxAxis[axis] += delta[axis];
    if (axis === 0) x += step[0]; else if (axis === 1) y += step[1]; else z += step[2];
  }
  return null;
}
