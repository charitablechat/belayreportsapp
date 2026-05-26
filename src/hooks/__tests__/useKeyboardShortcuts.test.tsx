import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "../useKeyboardShortcuts";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

function fire(init: Partial<KeyboardEventInit> & { target?: EventTarget }) {
  const ev = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  if (init.target) {
    Object.defineProperty(ev, "target", { value: init.target });
  }
  document.dispatchEvent(ev);
  return ev;
}

describe("useKeyboardShortcuts", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => vi.clearAllMocks());

  it("does not throw when event.key is undefined", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "s", ctrl: true, action }] })
    );
    expect(() => fire({ ctrlKey: true } as any)).not.toThrow();
    expect(action).not.toHaveBeenCalled();
  });

  it("does not throw when shortcut.key is undefined/malformed", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [{ key: undefined as any, ctrl: true, action }],
      })
    );
    expect(() => fire({ key: "s", ctrlKey: true })).not.toThrow();
    expect(action).not.toHaveBeenCalled();
  });

  it("fires valid shortcut normally", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "s", ctrl: true, action }] })
    );
    fire({ key: "s", ctrlKey: true });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("does not fire while typing in input (non-save)", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "k", action }] })
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    fire({ key: "k", target: input });
    expect(action).not.toHaveBeenCalled();
  });

  it("does not fire while typing in textarea", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "k", action }] })
    );
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    fire({ key: "k", target: ta });
    expect(action).not.toHaveBeenCalled();
  });

  it("does not fire in contenteditable", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "k", action }] })
    );
    const div = document.createElement("div");
    div.contentEditable = "true";
    document.body.appendChild(div);
    fire({ key: "k", target: div });
    expect(action).not.toHaveBeenCalled();
  });

  it("allows Ctrl+S save even inside an input", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "s", ctrl: true, action }] })
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    fire({ key: "s", ctrlKey: true, target: input });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("undefined key inside input does not throw", () => {
    const action = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ shortcuts: [{ key: "s", ctrl: true, action }] })
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(() => fire({ ctrlKey: true, target: input } as any)).not.toThrow();
    expect(action).not.toHaveBeenCalled();
  });
});
