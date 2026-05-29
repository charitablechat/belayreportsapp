import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
  },
}));

import { toast } from "sonner";
import {
  showSaveQueuedToast,
  __resetSaveQueuedToastForTests,
} from "@/lib/save-queued-toast";

describe("showSaveQueuedToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    __resetSaveQueuedToastForTests();
    (toast.info as ReturnType<typeof vi.fn>).mockClear();
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
  });

  it("emits the queued toast on the first call", () => {
    const emitted = showSaveQueuedToast("queued");
    expect(emitted).toBe(true);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      "Save queued",
      expect.objectContaining({
        id: "save-queued-toast",
        description: "Finishing previous sync — your latest changes will save next.",
        duration: 2500,
      })
    );
  });

  it("suppresses repeated queued toasts inside the 30s window", () => {
    showSaveQueuedToast("queued");
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(2_000);
      expect(showSaveQueuedToast("queued")).toBe(false);
    }
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("re-emits the queued toast after the 30s window expires", () => {
    showSaveQueuedToast("queued");
    vi.advanceTimersByTime(30_001);
    expect(showSaveQueuedToast("queued")).toBe(true);
    expect(toast.info).toHaveBeenCalledTimes(2);
  });

  it("routes the already-saved variant to toast.success with the existing copy", () => {
    const emitted = showSaveQueuedToast("already-saved");
    expect(emitted).toBe(true);
    expect(toast.success).toHaveBeenCalledWith(
      "Already saved",
      expect.objectContaining({
        id: "save-queued-toast",
        description: "Finishing background sync.",
        duration: 2000,
      })
    );
  });

  it("throttles queued and already-saved independently", () => {
    expect(showSaveQueuedToast("queued")).toBe(true);
    expect(showSaveQueuedToast("already-saved")).toBe(true);
    // Within window, both suppressed
    vi.advanceTimersByTime(1_000);
    expect(showSaveQueuedToast("queued")).toBe(false);
    expect(showSaveQueuedToast("already-saved")).toBe(false);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});
