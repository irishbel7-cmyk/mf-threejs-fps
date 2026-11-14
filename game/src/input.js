// input.js — keyboard + mouse state, one job: raw input, no game logic.
export class Input {
  constructor() {
    this.keys = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.firing = false;
    this.locked = false;
    this.onLockChange = null;
    this.onKey = null; // (code, down) => void, for one-shot actions
    this._onKeyDown = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e.code, true);
      if (e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = (e) => { this.keys.delete(e.code); if (this.onKey) this.onKey(e.code, false); };
    this._onMouseMove = (e) => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } };
    this._onMouseDown = (e) => { if (e.button === 0) this.firing = true; };
    this._onMouseUp = (e) => { if (e.button === 0) this.firing = false; };
    this._onLock = () => {
      this.locked = document.pointerLockElement === document.body;
      if (this.onLockChange) this.onLockChange(this.locked);
    };
    this._onBlur = () => { this.keys.clear(); this.firing = false; };
  }

  attach(canvas) {
    this.canvas = canvas;
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onLock);
    window.addEventListener('blur', this._onBlur);
  }

  requestLock() {
    if (document.pointerLockElement !== document.body) {
      document.body.requestPointerLock?.();
    }
  }

  releaseLock() { if (document.pointerLockElement) document.exitPointerLock?.(); }

  down(code) { return this.keys.has(code); }

  // Consume accumulated mouse deltas (called once per fixed step).
  takeMouse() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }

  // Forward / strafe intent in [-1, 1].
  moveAxes() {
    let f = 0, s = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) f += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) f -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) s += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) s -= 1;
    return { f, s };
  }

  get crouch() { return this.down('KeyC') || this.down('ControlLeft'); }
  get walk() { return this.down('ShiftLeft') || this.down('ShiftRight'); }
  get jump() { return this.down('Space'); }
}
