/**
 * Tablet edit-persistence regression lock.
 *
 * On tablets the soft keyboard often steals & returns focus to the trigger
 * Input mid-typing (autocorrect bar, candidate selection, accessibility
 * announcers). Before the fix, `handleTriggerFocus` re-seeded `inputValue`
 * from the prop `value` on EVERY focus event, wiping the user's in-flight
 * edit. And `handleOpenChange(false)` happily committed an empty buffer
 * over a previously non-empty value if the user opened then closed the
 * popover without typing.
 *
 * These tests pin the contract:
 *   1. Re-focus while editing does NOT clobber the in-flight buffer.
 *   2. Opening then closing the popover without typing preserves the
 *      previously-committed value.
 *   3. Editing an existing value by appending characters commits the
 *      concatenation, not just the typed suffix.
 *   4. Desktop keyboard flow (focus → type new → Enter) still commits
 *      cleanly with no regressions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { useState } from "react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function noop() {};
}

const okPromise = Promise.resolve({ error: null, data: [] });
const buildSelectChain = () => ({
  eq: () => ({
    order: () => ({
      order: () => ({
        limit: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      upsert: () => okPromise,
      delete: () => ({ eq: () => ({ eq: () => okPromise }) }),
      select: buildSelectChain,
    }),
  },
}));

vi.mock("@/lib/offline-storage", () => ({
  getAutocompleteHistory: vi.fn(async () => []),
  putAutocompleteEntry: vi.fn(async () => undefined),
  deleteAutocompleteEntry: vi.fn(async () => undefined),
  getUnsyncedAutocompleteEntries: vi.fn(async () => []),
  bulkPutAutocompleteEntries: vi.fn(async () => undefined),
}));

vi.mock("@/lib/table-focus-utils", () => ({
  focusNextCell: vi.fn(),
}));

import { GlobalAutocomplete } from "../GlobalAutocomplete";

function Harness({
  initialValue = "",
  existingValues = [],
  onChangeSpy,
}: {
  initialValue?: string;
  existingValues?: string[];
  onChangeSpy?: (v: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <GlobalAutocomplete
      value={value}
      onChange={(v) => {
        setValue(v);
        onChangeSpy?.(v);
      }}
      fieldType="onsite_contact"
      placeholder="Enter contact..."
      existingValues={existingValues}
    />
  );
}

describe("GlobalAutocomplete tablet edit-persistence", () => {
  beforeEach(() => {
    cleanup();
  });

  it("re-focusing the trigger mid-edit does not wipe the in-flight buffer", async () => {
    render(<Harness initialValue="John Doe" />);
    const trigger = screen.getByRole("combobox") as HTMLInputElement;

    // User taps the field to start editing — popover opens, value is mirrored
    // into the local buffer.
    await act(async () => {
      fireEvent.focus(trigger);
    });
    expect(trigger.value).toBe("John Doe");

    // User types an extra character via the trigger Input.
    await act(async () => {
      fireEvent.change(trigger, { target: { value: "John Doe!" } });
    });
    expect(trigger.value).toBe("John Doe!");

    // Soft-keyboard / autocorrect-bar steals and returns focus.
    // Before the fix, this re-fired handleTriggerFocus → setInputValue(value)
    // and wiped "John Doe!" back to "John Doe".
    await act(async () => {
      fireEvent.focus(trigger);
    });

    expect(trigger.value).toBe("John Doe!");
  });

  it("opening then closing the popover without typing preserves the previous value", async () => {
    const onChangeSpy = vi.fn();
    render(<Harness initialValue="Jane Roe" onChangeSpy={onChangeSpy} />);
    const trigger = screen.getByRole("combobox") as HTMLInputElement;

    // Tap to open.
    await act(async () => {
      fireEvent.focus(trigger);
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    // Tap outside (Escape collapses the popover identically here for jsdom).
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Escape" });
    });

    // Value untouched, no spurious onChange.
    expect(trigger.value).toBe("Jane Roe");
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it("appending to an existing value commits the concatenation on Enter, not just the suffix", async () => {
    const onChangeSpy = vi.fn();
    render(<Harness initialValue="Acme" onChangeSpy={onChangeSpy} />);
    const trigger = screen.getByRole("combobox") as HTMLInputElement;

    await act(async () => {
      fireEvent.focus(trigger);
    });
    await act(async () => {
      fireEvent.change(trigger, { target: { value: "Acme Corp" } });
    });
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });

    expect(onChangeSpy).toHaveBeenLastCalledWith("Acme Corp");
    expect(trigger.value).toBe("Acme Corp");
  });

  it("desktop keyboard flow: focus + type new + Enter commits cleanly (no regression)", async () => {
    const onChangeSpy = vi.fn();
    render(<Harness onChangeSpy={onChangeSpy} />);
    const trigger = screen.getByRole("combobox") as HTMLInputElement;

    await act(async () => {
      fireEvent.focus(trigger);
      fireEvent.change(trigger, { target: { value: "Dana Vega" } });
      fireEvent.keyDown(trigger, { key: "Enter" });
    });

    expect(onChangeSpy).toHaveBeenCalledWith("Dana Vega");
    expect(trigger.value).toBe("Dana Vega");
  });
});
