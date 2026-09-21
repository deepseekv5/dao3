# 架构与数据流

一句话：**编辑器和运行时共享同一份世界状态，运行是编辑态的预览，不是另一个进程。**

## 分层

```
                ┌───────────────────────────────────────────┐
                │  server.js  零依赖 Node 服务               │
                │  静态资源 · /api/world[ s] · 资产上传       │
                │  落盘格式 = gzip(JSON(VoxelPayload))        │
                └───────────────────┬───────────────────────┘
                                    │ fetch
┌───────────────────────────────────────────────────────────┐
│  main.js  编辑器装配                                        │
│    · 启动参数解析（?new / ?play / ?export）                 │
│    · 指针事件 → renderer.pick → TOOLS                       │
│    · save / loadWorld / enterPlay / stopPlay                │
└───────┬───────────────────────────────┬───────────────────┘
        │                               │
   ┌────▼─────┐                   ┌─────▼──────────┐
   │ world.js │◄── 同一实例 ──────│  game.js       │
   │ 稀疏体素  │                   │ 官方 GameAPI    │
   │ Map+pack │                   │ 运行时          │
   └────┬─────                   └─────┬──────────┘
        │ markDirty(cx,cy,cz)           │ 每 tick 读 get/getRot
   ┌────▼───────────────────────────────▼─────┐
   │ renderer.js  Three.js 分块网格            │
   │  · 面剔除 · 旋转码贴图重排 · 动画瓦片      │
   │  · 天气/雾/六面天光 · 区域预览 · 名牌层     │
   └──────────────────────────────────────────┘
```

## 为什么运行模式不复制一份世界

官方语义里"运行"就是预览：脚本改的东西不回写存档。
所以 `enterPlay()` 只做三件事——把场景模型同步回 `meta.entities`、把资产表交给运行时、
`game.start()`；`stopPlay()` 只回收通道与计时器。

这里踩过一次代价很高的坑：早先 `stopPlay` 会把运行时的**默认** `gameRules` 合并回
`state.meta.gameRules`。于是每跑一次自动化测试，就把一整套默认值固化进地图存档。
现在运行期的一切修改都是预览态，不回写。

## 实体只有一张表

官方没有"场景模型"和"玩法实体"两套东西——`entitiesTree` 是一张表，
带 `mesh` 的就是场景模型，不带的就是纯逻辑实体。本仓库照此办理：

- 内存里 `state.models` 是带 THREE 对象的视图（可点选、可拖、可换肤）
- 落盘时 `collectEntities()` 把它压回官方 22 字段
- 本地扩展字段（隐藏网格、物理盒偏移、gameRules、商品表、界面部件）
  一律走 `project/compat.json`，**绝不混进官方 22 字段**

`entity.id` 存的是实体**名字**，因为官方脚本这么写：
`parseInt(entity.id.match(/\d+/)[0])` 来给 `检查点-0…4` 排序。

## 模型拾取：射线打不中时用包围盒

单面材质朝后、被裁剪掉、或已经隐藏的网格，射线是打不中的——但用户点它就该选中它。
所以 `pickModel()` 先按常规射线求交，打不中再退化成"射线 × 缓存的 AABB"：

```js
const modelBox = (m) => {
  const v = m.object.matrixWorld ? m.object.matrixWorld.version : 0;
  if (!m._pickBox || m._pickBoxV !== v) {      // 世界矩阵没变就不重算
    m.object.updateWorldMatrix(true, true);
    m._pickBox = new THREE.Box3().setFromObject(m.object);
    m._pickBoxV = v;
  }
  return m._pickBox;
};
```

这是"所有模型都要可以设置"那条要求的落点：属性卡与标签页/模式解耦之后，
任何模式、任何可见性状态下都能选中并配置。

## 体素网格的增量重建

`renderer` 按 16³ 分块。写一格方块只标脏它所在块 + 越界时相邻块：

```js
markDirty(x, y, z) {
  const cx = Math.floor(x / CHUNK), …;
  this.markChunk(cx, cy, cz);
  if (x - cx * CHUNK === 0) this.markChunk(cx - 1, cy, cz);   // 贴块边界才带邻居
  …
}
```

批量写 1444 格实测 2ms、0 次音效——因为脏块在微任务里合并成一次 `flushChunks`。
早先每个 `setVoxel` 都重建一次并重放放置音效，脚本一跑就卡死+噪声，这是性能与
"官方语义"双重不可接受的行为。

## 脚本沙箱

`new Function(...keys, code)`，keys 由 `GameRuntime.SERVER_GLOBALS` /
`CLIENT_GLOBALS` 决定——两份名单**逐条对照官方 d.ts 的 `declare` 列表**，
不在名单上的成员在注入前就被删掉。所以服务端脚本里 `ui` 是 `undefined`，
客户端脚本里 `voxels` 是 `undefined`，和官方一致，而不是"反正也调不到"。

脚本异常只影响该回调：tick 循环里每个子系统单独 `_guard`，
物理抛了不会带走区域/环境/定时器/onTick。
