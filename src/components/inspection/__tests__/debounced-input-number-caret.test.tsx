/**
 * Regression: focusing a <DebouncedInput type="number"> must not throw
 * `InvalidStateError: Failed to execute 'setSelectionRange' on 'HTMLInputElement':
 *  The input element's type ('number') does not support selection.`
 *
 * Sentry: ef893d25fff04e82bea7fcf8ad4f66b9 (2026-05-12) — fired from
 * focusNextCell -> Input.onFocus -> DebouncedInput.handleFocus -> placeCursorAtEnd.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { DebouncedInput } from "../DebouncedInput";

describe("DebouncedInput caret guard", () => {
  it("does not throw on focus when type=number", () => {
    const { getByTestId } = render(
      <DebouncedInput
        data-testid="num"
        type="number"
        value="42"
        onChange={() => {}}
      />,
    );
    const el = getByTestId("num") as HTMLInputElement;
    expect(() => el.focus()).not.toThrow();
    expect(() => fireEvent.mouseUp(el)).not.toThrow();
    expect(() => fireEvent.touchEnd(el)).not.toThrow();
  });

  it("still places caret at end for type=text", () => {
    const { getByTestId } = render(
      <DebouncedInput
        data-testid="txt"
        type="text"
        value="hello"
        onChange={() => {}}
      />,
    );
    const el = getByTestId("txt") as HTMLInputElement;
    el.focus();
    // jsdom synchronously honors setSelectionRange for text inputs
    expect(el.selectionStart).toBe(5);
    expect(el.selectionEnd).toBe(5);
  });
});
