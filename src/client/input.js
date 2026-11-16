// Input: WASD/arrows to move (the only way to move), Space to jump, taps/clicks (used for tools, see
// main.js onTap), mouse wheel or two-finger pinch to zoom, and Q/E to turn the camera between its
// fixed angles (45 degree steps).

export class Input {
  /**
   * @param {HTMLElement} canvas
   * @param {(x:number, y:number, first:boolean) => void} onPoint  called with CSS px relative to the canvas
   */
  constructor(canvas, onPoint) {
    this.keys = new Set();
    this.zoom = 0;
    this.jumpQueued = false;
    this.rotSteps = 0; // Q/E presses: +-1 per 45 degree step
    this.hover = null; // [x, y] of the mouse over the canvas (CSS px), or null (for the tool outline)

    window.addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, select, textarea')) return;
      this.keys.add(e.code);
      if (e.code === 'Space') { this.jumpQueued = true; e.preventDefault(); }
      if (!e.repeat && (e.code === 'KeyQ' || e.code === 'KeyE')) this.rotSteps += e.code === 'KeyQ' ? -1 : 1;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    const pointers = new Map(); // id -> {x, y}
    let pinchDist = 0;
    let holdTimer = 0;
    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) { this.onRight?.(...local(e)); return; } // right click: a menu for what's under it (main.js)
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        onPoint(...local(e), true);
        holdTimer = performance.now();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.hover = local(e);
      const p = pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) this.zoom += Math.log(pinchDist / d) * 8;
        pinchDist = d;
      } else if (pointers.size === 1 && performance.now() - holdTimer > 120) {
        // holding and dragging: keep re-targeting toward the pointer
        holdTimer = performance.now();
        onPoint(...local(e), false);
      }
    });
    const end = (e) => { pointers.delete(e.pointerId); pinchDist = 0; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { this.hover = null; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom += Math.sign(e.deltaY); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // keyboard movement in screen space: x = right, z = up/forward
  read() {
    const k = this.keys;
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const z = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    return { x, z, run, jump };
  }

  /** Q/E presses since the last call: + = E (clockwise), each one 45 degrees. */
  takeRotate() {
    const r = this.rotSteps;
    this.rotSteps = 0;
    return r;
  }

  takeZoom() {
    const z = this.zoom;
    this.zoom = 0;
    return z;
  }
}
