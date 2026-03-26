/**
 * Moves focus to the next focusable cell in a table row.
 * If at the end of a row, wraps to the first input of the next row.
 * Scrolls the newly focused element to the center of the viewport.
 */
export function focusNextCell(current: HTMLElement) {
  const row = current.closest('[data-row-id]');
  if (!row) return;

  const selector =
    'input:not([disabled]):not([type="file"]):not([type="hidden"]), textarea:not([disabled]), [contenteditable="true"], select:not([disabled])';

  const focusables = Array.from(row.querySelectorAll<HTMLElement>(selector));

  // The current element might be nested inside a wrapper; find it or its ancestor in the list
  let idx = focusables.indexOf(current);
  if (idx === -1) {
    // Try to find the closest match (e.g. the current is inside a wrapper that contains the input)
    idx = focusables.findIndex((el) => el.contains(current) || current.contains(el));
  }

  const next = idx >= 0 ? focusables[idx + 1] : undefined;

  if (next) {
    next.focus();
    requestAnimationFrame(() => {
      next.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    });
  } else {
    // Move to the next row's first input
    const container = row.parentElement;
    if (!container) return;

    const allRows = Array.from(container.querySelectorAll(':scope > [data-row-id]'));
    const rowIdx = allRows.indexOf(row);
    const nextRow = allRows[rowIdx + 1];

    if (nextRow) {
      const firstInput = nextRow.querySelector<HTMLElement>(selector);
      if (firstInput) {
        firstInput.focus();
        requestAnimationFrame(() => {
          firstInput.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        });
      }
    }
  }
}
