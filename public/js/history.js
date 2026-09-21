// history.js — 基于体素 diff 的撤销/重做栈。
export class History {
  constructor(world, onChange) {
    this.world = world;
    this.onChange = onChange; // (touched:Set) => void
    this.stack = [];
    this.pointer = -1;
    this.max = 200;
  }
  // 记录一批变更：[{x,y,z,oldId,oldRot,newId,newRot}]
  commit(changes, label = "edit") {
    if (!changes.length) return;
    const touched = new Set();
    for (const c of changes) {
      touched.add(c.x + "," + c.y + "," + c.z);
      const [nx, ny, nz] = [c.x, c.y, c.z];
      this.world.set(nx, ny, nz, c.newId, c.newRot);
    }
    // 丢弃 redo 分支
    this.stack = this.stack.slice(0, this.pointer + 1);
    this.stack.push({ changes, label });
    if (this.stack.length > this.max) this.stack.shift();
    this.pointer = this.stack.length - 1;
    this.onChange(touched);
  }
  canUndo() { return this.pointer >= 0; }
  canRedo() { return this.pointer < this.stack.length - 1; }
  undo() {
    if (!this.canUndo()) return false;
    const { changes } = this.stack[this.pointer];
    const touched = new Set();
    for (const c of changes) { this.world.set(c.x, c.y, c.z, c.oldId, c.oldRot); touched.add(c.x + "," + c.y + "," + c.z); }
    this.pointer--;
    this.onChange(touched);
    return true;
  }
  redo() {
    if (!this.canRedo()) return false;
    this.pointer++;
    const { changes } = this.stack[this.pointer];
    const touched = new Set();
    for (const c of changes) { this.world.set(c.x, c.y, c.z, c.newId, c.newRot); touched.add(c.x + "," + c.y + "," + c.z); }
    this.onChange(touched);
    return true;
  }
  clear() { this.stack = []; this.pointer = -1; }
}
