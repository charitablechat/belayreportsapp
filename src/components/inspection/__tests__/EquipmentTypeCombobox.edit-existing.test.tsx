/**
 * EquipmentTypeCombobox: mirrors SystemTypeSelect contract.
 * Pre-seed the search box, preserve existing value on empty-commit attempts,
 * commit edits cleanly, and don't regress desktop click-to-select.
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

import { EquipmentTypeCombobox } from "../EquipmentTypeCombobox";

function Harness({
  initialValue = "",
  options = ["Harness", "Lanyard", "SRL"],
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
    <EquipmentTypeCombobox
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

describe("EquipmentTypeCombobox edit-existing", () => {
  beforeEach(() => {
    cleanup();
  });

  it("pre-seeds the search box with the current value when opened", async () => {
    render(<Harness initialValue="Harness" />);
    const trigger = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.click(trigger);
    });

    const searchBox = await screen.findByPlaceholderText(/search or type new/i) as HTMLInputElement;
    expect(searchBox.value).toBe("Harness");
  });

  it("clearing the search box then closing preserves the existing value", async () => {
    const onChangeSpy = vi.fn();
    render(<Harness initialValue="Lanyard" onChangeSpy={onChangeSpy} />);
    const trigger = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.click(trigger);
    });

    const searchBox = await screen.findByPlaceholderText(/search or type new/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(searchBox, { target: { value: "" } });
    });
    await act(async () => {
      fireEvent.keyDown(searchBox, { key: "Escape" });
    });

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain("Lanyard");
  });

  it("editing an existing value to something new commits and adds the option", async () => {
    const onChangeSpy = vi.fn();
    const onAddOptionSpy = vi.fn();
    render(
      <Harness
        initialValue="Lanyard"
        onChangeSpy={onChangeSpy}
        onAddOptionSpy={onAddOptionSpy}
      />,
    );
    const trigger = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.click(trigger);
    });
    const searchBox = await screen.findByPlaceholderText(/search or type new/i) as HTMLInputElement;

    await act(async () => {
      fireEvent.change(searchBox, { target: { value: "Lanyard XL" } });
    });
    await act(async () => {
      fireEvent.keyDown(searchBox, { key: "Enter" });
    });

    expect(onChangeSpy).toHaveBeenCalledWith("Lanyard XL");
    expect(onAddOptionSpy).toHaveBeenCalledWith("Lanyard XL");
  });

  it("desktop: clicking an existing option selects it without registering as new", async () => {
    const onChangeSpy = vi.fn();
    const onAddOptionSpy = vi.fn();
    render(
      <Harness
        options={["Harness", "Lanyard", "SRL"]}
        onChangeSpy={onChangeSpy}
        onAddOptionSpy={onAddOptionSpy}
      />,
    );
    const trigger = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.click(trigger);
    });

    const option = await screen.findByText("SRL");
    await act(async () => {
      fireEvent.click(option);
    });

    expect(onChangeSpy).toHaveBeenCalledWith("SRL");
    expect(onAddOptionSpy).not.toHaveBeenCalled();
  });
});
