# 脚本规范（官方 API 口径）

写任何 dao3 脚本前先读这份。下面每条都是**踩过才写下来的**，不是通用 JS 常识。
拿不准接口存不存在，先查：`node scripts/dao3.mjs api <关键词>`（100 类 / 1044 成员，
带签名与官方中文说明）。**查不到就是官方没有，不要编一个。**

## 1. 两端是两套全局，不是一套

服务端和客户端注入的全局不同，实现方式是构造完整对象后**按白名单删**。

| 只给服务端 | 只给客户端 |
|---|---|
| `voxels` `resources` `storage` `db` `rtc` `analytics` `gui` | `ui` `input` `screen` `media` `navigator` |
| 全部 `Game*` 类型（`GameVector3` `GameBounds3` `GameRGBColor` …） | `Vec2` `Vec3` `Coord2` `Audio` `EventEmitter` |
| `getEntityBounds` `randomPick` | `UiBox` `UiText` `UiImage` … 全部 `Ui*` |
| | `call` `callAsync` `screenWidth` `screenHeight` |

**共用面**：`world` `http` `remoteChannel` `sleep` `console` 计时器与 JS 内建。

把 `storage` 写进客户端脚本不会报错给你看——它在客户端根本不存在，是 `undefined`，
第一次调用才炸。写完用 `dao3.mjs api --class GameWorld` 这类命令核对端归属。

## 2. 单位制：位移是「格 / tick」，不是「格 / 秒」

```
TICK_MS   = 64          → 1000/64 = 15.625 tick/秒（不是 20 TPS）
walkSpeed = 0.22 格/tick ≈ 3.4 格/秒
runSpeed  = 0.4
crouchSpeed = 0.1
gravity   = -0.1 格/tick²
jumpPower = 0.96 格/tick（起跳瞬时 vy；官方没有"跳跃重力系数"这种用法）
```

把 `walkSpeed` 当"格/秒"，人物会慢 15 倍。这是本项目最容易搞错的一处。

## 3. 四元数是 **xyzw**，不是 wxyz

实测官方 432 个实体朝向：276 个是 `[0,0,0,1]`，**0 个**是 `[1,0,0,0]`；
`[0, 0.707, 0, 0.707]` 表示绕 Y 轴 90° 偏航。所以：

```js
entity.orientation = [x, y, z, w]      // 单位四元数写 [0,0,0,1]
```

按 wxyz 读的话，绕 Y 的偏航会被当成绕 Z，立着的物体会被放倒。

## 4. 颜色有两套量纲，混用必错

- `GameRGBColor`（服务端）分量是 **0..1**
- 客户端 `Vec3` 颜色是 **0..255**
- 但 `sky.sunColor` 是**千分制**（官方存档里见过 `{r:1000,g:1000,b:1000}`）

同一个 blob 里 `fogColor` / `skyTop` 又是 0..1。判据：分量超过 1 就按千分制收回。

## 5. `sunPhase` 是 0..1，且 0 = 早上 6 点

```
0 = 06:00   0.25 = 12:00   0.5 = 18:00   0.75 = 午夜
```

当成 0..24 的小时数，正午永远是黄昏。

## 6. `transparent` 只是渲染标记，不是"无碰撞"

玻璃、冰、空气墙都带 `transparent`，但**照样挡人**。把它当无碰撞会做出能穿过去的墙。

## 7. `next*` 接受对象形式的匹配器

```js
await world.nextTick({ tick: 100 });          // 不是只有回调
await player.nextPress({ button: GameButtonType.JUMP });
```

## 8. 服务端脚本是 CommonJS

`require` 可用、`import` 语句不可用（客户端相反）。跨端共享逻辑走 `shares/`。

## 9. `movementBounds` 是夹回，不是重生

越界会**夹回边界**并清掉朝外的速度，不会把玩家扔回出生点。

## 10. 落盘与验证

改完全量写回（服务端没有补丁接口）：

```bash
node scripts/dao3.mjs script <mapId> --name index.js --file ./server.js --client ./client.js
node scripts/dao3.mjs api --class GameWorld        # 核对用到的成员
```

然后开 `http://127.0.0.1:5180/edit/<mapId>` 点顶栏 ▶ 进运行模式看控制台。
**类型检查和测试证明不了行为正确**——要真的跑一遍。

## 权威出处

- 完整逐成员签名：`docs/api-reference.md`（1.7 万词，别整篇读，按类查）
- 兼容层与踩坑全表：`docs/api-compat.md`
- 物理与单位：`docs/physics.md`
- 机器可读规范：`public/data/api-spec.json`
