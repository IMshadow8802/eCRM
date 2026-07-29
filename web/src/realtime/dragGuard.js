// Shared flag so realtime invalidations can defer while a kanban drag is in
// flight. A socket-driven refetch that re-buckets a board mid-drag re-renders
// the columns under the pointer; deferring the refetch until the drop lands
// avoids the flicker (and any reconciliation hazard). Boards call start()/end()
// around a drag; SocketProvider checks isDragging() and defer()s the refetch.
let dragging = false;
const pending = new Set();

export const dragGuard = {
  start() {
    dragging = true;
  },
  end() {
    dragging = false;
    const thunks = [...pending];
    pending.clear();
    thunks.forEach((fn) => fn());
  },
  isDragging: () => dragging,
  defer(fn) {
    pending.add(fn);
  },
};
