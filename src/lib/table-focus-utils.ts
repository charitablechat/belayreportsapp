/**
 * Moves focus to the next focusable cell in a table row.
 * If at the end of a row, wraps to the first input of the next row.
 * Only scrolls if the newly focused element is not already visible, and never
 * with a smooth/centered animation that users perceive as a page jump.
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
    idx = focusables.findIndex((el) => el.contains(current) || current.contains(el));
  }

  const next = idx >= 0 ? focusables[idx + 1] : undefined;

  if (next) {
    next.focus();
    requestAnimationFrame(() => {
      next.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
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
          firstInput.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
        });
      }
    }
  }
}

/**
 * Snapshots window scroll position, runs fn, then restores scroll across two
 * animation frames. Use to wrap state-mutating handlers (like onImmediateSave)
 * that may remount rows and let the browser drop the document scroll position.
 */
export function preserveScroll<T>(fn: () => T): T {
  const x = typeof window !== 'undefined' ? window.scrollX : 0;
  const y = typeof window !== 'undefined' ? window.scrollY : 0;
  const result = fn();
  if (typeof window !== 'undefined' && typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      window.scrollTo(x, y);
      requestAnimationFrame(() => window.scrollTo(x, y));
    });
  }
  return result;
}
