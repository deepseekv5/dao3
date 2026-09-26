# 官方 API 全量索引

共 **100 个类 / 1044 个成员**，服务端独占 71、客户端独占 29（**没有"两端都有"的类**——
这个划分本身就是信息：拿 `GamePlayer` 在客户端找 `storage` 一定找不到）。

括号里是成员数。**不要整篇读这份文件**——它是目录，用来让你知道"有什么、叫什么"。
具体签名与官方中文说明按需查：

```bash
node scripts/dao3.mjs api --class GamePlayer     # 某个类的全部成员 + 签名 + 说明
node scripts/dao3.mjs api raycast                # 全文检索（成员名/说明/签名都参与匹配）
node scripts/dao3.mjs api --list                 # 全部 100 个类
```

查不到就说明**官方没有这个接口**。这时要明说"没有"，而不是编一个看起来合理的名字。

## 最常打交道的几个

| 类 | 成员数 | 端 | 是什么 |
|---|---|---|---|
| `GamePlayer` | 114 | server | 一个连接用户：移动、镜头、皮肤、按键通道、重生 |
| `GameWorld` | 111 | server | 引擎主入口：实体搜索、射线、区域、聊天、天气与时刻 |
| `GameEntity` | 95 | server | 场景里的游戏对象：位置、朝向、物理、粒子、音效 |
| `GameZone` | 46 | server | 区域触发器：进出事件、雾、雪、雨 |
| `GameEntityConfig` | 43 | server | `world.createEntity` 的参数形状 |
| `GameVector3` | 29 | server | 三维向量 |
| `UiText` | 14 | client | 客户端文本节点 |

## 服务端独占（71）

`GameAnalytics`（1） · `GameAnimation`（13） · `GameAnimationEvent`（4） · `GameAnimationPlaybackConfig`（7） · `GameAssetListEntry`（2） · `GameBounds3`（9） · `GameChatEvent`（3） · `GameClickEvent`（7） · `GameDamageEvent`（5） · `GameDatabase`（1） · `GameDataStorage`（8） · `GameDieEvent`（4） · `GameEntity`（95） · `GameEntityConfig`（43） · `GameEntityContact`（3） · `GameEntityContactEvent`（5） · `GameEntityEvent`（2） · `GameEntityKeyframe`（37） · `GameEventHandlerToken`（3） · `GameFluidContact`（2） · `GameFluidContactEvent`（3） · `GameGUI`（7） · `GameGUIEvent`（3） · `GameHttpAPI`（1） · `GameHttpFetchResponse`（8） · `GameHttpRequest`（3） · `GameHttpResponse`（3） · `GameHurtOptions`（2） · `GameInputEvent`（6） · `GameInteractEvent`（3） · `GameKeyBoardEvent`（2） · `GameMotionClipConfig`（2） · `GameMotionConfig`（2） · `GameMotionController`（4） · `GameMotionEvent`（4） · `GameMotionHandler`（7） · `GamePlayer`（114） · `GamePlayerKeyframe`（20） · `GamePurchaseSuccessEvent`（4） · `GameQuaternion`（26） · `GameQueryResult`（4） · `GameRaycastOptions`（5） · `GameRaycastResult`（9） · `GameRespawnEvent`（2） · `GameRGBAColor`（18） · `GameRGBColor`（18） · `GameRTC`（1） · `GameRTCChannel`（9） · `GameSensorAnalytics`（2） · `GameSoundEffect`（6） · `GameSoundEffectConfig`（6） · `GameStorage`（2） · `GameTickEvent`（4） · `GameTriggerEvent`（2） · `GameVector3`（29） · `GameVoxelContact`（6） · `GameVoxelContactEvent`（8） · `GameVoxels`（9） · `GameWearable`（11） · `GameWearableSpec`（9） · `GameWorld`（111） · `GameWorldKeyframe`（37） · `GameZone`（46） · `GUIBind`（3） · `GUIBindDefinition`（5） · `GUIConfigItem`（3） · `GUIData`（3） · `PlayerNavigator`（3） · `QueryList`（3） · `ServerRemoteChannel`（3） · `Sound`（4）

## 客户端独占（29）

`Audio`（6） · `AudioEvent`（1） · `BlobPropertyBag`（2） · `ClientHttp`（1） · `ClientMedia`（4） · `ClientNavigator`（3） · `ClientRemoteChannel`（3） · `ClientScreen`（1） · `ClientWorld`（1） · `Coord2`（3） · `DeviceInfo`（2） · `EventEmitter`（7） · `InputSystem`（5） · `MediaError`（2） · `RequestInit`（7） · `ResponseInit`（3） · `UiBox`（2） · `UiComponent`（2） · `UiEvent`（1） · `UiImage`（6） · `UiInput`（8） · `UiNode`（7） · `UiRenderable`（10） · `UiScale`（2） · `UiScreen`（5） · `UiScrollBox`（2） · `UiText`（14） · `Vec2`（4） · `Vec3`（8）

## 数据从哪来

`public/data/api-spec.json`，由 `npm run build:api-ref` 从各篇 d.ts 的 `declare` 列表
与官方中文注释合成。它同时喂三个地方：文档站、应用内 AI 的规范注入、以及上面的
`api` 查询命令。所以"AI 以为有的接口"和"实际实现的接口"不会各说一套。

写脚本前的硬约束与踩过的坑在 [scripting.md](scripting.md)。
