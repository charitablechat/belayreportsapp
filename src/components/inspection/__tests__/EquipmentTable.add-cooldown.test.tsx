/**
 * P1 regression: clicking "Add" twice within the cooldown window must only
 * insert one equipment row. Mobile rapid taps and React 18 dev double-fire
 * previously produced duplicates.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";

// Stub heavy children so the table mounts in jsdom.
vi.mock("@/components/ui/voice-rich-text-editor", () => ({ VoiceRichTextEditor: () => null }));
vi.mock("@/components/ui/lazy-rich-text-editor", () => ({ LazyRichTextEditor: () => null }));
vi.mock("@/components/ResultSelect", () => ({ default: () => null }));
vi.mock("../EquipmentTypeCombobox", () => ({ EquipmentTypeCombobox: () => null }));
vi.mock("../ItemPhotoUpload", () => ({ default: () => null }));
vi.mock("../DebouncedInput", () => ({ DebouncedInput: () => null }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

import EquipmentTable from "../EquipmentTable";

function Harness() {
  const [equipment, setEquipment] = useState<any[]>([]);
  return (
    <EquipmentTable
      category="helmets"
      displayName="Helmets"
      equipment={equipment}
      onUpdate={setEquipment as any}
      inspectionId="ins-1"
    />
  );
}

describe("EquipmentTable — Add row tap cooldown", () => {
  it("two rapid clicks insert only one row", () => {
    const { getByTestId, container } = render(<Harness />);
    const btn = getByTestId("add-equipment-helmets") as HTMLButtonElement;
    fireEvent.click(btn);
    fireEvent.click(btn);
    // Count rendered rows (desktop grid uses data-row-id on each row wrapper).
    const rows = container.querySelectorAll("[data-row-id]");
    // Desktop + mobile views both render — div count per row is constant.
    // Assert by row id uniqueness, not count.
    const ids = new Set(Array.from(rows).map((r) => r.getAttribute("data-row-id")));
    expect(ids.size).toBe(1);
    cleanup();
  });
});
