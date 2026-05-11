import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { preserveScroll } from "@/lib/table-focus-utils";

describe("preserveScroll", () => {
  let scrollToSpy: ReturnType<typeof vi.spyOn>;
  let rafCallbacks: FrameRequestCallback[] = [];
  let originalRAF: typeof requestAnimationFrame;

  beforeEach(() => {
    Object.defineProperty(window, "scrollX", { value: 42, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 137, configurable: true });
    scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    rafCallbacks = [];
    originalRAF = global.requestAnimationFrame;
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length as unknown as number;
    }) as typeof requestAnimationFrame;
  });

  afterEach(() => {
    scrollToSpy.mockRestore();
    global.requestAnimationFrame = originalRAF;
  });

  it("returns the result of fn", () => {
    expect(preserveScroll(() => 7)).toBe(7);
  });

  it("restores scroll position across two animation frames", () => {
    const fn = vi.fn(() => "ok");
    preserveScroll(fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(scrollToSpy).not.toHaveBeenCalled();

    // First rAF: restores once + schedules another rAF
    rafCallbacks[0]?.(0);
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
    expect(scrollToSpy).toHaveBeenLastCalledWith(42, 137);

    // Second rAF: restores again (covers post-blur mobile keyboard reflow)
    rafCallbacks[1]?.(0);
    expect(scrollToSpy).toHaveBeenCalledTimes(2);
    expect(scrollToSpy).toHaveBeenLastCalledWith(42, 137);
  });

  it("uses the scroll position captured BEFORE fn ran, not after", () => {
    preserveScroll(() => {
      // Simulate state mutation moving the page (e.g. row remount jump)
      Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    });
    rafCallbacks[0]?.(0);
    expect(scrollToSpy).toHaveBeenCalledWith(42, 137);
  });
});
