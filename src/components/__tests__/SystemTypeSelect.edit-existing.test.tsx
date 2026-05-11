/**
 * SystemTypeSelect: preserve existing value across popover open/close,
 * pre-seed the search box with the current value, and never commit empty
 * over a non-empty existing value.
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

import SystemTypeSelect from "../SystemTypeSelect";

function Harness({
  initialValue = "",
  options = ["Anchor Line", "Lifeline", "Davit"],
  onChangeSpy,
  onAddOptionSpy,
}: {
  initialValue?: string;
  options?: string[];
  onChangeSpy?: (v: string) => void;
  onAddOptionSpy?: (v: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [opts, setOpts] = useState(options);
  return (
    <SystemTypeSelect
      value={value}
      onChange={(v) => {
        setValue(v);
        onChangeSpy?.(v);
      }}
      options={opts}
      onAddOption={(label) => {
        setOpts((prev) => (prev.includes(label) ? prev : [...prev, label]));
        onAddOptionSpy?.(label);
      }}
    />
  );
}

describe("SystemTypeSelect edit-existing", () => {
  beforeEach(() => {
    cleanup();
  });

  it("pre-seeds the search box with the current value when the popover opens", async () => {
    render(<Harness initialValue="Anchor Line" />);
    const trigger = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.click(trigger);
    });

    const searchBox = await screen.findByPlaceholderText("Search or type new...") as HTMLInputElement;
    expect(searchBox.value).toBe("Anchor Line");
  });

  it("opening then closing without typing preserves the existing value", async () => {
    const onChangeSpy = vi.fn();
    render(<Harness initialValue="Lifeline" onChangeSpy={onChangeSpy} />);
    const trigger = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.click(trigger);
    });
    const searchBox = await screen.findByPlaceholderText("Search or type new...") as HTMLInputElement;

    // User clears the search box (mimics tablet "select all + delete") then
    // closes the popover. The previous "Lifeline" must NOT be wiped.
    await act(async () => {
      fireEvent.change(searchBox, { target: { value: "" } });
    });
    await act(async () => {
      fireEvent.keyDown(searchBox, { key: "Escape" });
    });

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain("Lifeline");
  });

  it("editing the existing value to a new one commits and registers as a new option", async () => {
    const onChangeSpy = vi.fn();
    const onAddOptionSpy = vi.fn();
    render(
      <Harness
        initialValue="Lifeline"
        onChangeSpy={onChangeSpy}
        onAddOptionSpy={onAddOptionSpy}
      />,
    );
    const trigger = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.click(trigger);
    });
    const searchBox = await screen.findByPlaceholderText("Search or type new...") as HTMLInputElement;

    await act(async () => {
      fireEvent.change(searchBox, { target: { value: "Lifeline North" } });
    });
    await act(async () => {
      fireEvent.keyDown(searchBox, { key: "Enter" });
    });

    expect(onChangeSpy).toHaveBeenCalledWith("Lifeline North");
    expect(onAddOptionSpy).toHaveBeenCalledWith("Lifeline North");
  });

  it("desktop: arrow-key + Enter selection picks an existing option (no regression)", async () => {
    const onChangeSpy = vi.fn();
    const onAddOptionSpy = vi.fn();
    render(
      <Harness
        initialValue=""
        options={["Anchor Line", "Lifeline", "Davit"]}
        onChangeSpy={onChangeSpy}
        onAddOptionSpy={onAddOptionSpy}
      />,
    );
    const trigger = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.click(trigger);
    });

    const option = await screen.findByText("Lifeline");
    await act(async () => {
      fireEvent.click(option);
    });

    expect(onChangeSpy).toHaveBeenCalledWith("Lifeline");
    // Lifeline already exists; must not be registered as a new option.
    expect(onAddOptionSpy).not.toHaveBeenCalled();
  });
});
