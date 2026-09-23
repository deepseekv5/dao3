# API 参考

> **本页由 `npm run build:api-ref` 从官方类型声明自动生成，不要手改。**
> 来源：`vendor/ArenaPro-CLI/server/types/GameAPI.d.ts`（服务端） 与 `vendor/ArenaPro-CLI/client/types/ClientAPI.d.ts`（客户端）；
> 本地覆盖列比对 `public/data/api-impl.json`（`npm run audit:api` 产出）。

共 **125 个类型**、**1044 个成员**，其中 1005 个带官方中文说明。

## 怎么读这张表

- **说明**里的单位一律照抄官方注释。这套 API 最容易错的就是单位：速度是 **格/tick**（20 tick/秒）而不是格/秒，`duration` 是**毫秒**，距离是**米＝格**。详见[物理与单位制](physics.md)。
- **本地**列：✅ 表示本地实现里有这个成员；**缺** 表示官方声明里有、本地找不到——脚本里用了就是 `undefined`。判定来自 `npm run audit:api` 的**静态比对**（在运行时源码里找这个名字），不是逐个真调用；`GameWorld / GameEntity / GamePlayer / GameVoxels` 这四类另有浏览器内的真运行时对账（`public/js/api-probe.js`，`test/e2e.mjs` 每次都会跑），那四类可以放心当实测结论。
- 标注 **已废弃** 的成员官方不建议再用，本页仍保留，因为老地图的脚本里还在调。
- 说明里的 `•` 行是官方 `@param` 逐条参数说明，顺序与签名一致。
- 只想把地图跑起来、不打算写脚本：看应用内的游玩手册（工作台左侧「手册」，本地地址 <code>/manual</code>）。
- 想按主题读而不是按类型查：[官方 API 兼容层](api-compat.md)；单位与物理口径：[物理与单位制](physics.md)。

## 全局对象

脚本里不需要 import、直接就能写的那些名字。**服务端**指 `?play` 里跑的那份逻辑，**客户端**只在 `ui` 沙箱里可见。同名两端都有的是两个不同对象（比如 `world`）。

| 名字 | 端 | 类型 | 说明 | 本地 |
| --- | --- | --- | --- | --- |
| `console` | 服务端 | `（内联对象）` | 控制台对象，用于在控制台输出信息。 | — |
| `world` | 服务端 | `GameWorld` | GameWorld 是整个游戏世界的主要接口，它对应涵盖了控制环境天气、物理重力、画面滤镜等全局场景属性，还可以在世界中创建、搜索实体，或监听世界中实体和玩家的碰撞、伤害、互动等事件。 | ✅ |
| `voxels` | 服务端 | `GameVoxels` | GameVoxels 是控制游戏方块的接口，你可以控制地形变化，利用循环语法批量生成/销毁方块，获取某个方块的类型、名称、旋转角度等。 | ✅ |
| `resources` | 服务端 | `（内联对象）` | GameAssetListEntry 是控制游戏中的资产对象，用于获取游戏内模型、图片、音频等资源。 | — |
| `db` | 服务端 | `GameDatabase` | 旧代编辑器使用的数据库接口，已弃用，请在使用GameDataStorage。 | ✅ |
| `storage` | 服务端 | `GameStorage` | GameDataStorage 代表数据存储空间的类，能控制单地图或组地图数据库，能够以键值对的形式存储数据，提供方法处理空间内键值对相关的操作。 | ✅ |
| `http` | 服务端 | `GameHttpAPI` | GameHttpAPI 是可以链接外部网站数据的对象，用于对接第三方平台接口的操作。 | ✅ |
| `rtc` | 服务端 | `GameRTC` | GameRTC 是实时通讯技术，用于与其他游戏玩家语音交流的操作。 | ✅ |
| `analytics` | 服务端 | `GameAnalytics` | GameAnalytics 是专业的游戏数据分析模块，提供强大的数据追踪与分析能力。借助此模块，你可以精确记录玩家行为、监控游戏事件并获取深入的数据洞察，为游戏优化和决策提供有力支持。 | ✅ |
| `gui` | 服务端 | `GameGUI` | 较老版本的GUI接口，已不推荐使用，请在客户端使用GameUI。 | ✅ |
| `remoteChannel` | 服务端 | `ServerRemoteChannel` | ServerRemoteChannel 是管理客户端与服务端通讯的对象，用于对跨端传递信息的操作。 | ✅ |
| `sleep` | 服务端 | `function sleep(ms: number): Promise<void>` | sleep是一种函数，作用是延时，程序暂停若干时间。在执行时可能会抛出一个中断异常，建议对其进行捕获并处理。 | — |
| `setTimeout` | 服务端 | `function setTimeout(callback: Function, delayMs: number): number` | 用于延迟执行函数的计时器，`delayMs`毫秒后异步执行回调函数`callback`。 该函数自身是同步的，返回用于清除此计时器的ID，可在 `clearTimeout` 中使用。 | — |
| `clearTimeout` | 服务端 | `function clearTimeout(id: number): void` | 用于清除传入ID对应的 `setTimeout` 计时器。 | — |
| `setInterval` | 服务端 | `function setInterval(callback: Function, delayMs: number): number` | 用于定时执行函数的计时器，每 `delayMs` 毫秒后异步执行回调函数 `callback`。 该函数自身是同步的，返回用于清除此计时器的ID，可在 `clearInterval` 中使用。 | — |
| `clearInterval` | 服务端 | `function clearInterval(id: number): void` | 用于清除传入ID对应的 `setInterval` 计时器。 | — |
| `console` | 客户端 | `（内联对象）` | 控制台对象，用于在控制台输出信息。 | — |
| `screenWidth` | 客户端 | `number` | 游戏屏幕的宽度，取决于玩家进入游戏时的屏幕大小。 | — |
| `screenHeight` | 客户端 | `number` | 游戏屏幕的高度，取决于玩家进入游戏时的屏幕大小。 | — |
| `ui` | 客户端 | `UiNode` | 默认的屏幕下的UI根节点。<br>**已废弃**：已不推荐使用该属性，请使用[UiScreen](#uiscreen)获取屏幕对象。 | ✅ |
| `remoteChannel` | 客户端 | `ClientRemoteChannel` | 客户端与服务端通信的通道。 | ✅ |
| `navigator` | 客户端 | `ClientNavigator` | 获取客户端的浏览器信息。 | ✅ |
| `world` | 客户端 | `ClientWorld` | 获取客户端的游戏世界。 | ✅ |
| `input` | 客户端 | `InputSystem` | 全局监听玩家的输入。 | ✅ |
| `screen` | 客户端 | `ClientScreen` | 全局监听玩家的屏幕。 | ✅ |
| `media` | 客户端 | `ClientMedia` | 获取客户端的录音管理器。 | ✅ |
| `http` | 客户端 | `ClientHttp` | 客户端请求外部数据 | ✅ |
| `sleep` | 客户端 | `function sleep(ms: number): Promise<void>` | 延迟指定毫秒后返回一个 resolve 的 Promise 对象。 | — |
| `setTimeout` | 客户端 | `function setTimeout(callback: Function, delayMs: number): number` | 用于延迟执行函数的计时器，`delayMs` 毫秒后异步执行回调函数 `callback`。 | — |
| `clearTimeout` | 客户端 | `function clearTimeout(id: number): void` | 用于清除传入 ID 对应的 `setTimeout` 计时器。 | — |
| `setInterval` | 客户端 | `function setInterval(callback: Function, delayMs: number): number` | 用于定时执行函数的计时器，每 `delayMs` 毫秒后异步执行回调函数 `callback`。 | — |
| `clearInterval` | 客户端 | `function clearInterval(id: number): void` | 用于清除传入 ID 对应的 `setInterval` 计时器。 | — |
| `call` | 客户端 | `function call(key, value, callback?): any` | 子窗口向父窗口通信 仅在 Webview 中 callback 生效 | — |
| `callAsync` | 客户端 | `function callAsync(key, value): Promise<any>` | 子窗口向父窗口异步通信 | — |

### console

*内联对象 · GameAPI*

> 控制台对象，用于在控制台输出信息。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `assert` | `assert: (assertion, ...args: any[]) => void` | 断言，如果断言为 false，则在控制台输出错误信息。 |
| `log` | `log: GameLoggerMethod` | 在控制台输出日志信息。 |
| `debug` | `debug: GameLoggerMethod` | 在控制台输出调试信息。 |
| `error` | `error: GameLoggerMethod` | 在控制台输出错误信息。 |
| `warn` | `warn: GameLoggerMethod` | 在控制台输出警告信息。 |
| `clear` | `clear: GameLoggerMethod` | 清空控制台。 |

### resources

*内联对象 · GameAPI*

> GameAssetListEntry 是控制游戏中的资产对象，用于获取游戏内模型、图片、音频等资源。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `ls` | `ls: ( path?: "snow" \| "mesh" \| "picture" \| "audio" \| "lut" ) => GameAssetListEntry[]` | 列出指定类型的游戏资源。<br>• path：可选。指定游戏资源的类型。如果不提供，默认返回全部资源（包含脚本）。<br>- 'snow': 查询雪贴图资源。<br>- 'mesh': 查询体素模型资源。<br>- 'picture': 查询图片资源。<br>- 'audio': 查询音频资源。<br>- 'lut': 查询滤镜资源。<br>• 返回值：返回一个 GameAssetListEntry 对象数组，每个对象代表一个游戏资源条目。 |

### console

*内联对象 · ClientAPI*

> 控制台对象，用于在控制台输出信息。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `assert` | `assert: (assertion, ...args: any[]) => void` | 断言，如果断言为 false，则在控制台输出错误信息。 |
| `log` | `log: GameLoggerMethod` | 在控制台输出日志信息。 |
| `debug` | `debug: GameLoggerMethod` | 在控制台输出调试信息。 |
| `error` | `error: GameLoggerMethod` | 在控制台输出错误信息。 |
| `warn` | `warn: GameLoggerMethod` | 在控制台输出警告信息。 |
| `clear` | `clear: GameLoggerMethod` | 清空控制台。 |

## 目录

### 世界与实体

[GameAnimation](#gameanimation) · [GameAnimationDirection](#gameanimationdirection) · [GameAnimationEvent](#gameanimationevent) · [GameAnimationPlaybackConfig](#gameanimationplaybackconfig) · [GameAnimationPlaybackState](#gameanimationplaybackstate) · [GameEntity](#gameentity) · [GameEntityConfig](#gameentityconfig) · [GameEntityContact](#gameentitycontact) · [GameEntityContactEvent](#gameentitycontactevent) · [GameEntityEvent](#gameentityevent) · [GameEntityKeyframe](#gameentitykeyframe) · [GameFluidContact](#gamefluidcontact) · [GameFluidContactEvent](#gamefluidcontactevent) · [GameHurtOptions](#gamehurtoptions) · [GameMotionClipConfig](#gamemotionclipconfig) · [GameMotionConfig](#gamemotionconfig) · [GameMotionController](#gamemotioncontroller) · [GameMotionEvent](#gamemotionevent) · [GameMotionHandler](#gamemotionhandler) · [GamePlayer](#gameplayer) · [GamePlayerKeyframe](#gameplayerkeyframe) · [GamePlayerMoveState](#gameplayermovestate) · [GamePlayerWalkState](#gameplayerwalkstate) · [GameQueryResult](#gamequeryresult) · [GameRaycastOptions](#gameraycastoptions) · [GameRaycastResult](#gameraycastresult) · [GameSoundEffect](#gamesoundeffect) · [GameSoundEffectConfig](#gamesoundeffectconfig) · [GameTriggerEvent](#gametriggerevent) · [GameVoxelContact](#gamevoxelcontact) · [GameVoxelContactEvent](#gamevoxelcontactevent) · [GameWearable](#gamewearable) · [GameWearableSpec](#gamewearablespec) · [GameWorld](#gameworld) · [GameWorldKeyframe](#gameworldkeyframe) · [GameZone](#gamezone)

### 方块与体素

[GameVoxels](#gamevoxels)

### 事件对象

[AudioEvent](#audioevent) · [GameChatEvent](#gamechatevent) · [GameClickEvent](#gameclickevent) · [GameDamageEvent](#gamedamageevent) · [GameDieEvent](#gamedieevent) · [GameGUIEvent](#gameguievent) · [GameInputEvent](#gameinputevent) · [GameInteractEvent](#gameinteractevent) · [GameKeyBoardEvent](#gamekeyboardevent) · [GamePurchaseSuccessEvent](#gamepurchasesuccessevent) · [GameRespawnEvent](#gamerespawnevent) · [GameTickEvent](#gametickevent) · [UiEvent](#uievent)

### 值与配置

[GameAssetListEntry](#gameassetlistentry) · [GameAssetType](#gameassettype) · [GameBodyPart](#gamebodypart) · [GameBounds3](#gamebounds3) · [GameButtonType](#gamebuttontype) · [GameCameraFreezedAxis](#gamecamerafreezedaxis) · [GameCameraMode](#gamecameramode) · [GameDatabase](#gamedatabase) · [GameDataStorage](#gamedatastorage) · [GameDialogType](#gamedialogtype) · [GameEasing](#gameeasing) · [GameEventHandlerToken](#gameeventhandlertoken) · [GameInputDirection](#gameinputdirection) · [GameLogLevel](#gameloglevel) · [GameQuaternion](#gamequaternion) · [GameRGBAColor](#gamergbacolor) · [GameRGBColor](#gamergbcolor) · [GameVector3](#gamevector3)

### 客户端界面

[AbortError](#aborterror) · [Audio](#audio) · [Blob](#blob) · [BlobPropertyBag](#blobpropertybag) · [BodyMixin](#bodymixin) · [ClientHttp](#clienthttp) · [ClientMedia](#clientmedia) · [ClientNavigator](#clientnavigator) · [ClientRemoteChannel](#clientremotechannel) · [ClientScreen](#clientscreen) · [ClientWorld](#clientworld) · [Coord2](#coord2) · [DeviceInfo](#deviceinfo) · [EventEmitter](#eventemitter) · [FetchError](#fetcherror) · [Headers](#headers) · [ImageDisplayMode](#imagedisplaymode) · [InputSystem](#inputsystem) · [MediaError](#mediaerror) · [MediaErrorCode](#mediaerrorcode) · [PointerEventBehavior](#pointereventbehavior) · [RequestInit](#requestinit) · [Response](#response) · [ResponseInit](#responseinit) · [Sound](#sound) · [UiBox](#uibox) · [UiComponent](#uicomponent) · [UiImage](#uiimage) · [UiInput](#uiinput) · [UiNode](#uinode) · [UiRenderable](#uirenderable) · [UiScale](#uiscale) · [UiScreen](#uiscreen) · [UiScrollBox](#uiscrollbox) · [UiText](#uitext) · [UITextFontFamily](#uitextfontfamily) · [Vec2](#vec2) · [Vec3](#vec3)

### 平台与网络

[GameAnalytics](#gameanalytics) · [GameGUI](#gamegui) · [GameGUIEventListener](#gameguieventlistener) · [GameHttpAPI](#gamehttpapi) · [GameHttpFetchResponse](#gamehttpfetchresponse) · [GameHttpRequest](#gamehttprequest) · [GameHttpResponse](#gamehttpresponse) · [GameRTC](#gamertc) · [GameRTCChannel](#gamertcchannel) · [GameSensorAnalytics](#gamesensoranalytics) · [GameStorage](#gamestorage) · [GUIBind](#guibind) · [GUIBindDefinition](#guibinddefinition) · [GUIConfigItem](#guiconfigitem) · [GUIData](#guidata) · [QueryList](#querylist) · [ServerRemoteChannel](#serverremotechannel) · [SocialType](#socialtype)

### 其它类型

[PlayerNavigator](#playernavigator)

## 世界与实体

_world / player / entity：跑图时最常碰的那一圈_

### GameAnimation

*class · GameAPI*

> 游戏动画类，用于控制和管理动画播放。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `target` | `target: TargetType` | 动画目标对象（可能是世界、玩家或实体）。 | — |
| `keyframes` | `keyframes: () => Partial<KeyframeType>[]` | 返回所有动画关键帧。 | — |
| `play` | `play: (playback?: Partial<GameAnimationPlaybackConfig>) => void` | 开始或重新开始播放动画。 | — |
| `cancel` | `cancel: () => void` | 取消当前动画播放。 | — |
| `onReady` | `onReady: GameEventChannel<GameAnimationEvent<KeyframeType, TargetType>>` | 当动画开始时触发。 | — |
| `nextReady` | `nextReady: GameEventFuture<GameAnimationEvent<KeyframeType, TargetType>>` | 获取下一个动画准备完成的事件。 | — |
| `onFinish` | `onFinish: GameEventChannel<GameAnimationEvent<KeyframeType, TargetType>>` | 当动画成功完成时触发。 | — |
| `nextFinish` | `nextFinish: GameEventFuture<GameAnimationEvent<KeyframeType, TargetType>>` | 获取下一个动画完成的事件。 | — |
| `currentTime` | `currentTime: number` | 动画的当前播放时间（以动画帧为单位）。 | — |
| `startTime` | `startTime: number` | 动画的开始刻度 | — |
| `playState` | `playState: GameAnimationPlaybackState` | 动画的当前播放状态 | — |
| `playbackRate` | `playbackRate: number` | 播放速率（每刻度的帧数） | — |
| `then` | `then<T>( resolve: (event: GameAnimationEvent<KeyframeType, TargetType>) => T` | — | — |

### GameAnimationDirection

*enum · GameAPI*

_（无成员级声明：枚举或纯数据形状。）_

### GameAnimationEvent

*class · GameAPI*

> 表示游戏动画中的一个事件，封装了当前帧数、目标对象、动画详情和取消状态等信息。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `tick` | `tick: number` | — | — |
| `target` | `target: TargetType` | — | — |
| `animation` | `animation: GameAnimation<KeyframeType, TargetType>` | — | — |
| `cancelled` | `cancelled: boolean` | — | — |

### GameAnimationPlaybackConfig

*interface · GameAPI*

> 定义游戏动画播放的配置接口。 这个接口包含了动画播放的所有必要参数，用于控制动画的行为和特性。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `startTick` | `startTick: number` | 动画开始的时间点，单位为毫秒。 | — |
| `delay` | `delay: number` | 动画开始前的延迟时间，单位为毫秒。 | — |
| `endDelay` | `endDelay: number` | 动画结束后的延迟时间，单位为毫秒。 | — |
| `duration` | `duration: number` | 动画持续的总时间，单位为毫秒。 | — |
| `direction` | `direction: GameAnimationDirection` | 动画播放的方向，可能的值包括正向、反向、交替等。 | — |
| `iterationStart` | `iterationStart: number` | 动画开始播放的位置，表示在动画周期中的一个比例。 | — |
| `iterations` | `iterations: number` | 动画重复播放的次数，无限重复时可以设置为特定值（例如Infinity）。 | — |

### GameAnimationPlaybackState

*enum · GameAPI*

_（无成员级声明：枚举或纯数据形状。）_

### GameEntity

*class · GameAPI*

> 实体是游戏中的游戏对象，可以用来表示玩家、物体等。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tags` | `tags: () => string[]` | 获取分配给实体的所有标签集合。 | ✅ |
| `addTag` | `addTag: (tag: string) => void` | 向实体添加新标签。<br>• tag：_param tag 要添加的标签。 | ✅ |
| `removeTag` | `removeTag: (tag: string) => void` | 从实体中移除标签。<br>• tag：_param tag 要移除的标签。 | ✅ |
| `hasTag` | `hasTag: (tag: string) => boolean` | 测试实体是否具有某个标签。<br>• tag：_param tag 要测试的标签。<br>• 返回值：_returns 如果实体有该标签则返回 true，否则返回 false。 | ✅ |
| `destroy` | `destroy: () => void` | 销毁实体。 | ✅ |
| `onDestroy` | `onDestroy: GameEventChannel<GameEntityEvent>` | 当实体被销毁时调用。 | ✅ |
| `nextDestroy` | `nextDestroy: GameEventFuture<GameEntityEvent>` | 下一次实体被销毁时的未来事件。 | ✅ |
| `onTakeDamage` | `onTakeDamage: GameEventChannel<GameDamageEvent>` | 当实体受到伤害时调用。 | ✅ |
| `nextTakeDamage` | `nextTakeDamage: GameEventFuture<GameDamageEvent>` | 下一次实体受到伤害时的未来事件。 | ✅ |
| `onDie` | `onDie: GameEventChannel<GameDieEvent>` | 当实体死亡时调用。 | ✅ |
| `nextDie` | `nextDie: GameEventFuture<GameDieEvent>` | 下一次实体死亡时的未来事件。 | ✅ |
| `hurt` | `hurt: (amount: number, options?: Partial<GameHurtOptions>) => void` | 对实体造成伤害。<br>• amount：_param amount 伤害量。<br>• options：_param options 伤害选项。 | ✅ |
| `say` | `say: ( message: string, options?: Partial<{ /** * @zh * 气泡及广播提示语的持续时间（ms)。 * - 缺省值：2000 * @en * The duration of the bubble and broadcast message in milliseconds. * - Default: 2000 */ duration: number; /** * @zh *…` | 使实体说话。<br>• message：_param message 要说的信息。<br>• options：_param options 说话的选项。 | ✅ |
| `animate` | `animate: ( keyframes: Partial<GameEntityKeyframe>[], playbackInfo?: Partial<GameAnimationPlaybackConfig> ) => GameAnimation<GameEntityKeyframe, GameEntity>` | 在实体上播放动画。<br>• keyframes：_param keyframes 动画的关键帧。<br>• playbackInfo：_param playbackInfo 动画的播放信息。<br>• 返回值：_returns 动画实例。 | ✅ |
| `getAnimations` | `getAnimations: () => GameAnimation<GameEntityKeyframe, GameEntity>[]` | 获取实体当前播放的所有动画。<br>• 返回值：_returns 动画实例数组。 | ✅ |
| `onClick` | `onClick: GameEventChannel<GameClickEvent>` | 当玩家点击此实体时调用。 | ✅ |
| `nextClick` | `nextClick: GameEventFuture<GameClickEvent>` | 下一次玩家点击此实体时的未来事件。 | ✅ |
| `onEntityContact` | `onEntityContact: GameEventChannel<GameEntityContactEvent>` | 当实体接触另一个实体时调用。 | ✅ |
| `nextEntityContact` | `nextEntityContact: GameEventFuture<GameEntityContactEvent>` | 下一次实体接触另一个实体时的未来事件。 | ✅ |
| `onEntitySeparate` | `onEntitySeparate: GameEventChannel<GameEntityContactEvent>` | 当实体停止接触另一个实体时调用。 | ✅ |
| `nextEntitySeparate` | `nextEntitySeparate: GameEventFuture<GameEntityContactEvent>` | 下一次实体停止接触另一个实体时的未来事件。 | ✅ |
| `onVoxelContact` | `onVoxelContact: GameEventChannel<GameVoxelContactEvent>` | 当实体接触方块时调用。 | ✅ |
| `nextVoxelContact` | `nextVoxelContact: GameEventFuture<GameVoxelContactEvent>` | 下一次实体接触方块时的未来事件。 | ✅ |
| `onVoxelSeparate` | `onVoxelSeparate: GameEventChannel<GameVoxelContactEvent>` | 当实体停止接触方块时调用。 | ✅ |
| `nextVoxelSeparate` | `nextVoxelSeparate: GameEventFuture<GameVoxelContactEvent>` | 下一次实体停止接触方块时的未来事件。 | ✅ |
| `onFluidEnter` | `onFluidEnter: GameEventChannel<GameFluidContactEvent>` | 当实体进入流体时调用。 | ✅ |
| `nextFluidEnter` | `nextFluidEnter: GameEventFuture<GameFluidContactEvent>` | 下一次实体进入流体时的未来事件。 | ✅ |
| `onFluidLeave` | `onFluidLeave: GameEventChannel<GameFluidContactEvent>` | 当实体离开流体时调用。 | ✅ |
| `nextFluidLeave` | `nextFluidLeave: GameEventFuture<GameFluidContactEvent>` | 下一次实体离开流体时的未来事件。 | ✅ |
| `onInteract` | `onInteract: GameEventChannel<GameInteractEvent>` | 当实体与另一个实体互动时调用。 | ✅ |
| `nextInteract` | `nextInteract: GameEventFuture<GameInteractEvent>` | 下一次实体与另一个实体互动时的未来事件。 | ✅ |
| `sound` | `sound: ( spec: \| { sample: GameAudioAssets \| ""; radius?: number; pitch?: number; gain?: number; } \| GameAudioAssets \| "" ) => Sound` | 在实体位置播放音效。<br>• spec：_param spec 音效规格。可以是一个音频资源字符串，一个用于停止音效的空字符串，或一个包含以下属性的配置对象：<br>- `sample`: 音频资源 (`GameAudioAssets \| ''`)。<br>- `radius`: 音效半径（可选）。<br>- `pitch`: 音调（可选）。<br>- `gain`: 音量（可选）。<br>• 返回值：_returns 音效实例。 | ✅ |
| `motion` | `motion: GameMotionController<GameEntity>` | 运动控制器。 | ✅ |
| `lookAt` | `lookAt: ( targetPosition: GameVector3, facingDirection?: "X" \| "Y" \| "Z", up?: GameVector3 ) => void` | 使实体朝向指定位置。<br>• targetPosition：_param targetPosition 要朝向的位置。<br>• facingDirection：_param facingDirection 应朝向目标的方向。<br>• up：_param up 上方向向量。 | ✅ |
| `rotateLocal` | `rotateLocal: ( localPosition: GameVector3, axis: "X" \| "Y" \| "Z", rad: number ) => void` | 围绕模型自身坐标系下的某个点进行旋转。<br>• localPosition：_param localPosition 一个包含x、y、z坐标的三维向量，表示待旋转的位置。<br>• axis：_param axis 一个字符串，指定旋转轴可以是'X'、'Y'或'Z'。<br>• rad：_param rad 旋转的角度，以弧度为单位。 | ✅ |
| `scaleLocal` | `scaleLocal: (localPosition: GameVector3, v: GameVector3) => void` | 参照模型自身坐标系下的某个点进行缩放。<br>• localPosition：_param localPosition 本地坐标系中的位置向量，表示待缩放的点。<br>• v：_param v 缩放向量，表示在x、y、z轴上的缩放因子。 | ✅ |
| `id` | `id: string` | 实体在编辑器中的种子名称。 | ✅ |
| `destroyed` | `readonly destroyed: boolean` | 如果为 true，表示实体已被销毁。 | ✅ |
| `position` | `position: GameVector3` | 实体的位置。 | ✅ |
| `velocity` | `velocity: GameVector3` | 实体的速度。 | ✅ |
| `bounds` | `bounds: GameVector3` | 实体边界框在 x/y/z 轴上的半径。 | ✅ |
| `mass` | `mass: number` | 实体的质量。 | ✅ |
| `friction` | `friction: number` | 控制物体的粘性（0 = 滑，1 = 粘）。 | ✅ |
| `restitution` | `restitution: number` | 控制弹跳性（0 = 软，1 = 弹）。 | ✅ |
| `collides` | `collides: boolean` | 如果为 false，物体不会发生碰撞。 | ✅ |
| `gravity` | `gravity: boolean` | 如果为 false，物体不会受到重力影响。 | ✅ |
| `fixed` | `fixed: boolean` | 如果为 true，物体不会移动。 | ✅ |
| `contactForce` | `contactForce: GameVector3` | 应用于此对象的净接触力。 | ✅ |
| `entityContacts` | `readonly entityContacts: GameEntityContact[]` | 返回所有活动的实体接触列表。 | ✅ |
| `voxelContacts` | `readonly voxelContacts: GameVoxelContact[]` | 返回所有活动的方块接触列表。 | ✅ |
| `fluidContacts` | `readonly fluidContacts: GameFluidContact[]` | 返回所有活动的流体接触列表。 | ✅ |
| `mesh` | `mesh: GameModelAssets \| ""` | 实体网格的哈希值。如果设置为空字符串，则实体没有网格。 除非对象是玩家，否则如果设置了网格，则使用网格来计算对象的边界。 | ✅ |
| `meshInvisible` | `meshInvisible: boolean` | 使网格不可见。 | ✅ |
| `meshScale` | `meshScale: GameVector3` | 网格缩放。 | ✅ |
| `meshOrientation` | `meshOrientation: GameQuaternion` | 网格方向。 | ✅ |
| `meshOffset` | `meshOffset: GameVector3` | 网格偏移。 | ✅ |
| `meshColor` | `meshColor: GameRGBAColor` | 网格颜色。 | ✅ |
| `meshMetalness` | `meshMetalness: number` | 网格金属度。 | ✅ |
| `meshEmissive` | `meshEmissive: number` | 网格发光度。 | ✅ |
| `meshShininess` | `meshShininess: number` | 网格光泽度。 | ✅ |
| `anchorOffset` | `anchorOffset: GameVector3` | 几何中心与锚点的偏移量。 | ✅ |
| `enableDamage` | `enableDamage: boolean` | 是否启用伤害。 | ✅ |
| `showHealthBar` | `showHealthBar: boolean` | 是否显示生命条。 | ✅ |
| `hp` | `hp: number` | 当前生命值。 | ✅ |
| `maxHp` | `maxHp: number` | 最大生命值。 | ✅ |
| `particleRate` | `particleRate: number` | 粒子发射速率（每秒粒子数）。 | ✅ |
| `particleRateSpread` | `particleRateSpread: number` | 粒子发射的变化范围。 | ✅ |
| `particleLimit` | `particleLimit: number` | 该实体可以发射的最大粒子数。 | ✅ |
| `particleColor` | `particleColor: GameRGBColor[]` | 粒子颜色样条曲线。最多 5 个条目，粒子在其生命周期内沿这 5 个点插值颜色。 颜色是发光值，可以在 0 到 256 之间取任何值。 | ✅ |
| `particleSize` | `particleSize: number[]` | 粒子大小样条曲线。最多 5 个条目，粒子在其生命周期内沿这 5 个点插值大小。 | ✅ |
| `particleSizeSpread` | `particleSizeSpread: number` | 粒子大小分布。 | ✅ |
| `particleLifetime` | `particleLifetime: number` | 控制每个粒子的生命周期（以秒为单位）。 | ✅ |
| `particleLifetimeSpread` | `particleLifetimeSpread: number` | 粒子生命周期的变化范围（以秒为单位）。 | ✅ |
| `particleVelocity` | `particleVelocity: GameVector3` | 粒子速度偏置。单位是方块/滴答。 | ✅ |
| `particleVelocitySpread` | `particleVelocitySpread: GameVector3` | 粒子速度随机化范围。单位是方块/滴答。 | ✅ |
| `particleDamping` | `particleDamping: number` | 粒子阻尼指数。0 = 无阻尼，正值减慢粒子，负值加速粒子。 | ✅ |
| `particleAcceleration` | `particleAcceleration: GameVector3` | 粒子加速度/重力力矢量 单位是方块/(滴答^2) | ✅ |
| `particleNoise` | `particleNoise: number` | 粒子噪声幅度。影响粒子运动 | ✅ |
| `particleNoiseFrequency` | `particleNoiseFrequency: number` | 粒子噪声频率。增加噪声偏置的运动速率 | ✅ |
| `particleTarget` | `particleTarget: GameEntity \| null` | 粒子目标实体 | ✅ |
| `particleTargetWeight` | `particleTargetWeight: number` | 粒子目标权重 | ✅ |
| `enableInteract` | `enableInteract: boolean` | 启用交互 | ✅ |
| `interactColor` | `interactColor: GameRGBColor` | 交互提示文本的颜色 | ✅ |
| `interactHint` | `interactHint: string` | 交互实体的提示文本 | ✅ |
| `interactRadius` | `interactRadius: number` | 交互的半径范围 | ✅ |
| `showEntityName` | `showEntityName: boolean` | 显示实体名称 | ✅ |
| `customName` | `customName: string` | 实体名称 | ✅ |
| `nameRadius` | `nameRadius: number` | 显示实体名称的半径范围 | ✅ |
| `nameColor` | `nameColor: GameRGBColor` | 实体名称的颜色 | ✅ |
| `chatSound` | `chatSound: GameSoundEffect` | 当实体聊天时播放的声音 | ✅ |
| `hurtSound` | `hurtSound: GameSoundEffect` | 当实体受到伤害时播放的声音 | ✅ |
| `dieSound` | `dieSound: GameSoundEffect` | 当实体死亡时播放的声音 | ✅ |
| `interactSound` | `interactSound: GameSoundEffect` | 当实体被交互时播放的声音 | ✅ |
| `isPlayer` | `readonly isPlayer: boolean` | 如果为 true，则该实体是玩家<br>**已废弃**：已废弃。请直接使用 `if (entity.player)` 进行玩家实体存在性检查，这能让TypeScript自动推断出 `GameEntity.player` 在该代码块中是已定义的 [GamePlayer](#gameplayer) 类型，从而提高类型安全性。 | ✅ |
| `player` | `player: GamePlayer \| undefined` | 如果实体是玩家，则此属性存在。包含所有特定于玩家的状态和方法的引用。 | ✅ |

### GameEntityConfig

*interface · GameAPI*

> 定义了用于创建或更新游戏实体的配置选项。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `position` | `position: GameVector3` | 实体在世界中的初始位置。 | — |
| `velocity` | `velocity: GameVector3` | 实体的初始速度。 | — |
| `bounds` | `bounds: GameVector3` | 实体的物理边界框大小。 | — |
| `mass` | `mass: number` | 实体的质量，影响物理交互。 | — |
| `friction` | `friction: number` | 实体在表面上移动时的摩擦系数。 | — |
| `restitution` | `restitution: number` | 实体的弹性恢复系数（“反弹”程度）。 | — |
| `collides` | `collides: boolean` | 实体是否与其他对象发生碰撞。 | — |
| `fixed` | `fixed: boolean` | 实体是否在世界中固定不动。 | — |
| `gravity` | `gravity: boolean` | 实体是否受世界重力的影响。 | — |
| `mesh` | `mesh: GameModelAssets \| ""` | 实体的视觉模型（网格）。可以是预设的模型资源名称或空字符串。 | — |
| `meshColor` | `meshColor: GameRGBAColor` | 实体模型的颜色和透明度。 | — |
| `meshScale` | `meshScale: GameVector3` | 实体模型的缩放比例。 | — |
| `meshOrientation` | `meshOrientation: GameQuaternion` | 实体模型的旋转朝向。 | — |
| `meshMetalness` | `meshMetalness: number` | 实体的网格金属度。 | — |
| `meshEmissive` | `meshEmissive: number` | 实体的网格发光强度。 | — |
| `meshShininess` | `meshShininess: number` | 实体的网格光泽度。 | — |
| `anchorOffset` | `anchorOffset: GameVector3` | 实体几何中心与锚点的偏移量。 | — |
| `particleRate` | `particleRate: number` | 实体的粒子发射速率。 | — |
| `particleRateSpread` | `particleRateSpread: number` | 实体的粒子发射速率的随机范围。 | — |
| `particleLimit` | `particleLimit: number` | 实体的粒子数量上限。 | — |
| `particleColor` | `particleColor: GameRGBColor[]` | 实体的粒子颜色数组。 | — |
| `particleSize` | `particleSize: number[]` | 实体的粒子大小数组。 | — |
| `particleSizeSpread` | `particleSizeSpread: number` | 实体的粒子大小的随机范围。 | — |
| `particleLifetime` | `particleLifetime: number` | 实体的粒子生命周期。 | — |
| `particleLifetimeSpread` | `particleLifetimeSpread: number` | 实体的粒子生命周期的随机范围。 | — |
| `particleVelocity` | `particleVelocity: GameVector3` | 实体的粒子初速度。 | — |
| `particleVelocitySpread` | `particleVelocitySpread: GameVector3` | 实体的粒子初速度的随机范围。 | — |
| `particleDamping` | `particleDamping: number` | 实体的粒子阻尼。 | — |
| `particleAcceleration` | `particleAcceleration: GameVector3` | 实体的粒子加速度。 | — |
| `particleNoise` | `particleNoise: number` | 实体的粒子噪声强度。 | — |
| `particleNoiseFrequency` | `particleNoiseFrequency: number` | 实体的粒子噪声频率。 | — |
| `particleTarget` | `particleTarget: GameEntity \| null` | 实体的粒子目标。 | — |
| `particleTargetWeight` | `particleTargetWeight: number` | 实体的粒子目标权重。 | — |
| `enableInteract` | `enableInteract: boolean` | 实体是否可以交互。 | — |
| `interactColor` | `interactColor: GameRGBColor` | 实体的交互颜色。 | — |
| `interactHint` | `interactHint: string` | 实体的交互提示文本。 | — |
| `interactRadius` | `interactRadius: number` | 实体的交互半径。 | — |
| `hurtSound` | `hurtSound: GameSoundEffectConfig` | 实体受伤时的声音配置。 | — |
| `dieSound` | `dieSound: GameSoundEffectConfig` | 实体死亡时的声音配置。 | — |
| `interactSound` | `interactSound: GameSoundEffectConfig` | 实体交互时的声音配置。 | — |
| `chatSound` | `chatSound: GameSoundEffectConfig` | 实体聊天时的声音配置。 | — |
| `id` | `readonly id: string` | 实体的唯一标识符。 | — |
| `tags` | `tags: (() => string[]) \| string[]` | 实体的标签，可以是返回字符串数组的函数或字符串数组。 | — |

### GameEntityContact

*class · GameAPI*

> 描述一个活跃的实体对接触状态。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `other` | `other: GameEntity` | 接触的另一个实体。 | ✅ |
| `force` | `force: GameVector3` | 接触力。 | ✅ |
| `axis` | `axis: GameVector3` | 接触轴。 | ✅ |

### GameEntityContactEvent

*class · GameAPI*

> 当两个实体发生碰撞时触发的事件。 由 `GameWorld.onEntityContact`, `GameWorld.onEntitySeparate`, `GameEntity.onEntityContact`, `GameEntity.onEntitySeparate` 触发。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 实体发生碰撞的时间。 | ✅ |
| `entity` | `entity: GameEntity` | 第一个实体。 | ✅ |
| `other` | `other: GameEntity` | 第二个实体。 | ✅ |
| `axis` | `axis: GameVector3` | 碰撞的分离轴。 | ✅ |
| `force` | `force: GameVector3` | 碰撞产生的力。 | ✅ |

### GameEntityEvent

*class · GameAPI*

> 当某个实体被创建或销毁时触发的事件。 由 `GameWorld.onPlayerJoin`, `GameWorld.onPlayerLeave`, `GameWorld.onEntityCreate`, `GameWorld.onEntityDestroy` 和 `GameEntity.onDestroy` 触发。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 事件发生的时间。 | ✅ |
| `entity` | `entity: GameEntity` | 被创建或销毁的实体。 | ✅ |

### GameEntityKeyframe

*interface · GameAPI*

> 定义游戏实体关键帧的接口。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `duration` | `duration: number` | 关键帧的持续时间。 | — |
| `easeIn` | `easeIn: GameEasing` | 关键帧的加速方式。 | — |
| `easeOut` | `easeOut: GameEasing` | 关键帧的减速方式。 | — |
| `position` | `position: GameVector3` | 实体的位置。 | — |
| `velocity` | `velocity: GameVector3` | 实体的速度。 | — |
| `mass` | `mass: number` | 实体的质量。 | — |
| `friction` | `friction: number` | 实体的摩擦力。 | — |
| `restitution` | `restitution: number` | 实体的恢复系数。 | — |
| `collides` | `collides: boolean` | 实体是否可以碰撞。 | — |
| `fixed` | `fixed: boolean` | 实体是否固定。 | — |
| `gravity` | `gravity: boolean` | 实体是否受重力影响。 | — |
| `mesh` | `mesh: GameModelAssets \| ""` | 实体的网格模型。 | — |
| `meshInvisible` | `meshInvisible: boolean` | 实体网格是否不可见。 | — |
| `meshScale` | `meshScale: GameVector3` | 实体的网格缩放。 | — |
| `meshOrientation` | `meshOrientation: GameQuaternion` | 实体的网格朝向。 | — |
| `meshOffset` | `meshOffset: GameVector3` | 实体的网格偏移。 | — |
| `meshColor` | `meshColor: GameRGBAColor` | 实体的网格颜色。 | — |
| `meshMetalness` | `meshMetalness: number` | 实体的网格金属度。 | — |
| `meshEmissive` | `meshEmissive: number` | 实体的网格发光强度。 | — |
| `meshShininess` | `meshShininess: number` | 实体的网格光泽度。 | — |
| `particleRate` | `particleRate: number` | 实体的粒子发射速率。 | — |
| `particleRateSpread` | `particleRateSpread: number` | 实体的粒子发射速率的随机范围。 | — |
| `particleLimit` | `particleLimit: number` | 实体的粒子数量上限。 | — |
| `particleLifetime` | `particleLifetime: number` | 实体的粒子生命周期。 | — |
| `particleLifetimeSpread` | `particleLifetimeSpread: number` | 实体的粒子生命周期的随机范围。 | — |
| `particleVelocity` | `particleVelocity: GameVector3` | 实体的粒子初速度。 | — |
| `particleVelocitySpread` | `particleVelocitySpread: GameVector3` | 实体的粒子初速度的随机范围。 | — |
| `particleColor` | `particleColor: GameRGBColor[]` | 实体的粒子颜色数组。 | — |
| `particleSize` | `particleSize: number[]` | 实体的粒子大小数组。 | — |
| `particleSizeSpread` | `particleSizeSpread: number` | 实体的粒子大小的随机范围。 | — |
| `particleDamping` | `particleDamping: number` | 实体的粒子阻尼。 | — |
| `particleAcceleration` | `particleAcceleration: GameVector3` | 实体的粒子加速度。 | — |
| `particleNoise` | `particleNoise: number` | 实体的粒子噪声强度。 | — |
| `particleNoiseFrequency` | `particleNoiseFrequency: number` | 实体的粒子噪声频率。 | — |
| `particleTarget` | `particleTarget: GameEntity \| null` | 实体的粒子目标。 | — |
| `particleTargetWeight` | `particleTargetWeight: number` | 实体的粒子目标权重。 | — |
| `interactColor` | `interactColor: GameRGBColor` | 实体的交互颜色。 | — |

### GameFluidContact

*class · GameAPI*

> 活跃流体接触。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `voxel` | `voxel: voxelId` | 方块编号。 | ✅ |
| `volume` | `volume: number` | 流体体积。 | ✅ |

### GameFluidContactEvent

*class · GameAPI*

> 当实体进入或离开流体时触发的事件。 由 `GameWorld.onFluidEnter`, `GameWorld.onFluidLeave`, `GameEntity.onFluidEnter`, `GameEntity.onFluidLeave` 触发。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 事件发生的时间。 | ✅ |
| `entity` | `entity: GameEntity` | 被修改的实体。 | ✅ |
| `voxel` | `voxel: voxelId` | 流体方块的 ID。 | ✅ |

### GameHurtOptions

*interface · GameAPI*

> 定义游戏实体受伤选项的接口。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `attacker` | `attacker: GameEntity` | 伤害来源的实体。 | — |
| `damageType` | `damageType: string` | 伤害类型。 | — |

### GameMotionClipConfig

*interface · GameAPI*

> 定义游戏动作集配置接口，用于描述一组游戏动作及其整体的迭代次数。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `motions` | `motions: GameMotionConfig[]` | 动作集，包含多个 `GameMotionConfig` | — |
| `iterations` | `iterations: number` | 整组动作的迭代次数 | — |

### GameMotionConfig

*interface · GameAPI*

> 定义游戏动作配置接口，用于描述单个游戏动作的名称和迭代次数。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `name` | `name: string` | 动作的名称 | — |
| `iterations` | `iterations: number` | 动作的迭代次数 | — |

### GameMotionController

*class · GameAPI*

> 游戏动作控制器类，用于管理和控制目标的动作播放。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `loadByName` | `loadByName: ( config: string \| GameMotionConfig[] \| GameMotionClipConfig ) => GameMotionHandler<TargetType>` | 通过名称（可以是动作列表）创建动作处理器。<br>• config：动作配置，可以是字符串、动作配置数组或单个动作剪辑配置。<br>• 返回值：返回一个 `GameMotionHandler` 实例，用于处理指定的动作。 | — |
| `pause` | `pause: () => void` | 暂停当前动作。 | — |
| `resume` | `resume: () => void` | 恢复暂停的动作。 | — |
| `setDefaultMotionByName` | `setDefaultMotionByName: (motionName?: string) => void` | 通过名称设置默认动作。<br>• motionName：动作名称，可选参数。 | — |

### GameMotionEvent

*class · GameAPI*

> 表示与游戏动作相关的事件，携带有关目标和事件状态的信息。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `tick` | `tick: number` | 发生事件的刻度。 | — |
| `target` | `readonly target: TargetType` | 事件的目标对象。 | — |
| `motionHandler` | `motionHandler: GameMotionHandler<TargetType>` | 动作事件处理器，特定于目标对象。 | — |
| `cancelled` | `readonly cancelled: boolean` | 表示事件是否被取消。 | — |

### GameMotionHandler

*class · GameAPI*

> 游戏动作处理器类，用于控制单个动作序列的播放。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `target` | `readonly target: TargetType` | 动作目标对象（实体）。 | — |
| `play` | `play: () => void` | 开始播放动作。 | — |
| `cancel` | `cancel: () => void` | 取消当前动作播放。 | — |
| `onFinish` | `onFinish: GameEventChannel<GameMotionEvent<TargetType>>` | 当动作成功完成时触发的事件。 | — |
| `nextFinish` | `nextFinish: GameEventFuture<GameMotionEvent<TargetType>>` | 下一次动作完成时的未来事件。 | — |
| `onCancel` | `onCancel: GameEventChannel<GameMotionEvent<TargetType>>` | 当动作被取消时触发的事件。 | — |
| `nextCancel` | `nextCancel: GameEventFuture<GameMotionEvent<TargetType>>` | 下一次动作取消时的未来事件。 | — |

### GamePlayer

*class · GameAPI*

> 玩家对应于连接到游戏的用户。每个玩家对象代表一个已连接的用户，可以包含玩家的详细信息，如用户名、得分、角色等。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `directMessage` | `directMessage: (message: string) => void` | 向玩家发送私聊消息。 | ✅ |
| `onChat` | `onChat: GameEventChannel<GameChatEvent>` | 当玩家发起聊天事件时调用。 | ✅ |
| `nextChat` | `nextChat: GameEventFuture<GameChatEvent>` | 获取下一个聊天事件。 | ✅ |
| `onPress` | `onPress: GameEventChannel<GameInputEvent>` | 当玩家按下按钮时调用。 | ✅ |
| `nextPress` | `nextPress: GameEventFuture<GameInputEvent>` | 获取下一个按键按下事件。 | ✅ |
| `onRelease` | `onRelease: GameEventChannel<GameInputEvent>` | 当玩家释放按钮时调用。 | ✅ |
| `nextRelease` | `nextRelease: GameEventFuture<GameInputEvent>` | 获取下一个按键释放事件。 | ✅ |
| `onRespawn` | `onRespawn: GameEventChannel<GameRespawnEvent>` | 当玩家重生时调用。 | ✅ |
| `nextRespawn` | `nextRespawn: GameEventFuture<GameRespawnEvent>` | 获取下一个重生事件。 | ✅ |
| `forceRespawn` | `forceRespawn: () => void` | 强制玩家重生。 | ✅ |
| `dialog` | `dialog< T extends \| GameInputDialogParams \| GameTextDialogParams \| GameSelectDialogParams >( params: T ): T extends GameSelectDialogParams ? Promise<GameDialogSelectResponse \| null> : Promise<string \| null>` | 为玩家打开一个对话框。<br>• params：对话框参数，可以是 `GameInputDialogParams`、`GameTextDialogParams` 或 `GameSelectDialogParams` 中的一种。<br>• 返回值：如果参数类型为 `GameSelectDialogParams`，则返回 `GameDialogSelectResponse` 或 null 的 Promise；否则，返回 string 或 null 的 Promise。 | ✅ |
| `dialog` | `dialog(params: GameInputDialogParams): Promise<string \| null>` | 为玩家打开一个对话框。<br>• params：对话框参数，可以是 `GameInputDialogParams`、`GameTextDialogParams` 或 `GameSelectDialogParams` 中的一种。<br>• 返回值：如果参数类型为 `GameSelectDialogParams`，则返回 `GameDialogSelectResponse` 或 null 的 Promise；否则，返回 string 或 null 的 Promise。 | ✅ |
| `dialog` | `dialog(params: GameTextDialogParams): Promise<string \| null>` | 为玩家打开一个对话框。<br>• params：对话框参数，可以是 `GameInputDialogParams`、`GameTextDialogParams` 或 `GameSelectDialogParams` 中的一种。<br>• 返回值：如果参数类型为 `GameSelectDialogParams`，则返回 `GameDialogSelectResponse` 或 null 的 Promise；否则，返回 string 或 null 的 Promise。 | ✅ |
| `dialog` | `dialog( params: GameSelectDialogParams ): Promise<GameDialogSelectResponse \| null>` | 为玩家打开一个对话框。<br>• params：对话框参数，可以是 `GameInputDialogParams`、`GameTextDialogParams` 或 `GameSelectDialogParams` 中的一种。<br>• 返回值：如果参数类型为 `GameSelectDialogParams`，则返回 `GameDialogSelectResponse` 或 null 的 Promise；否则，返回 string 或 null 的 Promise。 | ✅ |
| `cancelDialogs` | `cancelDialogs: () => void` | 取消玩家的所有打开的对话框。 | ✅ |
| `link` | `link: ( href: string, options?: { /** * @zh 是否弹出确认的提醒？ * @en Should a confirmation prompt be displayed? */ isConfirm?: boolean; /** * @zh 是否新标签页打开网页？ * @en Should the webpage be opened in a new tab? */ isNewTab?:…` | 在客户端打开一个超链接。 | ✅ |
| `wearables` | `wearables: (bodyPart?: GameBodyPart) => GameWearable[]` | 列出玩家身上所有可穿戴物品。<br>• bodyPart：是一个可选过滤器，用于显示特定身体部位上的可穿戴物品。 | ✅ |
| `addWearable` | `addWearable: (spec: Partial<GameWearable>) => GameWearable` | 为玩家添加一个新的可穿戴物品。 | ✅ |
| `removeWearable` | `removeWearable: (wearable: GameWearable) => void` | 从玩家身上移除一个可穿戴物品。<br>• wearable：要移除的可穿戴物品。 | ✅ |
| `setSkinByName` | `setSkinByName: (skinName: string) => void` | 通过皮肤名称设置玩家皮肤。 | ✅ |
| `resetToDefaultSkin` | `resetToDefaultSkin: () => void` | 将玩家重置为默认皮肤。 | ✅ |
| `clearSkin` | `clearSkin: () => void` | 清除玩家自定义皮肤并恢复到角色皮肤。 | ✅ |
| `sound` | `sound: ( spec: \| { /** * @zh 用于表示样本或示例数据。 * @en Used to represent sample or example data. */ sample: GameAudioAssets \| ""; /** * @zh 用于表示增益或音量调整。 * @en Used to represent gain or volume adjustment. */ gain?: number; /**…` | 为玩家播放声音。 | ✅ |
| `animate` | `animate: ( keyframes: Partial<GamePlayerKeyframe>[], playbackConfig?: GameAnimationPlaybackConfig ) => GameAnimation<GamePlayerKeyframe, GamePlayer>` | 播放动画。 | ✅ |
| `getAnimations` | `getAnimations: () => GameAnimation<GamePlayerKeyframe, GamePlayer>[]` | 获取当前播放的所有动画。 | ✅ |
| `kick` | `kick: () => void` | 将用户踢出服务器。 | ✅ |
| `setCameraPitch` | `setCameraPitch: (value: number) => void` | 设置摄像机的垂直旋转角度。 | ✅ |
| `setCameraYaw` | `setCameraYaw: (value: number) => void` | 设置摄像机的水平旋转角度。 | ✅ |
| `openMarketplace` | `openMarketplace: (productIds: GameProductAssets[]) => void` | 打开商品购买对话框。 | ✅ |
| `getMiaoShells` | `getMiaoShells: () => Promise<number>` | 获取玩家的喵币数量。 | ✅ |
| `share` | `share: (content: string) => void` | 打开分享模态框。 | ✅ |
| `openUserProfileDialog` | `openUserProfileDialog: (userId: number) => void` | 打开用户个人资料对话框。 | ✅ |
| `querySocial` | `querySocial: (socialType: SocialType) => Promise<number[]>` | 查询用户的社交关系。 | ✅ |
| `querySocialStatistic` | `querySocialStatistic: () => Promise<SocialStatisticType>` | 查询用户的社交统计信息。 | ✅ |
| `onKeyDown` | `onKeyDown: GameEventChannel<GameKeyBoardEvent>` | 当玩家按下键盘键时调用。 | ✅ |
| `onKeyUp` | `onKeyUp: GameEventChannel<GameKeyBoardEvent>` | 当玩家释放键盘键时调用。 | ✅ |
| `gamepad` | `gamepad: Gamepad` | 设置虚拟按键图片。 | ✅ |
| `name` | `name: string` | 玩家名称。常量。 | ✅ |
| `userId` | `userId: string` | 登录玩家的用户ID。 | ✅ |
| `userKey` | `userKey: string` | 此玩家的唯一用户密钥。可用于将他们的信息保存到数据库中。 | ✅ |
| `boxId` | `boxId: string` | 如果已登录，则为玩家的 Box 用户 ID。 | ✅ |
| `avatar` | `avatar: string` | 如果已登录，则为玩家的头像。 | ✅ |
| `url` | `url: URL` | 玩家 URL。 | ✅ |
| `spawnPoint` | `spawnPoint: GameVector3` | 玩家的初始生成点。 | ✅ |
| `movementBounds` | `movementBounds: GameBounds3` | 移动边界。 | ✅ |
| `scale` | `scale: number` | 缩放比例。 | ✅ |
| `color` | `color: GameRGBColor` | 颜色。 | ✅ |
| `metalness` | `metalness: number` | 金属度。 | ✅ |
| `emissive` | `emissive: number` | 发光强度。 | ✅ |
| `shininess` | `shininess: number` | 光泽度。 | ✅ |
| `invisible` | `invisible: boolean` | 是否隐身。 | ✅ |
| `showName` | `showName: boolean` | 是否显示名称。 | ✅ |
| `showIndicator` | `showIndicator: boolean` | 是否显示指示器。 | ✅ |
| `dead` | `dead: boolean` | 是否死亡。 | ✅ |
| `colorLUT` | `colorLUT: string` | 颜色分级查找表，应用于玩家以调整游戏状态的颜色。 | ✅ |
| `cameraMode` | `cameraMode: GameCameraMode` | 摄像机行为模式。 第一人称摄像机 第三人称跟随摄像机（默认） 第三人称固定摄像机 相对玩家位置的第三人称摄像机 | ✅ |
| `cameraEntity` | `cameraEntity: GameEntity \| null` | 在FPS或FOLLOW模式下，玩家摄像机跟随的实体。 | ✅ |
| `cameraTarget` | `cameraTarget: GameVector3` | 在FIXED模式下的摄像机目标点。 | ✅ |
| `cameraUp` | `cameraUp: GameVector3` | 在FIXED模式下的摄像机上向量。 | ✅ |
| `cameraPosition` | `cameraPosition: GameVector3` | 在FIXED模式下的摄像机眼睛位置。 | ✅ |
| `cameraFreezedAxis` | `cameraFreezedAxis: GameCameraFreezedAxis` | 在RELATIVE模式下冻结的摄像机轴。 | ✅ |
| `cameraFovY` | `cameraFovY: number` | 摄像机视场角Y。 | ✅ |
| `cameraDistance` | `cameraDistance: number` | 摄像机距离。 | ✅ |
| `canFly` | `canFly: boolean` | 如果为true，允许玩家飞行。 | ✅ |
| `spectator` | `spectator: boolean` | 如果为true，玩家是幽灵，可以穿过墙壁。 | ✅ |
| `walkSpeed` | `walkSpeed: number` | 最大步行速度。 | ✅ |
| `walkAcceleration` | `walkAcceleration: number` | 步行加速度。 | ✅ |
| `runSpeed` | `runSpeed: number` | 最大跑步速度。 | ✅ |
| `runAcceleration` | `runAcceleration: number` | 跑步加速度。 | ✅ |
| `crouchSpeed` | `crouchSpeed: number` | 蹲下行走速度。 | ✅ |
| `crouchAcceleration` | `crouchAcceleration: number` | 蹲下行走加速度。 | ✅ |
| `swimSpeed` | `swimSpeed: number` | 最大游泳速度。 | ✅ |
| `swimAcceleration` | `swimAcceleration: number` | 游泳加速度。 | ✅ |
| `flySpeed` | `flySpeed: number` | 最大飞行速度。 | ✅ |
| `flyAcceleration` | `flyAcceleration: number` | 飞行加速度。 | ✅ |
| `jumpSpeedFactor` | `jumpSpeedFactor: number` | 跳跃速度因子。 | ✅ |
| `jumpAccelerationFactor` | `jumpAccelerationFactor: number` | 跳跃加速度率。 | ✅ |
| `jumpPower` | `jumpPower: number` | 跳跃速度冲量。 | ✅ |
| `doubleJumpPower` | `doubleJumpPower: number` | 双重跳跃速度冲量。 | ✅ |
| `freezedForwardDirection` | `freezedForwardDirection: GameVector3 \| null` | 在RELATIVE模式下冻结的前向方向。 | ✅ |
| `moveState` | `moveState: GamePlayerMoveState` | 移动状态。 | ✅ |
| `walkState` | `walkState: GamePlayerWalkState` | 行走状态。 | ✅ |
| `swapInputDirection` | `swapInputDirection: boolean` | 是否交换输入方向。 | ✅ |
| `reverseInputDirection` | `reverseInputDirection: GameInputDirection` | 反转输入方向。 | ✅ |
| `disableInputDirection` | `disableInputDirection: GameInputDirection` | 禁用的输入方向。 | ✅ |
| `walkButton` | `walkButton: boolean` | 是否按下了行走按钮。 | ✅ |
| `crouchButton` | `crouchButton: boolean` | 是否按下了蹲下按钮。 | ✅ |
| `jumpButton` | `jumpButton: boolean` | 是否按下了跳跃按钮。 | ✅ |
| `enableAction0` | `enableAction0: boolean` | 如果为true，启用玩家输入按钮鼠标左键 / 虚拟按钮A。 | ✅ |
| `enableAction1` | `enableAction1: boolean` | 如果为true，启用玩家输入按钮鼠标右键 / 虚拟按钮B。 | ✅ |
| `action0Button` | `action0Button: boolean` | 是否按下了鼠标左键 / 虚拟按钮A按钮。 | ✅ |
| `action1Button` | `action1Button: boolean` | 是否按下了鼠标右键 / 虚拟按钮B按钮。 | ✅ |
| `enableJump` | `enableJump: boolean` | 是否启用跳跃。 | ✅ |
| `enableDoubleJump` | `enableDoubleJump: boolean` | 是否启用双重跳跃。 | ✅ |
| `enableCrouch` | `enableCrouch: boolean` | 是否启用蹲下。 | ✅ |
| `enable3DCursor` | `enable3DCursor: boolean` | 是否启用3D光标。 | ✅ |
| `facingDirection` | `facingDirection: GameVector3` | 面向方向。 | ✅ |
| `cameraYaw` | `cameraYaw: number` | 摄像机水平旋转角度。 | ✅ |
| `cameraPitch` | `cameraPitch: number` | 摄像机垂直旋转角度。 | ✅ |
| `spawnSound` | `spawnSound: GameSoundEffect` | 玩家重生时播放的声音。 | ✅ |
| `jumpSound` | `jumpSound: GameSoundEffect` | 玩家跳跃时播放的声音。 | ✅ |
| `doubleJumpSound` | `doubleJumpSound: GameSoundEffect` | 玩家双重跳跃时播放的声音。 | ✅ |
| `landSound` | `landSound: GameSoundEffect` | 玩家落地时播放的声音。 | ✅ |
| `crouchSound` | `crouchSound: GameSoundEffect` | 玩家蹲下时播放的声音。 | ✅ |
| `stepSound` | `stepSound: GameSoundEffect` | 玩家行走时播放的脚步声。 | ✅ |
| `swimSound` | `swimSound: GameSoundEffect` | 玩家游泳时播放的声音。 | ✅ |
| `action0Sound` | `action0Sound: GameSoundEffect` | 玩家按下鼠标左键 / 虚拟按钮A按钮时播放的声音。 | ✅ |
| `action1Sound` | `action1Sound: GameSoundEffect` | 玩家按下鼠标右键 / 虚拟按钮B按钮时播放的声音。 | ✅ |
| `enterWaterSound` | `enterWaterSound: GameSoundEffect` | 实体进入水中时播放的声音。 | ✅ |
| `leaveWaterSound` | `leaveWaterSound: GameSoundEffect` | 实体离开水中时播放的声音。 | ✅ |
| `startFlySound` | `startFlySound: GameSoundEffect` | 玩家开始飞行时播放的声音。 | ✅ |
| `stopFlySound` | `stopFlySound: GameSoundEffect` | 玩家停止飞行时播放的声音。 | ✅ |
| `music` | `music: GameSoundEffect` | 玩家的背景音乐。 | ✅ |
| `muted` | `muted: boolean` | 如果为true，则玩家不能聊天。<br>**已废弃**：当前未使用。 | ✅ |
| `skin` | `skin: GameSkin` | 皮肤部件。 | ✅ |
| `skinInvisible` | `skinInvisible: GameSkinInvisible` | 皮肤部件是否不可见。 | ✅ |
| `navigator` | `navigator: PlayerNavigator` | 导航器。 | ✅ |

### GamePlayerKeyframe

*interface · GameAPI*

> 游戏玩家关键帧接口，定义了玩家在游戏中的动画和视觉属性。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `duration` | `duration: number` | 关键帧持续时间，单位为毫秒。 | — |
| `easeIn` | `easeIn: GameEasing` | 加速曲线类型，用于控制动画开始时的速度变化。 | — |
| `easeOut` | `easeOut: GameEasing` | 减速曲线类型，用于控制动画结束时的速度变化。 | — |
| `scale` | `scale: number` | 玩家模型的缩放比例。 | — |
| `color` | `color: GameRGBColor` | 玩家模型的颜色，使用RGB格式。 | — |
| `metalness` | `metalness: number` | 金属度属性，影响材质的反射和高光特性。 | — |
| `emissive` | `emissive: number` | 自发光属性，使模型在黑暗中可见。 | — |
| `shininess` | `shininess: number` | 光泽度属性，影响材质的反光强度。 | — |
| `invisible` | `invisible: boolean` | 玩家模型是否不可见。 | — |
| `showName` | `showName: boolean` | 玩家名称是否显示。 | — |
| `showIndicator` | `showIndicator: boolean` | 玩家指示器是否显示。 | — |
| `colorLUT` | `colorLUT: string` | 颜色查找表，用于动态调整颜色。 | — |
| `cameraMode` | `cameraMode: GameCameraMode` | 相机模式，决定相机的移动和旋转行为。 | — |
| `cameraEntity` | `cameraEntity: GameEntity \| null` | 相机实体，关联到场景中的具体对象。 | — |
| `cameraTarget` | `cameraTarget: GameVector3` | 相机目标点，相机试图对准的位置。 | — |
| `cameraUp` | `cameraUp: GameVector3` | 相机上方向量，定义相机的向上方向。 | — |
| `cameraPosition` | `cameraPosition: GameVector3` | 相机位置，相机在世界空间中的坐标。 | — |
| `cameraFreezedAxis` | `cameraFreezedAxis: GameCameraFreezedAxis` | 相机冻结轴，限制相机在特定轴上的移动。 | — |
| `cameraFovY` | `cameraFovY: number` | 相机垂直视野角，影响投影矩阵的构建。 | — |
| `cameraDistance` | `cameraDistance: number` | 相机与目标点的距离。 | — |

### GamePlayerMoveState

*enum · GameAPI*

> 玩家移动状态。

_（无成员级声明：枚举或纯数据形状。）_

### GamePlayerWalkState

*enum · GameAPI*

> 玩家行走状态。

_（无成员级声明：枚举或纯数据形状。）_

### GameQueryResult

*class · GameAPI*

> 查询结果 API

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `next` | `next: () => Promise<{ done: boolean; value: any; }>` | 获取下一行 | ✅ |
| `return` | `return: () => Promise<{ done: boolean; value: any; }>` | 返回 | ✅ |
| `throw` | `throw: (err: any) => Promise<{ done: boolean; value: any; }>` | 抛出错误 | ✅ |
| `then` | `then: (resolve: (rows: any[]) => any, reject: (err: any) => any) => void` | 然后 | ✅ |

### GameRaycastOptions

*interface · GameAPI*

> 传递给射线检测方法的配置参数。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `maxDistance` | `maxDistance: number` | 射线允许的最大距离。 | — |
| `ignoreFluid` | `ignoreFluid: boolean` | 如果为 true，则忽略流体方块。 | — |
| `ignoreVoxel` | `ignoreVoxel: boolean` | 如果为 true，则不检测与方块的交点。 | — |
| `ignoreEntities` | `ignoreEntities: boolean` | 如果为 true，则不检测与实体的交点。 | — |
| `ignoreSelector` | `ignoreSelector: GameSelectorString` | 忽略选定的实体。 | — |

### GameRaycastResult

*class · GameAPI*

> 执行射线检测的结果。包含关于射线检测及其命中的对象的信息。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `hit` | `hit: boolean` | 如果为 true，射线检测命中了对象。 | ✅ |
| `hitEntity` | `hitEntity: GameEntity \| null` | 被射线检测命中的实体。 | ✅ |
| `hitVoxel` | `hitVoxel: voxelId` | 被射线检测命中的方块 ID（如果没有命中方块则为 0）。 | ✅ |
| `origin` | `origin: GameVector3` | 射线检测的起点。 | ✅ |
| `direction` | `direction: GameVector3` | 射线检测的方向。 | ✅ |
| `distance` | `distance: number` | 沿射线行进的距离。 | ✅ |
| `hitPosition` | `hitPosition: GameVector3` | 射线交点的位置。 | ✅ |
| `normal` | `normal: GameVector3` | 交点处表面的法向量。 | ✅ |
| `voxelIndex` | `voxelIndex: GameVector3` | 如果命中了方块，该方块的网格坐标。 | ✅ |

### GameSoundEffect

*class · GameAPI*

> 单个音效表。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `radius` | `radius: number` | 样本权重。 | ✅ |
| `gain` | `gain: number` | 音量增益，使声音更大。 | ✅ |
| `gainRange` | `gainRange: number` | 音量增益的变化范围。 | ✅ |
| `pitch` | `pitch: number` | 音调调整倍数。 * 1 : 正常 * < 1 : 播放速度变慢 * > 1 : 播放速度变快 | ✅ |
| `pitchRange` | `pitchRange: number` | 音调变化范围。 | ✅ |
| `sample` | `sample: GameAudioAssets \| ""` | 样本路径。 | ✅ |

### GameSoundEffectConfig

*interface · GameAPI*

> 定义游戏音效配置的接口。 此接口用于标准化音效配置，确保音效在游戏中的表现一致性和可预测性。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `sample` | `sample: GameAudioAssets \| ""` | 音效样本的标识符，用于引用特定的音效资源。 | — |
| `radius` | `radius: number` | 音效生效的最大半径，超出此范围将无法听到音效。 | — |
| `gain` | `gain: number` | 音效的基础音量增益，用于控制音效的初始响度。 | — |
| `gainRange` | `gainRange: number` | 音量增益的变化范围，用于随机化音效的响度，增加真实感。 | — |
| `pitch` | `pitch: number` | 音效的基础音高，用于控制音效的初始频率。 | — |
| `pitchRange` | `pitchRange: number` | 音高变化的范围，用于随机化音效的频率，增加多样性和真实感。 | — |

### GameTriggerEvent

*class · GameAPI*

> 当实体激活或取消激活触发器时触发的事件。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 事件发生的时间。 | ✅ |
| `entity` | `entity: GameEntity` | 触发事件的实体。 | ✅ |

### GameVoxelContact

*class · GameAPI*

> 描述一个活跃的方块接触状态。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `x` | `x: number` | 方块的 X 坐标。 | ✅ |
| `y` | `y: number` | 方块的 Y 坐标。 | ✅ |
| `z` | `z: number` | 方块的 Z 坐标。 | ✅ |
| `voxel` | `voxel: voxelId` | 方块编号。 | ✅ |
| `force` | `force: GameVector3` | 接触力。 | ✅ |
| `axis` | `axis: GameVector3` | 接触轴。 | ✅ |

### GameVoxelContactEvent

*class · GameAPI*

> 当实体与地形接触时触发的事件。 由 `GameWorld.onVoxelContact`, `GameWorld.onVoxelSeparate`, `GameEntity.onVoxelContact`, `GameEntity.onVoxelSeparate` 触发。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 接触事件发生的时间。 | ✅ |
| `entity` | `entity: GameEntity` | 与地形接触的实体。 | ✅ |
| `x` | `x: number` | 接触方块的 x 坐标。 | ✅ |
| `y` | `y: number` | 接触方块的 y 坐标。 | ✅ |
| `z` | `z: number` | 接触方块的 z 坐标。 | ✅ |
| `voxel` | `voxel: voxelId` | 方块的 ID。 | ✅ |
| `axis` | `axis: GameVector3` | 分离轴。 | ✅ |
| `force` | `force: GameVector3` | 碰撞力。 | ✅ |

### GameWearable

*class · GameAPI*

> 可穿戴物品类，实现了 GameWearableSpec 接口。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `player` | `player: GamePlayer \| null` | 此可穿戴装备所附着的玩家。 | ✅ |
| `bodyPart` | `bodyPart: GameBodyPart` | 此可穿戴装备所附着的身体部位。 | ✅ |
| `mesh` | `mesh: GameModelAssets \| ""` | 此可穿戴装备的网格模型。 | ✅ |
| `color` | `color: GameRGBColor` | 可穿戴装备的可选颜色调整。 | ✅ |
| `emissive` | `emissive: number` | 可穿戴装备的发光度调整。 | ✅ |
| `metalness` | `metalness: number` | 可穿戴装备的金属度调整。 | ✅ |
| `shininess` | `shininess: number` | 可穿戴装备的光泽度调整。 | ✅ |
| `orientation` | `orientation: GameQuaternion` | 可穿戴装备的方向。 | ✅ |
| `scale` | `scale: GameVector3` | 可穿戴装备在x/y/z轴上的缩放。 | ✅ |
| `offset` | `offset: GameVector3` | 可穿戴装备的位置偏移。 | ✅ |
| `remove` | `remove(): void` | 移除此可穿戴装备。 | ✅ |

### GameWearableSpec

*interface · GameAPI*

> 定义游戏可穿戴物品的规格接口。该接口用于描述游戏中的可穿戴物品的各种属性，以便在游戏环境中准确地呈现这些物品。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `bodyPart` | `bodyPart: GameBodyPart` | 身体部位，表示该可穿戴物品所对应的穿戴位置。 | — |
| `mesh` | `mesh: GameModelAssets \| ""` | 网格模型路径，用于指定该物品的3D模型。 | — |
| `color` | `color: GameRGBColor` | 颜色，表示该物品在游戏中的显示颜色。 | — |
| `emissive` | `emissive: number` | 发光强度，用于控制物品的自发光效果，使其在特定条件下更加显眼。 | — |
| `metalness` | `metalness: number` | 金属度，用于控制物品的金属质感，影响光照下的反射和折射效果。 | — |
| `shininess` | `shininess: number` | 光泽度，用于控制物品表面的光滑程度，影响光线的反射效果。 | — |
| `orientation` | `orientation: GameQuaternion` | 朝向，表示物品在空间中的旋转状态，用于确保物品正确地面向玩家或指定方向。 | — |
| `scale` | `scale: GameVector3` | 缩放，用于控制物品的大小，允许在不同情境下调整物品的视觉大小。 | — |
| `offset` | `offset: GameVector3` | 偏移，表示物品相对于默认位置的移动距离，用于精确定位物品在游戏世界中的位置。 | — |

### GameWorld

*class · GameAPI*

> [GameWorld](#gameworld) 是引擎 API 的主要入口点。使用此对象可以控制场景的全局属性，如天气、一天中的时间等，并对存在于世界中的所有 [GameEntity](#gameentity) 进行搜索。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `url` | `url: URL` | 当前运行世界的公共 URL。 | ✅ |
| `entityQuota` | `entityQuota: () => number` | 返回脚本当前还可以创建的实体数量配额。 | ✅ |
| `onRespawn` | `onRespawn: GameEventChannel<GameRespawnEvent>` | 当玩家重生时触发的事件。 | ✅ |
| `nextRespawn` | `nextRespawn: GameEventFuture<GameRespawnEvent>` | 等待下一次玩家重生事件。 | ✅ |
| `createEntity` | `createEntity: (config: Partial<GameEntityConfig>) => GameEntity \| null` | 创建一个新的 [GameEntity](#gameentity) 或复制一个现有实体。 如果超出实体配额，则返回 `null`。<br>• config：实体的初始值集或要复制的新实体。<br>• 返回值：具有给定参数的新创建的实体。 | ✅ |
| `querySelector` | `querySelector: (selector: GameSelectorString) => GameEntity \| null` | 使用类似于 jQuery 选择器的语法搜索游戏中的实体，并返回匹配的第一个实体。 更多示例参见 `GameSelectorString`。<br>• selector：选择器搜索模式。<br>• 返回值：匹配选择器的第一个实体，如果找不到则返回 `null`。 | ✅ |
| `querySelectorAll` | `querySelectorAll(selector: "player"): GamePlayerEntity[]` | 使用类似于 jQuery 选择器的语法搜索游戏中的实体，并返回所有匹配的实体。 更多示例参见 `GameSelectorString`。<br>• selector：选择器搜索模式。<br>• 返回值：所有匹配选择器的实体数组。 | ✅ |
| `querySelectorAll` | `querySelectorAll(selector: GameSelectorString): GameEntity[]` | 使用类似于 jQuery 选择器的语法搜索游戏中的实体，并返回所有匹配的实体。 更多示例参见 `GameSelectorString`。<br>• selector：选择器搜索模式。<br>• 返回值：所有匹配选择器的实体数组。 | ✅ |
| `testSelector` | `testSelector: (selector: GameSelectorString, entity: GameEntity) => boolean` | 测试给定实体是否匹配选择器模式。<br>• selector：要测试的选择器模式。<br>• entity：要测试的实体。<br>• 返回值：如果实体匹配选择器，则返回 `true`，否则返回 `false`。 | ✅ |
| `addCollisionFilter` | `addCollisionFilter: ( aSelector: GameSelectorString, bSelector: GameSelectorString ) => void` | 禁用所有匹配 aSelector 和 bSelector 的实体之间的碰撞。<br>• aSelector：第一组实体的选择器。<br>• bSelector：第二组实体的选择器。 | ✅ |
| `removeCollisionFilter` | `removeCollisionFilter: ( aSelector: GameSelectorString, bSelector: GameSelectorString ) => void` | 移除 aSelector 和 bSelector 之间的碰撞过滤器。<br>• aSelector：第一组实体的选择器。<br>• bSelector：第二组实体的选择器。 | ✅ |
| `clearCollisionFilters` | `clearCollisionFilters: () => void` | 清除所有已设置的碰撞过滤器。 | ✅ |
| `collisionFilters` | `collisionFilters: () => string[][]` | 返回当前所有活动的碰撞过滤器列表。<br>• 返回值：所有当前活动的碰撞过滤器。 | ✅ |
| `raycast` | `raycast: ( origin: GameVector3, direction: GameVector3, options?: Partial<GameRaycastOptions> ) => GameRaycastResult` | 从 `origin` 沿 `direction` 投射一条光线，并返回第一个命中的结果。<br>• origin：光线的起点。<br>• direction：光线的方向。<br>• options：可选的配置参数。<br>• 返回值：关于光线投射结果的信息。 | ✅ |
| `searchBox` | `searchBox: (bounds: GameBounds3) => GameEntity[]` | 搜索并返回所有包含在指定边界框内的实体。<br>• bounds：要搜索的边界框。<br>• 返回值：所有完全包含在 `bounds` 内的实体数组。 | ✅ |
| `animate` | `animate: ( keyframes: Partial<GameWorldKeyframe>[], playbackInfo?: Partial<GameAnimationPlaybackConfig> ) => GameAnimation<GameWorldKeyframe, GameWorld>` | 在世界对象上播放一个基于关键帧的动画。<br>• keyframes：定义动画行为的关键帧数组。<br>• playbackInfo：动画的播放配置选项。<br>• 返回值：返回一个 [GameAnimation](#gameanimation) 对象，用于控制动画的播放。 | ✅ |
| `getAnimations` | `getAnimations: () => GameAnimation<GameWorldKeyframe, GameWorld>[]` | 获取当前在世界对象上播放的所有动画。<br>• 返回值：一个包含所有世界动画的 [GameAnimation](#gameanimation) 数组。 | ✅ |
| `getEntityAnimations` | `getEntityAnimations: () => GameAnimation<GameEntityKeyframe, GameEntity>[]` | 获取当前在所有实体上播放的动画。<br>• 返回值：一个包含所有实体动画的 [GameAnimation](#gameanimation) 数组。 | ✅ |
| `getPlayerAnimations` | `getPlayerAnimations: () => GameAnimation<GamePlayerKeyframe, GamePlayer>[]` | 获取当前在所有玩家上播放的动画。<br>• 返回值：一个包含所有玩家动画的 [GameAnimation](#gameanimation) 数组。 | ✅ |
| `onTick` | `onTick: GameEventChannel<GameTickEvent>` | 每个游戏 tick 触发的事件。一个 tick 是一个游戏世界更新周期。 | ✅ |
| `nextTick` | `nextTick: GameEventFuture<GameTickEvent>` | 等待下一个游戏 tick 事件。 | ✅ |
| `onTakeDamage` | `onTakeDamage: GameEventChannel<GameDamageEvent>` | 当任何实体受到伤害时触发的事件。 | ✅ |
| `nextTakeDamage` | `nextTakeDamage: GameEventFuture<GameDamageEvent>` | 等待下一个实体受到伤害事件。 | ✅ |
| `onDie` | `onDie: GameEventChannel<GameDieEvent>` | 当任何实体死亡时触发的事件。 | ✅ |
| `nextDie` | `nextDie: GameEventFuture<GameDieEvent>` | 等待下一个实体死亡事件。 | ✅ |
| `onPlayerJoin` | `onPlayerJoin: GameEventChannel<GamePlayerEntityEvent>` | 当有新玩家加入游戏时触发的事件。 | ✅ |
| `nextPlayerJoin` | `nextPlayerJoin: GameEventFuture<GamePlayerEntityEvent>` | 等待下一个玩家加入事件。 | ✅ |
| `onPlayerLeave` | `onPlayerLeave: GameEventChannel<GamePlayerEntityEvent>` | 当有玩家离开游戏时触发的事件。 | ✅ |
| `nextPlayerLeave` | `nextPlayerLeave: GameEventFuture<GamePlayerEntityEvent>` | 等待下一个玩家离开事件。 | ✅ |
| `onEntityCreate` | `onEntityCreate: GameEventChannel<GameEntityEvent>` | 当世界中创建新实体时触发的事件。 | ✅ |
| `nextEntityCreate` | `nextEntityCreate: GameEventFuture<GameEntityEvent>` | 等待下一个实体创建事件。 | ✅ |
| `onEntityDestroy` | `onEntityDestroy: GameEventChannel<GameEntityEvent>` | 当世界中的实体被销毁时触发的事件。 | ✅ |
| `nextEntityDestroy` | `nextEntityDestroy: GameEventFuture<GameEntityEvent>` | 等待下一个实体销毁事件。 | ✅ |
| `say` | `say: (message: string) => void` | 向所有玩家广播一条消息。<br>• message：要广播的文本消息。 | ✅ |
| `onChat` | `onChat: GameEventChannel<GameChatEvent>` | 当任何玩家在聊天中发言时触发的事件。 | ✅ |
| `nextChat` | `nextChat: GameEventFuture<GameChatEvent>` | 等待下一个聊天事件。 | ✅ |
| `onClick` | `onClick: GameEventChannel<GameClickEvent>` | 当玩家点击一个实体或体素时触发的事件。 | ✅ |
| `nextClick` | `nextClick: GameEventFuture<GameClickEvent>` | 等待下一个点击事件。 | ✅ |
| `onPress` | `onPress: GameEventChannel<GameInputEvent>` | 当玩家按下已绑定的输入按钮时触发的事件。 | ✅ |
| `nextPress` | `nextPress: GameEventFuture<GameInputEvent>` | 等待下一个按钮按下事件。 | ✅ |
| `onRelease` | `onRelease: GameEventChannel<GameInputEvent>` | 当玩家释放已绑定的输入按钮时触发的事件。 | ✅ |
| `nextRelease` | `nextRelease: GameEventFuture<GameInputEvent>` | 等待下一个按钮释放事件。 | ✅ |
| `onEntityContact` | `onEntityContact: GameEventChannel<GameEntityContactEvent>` | 当两个实体开始接触时触发的事件。 | ✅ |
| `nextEntityContact` | `nextEntityContact: GameEventFuture<GameEntityContactEvent>` | 等待下一个实体接触事件。 | ✅ |
| `onEntitySeparate` | `onEntitySeparate: GameEventChannel<GameEntityContactEvent>` | 当两个实体停止接触时触发的事件。 | ✅ |
| `nextEntitySeparate` | `nextEntitySeparate: GameEventFuture<GameEntityContactEvent>` | 等待下一个实体分离事件。 | ✅ |
| `onVoxelContact` | `onVoxelContact: GameEventChannel<GameVoxelContactEvent>` | 当一个实体开始接触一个体素（方块）时触发的事件。 | ✅ |
| `nextVoxelContact` | `nextVoxelContact: GameEventFuture<GameVoxelContactEvent>` | 等待下一个实体接触体素事件。 | ✅ |
| `onVoxelSeparate` | `onVoxelSeparate: GameEventChannel<GameVoxelContactEvent>` | 当一个实体停止接触一个体素（方块）时触发的事件。 | ✅ |
| `nextVoxelSeparate` | `nextVoxelSeparate: GameEventFuture<GameVoxelContactEvent>` | 等待下一个实体与体素分离的事件。 | ✅ |
| `onFluidEnter` | `onFluidEnter: GameEventChannel<GameFluidContactEvent>` | 当一个实体进入流体时触发的事件。 | ✅ |
| `nextFluidEnter` | `nextFluidEnter: GameEventFuture<GameFluidContactEvent>` | 等待下一个实体进入流体的事件。 | ✅ |
| `onFluidLeave` | `onFluidLeave: GameEventChannel<GameFluidContactEvent>` | 当一个实体离开流体时触发的事件。 | ✅ |
| `nextFluidLeave` | `nextFluidLeave: GameEventFuture<GameFluidContactEvent>` | 等待下一个实体离开流体的事件。 | ✅ |
| `zones` | `zones: () => GameZone[]` | 获取世界中所有区域的列表。<br>• 返回值：一个包含所有 [GameZone](#gamezone) 对象的数组。 | ✅ |
| `addZone` | `addZone: (config: Partial<GameZoneConfig>) => GameZone` | 在世界中创建一个新的区域。<br>• config：用于配置新区域的 `GameZoneConfig` 对象。<br>• 返回值：新创建的 [GameZone](#gamezone) 对象。 | ✅ |
| `removeZone` | `removeZone: (trigger: GameZone) => void` | 从世界中移除一个区域。<br>• trigger：要移除的 [GameZone](#gamezone) 对象。 | ✅ |
| `onInteract` | `onInteract: GameEventChannel<GameInteractEvent>` | 当玩家与实体或UI元素互动时触发的事件。 | ✅ |
| `nextInteract` | `nextInteract: GameEventFuture<GameInteractEvent>` | 等待下一个互动事件。 | ✅ |
| `onPlayerPurchaseSuccess` | `onPlayerPurchaseSuccess: GameEventChannel<GamePurchaseSuccessEvent>` | 当玩家成功完成一次购买时触发的事件。 | ✅ |
| `nextPlayerPurchaseSuccess` | `nextPlayerPurchaseSuccess: GameEventFuture<GamePurchaseSuccessEvent>` | 等待下一个玩家成功购买事件。 | ✅ |
| `sound` | `sound: ( spec: \| { /** * @zh * 音频样本的名称。 * @en * The name of the audio sample. */ sample: string; /** * @zh * 声音的播放位置。 * @en * The position where the sound is played. */ position?: GameVector3; /** * @zh * 声音的播放半径。 *…` | 在指定位置播放一个声音效果。<br>• spec：声音效果配置。<br>• 返回值：返回一个 [Sound](#sound) 对象，用于控制声音的播放。 | ✅ |
| `teleport` | `teleport: TeleportType` | 提供将玩家传送到同一地图组内其他地图的能力。 | ✅ |
| `createTempChat` | `createTempChat: (userIds?: string[]) => Promise<string>` | 创建一个临时聊天频道。<br>• userIds：频道中初始用户的 ID 列表。<br>• 返回值：返回一个 Promise，解析为新创建的聊天频道的 ID。 | ✅ |
| `destroyTempChat` | `destroyTempChat: (chatIds: string[]) => Promise<string[]>` | 销毁一个或多个临时聊天频道。<br>• chatIds：要销毁的聊天频道的 ID 列表。<br>• 返回值：返回一个 Promise，解析为已成功销毁的聊天频道的 ID 列表。 | ✅ |
| `addTempChatPlayer` | `addTempChatPlayer: (chatId: string, userIds: string[]) => Promise<string[]>` | 将一个或多个用户添加到一个特定的临时聊天频道。<br>• chatId：目标聊天频道的 ID。<br>• userIds：要添加的用户的 ID 列表。<br>• 返回值：返回一个 Promise，解析为已成功添加的用户的 ID 列表。 | ✅ |
| `removeTempChatPlayer` | `removeTempChatPlayer: ( chatId: string, userIds: string[] ) => Promise<string[]>` | 从一个特定的临时聊天频道中移除一个或多个用户。<br>• chatId：目标聊天频道的 ID。<br>• userIds：要移除的用户的 ID 列表。<br>• 返回值：返回一个 Promise，解析为已成功移除的用户的 ID 列表。 | ✅ |
| `getTempChats` | `getTempChats: () => Promise<string[]>` | 获取当前地图中所有存在的临时聊天频道的列表。<br>• 返回值：返回一个 Promise，解析为一个包含所有临时聊天频道 ID 的数组。 | ✅ |
| `getTempChatUsers` | `getTempChatUsers: (chatId: string) => Promise<string[]>` | 查询特定临时聊天频道内的所有用户。<br>• chatId：要查询的聊天频道的 ID。<br>• 返回值：返回一个 Promise，解析为一个包含该频道内所有用户 ID 的数组。 | ✅ |
| `serverId` | `serverId: string` | 当前服务器的唯一标识符。 | ✅ |
| `projectName` | `projectName: string` | 项目的名称（只读）。 | ✅ |
| `currentTick` | `currentTick: number` | 当前的游戏 tick 数，用于记录时间点或事件序列中的位置。 | ✅ |
| `lightMode` | `lightMode: "natural" \| "manual"` | 用于天空和环境光的照明模式。 | ✅ |
| `sunPhase` | `sunPhase: number` | 太阳在天空中的初始相位。一天中的时间通过以下公式计算： `timeOfDay = (sunPhase + sunFrequency * tick) % 1` | ✅ |
| `sunFrequency` | `sunFrequency: number` | 太阳在天空中移动的频率。值越高，太阳移动越快。 | ✅ |
| `lunarPhase` | `lunarPhase: number` | 月球的相位。必须在 0 和 1 之间。 | ✅ |
| `sunDirection` | `sunDirection: GameVector3` | 太阳的方向（仅当 `lightMode` 为 `'manual'` 时生效）。 | ✅ |
| `sunLight` | `sunLight: GameRGBColor` | 太阳光的光照颜色（仅当 `lightMode` 为 `'manual'` 时生效）。 | ✅ |
| `skyLeftLight` | `skyLeftLight: GameRGBColor` | 天空左侧（-x 方向）的环境光颜色（仅当 `lightMode` 为 `'manual'` 时生效）。 | ✅ |
| `skyRightLight` | `skyRightLight: GameRGBColor` | 天空右侧（+x 方向）的环境光颜色（仅当 `lightMode` 为 `'manual'` 时生效）。 | ✅ |
| `skyBottomLight` | `skyBottomLight: GameRGBColor` | 天空底部（-y 方向）的环境光颜色（仅当 `lightMode` 为 `'manual'` 时生效）。 | ✅ |
| `skyTopLight` | `skyTopLight: GameRGBColor` | 天空顶部（+y 方向）的环境光颜色（仅当 `lightMode` 为 `'manual'` 时生效）。 | ✅ |
| `skyFrontLight` | `skyFrontLight: GameRGBColor` | 天空前方（-z 方向）的环境光颜色（仅当 `lightMode` 为 `'manual'` 时生效）。 | ✅ |
| `skyBackLight` | `skyBackLight: GameRGBColor` | 天空后方（+z 方向）的环境光颜色（仅当 `lightMode` 为 `'manual'` 时生效）。 | ✅ |
| `fogColor` | `fogColor: GameRGBColor` | 雾的颜色。 | ✅ |
| `fogStartDistance` | `fogStartDistance: number` | 雾开始的距离。 | ✅ |
| `fogHeightOffset` | `fogHeightOffset: number` | 雾开始的高度。 | ✅ |
| `fogHeightFalloff` | `fogHeightFalloff: number` | 高度雾衰减率。 | ✅ |
| `fogUniformDensity` | `fogUniformDensity: number` | 均匀雾的量（如果大于 0，则看不到天空盒）。 | ✅ |
| `maxFog` | `maxFog: number` | 最大雾量。 | ✅ |
| `snowDensity` | `snowDensity: number` | 雪的密度。 | ✅ |
| `snowSizeLo` | `snowSizeLo: number` | 雪的最小尺寸。 | ✅ |
| `snowSizeHi` | `snowSizeHi: number` | 雪的最大尺寸。 | ✅ |
| `snowFallSpeed` | `snowFallSpeed: number` | 雪的下落速度。 | ✅ |
| `snowSpinSpeed` | `snowSpinSpeed: number` | 雪的旋转速度。 | ✅ |
| `snowColor` | `snowColor: GameRGBAColor` | 雪的颜色。 | ✅ |
| `snowTexture` | `snowTexture: string` | 雪的纹理。 | ✅ |
| `rainDensity` | `rainDensity: number` | 雨的密度。 | ✅ |
| `rainDirection` | `rainDirection: GameVector3` | 雨的方向。 | ✅ |
| `rainSpeed` | `rainSpeed: number` | 雨的速度。 | ✅ |
| `rainSizeLo` | `rainSizeLo: number` | 雨滴的最小尺寸。 | ✅ |
| `rainSizeHi` | `rainSizeHi: number` | 雨滴的最大尺寸。 | ✅ |
| `rainInterference` | `rainInterference: number` | 雨的干扰量。 | ✅ |
| `rainColor` | `rainColor: GameRGBAColor` | 雨的颜色。 | ✅ |
| `gravity` | `gravity: number` | 全局重力。 | ✅ |
| `airFriction` | `airFriction: number` | 空气摩擦力。 | ✅ |
| `rainSizeLo` | `rainSizeLo: number` | 雨滴的最小尺寸。 | ✅ |
| `rainSizeHi` | `rainSizeHi: number` | 雨滴的最大尺寸。 | ✅ |
| `rainInterference` | `rainInterference: number` | 雨的干扰量。 | ✅ |
| `rainColor` | `rainColor: GameRGBAColor` | 雨的颜色。 | ✅ |
| `useOBB` | `useOBB: boolean` | 是否使用 OBB（Oriented Bounding Box）刚体进行物理计算。 | ✅ |
| `breakVoxelSound` | `breakVoxelSound: GameSoundEffect` | 当方块被破坏时播放的声音效果。 | ✅ |
| `placeVoxelSound` | `placeVoxelSound: GameSoundEffect` | 当方块被放置时播放的声音效果。 | ✅ |
| `playerJoinSound` | `playerJoinSound: GameSoundEffect` | 当玩家加入游戏时播放的声音效果。 | ✅ |
| `playerLeaveSound` | `playerLeaveSound: GameSoundEffect` | 当玩家离开游戏时播放的声音效果。 | ✅ |
| `ambientSound` | `ambientSound: GameSoundEffect` | 全局播放的背景环境声音。 | ✅ |

### GameWorldKeyframe

*interface · GameAPI*

> 定义游戏世界的关键帧接口，用于描述游戏环境中各种效果和状态的动画变化。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `duration` | `duration: number` | 关键帧持续时间，单位为毫秒。 | — |
| `easeIn` | `easeIn: GameEasing` | 加速曲线类型，用于控制关键帧开始时的变化速度。 | — |
| `easeOut` | `easeOut: GameEasing` | 减速曲线类型，用于控制关键帧结束时的变化速度。 | — |
| `fogColor` | `fogColor: GameRGBColor` | 雾效颜色，使用RGB格式。 | — |
| `fogStartDistance` | `fogStartDistance: number` | 雾效起始距离，单位为米。 | — |
| `fogHeightOffset` | `fogHeightOffset: number` | 雾效高度偏移量，用于调整雾效的垂直位置。 | — |
| `fogHeightFalloff` | `fogHeightFalloff: number` | 雾效高度衰减系数，用于控制雾效随高度减少的速度。 | — |
| `fogUniformDensity` | `fogUniformDensity: number` | 统一雾效密度，用于控制雾效的浓密程度。 | — |
| `maxFog` | `maxFog: number` | 最大雾效强度，用于限制雾效的最大可见度。 | — |
| `lightMode` | `lightMode: "natural" \| "manual"` | 光照模式，可以是 'natural' (自然) 或 'manual' (手动)。 | — |
| `sunPhase` | `sunPhase: number` | 太阳相位，用于控制太阳的位置和光照。 | — |
| `sunFrequency` | `sunFrequency: number` | 太阳频率，用于控制太阳光照的变化速度。 | — |
| `lunarPhase` | `lunarPhase: number` | 月相，用于控制月亮的光照效果。 | — |
| `sunDirection` | `sunDirection: GameVector3` | 太阳方向，使用三维向量表示。 | — |
| `sunLight` | `sunLight: GameRGBColor` | 太阳光照颜色，使用RGB格式。 | — |
| `skyLeftLight` | `skyLeftLight: GameRGBColor` | 左侧天空光照颜色。 | — |
| `skyRightLight` | `skyRightLight: GameRGBColor` | 右侧天空光照颜色。 | — |
| `skyBottomLight` | `skyBottomLight: GameRGBColor` | 底部天空光照颜色。 | — |
| `skyTopLight` | `skyTopLight: GameRGBColor` | 顶部天空光照颜色。 | — |
| `skyFrontLight` | `skyFrontLight: GameRGBColor` | 前方天空光照颜色。 | — |
| `skyBackLight` | `skyBackLight: GameRGBColor` | 后方天空光照颜色。 | — |
| `rainDensity` | `rainDensity: number` | 雨密度，用于控制雨效的浓密程度。 | — |
| `rainDirection` | `rainDirection: GameVector3` | 雨方向，使用三维向量表示。 | — |
| `rainSpeed` | `rainSpeed: number` | 雨速，单位为米/秒。 | — |
| `rainSizeLo` | `rainSizeLo: number` | 小雨滴大小，单位为米。 | — |
| `rainSizeHi` | `rainSizeHi: number` | 大雨滴大小，单位为米。 | — |
| `rainInterference` | `rainInterference: number` | 雨干扰程度，用于控制雨滴的随机偏移。 | — |
| `rainColor` | `rainColor: GameRGBAColor` | 雨色，使用RGBA格式，支持透明度。 | — |
| `snowDensity` | `snowDensity: number` | 雪密度，用于控制雪效的浓密程度。 | — |
| `snowSizeLo` | `snowSizeLo: number` | 小雪片大小，单位为米。 | — |
| `snowSizeHi` | `snowSizeHi: number` | 大雪片大小，单位为米。 | — |
| `snowFallSpeed` | `snowFallSpeed: number` | 雪片下落速度，单位为米/秒。 | — |
| `snowSpinSpeed` | `snowSpinSpeed: number` | 雪片旋转速度，用于控制雪片的旋转动画。 | — |
| `snowColor` | `snowColor: GameRGBAColor` | 雪色，使用RGBA格式，支持透明度。 | — |
| `snowTexture` | `snowTexture: string` | 雪纹理，使用字符串表示雪片的纹理资源。 | — |
| `gravity` | `gravity: number` | 重力加速度，用于控制物体下落速度。 | — |
| `airFriction` | `airFriction: number` | 空气摩擦系数，用于控制物体在空气中移动时的阻力。 | — |

### GameZone

*class · GameAPI*

> 触发器可以用于检测对象何时进入或离开某个区域。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `entities` | `entities: () => GameEntity[]` | 列出所有实体。 | ✅ |
| `onEnter` | `onEnter: GameEventChannel<GameTriggerEvent>` | 当实体进入区域时触发。 | ✅ |
| `nextEnter` | `nextEnter: GameEventFuture<GameTriggerEvent>` | 获取下一个进入事件。 | ✅ |
| `onLeave` | `onLeave: GameEventChannel<GameTriggerEvent>` | 当实体离开区域时触发。 | ✅ |
| `nextLeave` | `nextLeave: GameEventFuture<GameTriggerEvent>` | 获取下一个离开事件。 | ✅ |
| `remove` | `remove: () => void` | 销毁区域。 | ✅ |
| `bounds` | `bounds: GameBounds3` | 区域的边界。 | ✅ |
| `selector` | `selector: GameSelectorString` | 选择器过滤条件。 | ✅ |
| `massScale` | `massScale: number` | 控制对象的质量对力的影响。 0 = 行为像重力 1 = 行为像风 | ✅ |
| `force` | `force: GameVector3` | 应用到对象上的力的大小。 | ✅ |
| `fogEnabled` | `fogEnabled: boolean` | 是否启用雾效果。 | ✅ |
| `fogColor` | `fogColor: GameRGBColor` | 雾的颜色。 | ✅ |
| `fogStartDistance` | `fogStartDistance: number` | 雾开始的距离。 | ✅ |
| `fogHeightOffset` | `fogHeightOffset: number` | 雾的高度偏移。 | ✅ |
| `fogHeightFalloff` | `fogHeightFalloff: number` | 雾的高度衰减。 | ✅ |
| `fogDensity` | `fogDensity: number` | 雾的密度。 | ✅ |
| `fogMax` | `fogMax: number` | 雾的最大值。 | ✅ |
| `snowEnabled` | `snowEnabled: boolean` | 是否启用雪效果。 | ✅ |
| `snowDensity` | `snowDensity: number` | 雪的密度。 | ✅ |
| `snowSizeLo` | `snowSizeLo: number` | 雪的最小尺寸。 | ✅ |
| `snowSizeHi` | `snowSizeHi: number` | 雪的最大尺寸。 | ✅ |
| `snowFallSpeed` | `snowFallSpeed: number` | 雪的下落速度。 | ✅ |
| `snowSpinSpeed` | `snowSpinSpeed: number` | 雪的旋转速度。 | ✅ |
| `snowColor` | `snowColor: GameRGBAColor` | 雪的颜色。 | ✅ |
| `snowTexture` | `snowTexture: string` | 雪的纹理。 | ✅ |
| `rainEnabled` | `rainEnabled: boolean` | 是否启用雨效果。 | ✅ |
| `rainDensity` | `rainDensity: number` | 雨的密度。 | ✅ |
| `rainDirection` | `rainDirection: GameVector3` | 雨的方向。 | ✅ |
| `rainSpeed` | `rainSpeed: number` | 雨的速度。 | ✅ |
| `rainSizeLo` | `rainSizeLo: number` | 雨的最小尺寸。 | ✅ |
| `rainSizeHi` | `rainSizeHi: number` | 雨的最大尺寸。 | ✅ |
| `rainInterference` | `rainInterference: number` | 雨的干扰程度。 | ✅ |
| `rainColor` | `rainColor: GameRGBAColor` | 雨的颜色。 | ✅ |
| `skyEnabled` | `skyEnabled: boolean` | 是否启用天空效果。 | ✅ |
| `skyMode` | `skyMode: "natural" \| "manual"` | 天空模式。 'natural' - 自然模式 'manual' - 手动模式 | ✅ |
| `skySunPhase` | `skySunPhase: number` | 太阳相位。 | ✅ |
| `skySunFrequency` | `skySunFrequency: number` | 太阳频率。 | ✅ |
| `skyLunarPhase` | `skyLunarPhase: number` | 月相。 | ✅ |
| `skySunDirection` | `skySunDirection: GameVector3` | 太阳方向。 | ✅ |
| `skySunLight` | `skySunLight: GameRGBColor` | 太阳光颜色。 | ✅ |
| `skyLeftLight` | `skyLeftLight: GameRGBColor` | 左侧光颜色。 | ✅ |
| `skyRightLight` | `skyRightLight: GameRGBColor` | 右侧光颜色。 | ✅ |
| `skyBottomLight` | `skyBottomLight: GameRGBColor` | 底部光颜色。 | ✅ |
| `skyTopLight` | `skyTopLight: GameRGBColor` | 顶部光颜色。 | ✅ |
| `skyFrontLight` | `skyFrontLight: GameRGBColor` | 前方光颜色。 | ✅ |
| `skyBackLight` | `skyBackLight: GameRGBColor` | 后方光颜色。 | ✅ |

## 方块与体素

_voxels 全局对象与体素读写_

### GameVoxels

*class · GameAPI*

> [GameVoxels](#gamevoxels) 提供了游戏中所有方块的接口。您可以使用它来控制地形。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `shape` | `shape: GameVector3` | 方块网格在 x、y、z 维度上的大小。 | ✅ |
| `VoxelTypes` | `VoxelTypes: string[]` | 游戏中所有支持的方块类型的名称数组。 | ✅ |
| `id` | `id: (name: voxelName) => voxelId \| 0` | 根据方块的可读名称获取其数字 ID。如果名称无效，则返回 0。<br>• name：方块的可读名称。<br>• 返回值：方块的数字 ID，如果名称无效则为 0。 | ✅ |
| `getVoxel` | `getVoxel: (x: number, y: number, z: number) => voxelId \| 0` | 获取指定坐标处的方块 ID。<br>• x：x 坐标。<br>• y：y 坐标。<br>• z：z 坐标。<br>• 返回值：指定坐标处的方块 ID。 | ✅ |
| `getVoxelRotation` | `getVoxelRotation: (x: number, y: number, z: number) => voxelRotation` | 获取指定坐标处方块的旋转代码。<br>• x：x 坐标。<br>• y：y 坐标。<br>• z：z 坐标。<br>• 返回值：指定坐标处方块的旋转代码。 | ✅ |
| `setVoxelId` | `setVoxelId(x: number, y: number, z: number, voxel: number \| voxelId): voxelId \| number` | 使用方块的数字 ID 在指定坐标处设置一个方块。这是 `setVoxel` 的一个更高效的版本。<br>• x：x 坐标。<br>• y：y 坐标。<br>• z：z 坐标。<br>• voxel：要设置的方块的 ID。<br>• 返回值：更新后位置的方块 ID。 | ✅ |
| `setVoxel` | `setVoxel( x: number, y: number, z: number, voxel: number, rotation: voxelRotation ): number` | 在指定坐标处设置一个带旋转信息的方块，并返回完整的数值 ID。 传入的 `voxel` 为基础方块 ID，最终返回的 ID 将包含旋转码。<br>• x：x 坐标。<br>• y：y 坐标。<br>• z：z 坐标。<br>• voxel：基础方块数值 ID（不含旋转码）。<br>• rotation：旋转码，将编码进返回的 ID 中。<br>• 返回值：带旋转码的数值 ID。 | ✅ |
| `setVoxel` | `setVoxel( x: number, y: number, z: number, voxel: voxelId \| voxelName, rotation?: 0 ): voxelId \| 0` | 在指定坐标处通过方块 ID 或方块名设置一个方块（不使用旋转，或旋转为 0）， 并返回不带旋转码的 `voxelId`，否则返回 `0`。<br>• x：x 坐标。<br>• y：y 坐标。<br>• z：z 坐标。<br>• voxel：要设置的方块，可以是方块 ID 或方块名。<br>• rotation：可选旋转码，为 `0` 或未传入时表示不使用旋转。<br>• 返回值：成功设置且不含旋转信息时返回 `voxelId`，否则返回 `0`。 | ✅ |
| `setVoxel` | `setVoxel( x: number, y: number, z: number, voxel: voxelId \| voxelName, rotation: voxelRotation ): number` | 在指定坐标处通过方块 ID 或方块名设置一个带旋转的方块， 返回带旋转码的完整数值 ID。<br>• x：x 坐标。<br>• y：y 坐标。<br>• z：z 坐标。<br>• voxel：要设置的方块，可以是方块 ID 或方块名。<br>• rotation：旋转码，将编码进返回的 ID 中。<br>• 返回值：带旋转码的数值 ID。 | ✅ |
| `setVoxelId` | `setVoxelId(x: number, y: number, z: number, voxel: voxelId \| number): voxelId \| number` | 在指定坐标处通过数值 ID 设置一个方块，并返回最终写入的数值 ID。 此处 `voxel` 可以是带旋转码的 ID，返回值同样是带旋转码的 ID。<br>• x：x 坐标。<br>• y：y 坐标。<br>• z：z 坐标。<br>• voxel：方块的数值 ID，可以包含旋转码。<br>• 返回值：实际写入的数值 ID（可能包含旋转码）。 | ✅ |
| `setVoxelId` | `setVoxelId(x: number, y: number, z: number, voxel: voxelId): voxelId \| 0` | 在指定坐标处通过 `voxelId` 设置一个方块。 若传入的是不带旋转码的 `voxelId`，返回值也为不带旋转码的 `voxelId`； 若无法设置则返回 `0`。<br>• x：x 坐标。<br>• y：y 坐标。<br>• z：z 坐标。<br>• voxel：方块的 `voxelId`（不包含旋转码）。<br>• 返回值：设置成功时返回 `voxelId`，否则返回 `0`。 | ✅ |
| `getVoxelId` | `getVoxelId(x: number, y: number, z: number): voxelId \| number` | 检索指定坐标处方块的数字 ID。这是 `getVoxel` 的一个更高效的版本。 返回的方块 ID 是带旋转码的 ID。<br>• x：x 坐标。<br>• y：y 坐标。<br>• z：z 坐标。<br>• 返回值：带旋转码的方块数值 ID。 | ✅ |
| `name` | `name(id: voxelId \| number): voxelName` | 根据方块的数值 ID 获取对应的方块名称。 传入带旋转码的 ID 也可以正常解析为方块名。<br>• id：方块的数值 ID，可以包含旋转码。<br>• 返回值：与该 ID 对应的方块名称。 | ✅ |

## 事件对象

_各 on* / next* 通道回调拿到的事件_

### AudioEvent

*interface · ClientAPI*

> 定义Audio事件的接口，包含事件的目标是Audio实例

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `target` | `target: Audio` | — | — |

### GameChatEvent

*class · GameAPI*

> 当实体发起聊天事件时触发。 由 `GameWorld.onChat` 和 `GameEntity.onChat` 触发。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 聊天事件发生的时间。 | ✅ |
| `entity` | `entity: GameEntity` | 发起聊天事件的实体。 | ✅ |
| `message` | `message: string` | 实体在聊天事件中说的话。 | ✅ |

### GameClickEvent

*class · GameAPI*

> 游戏点击事件类，用于封装游戏中的点击事件信息。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 发生点击事件的游戏刻。 | ✅ |
| `entity` | `entity: GameEntity` | 被点击的游戏实体。 | ✅ |
| `clicker` | `clicker: GamePlayerEntity` | 发起点击事件的玩家实体。 | ✅ |
| `button` | `button: GameButtonType.ACTION0 \| GameButtonType.ACTION1` | 被按下的按钮，ACTION0 表示左键，ACTION1 表示右键。 | ✅ |
| `distance` | `distance: number` | 点击者与被点击实体之间的距离。 | ✅ |
| `clickerPosition` | `clickerPosition: GameVector3` | 点击发生时点击者的位置。 | ✅ |
| `raycast` | `raycast: GameRaycastResult` | 从点击者到被点击实体的射线检测结果。 | ✅ |

### GameDamageEvent

*class · GameAPI*

> 当实体受到伤害时触发的事件。 由 `GameWorld.onTakeDamage` 和 `GameEntity.onTakeDamage` 触发。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 事件发生的时间。 | ✅ |
| `entity` | `entity: GameEntity` | 受到伤害的实体。 | ✅ |
| `damage` | `damage: number` | 伤害量。 | ✅ |
| `attacker` | `attacker: GameEntity \| null` | 攻击者实体。 | ✅ |
| `damageType` | `damageType: string` | 伤害类型。 | ✅ |

### GameDieEvent

*class · GameAPI*

> 当实体死亡时触发的事件。 由 `GameWorld.onTakeDamage` 和 `GameEntity.onTakeDamage` 触发。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 事件发生的时间。 | ✅ |
| `entity` | `entity: GameEntity` | 死亡的实体。 | ✅ |
| `attacker` | `attacker: GameEntity \| null` | 攻击者实体。 | ✅ |
| `damageType` | `damageType: string` | 伤害类型。 | ✅ |

### GameGUIEvent

*interface · GameAPI*

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `entity` | `entity: GamePlayerEntity` | — | — |
| `name` | `name: string` | — | — |
| `payload` | `payload: any` | — | — |

### GameInputEvent

*class · GameAPI*

> 当玩家按下按钮时生成输入事件。 事件的时间戳表示玩家按下按钮的确切时刻。 由 `GameWorld.onPress`, `GameWorld.onRelease`, `GamePlayer.onPress`, `GamePlayer.onRelease` 触发。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 按钮被按下的时间。 | ✅ |
| `entity` | `entity: GamePlayerEntity` | 按下按钮的玩家引用。 | ✅ |
| `position` | `position: GameVector3` | 按下按钮时玩家的位置。 | ✅ |
| `button` | `button: GameButtonType` | 玩家输入的按钮。 | ✅ |
| `pressed` | `pressed: boolean` | 如果为 true，则这是一个按下事件。否则为 false，表示这是一个释放事件。 | ✅ |
| `raycast` | `raycast: GameRaycastResult` | 玩家在按下按钮的确切时刻从其摄像机视角发起的射线检测结果。 | ✅ |

### GameInteractEvent

*class · GameAPI*

> 当实体进行交互时触发的事件。 由 `GameWorld.onInteract` 和 `GameEntity.onInteract` 触发。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 事件发生的时间。 | ✅ |
| `entity` | `entity: GamePlayerEntity` | 发起交互的实体。 | ✅ |
| `targetEntity` | `targetEntity: GameEntity` | 接收交互的实体。 | ✅ |

### GameKeyBoardEvent

*class · GameAPI*

> 游戏键盘事件类，用于封装游戏中的键盘事件信息。 由 `GameWorld.onKeyBoard`, `GamePlayer.onKeyBoard` 触发。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 发生键盘事件的游戏时刻。 | ✅ |
| `keyCode` | `keyCode: number` | 按下的键码。 | ✅ |

### GamePurchaseSuccessEvent

*class · GameAPI*

> 当玩家购买成功时触发的事件。 由 `GameWorld.onPlayerPurchaseSuccess` 触发。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 购买成功事件发生的时间。 | ✅ |
| `userId` | `userId: string` | 触发购买事件的用户 ID。 | ✅ |
| `productId` | `productId: GameProductAssets` | 购买的商品 ID。 | ✅ |
| `orderId` | `orderId: number` | 购买成功的订单号。 | ✅ |

### GameRespawnEvent

*class · GameAPI*

> 当玩家重生时触发的事件。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 事件发生的时间。 | ✅ |
| `entity` | `entity: GamePlayerEntity` | 重生的玩家实体。 | ✅ |

### GameTickEvent

*class · GameAPI*

> 每个游戏帧由 `GameWorld.onTick` 触发的事件。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `tick` | `tick: number` | 事件触发的帧数。 | ✅ |
| `prevTick` | `prevTick: number` | 上一次处理的帧数。 | ✅ |
| `skip` | `skip: boolean` | 是否由于脚本延迟而跳过了任何帧。 | ✅ |
| `elapsedTimeMS` | `elapsedTimeMS: number` | 帧之间的时间间隔（毫秒）。 | ✅ |

### UiEvent

*interface · ClientAPI*

> UI事件

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `target` | `target: T` | 触发事件的节点。 | — |

## 值与配置

_构造与传值用的形状：向量、颜色、关键帧、配置_

### GameAssetListEntry

*class · GameAPI*

> 资产列表条目

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `path` | `path: string` | 资产的完全限定路径，按目录分割 | ✅ |
| `type` | `type: GameAssetType` | 资产的类型 | ✅ |

### GameAssetType

*enum · GameAPI*

> 描述资产的类型

_（无成员级声明：枚举或纯数据形状。）_

### GameBodyPart

*enum · GameAPI*

> 身体部位。

_（无成员级声明：枚举或纯数据形状。）_

### GameBounds3

*class · GameAPI*

> 表示一个三维游戏区域的边界。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `lo` | `lo: GameVector3` | 区域的低处顶点。 | ✅ |
| `hi` | `hi: GameVector3` | 区域的高处顶点。 | ✅ |
| `constructor` | `constructor(lo: GameVector3, hi: GameVector3)` | 构造一个新的三维游戏区域边界对象。<br>• lo：区域的低处顶点。xyz最小的值。<br>• hi：区域的高处顶点。xyz最大的值。 | ✅ |
| `fromPoints` | `static fromPoints(...points: GameVector3[]): GameBounds3` | 根据多个点创建一个三维游戏区域边界对象。<br>• points：用于定义边界的点数组。<br>• 返回值：一个新的三维游戏区域边界对象。 | ✅ |
| `intersect` | `intersect(b: GameBounds3): GameBounds3` | 计算当前边界与另一个边界的交集。<br>• b：另一个边界对象。<br>• 返回值：交集边界对象。 | ✅ |
| `contains` | `contains(b: GameVector3): boolean` | 检查当前边界是否包含给定点。<br>• b：要检查的点。<br>• 返回值：如果当前边界包含该点，则返回true；否则返回false。 | ✅ |
| `containsBounds` | `containsBounds(b: GameBounds3): boolean` | 检查当前边界是否完全包含另一个边界。<br>• b：要检查的边界对象。<br>• 返回值：如果当前边界完全包含另一个边界，则返回true；否则返回false。 | ✅ |
| `intersects` | `intersects(b: GameBounds3): boolean` | 检查当前边界是否与另一个边界相交。<br>• b：另一个边界对象。<br>• 返回值：如果当前边界与另一个边界相交，则返回true；否则返回false。 | ✅ |
| `set` | `set( lox: number, loy: number, loz: number, hix: number, hiy: number, hiz: number ): GameBounds3` | 设置当前边界的低处和高处顶点坐标。<br>• lox：低处顶点的x坐标。<br>• loy：低处顶点的y坐标。<br>• loz：低处顶点的z坐标。<br>• hix：高处顶点的x坐标。<br>• hiy：高处顶点的y坐标。<br>• hiz：高处顶点的z坐标。<br>• 返回值：当前的三维游戏区域边界对象。 | ✅ |
| `copy` | `copy(b: GameBounds3): GameBounds3` | 复制另一个边界对象的属性到当前边界对象。<br>• b：要复制的边界对象。<br>• 返回值：当前的三维游戏区域边界对象。 | ✅ |
| `toString` | `toString(): string` | 返回当前边界对象的字符串表示。<br>• 返回值：当前边界对象的字符串表示。 | ✅ |

### GameButtonType

*enum · GameAPI*

> 玩家按下的按钮类型。

_（无成员级声明：枚举或纯数据形状。）_

### GameCameraFreezedAxis

*enum · GameAPI*

> 冻结相机轴的枚举。

_（无成员级声明：枚举或纯数据形状。）_

### GameCameraMode

*enum · GameAPI*

> 定义游戏摄像头模式的枚举，包含游戏摄像头可以设置的不同模式。

_（无成员级声明：枚举或纯数据形状。）_

### GameDatabase

*class · GameAPI*

> 标准 SQL 数据库

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `sql` | `sql: ( sql: string[], ...params: (number \| string \| Uint8Array \| boolean \| null)[] ) => GameQueryResult` | 执行 SQL 查询 | **缺** |

### GameDataStorage

*class · GameAPI*

> 游戏数据存储类，用于对特定存储空间内的数据进行操作。 存储数据的类型。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `key` | `readonly key: string` | 数据存储空间的名称。 | — |
| `increment` | `increment: (key: string, value?: number) => Promise<number>` | 以原子方式递增给定键的值。如果键不存在，则会创建并设置初始值。如果对应的值不是数字，则会报错。 通过此方式修改值时不会触发数据锁定。<br>• key：需要递增的键。<br>• value：递增量，默认为 1。<br>• 返回值：返回一个 Promise，解析为累加后的数值。 | — |
| `set` | `set: (key: string, value: T) => Promise<void>` | 设置指定键的值。<br>• key：需要设置的键。<br>• value：需要设置的值。<br>• 返回值：返回一个 Promise，在设置完成后解析。 | — |
| `update` | `update: ( key: string, handler: (prevValue: ReturnValue<T>) => T ) => Promise<void>` | 使用处理器函数更新指定键的值。<br>• key：需要更新的键。<br>• handler：一个接收旧值并返回新值的处理器函数。<br>• 返回值：返回一个 Promise，在更新完成后解析。 | — |
| `get` | `get: (key: string) => Promise<ReturnValue<T>>` | 获取指定键的值。<br>• key：需要获取的键。<br>• 返回值：返回一个 Promise，解析为获取操作的结果。 | — |
| `list` | `list: (options: ListPageOptions) => Promise<QueryList<T>>` | 根据指定选项获取数据列表。<br>• options：分页和排序选项。<br>• 返回值：返回一个 Promise，解析为查询结果列表。 | — |
| `remove` | `remove: (key: string) => Promise<ReturnValue<T>>` | 删除指定键的数据。<br>• key：需要删除的键。<br>• 返回值：返回一个 Promise，解析为被删除的数据。 | — |
| `destroy` | `destroy: () => Promise<void>` | 销毁此数据存储空间，并删除所有数据。<br>• 返回值：返回一个 Promise，在销毁完成后解析。 | — |

### GameDialogType

*enum · GameAPI*

> 定义游戏对话的类型。 GameDialogType 枚举列出了游戏中对话类型： - `TEXT` —— 文本 - `SELECT` —— 选择 - `INPUT` —— 输入

_（无成员级声明：枚举或纯数据形状。）_

### GameEasing

*enum · GameAPI*

> 游戏动画缓动类型枚举。

_（无成员级声明：枚举或纯数据形状。）_

### GameEventHandlerToken

*class · GameAPI*

> 当注册处理程序时由 `GameEventChannel` 返回。可以用于取消处理程序。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `cancel` | `cancel: () => void` | 取消事件处理程序。 | ✅ |
| `resume` | `resume: () => void` | 恢复监听事件处理程序。 | ✅ |
| `active` | `active: () => boolean` | 检查处理程序是否处于活动状态。 | ✅ |

### GameInputDirection

*enum · GameAPI*

> 输入方向的枚举。

_（无成员级声明：枚举或纯数据形状。）_

### GameLogLevel

*enum · GameAPI*

> 游戏日志级别枚举。

_（无成员级声明：枚举或纯数据形状。）_

### GameQuaternion

*class · GameAPI*

> 表示一个四元数，用于游戏中的旋转计算。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `w` | `w: number` | 四元数的 w 分量。 | ✅ |
| `x` | `x: number` | 四元数的 x 分量。 | ✅ |
| `y` | `y: number` | 四元数的 y 分量。 | ✅ |
| `z` | `z: number` | 四元数的 z 分量。 | ✅ |
| `constructor` | `constructor(w: number, x: number, y: number, z: number)` | 构造一个新的四元数实例。<br>• w：四元数的w分量。<br>• x：四元数的x分量。<br>• y：四元数的y分量。<br>• z：四元数的z分量。 | ✅ |
| `rotationBetween` | `static rotationBetween(a: GameVector3, b: GameVector3): GameQuaternion` | 计算两个三维向量之间的旋转四元数。<br>• a：起始向量。<br>• b：目标向量。<br>• 返回值：代表从向量a旋转到向量b的四元数。 | ✅ |
| `fromAxisAngle` | `static fromAxisAngle(axis: GameVector3, rad: number): GameQuaternion` | 从轴角表示转换到四元数表示。<br>• axis：旋转轴。<br>• rad：旋转角度（弧度）。<br>• 返回值：对应轴角表示的四元数。 | ✅ |
| `fromEuler` | `static fromEuler(x: number, y: number, z: number): GameQuaternion` | 从欧拉角转换到四元数。<br>• x：绕x轴的旋转角度。<br>• y：绕y轴的旋转角度。<br>• z：绕z轴的旋转角度。<br>• 返回值：对应欧拉角的四元数。 | ✅ |
| `set` | `set(w: number, x: number, y: number, z: number): GameQuaternion` | 设置四元数的分量值。<br>• w：四元数的w分量。<br>• x：四元数的x分量。<br>• y：四元数的y分量。<br>• z：四元数的z分量。<br>• 返回值：当前四元数实例。 | ✅ |
| `copy` | `copy(q: GameQuaternion): GameQuaternion` | 复制另一个四元数的值。<br>• q：要复制的四元数。<br>• 返回值：当前四元数实例。 | ✅ |
| `getAxisAngle` | `getAxisAngle(_q: GameQuaternion): { axis: GameVector3; angle: number; }` | 获取四元数的轴角表示。<br>• _q：另一个四元数（未使用）。<br>• 返回值：包含旋转轴和旋转角度的对象。 | ✅ |
| `rotateX` | `rotateX(rad: number): GameQuaternion` | 绕x轴旋转四元数。<br>• rad：旋转角度（弧度）。<br>• 返回值：当前四元数实例。 | ✅ |
| `rotateY` | `rotateY(rad: number): GameQuaternion` | 绕y轴旋转四元数。<br>• rad：旋转角度（弧度）。<br>• 返回值：当前四元数实例。 | ✅ |
| `rotateZ` | `rotateZ(rad: number): GameQuaternion` | 绕z轴旋转四元数。<br>• rad：旋转角度（弧度）。<br>• 返回值：当前四元数实例。 | ✅ |
| `dot` | `dot(q: GameQuaternion): number` | 计算当前四元数与另一个四元数的点积。<br>• q：另一个四元数。<br>• 返回值：点积结果。 | ✅ |
| `add` | `add(v: GameQuaternion): GameQuaternion` | 将另一个四元数加到当前四元数上。<br>• v：另一个四元数。<br>• 返回值：当前四元数实例。 | ✅ |
| `sub` | `sub(v: GameQuaternion): GameQuaternion` | 从当前四元数减去另一个四元数。<br>• v：另一个四元数。<br>• 返回值：当前四元数实例。 | ✅ |
| `angle` | `angle(q: GameQuaternion): number` | 计算当前四元数与另一个四元数之间的角度。<br>• q：另一个四元数。<br>• 返回值：角度结果（弧度）。 | ✅ |
| `mul` | `mul(q: GameQuaternion): GameQuaternion` | 将当前四元数与另一个四元数相乘。<br>• q：另一个四元数。<br>• 返回值：当前四元数实例。 | ✅ |
| `inv` | `inv(): GameQuaternion` | 计算当前四元数的逆四元数。<br>• 返回值：当前四元数实例。 | ✅ |
| `div` | `div(q: GameQuaternion): GameQuaternion` | 将当前四元数除以另一个四元数。<br>• q：另一个四元数。<br>• 返回值：当前四元数实例。 | ✅ |
| `slerp` | `slerp(q: GameQuaternion, n: number): GameQuaternion` | 使用球面线性插值计算两个四元数之间的中间四元数。<br>• q：另一个四元数。<br>• n：插值参数，范围在0到1之间。<br>• 返回值：插值结果四元数。 | ✅ |
| `mag` | `mag(): number` | 计算四元数的模长。<br>• 返回值：模长结果。 | ✅ |
| `sqrMag` | `sqrMag(): number` | 计算四元数的模长的平方。<br>• 返回值：模长平方结果。 | ✅ |
| `normalize` | `normalize(): GameQuaternion` | 将四元数归一化，使其模长为1。<br>• 返回值：当前四元数实例。 | ✅ |
| `equals` | `equals(q: GameQuaternion): boolean` | 检查当前四元数是否与另一个四元数近似（误差值：0.000001）相等。<br>• q：另一个四元数。<br>• 返回值：如果相等返回true，否则返回false。 | ✅ |
| `clone` | `clone(): GameQuaternion` | 克隆当前四元数实例。<br>• 返回值：新的四元数实例，值与当前实例相同。 | ✅ |
| `toString` | `toString(): string` | 将四元数转换为字符串表示。<br>• 返回值：四元数的字符串表示。 | ✅ |

### GameRGBAColor

*class · GameAPI*

> GameRGBAColor 类用于表示和操作具有红（r）、绿（g）、蓝（b）和透明度（a）分量的颜色值。 它提供了一系列方法来设置、复制、比较颜色值，以及进行颜色间的数学运算。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `r` | `r: number` | 红色分量。取值范围为 0 到 1。 | ✅ |
| `g` | `g: number` | 绿色分量。取值范围为 0 到 1。 | ✅ |
| `b` | `b: number` | 蓝色分量。取值范围为 0 到 1。 | ✅ |
| `a` | `a: number` | 透明度分量。取值范围为 0 到 1。 | ✅ |
| `constructor` | `constructor(r: number, g: number, b: number, a: number)` | 构造一个 GameRGBAColor 实例。<br>• r：红色分量，取值范围为 0 到 1。<br>• g：绿色分量，取值范围为 0 到 1。<br>• b：蓝色分量，取值范围为 0 到 1。<br>• a：透明度分量，取值范围为 0 到 1，其中 0 表示完全透明，1 表示完全不透明。 | ✅ |
| `set` | `set(r: number, g: number, b: number, a: number): GameRGBAColor` | 设置颜色的红、绿、蓝和透明度分量。<br>• r：红色分量。<br>• g：绿色分量。<br>• b：蓝色分量。<br>• a：透明度分量。<br>• 返回值：返回当前 GameRGBAColor 实例，支持链式调用。 | ✅ |
| `copy` | `copy(c: GameRGBAColor): GameRGBAColor` | 复制一个颜色值到当前颜色实例。<br>• c：要复制的颜色值。<br>• 返回值：返回当前 GameRGBAColor 实例，支持链式调用。 | ✅ |
| `add` | `add(rgba: GameRGBAColor): GameRGBAColor` | 将另一个颜色值与当前颜色相加。<br>• rgba：要相加的颜色值。<br>• 返回值：返回一个新的 GameRGBAColor 实例，表示相加后的颜色。 | ✅ |
| `sub` | `sub(rgba: GameRGBAColor): GameRGBAColor` | 从当前颜色中减去另一个颜色值。<br>• rgba：要减去的颜色值。<br>• 返回值：返回一个新的 GameRGBAColor 实例，表示相减后的颜色。 | ✅ |
| `mul` | `mul(rgba: GameRGBAColor): GameRGBAColor` | 将当前颜色与另一个颜色值相乘。<br>• rgba：要相乘的颜色值。<br>• 返回值：返回一个新的 GameRGBAColor 实例，表示相乘后的颜色。 | ✅ |
| `div` | `div(rgba: GameRGBAColor): GameRGBAColor` | 将当前颜色除以另一个颜色值。<br>• rgba：要除以的颜色值。<br>• 返回值：返回一个新的 GameRGBAColor 实例，表示相除后的颜色。 | ✅ |
| `addEq` | `addEq(rgba: GameRGBAColor): GameRGBAColor` | 将另一个颜色值与当前颜色相加，并更新当前颜色值。<br>• rgba：要相加的颜色值。<br>• 返回值：返回当前 GameRGBAColor 实例，支持链式调用。 | ✅ |
| `subEq` | `subEq(rgba: GameRGBAColor): GameRGBAColor` | 从当前颜色中减去另一个颜色值，并更新当前颜色值。<br>• rgba：要减去的颜色值。<br>• 返回值：返回当前 GameRGBAColor 实例，支持链式调用。 | ✅ |
| `mulEq` | `mulEq(rgba: GameRGBAColor): GameRGBAColor` | 将当前颜色与另一个颜色值相乘，并更新当前颜色值。<br>• rgba：要相乘的颜色值。<br>• 返回值：返回当前 GameRGBAColor 实例，支持链式调用。 | ✅ |
| `divEq` | `divEq(rgba: GameRGBAColor): GameRGBAColor` | 将当前颜色除以另一个颜色值，并更新当前颜色值。<br>• rgba：要除以的颜色值。<br>• 返回值：返回当前 GameRGBAColor 实例，支持链式调用。 | ✅ |
| `lerp` | `lerp(rgba: GameRGBAColor, n: number): GameRGBAColor` | 对当前颜色与另一个颜色值进行线性插值。<br>• rgba：要进行线性插值的颜色值。<br>• n：插值因子，决定了结果颜色中当前颜色和目标颜色的权重。<br>• 返回值：返回一个新的 GameRGBAColor 实例，表示插值后的颜色。 | ✅ |
| `blendEq` | `blendEq(rgb: GameRGBColor): GameRGBColor` | 将当前颜色与一个 RGB 颜色进行混合。<br>• rgb：要混合的 RGB 颜色。<br>• 返回值：返回一个新的 GameRGBColor 实例，表示混合后的颜色。 | ✅ |
| `equals` | `equals(rgba: GameRGBAColor): boolean` | 比较当前颜色是否与近似（误差值：0.000001）等于另一个颜色。<br>• rgba：要比较的颜色。<br>• 返回值：如果两个颜色相等，则返回 true；否则返回 false。 | ✅ |
| `clone` | `clone(): GameRGBAColor` | 克隆当前颜色实例。<br>• 返回值：返回一个新的 GameRGBAColor 实例，具有与当前颜色相同的值。 | ✅ |
| `toString` | `toString(): string` | 将当前颜色转换为字符串表示。<br>• 返回值：返回当前颜色的字符串表示。 | ✅ |

### GameRGBColor

*class · GameAPI*

> GameRGBColor 类用于表示和操作 RGB 颜色值。 它提供了设置、复制、运算、插值和比较颜色的功能。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `r` | `r: number` | 红色分量。取值范围为 0 到 1。 | ✅ |
| `g` | `g: number` | 绿色分量。取值范围为 0 到 1。 | ✅ |
| `b` | `b: number` | 蓝色分量。取值范围为 0 到 1。 | ✅ |
| `random` | `static random(): GameRGBColor` | 生成一个随机的 GameRGBColor 实例。<br>• 返回值：一个随机的 GameRGBColor 实例。 | ✅ |
| `constructor` | `constructor(r: number, g: number, b: number)` | 创建一个 GameRGBColor 实例。<br>• r：红色分量值，取值范围为 0 到 1。<br>• g：绿色分量值，取值范围为 0 到 1。<br>• b：蓝色分量值，取值范围为 0 到 1。 | ✅ |
| `set` | `set(r: number, g: number, b: number): GameRGBColor` | 设置颜色的 RGB 分量值。<br>• r：红色分量值。<br>• g：绿色分量值。<br>• b：蓝色分量值。<br>• 返回值：当前的 GameRGBColor 实例。 | ✅ |
| `copy` | `copy(c: GameRGBColor): GameRGBColor` | 复制一个颜色到当前颜色实例。<br>• c：要复制的颜色。<br>• 返回值：当前的 GameRGBColor 实例。 | ✅ |
| `add` | `add(rgb: GameRGBColor): GameRGBColor` | 将当前颜色与另一个颜色相加。<br>• rgb：要相加的颜色。<br>• 返回值：两个颜色相加的结果。 | ✅ |
| `sub` | `sub(rgb: GameRGBColor): GameRGBColor` | 从当前颜色中减去另一个颜色。<br>• rgb：要减去的颜色。<br>• 返回值：两个颜色相减的结果。 | ✅ |
| `mul` | `mul(rgb: GameRGBColor): GameRGBColor` | 将当前颜色与另一个颜色相乘。<br>• rgb：要相乘的颜色。<br>• 返回值：两个颜色相乘的结果。 | ✅ |
| `div` | `div(rgb: GameRGBColor): GameRGBColor` | 将当前颜色除以另一个颜色。<br>• rgb：要除以的颜色。<br>• 返回值：两个颜色相除的结果。 | ✅ |
| `addEq` | `addEq(rgb: GameRGBColor): GameRGBColor` | 将当前颜色与另一个颜色相加，并更新当前颜色。<br>• rgb：要相加的颜色。<br>• 返回值：更新后的当前颜色。 | ✅ |
| `subEq` | `subEq(rgb: GameRGBColor): GameRGBColor` | 从当前颜色中减去另一个颜色，并更新当前颜色。<br>• rgb：要减去的颜色。<br>• 返回值：更新后的当前颜色。 | ✅ |
| `mulEq` | `mulEq(rgb: GameRGBColor): GameRGBColor` | 将当前颜色与另一个颜色相乘，并更新当前颜色。<br>• rgb：要相乘的颜色。<br>• 返回值：更新后的当前颜色。 | ✅ |
| `divEq` | `divEq(rgb: GameRGBColor): GameRGBColor` | 将当前颜色除以另一个颜色，并更新当前颜色。<br>• rgb：要除以的颜色。<br>• 返回值：更新后的当前颜色。 | ✅ |
| `lerp` | `lerp(rgb: GameRGBColor, n: number): GameRGBColor` | 在当前颜色与另一个颜色之间进行线性插值。<br>• rgb：要插值的另一个颜色。<br>• n：插值因子，范围在 0 到 1 之间。<br>• 返回值：插值后的颜色。 | ✅ |
| `equals` | `equals(rgb: GameRGBColor): boolean` | 比较当前颜色与另一个颜色是否近似（误差值：0.000001）相等。<br>• rgb：要比较的另一个颜色。<br>• 返回值：如果两个颜色相等则返回 true，否则返回 false。 | ✅ |
| `clone` | `clone(): GameRGBColor` | 克隆当前颜色实例。<br>• 返回值：当前颜色的克隆。 | ✅ |
| `toRGBA` | `toRGBA(): GameRGBAColor` | 将当前颜色转换为 RGBA 格式。<br>• 返回值：当前颜色的 RGBA 表示。 | ✅ |
| `toString` | `toString(): string` | 返回当前颜色的字符串表示。<br>• 返回值：当前颜色的字符串表示。 | ✅ |

### GameVector3

*class · GameAPI*

> 表示用于游戏开发的三维向量。该类提供了多种3D向量数学运算，包括加法、减法、乘法、除法、点积、叉积和向量插值。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `x` | `x: number` | 向量的 x 分量。 | ✅ |
| `y` | `y: number` | 向量的 y 分量。 | ✅ |
| `z` | `z: number` | 向量的 z 分量。 | ✅ |
| `constructor` | `constructor(x: number, y: number, z: number)` | 创建一个新的GameVector3实例。<br>• x：向量的x分量。<br>• y：向量的y分量。<br>• z：向量的z分量。 | ✅ |
| `fromPolar` | `static fromPolar(mag: number, phi: number, theta: number): GameVector3` | 从极坐标创建一个新的GameVector3对象。<br>• mag：向量的模长。<br>• phi：xy平面上的角度（方位角）。<br>• theta：z轴上的角度（极角）。<br>• 返回值：新的GameVector3对象。 | ✅ |
| `set` | `set(x: number, y: number, z: number): GameVector3` | 设置此向量的分量。<br>• x：新的x分量。<br>• y：新的y分量。<br>• z：新的z分量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `copy` | `copy(v: GameVector3): GameVector3` | 将另一个向量的分量复制到此向量。<br>• v：要复制的向量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `add` | `add(v: GameVector3): GameVector3` | 将另一个向量加到此向量上。<br>• v：要相加的向量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `sub` | `sub(v: GameVector3): GameVector3` | 从此向量中减去另一个向量。<br>• v：要相减的向量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `mul` | `mul(v: GameVector3): GameVector3` | 按分量将此向量与另一个向量相乘。<br>• v：要相乘的向量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `div` | `div(v: GameVector3): GameVector3` | 按分量将此向量与另一个向量相除。<br>• v：要相除的向量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `addEq` | `addEq(v: GameVector3): GameVector3` | 将另一个向量加到此向量上并更新此向量。<br>• v：要相加的向量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `subEq` | `subEq(v: GameVector3): GameVector3` | 从此向量中减去另一个向量并更新此向量。<br>• v：要相减的向量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `mulEq` | `mulEq(v: GameVector3): GameVector3` | 按分量将此向量与另一个向量相乘并更新此向量。<br>• v：要相乘的向量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `divEq` | `divEq(v: GameVector3): GameVector3` | 按分量将此向量与另一个向量相除并更新此向量。<br>• v：要相除的向量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `dot` | `dot(v: GameVector3): number` | 计算此向量与另一个向量的点积。<br>• v：另一个向量。<br>• 返回值：点积。 | ✅ |
| `cross` | `cross(v: GameVector3): GameVector3` | 计算此向量与另一个向量的叉积。<br>• v：另一个向量。<br>• 返回值：叉积。 | ✅ |
| `scale` | `scale(n: number): GameVector3` | 按标量缩放此向量。<br>• n：标量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `clone` | `clone(): GameVector3` | 创建此向量的副本。<br>• 返回值：新的GameVector3对象。 | ✅ |
| `lerp` | `lerp(v: GameVector3, n: number): GameVector3` | 线性插值此向量朝向另一个向量。<br>• v：目标向量。<br>• n：插值因子。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `mag` | `mag(): number` | 计算此向量的模长。<br>• 返回值：模长。 | ✅ |
| `sqrMag` | `sqrMag(): number` | 计算此向量的模长平方。<br>• 返回值：模长平方。 | ✅ |
| `towards` | `towards(v: GameVector3): GameVector3` | 计算并返回指向目标位置的向量。<br>• v：目标位置的三维向量，表示目标点在游戏世界中的坐标。<br>• 返回值：返回一个从当前点指向目标点的三维向量。 | ✅ |
| `distance` | `distance(v: GameVector3): number` | 计算此向量与另一个向量之间的距离。<br>• v：另一个向量。<br>• 返回值：距离。 | ✅ |
| `normalize` | `normalize(): GameVector3` | 归一化此向量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `angle` | `angle(v: GameVector3): number` | 计算此向量与另一个向量之间的夹角。<br>• v：另一个向量。<br>• 返回值：夹角（弧度）。 | ✅ |
| `max` | `max(v: GameVector3): GameVector3` | 计算此向量与另一个向量的按分量最大值。<br>• v：另一个向量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `min` | `min(v: GameVector3): GameVector3` | 计算此向量与另一个向量的按分量最小值。<br>• v：另一个向量。<br>• 返回值：本向量，用于链式操作。 | ✅ |
| `exactEquals` | `exactEquals(v: GameVector3): boolean` | 检查此向量是否完全等于另一个向量。<br>• v：另一个向量。<br>• 返回值：如果向量完全相等则返回true，否则返回false。 | ✅ |
| `equals` | `equals(v: GameVector3): boolean` | 检查此向量是否近似（误差值：0.000001）等于另一个向量。<br>• v：另一个向量。<br>• 返回值：如果向量近似相等则返回true，否则返回false。 | ✅ |
| `toString` | `toString(): string` | 将此向量转换为字符串。<br>• 返回值：此向量的字符串表示形式。 | ✅ |

## 客户端界面

_ClientAPI：ui / input / screen / media / audio_

### AbortError

*class · ClientAPI*

> 表示一个中止错误。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `type` | `type: string` | — | — |
| `name` | `name: "AbortError"` | — | — |

### Audio

*class · ClientAPI*

> 客户端音频，继承自EventEmitter

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `constructor` | `constructor(url: string)` | 创建一个新的Audio实例<br>• url：设置音频的源路径 | ✅ |
| `src` | `src: string` | 设置或获取音频的源路径 | ✅ |
| `volume` | `volume: number` | 设置或获取音频的音量，取值范围为0到1 | ✅ |
| `error` | `error: MediaError \| null` | 获取音频播放过程中的错误信息，如果没有错误则为null | ✅ |
| `load` | `load(): void` | 加载音频文件 | ✅ |
| `play` | `play(): Promise<void>` | 播放音频<br>• 返回值：Promise，表示音频播放完成 | ✅ |
| `pause` | `pause(): void` | 暂停音频播放 | ✅ |

### Blob

*class · ClientAPI*

> 表示一个 blob 对象，它是一个不可变的、类似文件的对象，用于表示原始二进制数据。Blob 通常用于处理 Web 应用程序中的二进制数据，例如图像、视频或其他文件类型。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `constructor` | `constructor( blobParts?: ArrayBufferView[] \| ArrayBuffer[] \| Blob[] \| string[], options?: BlobPropertyBag ): Blob` | Blob 接口的构造函数，用于创建一个新的 blob 对象。<br>• blobParts：一个由 ArrayBufferView、ArrayBuffer、Blob 或字符串对象组成的数组，用于构成 blob。<br>• options：创建 blob 的可选参数，包括类型（MIME 类型）和结尾（行尾处理）。<br>• 返回值：返回一个新的 blob 对象。 | ✅ |
| `size` | `readonly size: number` | blob 的大小（以字节为单位），用于获取二进制数据的长度。 | ✅ |
| `type` | `readonly type: string \| null` | blob 的 MIME 类型，用于描述二进制数据的类型。如果类型未知，则可能为 null。 | ✅ |
| `slice` | `slice(start?: number, end?: number, contentType?: string): Blob` | 创建一个包含原始 blob 数据子集的新 blob 对象。<br>• start：子集的起始位置。如果未指定，则默认为 0。<br>• end：子集的结束位置。如果未指定，则默认为 blob 的大小。<br>• contentType：新 blob 的 MIME 类型。如果未指定，则默认为原始 blob 的类型。<br>• 返回值：返回一个包含指定数据子集的新 blob 对象。 | ✅ |
| `arrayBuffer` | `arrayBuffer(): Promise<ArrayBuffer>` | 返回一个包含 blob 二进制数据的 ArrayBuffer。<br>• 返回值：返回一个 Promise，该 Promise 解析为表示 blob 数据的 ArrayBuffer。 | ✅ |
| `stream` | `stream(): ReadableStream<Uint8Array>` | 返回一个 ReadableStream，可用于将 blob 的数据作为 Uint8Array 流读取。<br>• 返回值：返回一个表示 blob 数据的 ReadableStream。 | ✅ |
| `text` | `text(): Promise<string>` | 返回 blob 数据的文本表示形式。<br>• 返回值：返回一个 Promise，该 Promise 解析为表示 blob 数据的字符串。 | ✅ |

### BlobPropertyBag

*interface · ClientAPI*

> 创建 blob 的可选参数，包括 MIME 类型和行尾处理。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `type` | `type?: string` | blob 的 MIME 类型，用于描述二进制数据的类型。如果未指定类型，则可能为 undefined。 | — |
| `endings` | `endings?: string` | 指定从文本创建 blob 时如何处理行尾。如果不需要特殊处理，则可能为 undefined。 | — |

### BodyMixin

*class · ClientAPI*

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `constructor` | `constructor(body?: BodyInit, options?: { size?: number })` | — | ✅ |
| `body` | `readonly body: NodeJS.ReadableStream \| null` | — | ✅ |
| `bodyUsed` | `readonly bodyUsed: boolean` | — | ✅ |
| `size` | `readonly size: number` | — | ✅ |
| `buffer` | `buffer(): Promise<Buffer>` | **已废弃**：请改用 `body.arrayBuffer()`。 | ✅ |
| `arrayBuffer` | `arrayBuffer(): Promise<ArrayBuffer>` | 读取响应流并将其解析为 ArrayBuffer。<br>• 返回值：一个解析为 ArrayBuffer 的 Promise。 | ✅ |
| `formData` | `formData(): Promise<FormData>` | 读取响应流并将其解析为 FormData 对象。<br>• 返回值：一个解析为 FormData 对象的 Promise。 | ✅ |
| `blob` | `blob(): Promise<Blob>` | 读取响应流并将其解析为 Blob。<br>• 返回值：一个解析为 Blob 的 Promise。 | ✅ |
| `json` | `json(): Promise<unknown>` | 读取响应流并将其解析为 JSON。<br>• 返回值：一个解析为 JSON 对象的 Promise。 | ✅ |
| `text` | `text(): Promise<string>` | 读取响应流并将其解析为文本。<br>• 返回值：一个解析为字符串的 Promise。 | ✅ |

### ClientHttp

*class · ClientAPI*

> 用于执行 HTTP 请求。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `fetch` | `fetch(url: string, options?: RequestInit): Promise<Response>` | 使用给定的 URL 和选项来发起 HTTP 请求。<br>• url：请求的 URL 地址。<br>• options：可选的请求配置项，包括请求方法、头部信息等。<br>• 返回值：返回一个 Promise，该 Promise 解析为服务器的响应。 | ✅ |

### ClientMedia

*class · ClientAPI*

> 客户端媒体控制类。提供音频播放、停止播放、开始录音和停止录音等功能。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `playAudio` | `playAudio( spec?: Partial<{ /** * @zh 音频Blob数据 * @en Audio Blob data. */ blob: Blob; /** * @zh 音频声音增益 * @en Audio sound gain. */ gain: number; }> ): Promise<void>` | 播放音频<br>• spec：可选的音频配置参数，包含音频数据blob<br>• 返回值：返回一个Promise，表示音频播放完毕 | ✅ |
| `stopPlayAudio` | `stopPlayAudio(): void` | 停止播放音频 | ✅ |
| `startRecording` | `startRecording(): Promise<void>` | 开始录音<br>• 返回值：返回一个Promise，表示成功开始录音，反之则抛出错误 | ✅ |
| `stopRecording` | `stopRecording(): Promise<Blob>` | 停止录音<br>• 返回值：返回一个Promise，解析为录音的Blob对象，格式为`wav` | ✅ |

### ClientNavigator

*class · ClientAPI*

> 导航器。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `userAgent` | `readonly userAgent: string` | 获取该客户端的用户代理信息。 值以及属性特性与浏览器本身的属性保持一致。 | ✅ |
| `language` | `readonly language: string` | 获取该客户端当前语言。 有效的语言代码示例包括“en”、“zh-CN”、“fr”、“fr-FR”、“es-ES”等。 值以及属性特性与浏览器本身的属性保持一致。 | ✅ |
| `getDeviceInfo` | `getDeviceInfo(): DeviceInfo` | — | ✅ |

### ClientRemoteChannel

*class · ClientAPI*

> 客户端与服务端通信通道

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `sendServerEvent` | `sendServerEvent<T = any>(event: T): void` | 向服务端发送数据。 | ✅ |
| `onClientEvent` | `onClientEvent<T = any>(handler: (event: T) => void): void` | 监听服务端发来的数据事件。 | ✅ |
| `events` | `readonly events: EventEmitter<ClientRemoteChannelEvents>` | 事件管理器。 | ✅ |

### ClientScreen

*class · ClientAPI*

> 客户端屏幕

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `events` | `readonly events: EventEmitter<ScreenEvents>` | 一个只读的事件发射器，用于处理用户界面屏幕事件 | ✅ |

### ClientWorld

*class · ClientAPI*

> 代表客户端上的游戏世界。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `rendering3d` | `rendering3d: boolean` | 控制是否渲染3D场景。 - 当关闭(false)时，3D 场景的渲染将在客户端暂停，画面会停留在最后一次渲染的状态。 - 2D UI 不受此属性影响，除 3D 渲染外的客户端行为不受此属性影响。 | ✅ |

### Coord2

*class · ClientAPI*

> 图像映射中区域的坐标

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `offset` | `readonly offset: Vec2` | 节点坐标的偏移量。 | ✅ |
| `scale` | `readonly scale: Vec2` | 节点坐标的缩放比。 | ✅ |
| `create` | `static create(val?: Coord2 \| { offset: Vec2; scale: Vec2 }): Coord2` | 创建并返回一个新的 Coord2，该 Coord2 初始 offset 和 scale 为 {}。<br>• val：节点坐标数据。 | ✅ |

### DeviceInfo

*interface · ClientAPI*

> 设备信息。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `deviceType` | `deviceType: "Desktop" \| "Mobile"` | 设备类型。 - Desktop : 桌面设备 - Mobile : 手机设备 | — |
| `screen` | `screen: { /** * @zh 屏幕宽度。 * @en Screen width. */ width: number; /** * @zh 屏幕高度。 * @en Screen height. */ height: number; }` | 屏幕信息。 | — |

### EventEmitter

*class · ClientAPI*

> 事件处理模块

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `on` | `on<K extends keyof EventMap>( type: K, listener: (event: EventMap[K]) => void ): void` | 监听指定的事件。<br>• type：监听的事件类型，是个字符串。<br>• listener：监听到事件类型后的处理函数。 | — |
| `once` | `once<K extends keyof EventMap>( type: K, listener: (event: EventMap[K]) => void ): void` | 与 on 的区别是仅触发一次。<br>• type：监听的事件类型，是个字符串。<br>• listener：监听到事件类型后的处理函数。 | — |
| `remove` | `remove<K extends keyof EventMap>( type: K, listener: (event: EventMap[K]) => void ): void` | 移除找到的第一个 listener。<br>• type：要移除的事件类型。<br>• listener：要移除的事件处理函数。 | — |
| `removeAll` | `removeAll<K extends keyof EventMap>( type?: K, listener?: (event: EventMap[K]) => void ): void` | 移除找到的所有 listener，不传则移除事件下所有。<br>• type：要移除的事件类型。<br>• listener：可选，要移除的事件处理函数。 | — |
| `add` | `add<K extends keyof EventMap>( type: K, listener: (event: EventMap[K]) => void ): void` | 与 on 是同一个方法，只是方法名不同。<br>• type：监听的事件类型，是个字符串。<br>• listener：监听到事件类型后的处理函数。 | — |
| `off` | `off<K extends keyof EventMap>( type: K, listener: (event: EventMap[K]) => void ): void` | 与 remove 是同一个方法，只是方法名不同。<br>• type：要移除的事件类型。<br>• listener：要移除的事件处理函数。 | — |
| `emit` | `emit<K extends keyof EventMap>(type: K, event: EventMap[K]): void` | 触发指定的事件 | — |

### FetchError

*class · ClientAPI*

> 表示一个 fetch 错误。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `constructor` | `constructor( message: string, type: string, systemError?: Record<string, unknown> )` | — | — |
| `name` | `name: "FetchError"` | — | — |
| `type` | `type: string` | — | — |
| `code` | `code?: string` | — | — |
| `errno` | `errno?: string` | — | — |

### Headers

*class · ClientAPI*

> 此 Fetch API 接口允许您对 HTTP 请求和响应头执行各种操作。这些操作包括检索、设置、添加和删除。Headers 对象具有一个关联的头列表，该列表最初为空，由零个或多个名称和值对组成。您可以使用 append() 等方法向其添加内容（请参阅示例）。在此接口的所有方法中，头名称都通过不区分大小写的字节序列进行匹配。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `constructor` | `constructor(init?: HeadersInit)` | — | — |
| `append` | `append(name: string, value: string): void` | — | — |
| `delete` | `delete(name: string): void` | — | — |
| `get` | `get(name: string): string \| null` | — | — |
| `has` | `has(name: string): boolean` | — | — |
| `set` | `set(name: string, value: string): void` | — | — |
| `forEach` | `forEach( callbackfn: (value: string, key: string, parent: Headers) => void` | — | — |
| `entries` | `entries(): IterableIterator<[string, string]>` | 返回一个迭代器，允许遍历此对象中包含的所有键/值对。 | — |
| `keys` | `keys(): IterableIterator<string>` | 返回一个迭代器，允许遍历此对象中包含的键/值对的所有键。 | — |
| `values` | `values(): IterableIterator<string>` | 返回一个迭代器，允许遍历此对象中包含的键/值对的所有值。 | — |
| `raw` | `raw(): Record<string, string[]>` | Node-fetch extension | — |

### ImageDisplayMode

*enum · ClientAPI*

> 控制图像的显示方式

_（无成员级声明：枚举或纯数据形状。）_

### InputSystem

*class · ClientAPI*

> 全局监听玩家的输入。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `uiEvents` | `readonly uiEvents: EventEmitter<UiNodeEvents<UiElement>>` | 全局监听玩家指针与UI元素交互时的产生的事件。 | ✅ |
| `pointerLockEvents` | `readonly pointerLockEvents: EventEmitter<PointerLockEvents>` | 全局监听当玩家指针锁定状态变化或出错时产生的事件。 | ✅ |
| `onPointerDown` | `onPointerDown: { sub: (handler: (e: { target: UiNode }) => void) => void }` | 全局监听当玩家按下鼠标时产生的事件。 | ✅ |
| `unlockPointer` | `unlockPointer(): void` | 调用后解锁鼠标指针。 | ✅ |
| `lockPointer` | `lockPointer(): void` | 调用后锁定鼠标指针，由于浏览器限制，此操作可能会失败。 有兴趣可以查看https://w3c.github.io/pointerlock/#dom-element-requestpointerlock。 | ✅ |

### MediaError

*class · ClientAPI*

> 表示媒体操作期间发生的错误。该类用于封装媒体错误的详细信息。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `constructor` | `constructor(code: MediaErrorCode, message: string)` | 创建 MediaError 的实例。<br>• code：表示媒体错误类型的 MediaErrorCode 枚举值。<br>• message：描述错误详细信息的字符串。 | ✅ |
| `code` | `code: MediaErrorCode` | 错误代码，表示媒体错误的类型。 | ✅ |
| `message` | `message: string` | 错误消息，提供错误的详细描述。 | ✅ |

### MediaErrorCode

*enum · ClientAPI*

> 定义了一组媒体错误代码。这些错误代码用于标识不同类型的媒体错误。

_（无成员级声明：枚举或纯数据形状。）_

### PointerEventBehavior

*enum · ClientAPI*

> 指针事件行为

_（无成员级声明：枚举或纯数据形状。）_

### RequestInit

*interface · ClientAPI*

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `body` | `body?: BodyInit \| null` | 一个 BodyInit 对象或 null，用于设置请求的正文。 | — |
| `headers` | `headers?: HeadersInit` | 一个 Headers 对象、一个对象字面量或一个由双元素数组组成的数组，用于设置请求的头部。 | — |
| `method` | `method?: string` | 一个字符串，用于设置请求的方法。 | — |
| `redirect` | `redirect?: RequestRedirect` | 一个字符串，指示请求是否应遵循重定向、在遇到重定向时是否应报错，或是否应（以不透明方式）返回重定向。用于设置请求的重定向策略。 | — |
| `signal` | `signal?: AbortSignal \| null` | 一个 AbortSignal，用于设置请求的信号。 | — |
| `referrer` | `referrer?: string` | 一个字符串，其值为同源 URL、“about:client”或空字符串，用于设置请求的引用来源。 | — |
| `referrerPolicy` | `referrerPolicy?: ReferrerPolicy` | 一个引用策略，用于设置请求的 referrerPolicy。 | — |

### Response

*class · ClientAPI*

> 此接口表示对请求的响应。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `constructor` | `constructor(body?: BodyInit \| null, init?: ResponseInit)` | 创建一个新的 Response 对象。 | — |
| `headers` | `readonly headers: Headers` | 与响应关联的 Headers 对象。 | — |
| `ok` | `readonly ok: boolean` | 一个布尔值，指示响应是否成功（状态在 200-299 范围内）。 | — |
| `redirected` | `readonly redirected: boolean` | 指示响应是否是重定向的结果。 | — |
| `status` | `readonly status: number` | 响应的状态码。 | — |
| `statusText` | `readonly statusText: string` | 与状态码对应的状态消息。 | — |
| `type` | `readonly type: ResponseType` | 响应的类型。 | — |
| `url` | `readonly url: string` | 响应的 URL。 | — |
| `clone` | `clone(): Response` | 创建 Response 对象的克隆。 | — |
| `error` | `static error(): Response` | 返回一个与网络错误关联的新 Response 对象。 | — |
| `redirect` | `static redirect(url: string, status?: number): Response` | 创建一个重定向到指定 URL 的新响应。 | — |
| `json` | `static json(data: any, init?: ResponseInit): Response` | 创建一个表示 JSON 的新响应。 | — |

### ResponseInit

*interface · ClientAPI*

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `headers` | `headers?: HeadersInit` | — | — |
| `status` | `status?: number` | — | — |
| `statusText` | `statusText?: string` | — | — |

### Sound

*class · GameAPI*

> 定义声音类，用于控制声音的播放。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `resume` | `resume: (currentTime?: number) => void` | 恢复播放。<br>• currentTime：可选参数，指定从哪个时间点开始恢复播放。如果不提供，则从上次暂停处继续。 | ✅ |
| `setCurrentTime` | `setCurrentTime: (currentTime: number) => void` | 设置当前播放时间，允许精确控制播放进度。<br>• currentTime：必需参数，指定要跳转到的播放时间点。 | ✅ |
| `pause` | `pause: () => void` | 暂停当前播放。 | ✅ |
| `stop` | `stop: () => void` | 停止当前播放，并将播放进度重置到初始状态。 | ✅ |

### UiBox

*class · ClientAPI*

> UI盒子

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `events` | `readonly events: EventEmitter<UiNodeEvents<UiBox>>` | 事件管理器。 | ✅ |
| `create` | `static create(): UiBox` | 创建一个新的 Ui盒子 实例。 | ✅ |

### UiComponent

*class · ClientAPI*

> UI组件

_（无成员级声明：枚举或纯数据形状。）_

### UiImage

*class · ClientAPI*

> UI图片

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `complete` | `readonly complete: boolean` | 图片元素是否加载完成。 | ✅ |
| `image` | `image: (string & {}) \| GamePictureAssets` | 图片元素的内容，应为图片的路径或者 URL。 | ✅ |
| `imageOpacity` | `imageOpacity: number` | 图片元素的透明度。 | ✅ |
| `imageDisplayMode` | `imageDisplayMode: ImageDisplayMode` | 图片元素的图片资源展示方式 图片元素中的图片资源不属于其子元素，所以图片资源只受imageDisplayMode属性影响，不受其所在元素的裁剪、自适应作用。 缺省值：ImageDisplayMode.Fill | ✅ |
| `events` | `readonly events: EventEmitter<UiImageEvents>` | 事件管理器。 | ✅ |
| `create` | `static create(): UiImage` | 创建一个新的 Ui图片 实例。 | ✅ |

### UiInput

*class · ClientAPI*

> UI输入框

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `events` | `readonly events: EventEmitter<UiInputEvents>` | 事件管理器。 | ✅ |
| `placeholder` | `placeholder: string` | 输入框的未输入时文本提示内容。 | ✅ |
| `placeholderColor` | `readonly placeholderColor: Vec3` | 输入框显示的占位文本的颜色。 | ✅ |
| `placeholderOpacity` | `readonly placeholderOpacity: number` | 输入框提示文本的不透明度。 | ✅ |
| `isFocus` | `readonly isFocus: boolean` | 输入框是否聚焦。 | ✅ |
| `focus` | `readonly focus: () => void` | 使输入框聚焦。 | ✅ |
| `blur` | `readonly blur: () => string` | 使输入框失去焦点。 | ✅ |
| `create` | `static create(): UiInput` | 创建一个新的 Ui输入框 实例。 | ✅ |

### UiNode

*class · ClientAPI*

> 基础节点

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `name` | `name: string` | 该节点的标识，可重复。 | ✅ |
| `children` | `readonly children: ReadonlyArray<UiNode>` | 节点的子节点。如需要调整子节点结构，应修改子节点的parent属性。 | ✅ |
| `parent` | `parent: UiNode \| undefined` | 节点的父节点，非根节点的父节点为空时，该节点将不会被渲染。 | ✅ |
| `findChildByName` | `findChildByName<T extends UiElement>(name: string): T \| undefined` | 按名称查找子节点，返回对应子节点对象。（节点名称可在编辑模式下的属性面板中查看）<br>• name：子节点名称。 | ✅ |
| `events` | `events: EventEmitter<UiNodeEvents>` | 管理节点相关的事件。 | ✅ |
| `uiScale` | `uiScale: UiScale \| undefined` | 节点等比例缩放数据。 | ✅ |
| `clone` | `clone: () => this` | 克隆节点，包括其子节点。 | ✅ |

### UiRenderable

*class · ClientAPI*

> UI可渲染的基类

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `anchor` | `readonly anchor: Vec2` | 节点的锚点，用于确定节点的位置。 | ✅ |
| `position` | `readonly position: Coord2` | 节点的位置，相对于父节点的位置。 | ✅ |
| `backgroundColor` | `readonly backgroundColor: Vec3` | 节点的背景颜色。 | ✅ |
| `backgroundOpacity` | `backgroundOpacity: number` | 节点的背景透明度。 | ✅ |
| `rotation` | `rotation: number` | 节点的旋转（角度） | ✅ |
| `size` | `readonly size: Coord2` | 节点的尺寸。 | ✅ |
| `zIndex` | `zIndex: number` | 节点的层级，用于确定节点的渲染顺序。 | ✅ |
| `autoResize` | `autoResize: "NONE" \| "X" \| "Y" \| "XY"` | 节点的自动调整尺寸的方式。 | ✅ |
| `visible` | `visible: boolean` | 节点的可见性。 | ✅ |
| `pointerEventBehavior` | `pointerEventBehavior: PointerEventBehavior` | 配置鼠标指针事件的响应方式 | ✅ |

### UiScale

*class · ClientAPI*

> UI缩放

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `scale` | `scale: number` | 缩放倍数，仅允许设置大于等于0的数字。当传入非法值时，不会生效并会在控制台打印一条警告。 | ✅ |
| `create` | `static create(): UiScale` | 创建一个新的 Ui缩放 实例。 | ✅ |

### UiScreen

*class · ClientAPI*

> UI屏幕

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `name` | `name: UiScreenName` | 该屏幕的标识。 | ✅ |
| `visible` | `visible: boolean` | 屏幕是否可见。 | ✅ |
| `zIndex` | `zIndex: number` | 屏幕层级，层级越高的屏幕会显示在顶部，遮盖住层级较低的屏幕。 | ✅ |
| `create` | `static create(): UiScreen` | 创建一个新的 Ui屏幕 实例。 | ✅ |
| `getAllScreen` | `static getAllScreen(): UiScreen[]` | 获取当前所有存在的屏幕实例。 | ✅ |

### UiScrollBox

*class · ClientAPI*

> UI滚动框

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `scrollPosition` | `readonly scrollPosition: Vec2` | 滚动的位置，设置后，会受到当前可滚动范围约束 | ✅ |
| `create` | `static create(): UiScrollBox` | 创建一个新的 Ui滚动框 实例。 | ✅ |

### UiText

*class · ClientAPI*

> UI文本

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `events` | `readonly events: EventEmitter<UiNodeEvents<UiText>>` | 事件管理器。 | ✅ |
| `textContent` | `textContent: string` | 文本元素的内容，支持转义字符与换行，会对自身元素的自适应大小产生影响。 - 换行后，所有受到元素大小影响的属性，均需以新的大小进行计算， - 当`UiText.richText`为真时，将开启富文本解析。 | ✅ |
| `richText` | `richText: boolean` | 富文本标记，表示内容是否支持富文本格式 当前支持的xml标签有： - <font size="16" color="#D03737">内容</font> - <stroke color="#00FFFF" thickness="10" opacity="0.6">内容</stroke> | ✅ |
| `textFontSize` | `textFontSize: number` | 节点显示的文本的字体大小。 | ✅ |
| `textColor` | `readonly textColor: Vec3` | 节点显示的文本的颜色。 | ✅ |
| `textXAlignment` | `textXAlignment: "Center" \| "Left" \| "Right"` | 节点显示的文本的水平对齐方式。 | ✅ |
| `textYAlignment` | `textYAlignment: "Center" \| "Top" \| "Bottom"` | 节点显示的文本的垂直对齐方式。 | ✅ |
| `autoWordWrap` | `autoWordWrap: boolean` | 是否开启自动换行。 | ✅ |
| `textLineHeight` | `textLineHeight: number` | 文本的行高。 | ✅ |
| `textStrokeColor` | `readonly textStrokeColor: Vec3` | 只读属性，定义文本的描边颜色。 | ✅ |
| `textStrokeOpacity` | `textStrokeOpacity: number` | 定义文本描边的不透明度。 | ✅ |
| `textStrokeThickness` | `textStrokeThickness: number` | 定义文本描边的厚度。 | ✅ |
| `textFontFamily` | `textFontFamily: UITextFontFamily` | 定义文本使用的字体。 | ✅ |
| `create` | `static create(): UiText` | 创建一个新的 Ui文本 实例。 | ✅ |

### UITextFontFamily

*enum · ClientAPI*

> 字体样式

_（无成员级声明：枚举或纯数据形状。）_

### Vec2

*class · ClientAPI*

> 二维向量

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `x` | `x: number` | Vec2 的 x 坐标。 | ✅ |
| `y` | `y: number` | Vec2 的 y 坐标。 | ✅ |
| `copy` | `copy(val: Vec2): void` | 复制给定的 Vec2 的 x 和 y 到当前 Vec2。<br>• val：节点坐标数据。 | ✅ |
| `create` | `static create(val?: Vec2 \| { x: number; y: number }): Vec2` | 创建并返回一个新的 Vec2。如果提供了一个 Vec2 作为参数，新的 Vec2 的 x 和 y 将被设置为给定 Vec2 的 x 和 y。如果没有提供参数，新的 Vec2 的 x 和 y 将被设置为 0。<br>• val：节点坐标数据。 | ✅ |

### Vec3

*class · ClientAPI*

> 三维向量 & RGB颜色

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `x` | `x: number` | Vec3的x坐标。 | ✅ |
| `y` | `y: number` | Vec3的y坐标。 | ✅ |
| `z` | `z: number` | Vec3的z坐标。 | ✅ |
| `r` | `r: number` | Vec3的r颜色值。范围：0-255 | ✅ |
| `g` | `g: number` | Vec3的g颜色值。范围：0-255 | ✅ |
| `b` | `b: number` | Vec3的b颜色值。范围：0-255 | ✅ |
| `copy` | `copy(val: Vec3): void` | 复制给定的Vec3的x和y到当前Vec3。<br>• val：节点坐标数据。 | ✅ |
| `create` | `static create( val?: \| Vec3 \| { x: number; y: number; z: number } \| { r: number; g: number; b: number } ): Vec3` | 创建并返回一个新的Vec3。如果提供了一个Vec3作为参数，新的Vec3的x、y和z将被设置为给定Vec3的x、y和z。如果没有提供参数，新的Vec3的x、y和z将被设置为0。<br>• val：节点坐标数据。 | ✅ |

## 平台与网络

_http / rtc / storage / db / analytics / gui_

### GameAnalytics

*class · GameAPI*

> GameAnalytics 类用于处理游戏分析相关的功能。 它提供了许多方法来记录游戏事件、用户属性和游戏状态等。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `sensor` | `readonly sensor: GameSensorAnalytics` | 神策分析平台实例。 | ✅ |

### GameGUI

*class · GameAPI*

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `init` | `init: <T extends string, U extends T>( entity: GamePlayerEntity, config: GUIConfig<T, U> ) => Promise<void>` | — | ✅ |
| `show` | `show: ( entity: GamePlayerEntity, name: string, allowMultiple?: boolean ) => Promise<void>` | — | ✅ |
| `remove` | `remove: (entity: GamePlayerEntity, selector: string) => Promise<void>` | — | ✅ |
| `getAttribute` | `getAttribute: ( entity: GamePlayerEntity, selector: string, name: string ) => Promise<any>` | — | ✅ |
| `setAttribute` | `setAttribute: ( entity: GamePlayerEntity, selector: string, name: string, value: any ) => Promise<void>` | — | ✅ |
| `onMessage` | `onMessage: (listener: GameGUIEventListener) => void` | — | ✅ |
| `ui` | `ui: InstanceType<any>["ui"]` | — | ✅ |

### GameGUIEventListener

*interface · GameAPI*

_（无成员级声明：枚举或纯数据形状。）_

### GameHttpAPI

*class · GameAPI*

> HTTP API 类，用于处理 HTTP 请求。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `fetch` | `fetch: ( url: string, options?: GameHttpFetchRequestOptions ) => Promise<GameHttpFetchResponse>` | 请求网络资源。<br>• url：请求地址。<br>• options：请求配置。<br>• 返回值：返回一个 Promise，其 resolve 的值为请求结果。 | ✅ |

### GameHttpFetchResponse

*class · GameAPI*

> HTTP 请求响应

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `status` | `status: number` | 状态码 | ✅ |
| `statusText` | `statusText: string` | 状态码描述 | ✅ |
| `headers` | `headers: GameHttpFetchHeaders` | 所有响应头 | ✅ |
| `json` | `json: () => Promise<any>` | 返回一个Promise，Promise resolve的值为JSON格式的数据 | ✅ |
| `text` | `text: () => Promise<string>` | 返回一个Promise，Promise resolve的值为文本格式的数据 | ✅ |
| `arrayBuffer` | `arrayBuffer: () => Promise<ArrayBuffer>` | 返回一个Promise，Promise resolve的值为二进制格式的数据 | ✅ |
| `close` | `close: () => Promise<void>` | 关闭连接 | ✅ |
| `ok` | `get ok(): boolean` | 是否请求成功 | ✅ |

### GameHttpRequest

*class · GameAPI*

> HTTP 请求对象。该类目前为空，作为类型占位符使用。

_（无成员级声明：枚举或纯数据形状。）_

### GameHttpResponse

*class · GameAPI*

> HTTP 响应对象。该类目前为空，作为类型占位符使用。

_（无成员级声明：枚举或纯数据形状。）_

### GameRTC

*class · GameAPI*

> GameRTC 类用于管理实时语音通道。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `createChannel` | `createChannel: (channelId?: string) => Promise<GameRTCChannel>` | 创建一个实时语音通道。<br>• channelId：通道 ID，可选参数。如果不提供，系统将自动生成一个唯一的 ID。<br>• 返回值：一个 Promise，解析为一个 `GameRTCChannel` 对象。 | ✅ |

### GameRTCChannel

*class · GameAPI*

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `add` | `add: (entity: GamePlayerEntity) => Promise<void>` | 将一个玩家添加到此 RTC 通道。<br>• entity：要添加的玩家实体。 | ✅ |
| `remove` | `remove: (entity: GamePlayerEntity) => Promise<void>` | 从此 RTC 通道移除一个玩家。<br>• entity：要移除的玩家实体。 | ✅ |
| `unpublish` | `unpublish: (entity: GamePlayerEntity) => Promise<void>` | 停止向此 RTC 通道发布指定玩家的麦克风音频流。<br>• entity：要停止发布麦克风的玩家实体。 | ✅ |
| `publishMicrophone` | `publishMicrophone: (entity: GamePlayerEntity) => Promise<void>` | 允许指定玩家向此 RTC 通道发布其麦克风音频流。<br>• entity：要发布麦克风的玩家实体。 | ✅ |
| `getPlayers` | `getPlayers: () => Promise<GamePlayerEntity[]>` | 获取当前在此 RTC 通道中的所有玩家实体的列表。<br>• 返回值：一个包含所有玩家实体的数组的 Promise。 | ✅ |
| `destroy` | `destroy: () => Promise<void>` | 销毁此 RTC 通道，断开所有连接。 | ✅ |
| `getVolume` | `getVolume: (entity: GamePlayerEntity) => Promise<number>` | 获取指定玩家在此 RTC 通道中的音量。<br>• entity：要获取音量的玩家实体。<br>• 返回值：一个解析为玩家音量（0-100）的 Promise。 | ✅ |
| `setVolume` | `setVolume: (entity: GamePlayerEntity, volume: number) => Promise<void>` | 设置指定玩家在此 RTC 通道中的音量。<br>• entity：要设置音量的玩家实体。<br>• volume：音量大小，范围从 0 到 100。 | ✅ |
| `getMicrophonePermission` | `getMicrophonePermission: (entity: GamePlayerEntity) => Promise<boolean>` | 检查指定玩家是否已授予麦克风权限。<br>• entity：要检查权限的玩家实体。<br>• 返回值：一个解析为 `true`（如果已授予权限）或 `false`（如果未授予）的 Promise。 | ✅ |

### GameSensorAnalytics

*class · GameAPI*

> GameSensorAnalytics 类是神策平台的专业数据分析模块，提供完整的游戏数据采集与分析能力。通过该模块，你可以追踪玩家行为、记录关键事件并构建全面的数据分析体系。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `init` | `init(url: string, timeout?: number): void` | 初始化神策埋点配置方法。 用于设置数据接收地址和超时时间。 注意: 以最后一次执行的配置为准。<br>• url：数据接收地址，神策服务器的 URL。<br>• timeout：可选，请求超时时间，默认为30s。 | ✅ |
| `track` | `track( distinctId: string, eventName: string, properties?: Record<string, string \| number \| boolean> ): void` | 追踪数据事件方法。 用于记录用户行为和自定义事件。<br>• distinctId：用户唯一标识，通常是平台用户 ID (`GamePlayer.userId`)。<br>• eventName：事件名称。<br>• properties：可选，事件属性 (会被 `JSON.stringify` 序列化)。 | ✅ |

### GameStorage

*class · GameAPI*

> GameStorage 类用于管理游戏数据存储空间。 它提供了连接数据存储空间、获取数据存储空间实例、销毁数据存储空间等方法。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `getDataStorage` | `getDataStorage<T = JSONValue>(key: string): GameDataStorage<T>` | 连接指定数据存储空间，如果不存在则创建一个新的空间。 只能在本地图使用此空间，其他地图（如副图）无法访问此空间，从而避免全局污染。 | ✅ |
| `getGroupStorage` | `getGroupStorage<T = JSONValue>(key: string): GameDataStorage<T>` | 连接指定数据存储空间，如果不存在则创建一个新的空间。 此方法为主图和副图共同维护的数据存储空间。 | ✅ |

### GUIBind

*interface · GameAPI*

> 定义 GUI 事件绑定。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `event` | `event: string` | 要绑定的事件名称（例如 'click'）。 | — |
| `selector` | `selector?: string` | 用于目标元素的 CSS 选择器。 | — |
| `action` | `action: T` | 事件触发时要执行的操作。 | — |

### GUIBindDefinition

*interface · GameAPI*

> 定义 GUI 绑定的具体行为。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `drag` | `drag: { /** * @zh * 将 DOM 元素的属性映射到拖动方向。 * @en * Maps attributes of a DOM element to drag directions. */ attributes: { [name: string]: "x" \| "-x" \| "y" \| "-y"; }; /** * @zh * 要应用拖动效果的目标元素的 CSS 选择器。 * @en * The CSS…` | 定义拖动行为。 | — |
| `show` | `show: { /** * @zh * 要显示的元素的名称。 * @en * The name of the element to show. */ name: T; /** * @zh * 是否允许多个实例。 * @en * Whether to allow multiple instances. */ allowMultiple?: boolean; }` | 定义显示行为。 | — |
| `remove` | `remove: { /** * @zh * 要移除的目标元素的 CSS 选择器。 * @en * The CSS selector for the target element to remove. */ targetSelector: string; }` | 定义移除行为。 | — |
| `sendMessage` | `sendMessage: { /** * @zh * 要发送的消息的名称。 * @en * The name of the message to send. */ messageName: string; /** * @zh * 要发送的消息数据。 * @en * The message data to send. */ messageData?: string[]; }` | 定义发送消息行为。 | — |
| `clipboardWrite` | `clipboardWrite: { /** * @zh * 从中获取数据的目标元素的 CSS 选择器。 * @en * The CSS selector for the target element to get data from. */ targetSelector: string; /** * @zh * 要写入剪贴板的属性名称。 * @en * The name of the attribute to write to…` | 定义写入剪贴板行为。 | — |

### GUIConfigItem

*interface · GameAPI*

> 定义单个 GUI 配置项。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `display` | `display?: boolean` | 是否显示此项。 | — |
| `bindings` | `bindings?: GUIBindTypes<T>[]` | 此项的 GUI 绑定。 | — |
| `data` | `data: string \| GUIData` | 此项的 GUI 数据。 | — |

### GUIData

*interface · GameAPI*

> 定义 GUI 元素的数据结构。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `name` | `name: string` | 元素的名称或类型。 | — |
| `attributes` | `attributes?: { [name: string]: string \| number; }` | 元素拥有的属性。 | — |
| `children` | `children?: GUIData[]` | 子元素列表。 | — |

### QueryList

*class · GameAPI*

> 数据查询列表类，用于处理分页查询结果。 列表中数据的类型。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `getCurrentPage` | `getCurrentPage: () => ReturnValue<T>[]` | 获取当前页的键值对数组。<br>• 返回值：返回当前页的键值对内容。 | — |
| `nextPage` | `nextPage: () => Promise<void>` | 翻到下一页。执行后，`QueryList.getCurrentPage` 将返回下一页的键值对内容。<br>• 返回值：返回一个 Promise，在翻页操作完成后解析。 | — |
| `isLastPage` | `readonly isLastPage: boolean` | 是否为最后一页。如果已经翻到末尾之后，此值也为 `true`。 | — |

### ServerRemoteChannel

*class · GameAPI*

> ServerRemoteChannel 类用于在服务端和客户端之间进行事件通信。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `sendClientEvent` | `sendClientEvent<T = any>( entities: GamePlayerEntity \| GamePlayerEntity[], clientEvent: T ): void` | 服务端发送至客户端，向指定玩家发送事件。<br>• entities：要发送事件的玩家实体或实体列表。<br>• clientEvent：要发送的事件。 | ✅ |
| `broadcastClientEvent` | `broadcastClientEvent<T = any>(clientEvent: T): void` | 服务端发送至客户端，向所有玩家发送事件。<br>• clientEvent：要广播的事件。 | ✅ |
| `onServerEvent` | `onServerEvent<T = any>( handler: (event: { /** * @zh 服务端当前时间 * @en The current server time (tick). */ tick: number; /** * @zh 发送者实体 * @en The sender entity. */ entity: GamePlayerEntity; /** * @zh 事件参数 * @en The event…` | 监听客户端发来的事件。<br>• handler：事件处理函数。<br>• 返回值：事件处理器令牌。 | ✅ |

### SocialType

*enum · GameAPI*

> 社交关系类型枚举。

_（无成员级声明：枚举或纯数据形状。）_

## 其它类型

_没有归进上面几组的声明_

### PlayerNavigator

*class · GameAPI*

> Player 用户设备相关的接口。

| 成员 | 签名 | 说明 | 本地 |
| --- | --- | --- | --- |
| `emitEvent` | `emitEvent: (type: string, value: object) => void` | 发出事件。 | ✅ |
| `addEventListener` | `addEventListener: ( type: NavigatorEventType, listener: (event: { data: object }) => void ) => void` | 添加事件监听器。 | ✅ |
| `dispatchEvent` | `dispatchEvent: (type: string, value: object) => void` | 分发事件。 | ✅ |

---

本页是生成物：改了官方声明或补了实现，跑 `npm run audit:api && npm run build:api-ref` 重新生成，不要直接编辑 `docs/api-reference.md`。上游参考仓库需要先在 `vendor/` 下 clone，见[依赖清单](dependencies.md)。
