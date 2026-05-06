/**
 * Onsite-contact persistence regression lock.
 *
 * The bug: after a dropdown selection, Radix's PopoverContent unmounts and
 * its FocusScope auto-restores focus to the trigger Input. The trigger's
 * onFocus handler (`handleTriggerFocus`) then re-entered edit mode and
 * reopened the popover, masking the fact that `onChange` had already
 * committed the selection upstream — to inspectors it looked like the
 * field "didn't persist" the value they just picked.
 *
 * These tests pin the post-selection contract:
 *   1. `onChange` is called exactly once with the selected value.
 *   2. The trigger Input shows the selected value (not "" and not stale).
 *   3. The popover stays closed after selection — the focus-restore
 *      auto-fire is suppressed by `justSelectedRef`.
 *   4. A genuine subsequent re-focus by the user (after the suppression
 *      window) reopens the popover normally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { useState } from 'react';

// cmdk's <Command> uses ResizeObserver and Element.scrollIntoView internally;
// jsdom ships neither. Stub both so the popover renders without throwing.
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
// pointer-events:none guard inside cmdk reads getBoundingClientRect; jsdom
// returns zeros which is fine but Radix Popover's collision detection also
// reads it — keep default behaviour.

// Stub the Supabase chain `from(...).select().eq().order().order().limit()` plus
// the `.upsert()` and `.delete().eq().eq()` shapes used in saveToHistory /
// pushUnsyncedToServer / handleDelete. Empty results so fetchGlobalHistory
// resolves to an empty server set and only the local existingValues drive the
// dropdown contents in tests.
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
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      upsert: () => okPromise,
      delete: () => ({ eq: () => ({ eq: () => okPromise }) }),
      select: buildSelectChain,
    }),
  },
}));

vi.mock('@/lib/offline-storage', () => ({
  getAutocompleteHistory: vi.fn(async () => []),
  putAutocompleteEntry: vi.fn(async () => undefined),
  deleteAutocompleteEntry: vi.fn(async () => undefined),
  getUnsyncedAutocompleteEntries: vi.fn(async () => []),
  bulkPutAutocompleteEntries: vi.fn(async () => undefined),
}));

vi.mock('@/lib/table-focus-utils', () => ({
  focusNextCell: vi.fn(),
}));

import { GlobalAutocomplete } from '../GlobalAutocomplete';

function ControlledHarness({
  initialValue = '',
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
      placeholder="Select or enter contact..."
      existingValues={existingValues}
    />
  );
}

describe('GlobalAutocomplete onsite_contact dropdown persistence', () => {
  beforeEach(() => {
    cleanup();
  });

  it('controlled prop displays committed value when not editing (regression: empty inputValue race)', () => {
    render(<ControlledHarness initialValue="John Doe" />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.value).toBe('John Doe');
  });

  it('selecting an existing entry from the dropdown calls onChange with the picked value and updates the trigger Input', async () => {
    const onChangeSpy = vi.fn();
    render(
      <ControlledHarness
        existingValues={['Alice Smith', 'Bob Jones']}
        onChangeSpy={onChangeSpy}
      />,
    );

    const trigger = screen.getByRole('combobox') as HTMLInputElement;
    await act(async () => {
      fireEvent.focus(trigger);
    });

    const option = await screen.findByText('Alice Smith');
    await act(async () => {
      fireEvent.click(option);
    });

    expect(onChangeSpy).toHaveBeenCalledTimes(1);
    expect(onChangeSpy).toHaveBeenCalledWith('Alice Smith');
    expect(trigger.value).toBe('Alice Smith');
  });

  it('Enter on a typed-but-not-listed value commits via onChange', async () => {
    const onChangeSpy = vi.fn();
    render(<ControlledHarness onChangeSpy={onChangeSpy} />);
    const trigger = screen.getByRole('combobox') as HTMLInputElement;

    await act(async () => {
      fireEvent.focus(trigger);
      fireEvent.change(trigger, { target: { value: 'Charlie Brown' } });
    });

    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    });

    expect(onChangeSpy).toHaveBeenCalledWith('Charlie Brown');
    expect(trigger.value).toBe('Charlie Brown');
  });

  it('the focus-restore that fires immediately after a dropdown selection does NOT reopen the popover', async () => {
    render(<ControlledHarness existingValues={['Alice Smith']} />);
    const trigger = screen.getByRole('combobox') as HTMLInputElement;

    await act(async () => {
      fireEvent.focus(trigger);
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const option = await screen.findByText('Alice Smith');
    await act(async () => {
      fireEvent.click(option);
    });

    // Simulate Radix FocusScope's auto-restore-focus firing on PopoverContent
    // unmount: the trigger Input gets focused again. Without `justSelectedRef`
    // the popover would reopen and the field would appear "still in edit
    // mode" to the inspector.
    await act(async () => {
      fireEvent.focus(trigger);
    });

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.value).toBe('Alice Smith');
  });

  it('after the suppression window elapses, a genuine re-focus reopens the popover normally', async () => {
    render(<ControlledHarness existingValues={['Alice Smith']} />);
    const trigger = screen.getByRole('combobox') as HTMLInputElement;

    await act(async () => {
      fireEvent.focus(trigger);
    });
    const option = await screen.findByText('Alice Smith');
    await act(async () => {
      fireEvent.click(option);
    });

    // First simulated post-select auto-restore is consumed by the guard.
    await act(async () => {
      fireEvent.focus(trigger);
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    // Wait past the 200ms suppression window.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    // A NEW user-initiated focus must reopen the popover.
    await act(async () => {
      fireEvent.focus(trigger);
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
});
