# 物理与单位制

## 官方口径：位移是「格 / tick」，不是「格 / 秒」

```
TICK_MS = 64        // 20 TPS
walkSpeed           0.22  格/tick   ≈ 3.4 格/秒
runSpeed            0.4
crouchSpeed         0.1
flySpeed            2
gravity            -0.1  格/tick²
jumpPower           0.96
airFriction         0.001（地图可覆盖为官方 velocityDamping 0.01）
```

这是最容易搞错的一处：把 `walkSpeed` 当成"格/秒"，人物就会慢 15 倍。
`test/runtime_parity.mjs` 因此不是在墙上时间里量位移，而是**按真实推进的 tick 数归一**：

```js
out.walk = { per: 距离 / (currentTick - t0), want: P.walkSpeed };
```

实测 0.208–0.22 格/tick，与官方吻合。

## 定步长 + 追帧上限

```js
if (this._acc > TICK_MS * 5) { skip = true; this._acc = TICK_MS * 5; }
while (this._acc >= TICK_MS) { …一次 tick… }
```

一帧最多补 5 个 tick，超出就置 `skip` 并丢掉积压——否则切后台回来会一次性跑几百 tick，
把物理和脚本回调全炸开。`GameTickEvent.skip` 就是告诉脚本"这一 tick 是补的"。

tick 循环里每个子系统单独包 `_guard`：物理抛错不能带走区域/环境/定时器/onTick。
这和官方"脚本异常只影响该回调"一致。

## 碰撞判据的官方依据

**方块**：`block-spec.json` 里 `transparent` 只是渲染标记。
`glass / ice / barrier / 各种窗` 全是 `transparent: true` 但都挡人；
只有 `fluid: true`（含 `air`）不挡。所以：

```js
_solidAt(x, y, z) { …; return b.fluid ? 0 : id; }   // 不是 !b.transparent
```

这一条改掉消掉了 456 格"画得出来却穿得过去"的玻璃。射线求交与编辑器第一人称
行走用的是同一判据，三处必须一致。

**玩家盒**：`position` 是脚底，`half = 0.3 * scale`，`height = 1.8 * scale`。
**实体盒**：`position` 是盒心 → 传 `yOff = -半高`。
以前两者共用"position 即盒底"的假设，实体碰撞盒整体上移半格，该挡的不挡。

**anchorOffset**：官方 `getEntityBounds` = 中心 ± 半径，中心 = `position + anchorOffset`。
参与碰撞的实心盒与接触事件都用这个口径，漏掉偏移会把接触算到隔壁实体上。

## 子步推进，不重发整段

```js
const travel = (axis, amt) => {          // 每子步 ≤ 0.15 格
  while (left > 1e-6) { const s = Math.min(left, 0.15);
    if (apply(axis, dir * s)) { out[rem] = dir * left; return true; }  // 记下余量
    left -= s; }
};
```

早先撞到障碍后"抬身 → 重发**整段**位移"，既绕过子步形成高速隧穿，
又让实际位移比官方多 1.68 倍。现在抬身之后只走**剩下的**那段。

## 自动踏步

`STEP_UP = 0.55` 格，且抬升本身也走子步、随时校验头顶净空：

- 撞到 ≤0.55 的障碍 → 抬脚迈过去（台阶）
- 撞到 1 格墙 → 抬不上去，**必须起跳**（官方如此）
- 抬完仍过不去 → 原样退回，不白送高度

之前是单发 `apply("y", 1.0)` 且无头顶判定，走路就能爬满格墙。

## 相机不穿墙

```js
if (back.hit) {
  dist = Math.min(dist, Math.max(0.22, back.distance - 0.24));
  lift = clamp((2.4 - dist) * 0.34, 0, 0.85);   // 收得越紧越抬成过肩
}
```

原来的 `Math.max(0.8, …)` 硬下限正是"相机留在几何体里"的原因
（120 个贴墙站位 × 12 yaw × 2 pitch 的扫描里 7.9% 落在实心格内）。
去掉硬下限会顶到后脑勺，所以配上抬肩。

## 已知边界

- 方块一律整格立方：官方 `block-spec.json` 没有 slab/stair/shape 字段，
  网格与物理都是整格，所以**不存在台阶/斜坡形状**，旋转码只改贴图来源。
- 蹲下不改物理盒高度（官方 player 只有 `crouchSpeed/crouchAcceleration`，
  没有任何高度/碰撞相关字段），因此蹲着进不了 1 格洞是符合官方数据的表现。
- `restitution/friction/mass` 走简化刚体，不是完整物理引擎；
  弹跳垫与传送带的方向按方块旋转码绕 Y 旋转。
