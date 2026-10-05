// skin-presets.js — 内置骨骼皮肤预设（纯数据）。
// 单独立一个文件是因为 VOXA 的 model.js 要能在裸 Node 里跑单测，
// 而 skin-rig.js 一 import 就拖进 three；数据与驱动分开放，两边都能引用同一份真相。

/** 内置预设：名字、模型路径、映射到官方 18 槽位的关节名、卡片上的提示语。
 *  关节名必须逐字等于**加载之后**的节点名：.glb 文件里写的是 "shoulder.L"，
 *  GLTFLoader 把点号去掉才交到代码手上（"shoulderL"），照文件抄就找不到节点，
 *  表现是"机甲穿在身上但站着不动"。test/skin.test.mjs 拿加载后的节点名对这张表。 */
export const BUILTIN_RIG_PRESETS = [{
  name: "ATLAS-09 机甲",
  model: "/skins/atlas-09.glb",
  hint: "CC0 · 17 关节 · 6.9 MB",
  bones: {
    hips: "pelvis", torso: "chest", head: "head",
    leftShoulder: "shoulderL", leftUpperArm: "upper_armL", leftLowerArm: "forearmL", leftHand: "handL",
    rightShoulder: "shoulderR", rightUpperArm: "upper_armR", rightLowerArm: "forearmR", rightHand: "handR",
    leftUpperLeg: "thighL", leftLowerLeg: "shinL", leftFoot: "footL",
    rightUpperLeg: "thighR", rightLowerLeg: "shinR", rightFoot: "footR",
  },
}];

/** 默认皮肤就是这一台：官方换肤模式打开即是"已绑好骨骼的现成角色"，
 *  而不是让我们自己再捏一个方块小人当默认。 */
export const DEFAULT_SKIN_RIG = BUILTIN_RIG_PRESETS[0];
