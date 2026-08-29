import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import StreamActions from '../StreamActions';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/src/lib/sorostream', () => ({
  sorostream: {
    withdraw: vi.fn(),
    cancelStream: vi.fn(),
  },
  claimableNow: vi.fn(() => '0'),
  getMockStream: vi.fn(() => null),
}));

// Capture toast calls so we can assert on them
const mockAddToast = vi.fn();
const mockUpsertPersistentToast = vi.fn(() => 1);
const mockRemoveToast = vi.fn();

vi.mock('@/src/lib/toast', () => ({
  useToast: () => ({
    addToast: mockAddToast,
    upsertPersistentToast: mockUpsertPersistentToast,
    removeToast: mockRemoveToast,
  }),
}));

vi.mock('@/src/context/SettingsContext', () => ({
  useSettings: () => ({ withdrawThreshold: 1000 }),
}));

vi.mock('@/src/context/WalletContext', () => ({
  useWallet: () => ({ refetchBalance: vi.fn(), address: 'GBKLYONWFBQFBFZK6HMTXQZJNBKQEXZ3PJOVXNKZXVTV4FQXVMKLKHA' }),
}));

// LiveCounter doesn't matter for these tests
vi.mock('@/components/LiveCounter', () => ({
  default: () => <span data-testid="live-counter">0.00</span>,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { sorostream } from '@/src/lib/sorostream';

const defaultProps = {
  streamId: '42',
  flowRate: 1_000_000,
  lastWithdrawTime: new Date().toISOString(),
};

function renderActions() {
  return render(<StreamActions {...defaultProps} />);
}

/**
 * Helper that advances the cancel flow past the confirmation dialog.
 * The Cancel button now opens a confirm dialog first; calling this helper
 * clicks "Cancel" → then "Cancel Stream" in the dialog to start the grace
 * period countdown.
 */
function startCancelGracePeriod() {
  fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
  fireEvent.click(screen.getByRole('button', { name: /cancel stream/i }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StreamActions — cancel grace period', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (sorostream.cancelStream as ReturnType<typeof vi.fn>).mockResolvedValue({
      txHash: 'mock-tx-hash',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a countdown toast immediately when Cancel is clicked', () => {
    renderActions();
    startCancelGracePeriod();

    expect(mockUpsertPersistentToast).toHaveBeenCalledWith(
      'cancel-grace-42',
      'Cancelling stream #42 in 5s…',
      'warning',
      expect.objectContaining({ label: 'Undo' }),
    );
  });

  it('counts down each second in the toast', () => {
    renderActions();
    startCancelGracePeriod();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(mockUpsertPersistentToast).toHaveBeenCalledWith(
      'cancel-grace-42',
      'Cancelling stream #42 in 4s…',
      'warning',
      expect.objectContaining({ label: 'Undo' }),
    );

    act(() => { vi.advanceTimersByTime(1000); });
    expect(mockUpsertPersistentToast).toHaveBeenCalledWith(
      'cancel-grace-42',
      'Cancelling stream #42 in 3s…',
      'warning',
      expect.objectContaining({ label: 'Undo' }),
    );
  });

  it('submits the transaction after 5 seconds', async () => {
    renderActions();
    startCancelGracePeriod();

    await act(async () => { vi.advanceTimersByTime(5000); });

    expect(sorostream.cancelStream).toHaveBeenCalledTimes(1);
    expect(mockAddToast).toHaveBeenCalledWith(
      'Stream #42 cancelled',
      'success',
    );
  });

  it('does NOT submit the transaction before 5 seconds', () => {
    renderActions();
    startCancelGracePeriod();

    act(() => { vi.advanceTimersByTime(4999); });

    expect(sorostream.cancelStream).not.toHaveBeenCalled();
  });

  it('button changes to "Undo Cancel" while grace period is active', () => {
    renderActions();
    startCancelGracePeriod();

    expect(screen.getByRole('button', { name: /undo cancel/i })).toBeInTheDocument();
  });

  it('clicking Undo Cancel aborts the transaction', async () => {
    renderActions();
    startCancelGracePeriod();

    // The button is now disabled (#485 fix); undo is done via the toast action.
    const { onClick: undoAction } = (mockUpsertPersistentToast.mock.calls[0] as any)[3] as {
      label: string;
      onClick: () => void;
    };
    act(() => { undoAction(); });

    // Advance past the 5-second mark
    await act(async () => { vi.advanceTimersByTime(6000); });

    expect(sorostream.cancelStream).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith('Cancellation undone.', 'info');
  });

  it('clicking Undo Cancel dismisses the countdown toast', () => {
    // upsertPersistentToast returns id 1
    mockUpsertPersistentToast.mockReturnValue(1);

    renderActions();
    startCancelGracePeriod();

    // The button is disabled (#485 fix); invoke the toast action directly.
    const { onClick: undoAction } = (mockUpsertPersistentToast.mock.calls[0] as any)[3] as {
      label: string;
      onClick: () => void;
    };
    act(() => { undoAction(); });

    expect(mockRemoveToast).toHaveBeenCalledWith(1);
  });

  it('restores the Cancel button after Undo via toast action', () => {
    renderActions();
    startCancelGracePeriod();

    // The "Undo Cancel" button is disabled (#485 fix); undo via the toast action.
    const { onClick: undoAction } = (mockUpsertPersistentToast.mock.calls[0] as any)[3] as {
      label: string;
      onClick: () => void;
    };
    act(() => { undoAction(); });

    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
  });

  it('dismisses the countdown toast before submitting on-chain', async () => {
    mockUpsertPersistentToast.mockReturnValue(99);

    renderActions();
    startCancelGracePeriod();

    await act(async () => { vi.advanceTimersByTime(5000); });

    expect(mockRemoveToast).toHaveBeenCalledWith(99);
  });

  it('shows an error toast if cancelStream throws', async () => {
    (sorostream.cancelStream as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network error'),
    );

    renderActions();
    startCancelGracePeriod();

    await act(async () => { vi.advanceTimersByTime(5000); });

    expect(mockAddToast).toHaveBeenCalledWith(
      'Failed to cancel stream. Please try again.',
      'error',
    );
  });

  it('calling Undo via the toast action callback also aborts', async () => {
    renderActions();
    startCancelGracePeriod();

    // Grab the action.onClick that was passed to upsertPersistentToast
    const { onClick: action } = (mockUpsertPersistentToast.mock.calls[0] as any)[3] as {
      label: string;
      onClick: () => void;
    };

    act(() => { action(); });

    await act(async () => { vi.advanceTimersByTime(6000); });

    expect(sorostream.cancelStream).not.toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith('Cancellation undone.', 'info');
  });
});

describe('StreamActions — cancel button disabled during grace period (#485)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (sorostream.cancelStream as ReturnType<typeof vi.fn>).mockResolvedValue({
      txHash: 'mock-tx-hash',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancel button is disabled as soon as the grace period starts', () => {
    renderActions();
    startCancelGracePeriod();

    // During the grace period the button shows "Undo Cancel" and must be disabled
    // so the user cannot accidentally submit a second cancellation.
    const undoBtn = screen.getByRole('button', { name: /undo cancel/i });
    expect(undoBtn).toBeDisabled();
  });

  it('cancel button is disabled while the on-chain transaction is in flight', async () => {
    let resolveCancelStream!: (value: { txHash: string }) => void;
    (sorostream.cancelStream as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<{ txHash: string }>((res) => { resolveCancelStream = res; }),
    );

    renderActions();
    startCancelGracePeriod();

    // Advance past the grace period to trigger the on-chain call
    await act(async () => { vi.advanceTimersByTime(5000); });

    // The button should still be disabled while cancelling is true
    const cancelBtn = screen.getByRole('button', { name: /cancelling/i });
    expect(cancelBtn).toBeDisabled();

    // Clean up — resolve the promise
    await act(async () => { resolveCancelStream({ txHash: 'tx-123' }); });
  });
});

describe('StreamActions — withdraw (unchanged behaviour)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (sorostream.withdraw as ReturnType<typeof vi.fn>).mockResolvedValue({
      txHash: 'mock-tx',
      amount: '5.00',
    });
  });

  it('shows success toast after withdrawal', async () => {
    renderActions();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /withdraw/i }));
    });

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining('Withdrawn'),
      'success',
    );
  });

  it('shows error toast if withdraw fails', async () => {
    (sorostream.withdraw as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('tx failed'),
    );

    renderActions();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /withdraw/i }));
    });

    expect(mockAddToast).toHaveBeenCalledWith(
      'Withdrawal failed. Please try again.',
      'error',
    );
  });

  it('withdraw button is disabled while a withdrawal is in flight', async () => {
    // Keep the promise unresolved so the component stays in the withdrawing state
    let resolveWithdraw!: (value: { txHash: string; amount: string }) => void;
    (sorostream.withdraw as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<{ txHash: string; amount: string }>((res) => {
        resolveWithdraw = res;
      }),
    );

    renderActions();
    const btn = screen.getByRole('button', { name: /withdraw/i });

    // Click to start the withdrawal
    fireEvent.click(btn);

    // Button should be disabled (and show spinner text) while tx is pending
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /withdrawing/i })).toBeDisabled(),
    );

    // Resolve so the component can clean up
    await act(async () => {
      resolveWithdraw({ txHash: 'tx-123', amount: '5.00' });
    });
  });

  it('clicking the withdraw button multiple times only submits one transaction', async () => {
    // Keep the first call pending so the guard has a chance to block subsequent clicks
    let resolveWithdraw!: (value: { txHash: string; amount: string }) => void;
    (sorostream.withdraw as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<{ txHash: string; amount: string }>((res) => {
        resolveWithdraw = res;
      }),
    );

    renderActions();
    const btn = screen.getByRole('button', { name: /withdraw/i });

    // Rapidly fire three clicks
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);

    // Resolve the in-flight transaction
    await act(async () => {
      resolveWithdraw({ txHash: 'tx-abc', amount: '5.00' });
    });

    // Despite three clicks, only one withdraw call should have been made
    expect(sorostream.withdraw).toHaveBeenCalledTimes(1);
  });
});
