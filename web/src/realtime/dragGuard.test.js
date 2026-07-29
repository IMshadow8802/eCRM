import { describe, it, expect, beforeEach, vi } from "vitest";
import { dragGuard } from "./dragGuard";

describe("dragGuard", () => {
  beforeEach(() => dragGuard.end()); // reset to not-dragging + flush

  it("reports dragging state between start and end", () => {
    expect(dragGuard.isDragging()).toBe(false);
    dragGuard.start();
    expect(dragGuard.isDragging()).toBe(true);
    dragGuard.end();
    expect(dragGuard.isDragging()).toBe(false);
  });

  it("defers thunks while dragging and flushes them on end", () => {
    const fn = vi.fn();
    dragGuard.start();
    dragGuard.defer(fn);
    expect(fn).not.toHaveBeenCalled(); // held during drag
    dragGuard.end();
    expect(fn).toHaveBeenCalledTimes(1); // flushed on drop
  });

  it("flushes each deferred thunk only once", () => {
    const fn = vi.fn();
    dragGuard.start();
    dragGuard.defer(fn);
    dragGuard.end();
    dragGuard.end(); // second end must not re-run
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
