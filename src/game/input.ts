/**
 * FrostPlow: Unified Input Management
 * Continuous held keys, edge-triggered one-shots, and focus hygiene
 */

export interface InputHub {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  drift: boolean;
  action: boolean; // blower
  consumeAction: () => boolean;
  consumePause: () => boolean;
  consumeMute: () => boolean;
  consumeCameraToggle: () => boolean;
  setVirtualInput: (input: Partial<{ forward: boolean; backward: boolean; left: boolean; right: boolean; action: boolean }>) => void;
  dispose: () => void;
}

export function createInputHub(): InputHub {
  const heldKeys = new Set<string>();
  let actionJustPressed = false;
  let pauseJustPressed = false;
  let muteJustPressed = false;
  let camJustPressed = false;

  // Virtual touch input overlays
  const virtual = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    action: false,
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Avoid default browser scrolling with game controls
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }

    if (!e.repeat) {
      if (e.code === 'KeyP' || e.code === 'Escape') {
        pauseJustPressed = true;
      }
      if (e.code === 'KeyM') {
        muteJustPressed = true;
      }
      if (e.code === 'KeyC') {
        camJustPressed = true;
      }
      if (e.code === 'Space') {
        actionJustPressed = true;
      }
    }

    heldKeys.add(e.code);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    heldKeys.delete(e.code);
  };

  const onBlur = () => {
    heldKeys.clear();
    virtual.forward = false;
    virtual.backward = false;
    virtual.left = false;
    virtual.right = false;
    virtual.action = false;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onBlur);

  return {
    get forward() {
      return heldKeys.has('KeyW') || heldKeys.has('ArrowUp') || virtual.forward;
    },
    get backward() {
      return heldKeys.has('KeyS') || heldKeys.has('ArrowDown') || virtual.backward;
    },
    get left() {
      return heldKeys.has('KeyA') || heldKeys.has('ArrowLeft') || virtual.left;
    },
    get right() {
      return heldKeys.has('KeyD') || heldKeys.has('ArrowRight') || virtual.right;
    },
    get drift() {
      return heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight') || heldKeys.has('KeyX');
    },
    get action() {
      return heldKeys.has('Space') || virtual.action;
    },
    consumeAction: () => {
      const pressed = actionJustPressed || virtual.action;
      actionJustPressed = false;
      virtual.action = false;
      return pressed;
    },
    consumePause: () => {
      const pressed = pauseJustPressed;
      pauseJustPressed = false;
      return pressed;
    },
    consumeMute: () => {
      const pressed = muteJustPressed;
      muteJustPressed = false;
      return pressed;
    },
    consumeCameraToggle: () => {
      const pressed = camJustPressed;
      camJustPressed = false;
      return pressed;
    },
    setVirtualInput: (input) => {
      Object.assign(virtual, input);
    },
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onBlur);
    },
  };
}
