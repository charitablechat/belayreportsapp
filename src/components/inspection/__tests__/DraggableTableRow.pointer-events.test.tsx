/**
 * P1 regression: DraggableTableRow / DraggableMobileCard must NOT set
 * pointer-events:none on the entire row when isTouchDragging is true. A
 * stale isTouchDragging flag from an aborted drag would otherwise block
 * Type/Result dropdown taps inside the row on touch devices.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DraggableTableRow, DraggableMobileCard } from "../DraggableTableRow";

const noop = () => {};
const baseProps = {
  id: "row-1",
  isDragging: false,
  isTouchDragging: true,
  onRowDragStart: noop,
  onRowDragOver: noop,
  onRowDragLeave: noop,
  onRowDrop: noop,
  onRowDragEnd: noop,
};

describe("DraggableTableRow — touch-drag must not block dropdown taps", () => {
  it("row does not set pointer-events:none even when isTouchDragging is true", () => {
    const { container } = render(
      <DraggableTableRow {...baseProps}>
        <div>cell</div>
      </DraggableTableRow>,
    );
    const row = container.querySelector('[data-row-id="row-1"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.style.pointerEvents).not.toBe("none");
  });

  it("mobile card does not set pointer-events:none even when isTouchDragging is true", () => {
    const { container } = render(
      <DraggableMobileCard {...baseProps}>
        <div>card</div>
      </DraggableMobileCard>,
    );
    const card = container.querySelector('[data-row-id="row-1"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.style.pointerEvents).not.toBe("none");
  });
});
