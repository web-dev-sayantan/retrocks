const TAP_MAX_MOVE_PX = 16;
const TAP_MAX_DURATION_MS = 300;
const DOUBLE_TAP_MAX_DELAY_MS = 350;
const DOUBLE_TAP_MAX_DISTANCE_PX = 32;

export function createDoubleTap(
  acceptsTarget: (target: EventTarget | null) => boolean,
  activate: () => void,
) {
  let activeTouch: { pointerId: number; x: number; y: number; time: number } | undefined;
  let lastTap: { x: number; y: number; time: number } | undefined;

  function reset() {
    activeTouch = undefined;
    lastTap = undefined;
  }

  return {
    reset,
    onPointerDown(event: PointerEvent) {
      if (event.pointerType !== 'touch') return;
      if (!event.isPrimary || !acceptsTarget(event.target)) {
        reset();
        return;
      }
      activeTouch = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: Date.now(),
      };
    },
    onPointerCancel(event: PointerEvent) {
      if (activeTouch?.pointerId === event.pointerId) activeTouch = undefined;
    },
    onPointerUp(event: PointerEvent) {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;
      const start = activeTouch;
      activeTouch = undefined;
      if (!start || start.pointerId !== event.pointerId) return;

      const now = Date.now();
      const moveDistance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (!acceptsTarget(event.target) || now - start.time > TAP_MAX_DURATION_MS || moveDistance > TAP_MAX_MOVE_PX) {
        lastTap = undefined;
        return;
      }
      if (
        lastTap &&
        now - lastTap.time <= DOUBLE_TAP_MAX_DELAY_MS &&
        Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= DOUBLE_TAP_MAX_DISTANCE_PX
      ) {
        lastTap = undefined;
        event.preventDefault();
        activate();
      } else {
        lastTap = { x: event.clientX, y: event.clientY, time: now };
      }
    },
  };
}
