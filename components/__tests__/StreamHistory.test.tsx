import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StreamHistory, { type HistoryEntry } from '../StreamHistory';

vi.mock('@/src/lib/network', () => ({
  useNetwork: () => ({ network: 'testnet' }),
}));

vi.mock('@/src/lib/sorostream', () => ({
  formatUSDC: (stroops: bigint) => {
    const whole = Number(stroops) / 10_000_000;
    return whole.toLocaleString(undefined, { minimumFractionDigits: 7, maximumFractionDigits: 7 });
  },
  truncateAddress: (addr: string) => `${addr.slice(0, 4)}…${addr.slice(-4)}`,
}));

const makeEntry = (overrides: Partial<HistoryEntry>): HistoryEntry => ({
  timestamp: new Date('2024-01-15T10:00:00Z').toISOString(),
  type: 'creation',
  amount: '10000000000',
  txHash: 'TX000000HASH0000',
  ...overrides,
});

/** Generate N unique entries to exceed the initial page size (20). */
function makeManyEntries(count: number): HistoryEntry[] {
  return Array.from({ length: count }, (_, i) =>
    makeEntry({ txHash: `TX_HASH_${String(i).padStart(4, '0')}` }),
  );
}

describe('StreamHistory', () => {
  it('renders a creation entry', () => {
    render(<StreamHistory entries={[makeEntry({ type: 'creation' })]} />);
    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('renders a withdrawal entry', () => {
    render(<StreamHistory entries={[makeEntry({ type: 'withdrawal' })]} />);
    expect(screen.getByText('Withdrawal')).toBeInTheDocument();
  });

  it('renders a top-up entry', () => {
    render(<StreamHistory entries={[makeEntry({ type: 'top-up' })]} />);
    expect(screen.getByText('Top-up')).toBeInTheDocument();
  });

  it('renders a cancellation entry', () => {
    render(<StreamHistory entries={[makeEntry({ type: 'cancellation' })]} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('renders empty state when history array is empty', () => {
    render(<StreamHistory entries={[]} />);
    expect(screen.getByText(/no history events recorded yet/i)).toBeInTheDocument();
  });

  it('displays amounts in human-readable format', () => {
    const entry = makeEntry({ type: 'creation', amount: '10000000000' });
    render(<StreamHistory entries={[entry]} />);
    // 10_000_000_000 stroops = 1000 XLM/USDC
    expect(screen.getByText(/1,000/)).toBeInTheDocument();
  });

  it('prefixes withdrawal amounts with a minus sign', () => {
    const entry = makeEntry({ type: 'withdrawal', amount: '5000000000' });
    const { container } = render(<StreamHistory entries={[entry]} />);
    expect(container.textContent).toMatch(/-/);
  });

  it('prefixes top-up amounts with a plus sign', () => {
    const entry = makeEntry({ type: 'top-up', amount: '5000000000' });
    const { container } = render(<StreamHistory entries={[entry]} />);
    expect(container.textContent).toMatch(/\+/);
  });

  it('renders entries in the order provided (reverse chronological expected from caller)', () => {
    const entries: HistoryEntry[] = [
      makeEntry({ type: 'cancellation', timestamp: new Date('2024-01-15T12:00:00Z').toISOString(), txHash: 'TX_CANCEL_0001' }),
      makeEntry({ type: 'top-up',       timestamp: new Date('2024-01-15T08:00:00Z').toISOString(), txHash: 'TX_TOPUP__0002' }),
      makeEntry({ type: 'creation',     timestamp: new Date('2024-01-14T00:00:00Z').toISOString(), txHash: 'TX_CREATE_0003' }),
    ];
    render(<StreamHistory entries={entries} />);

    const labels = screen.getAllByText(/Cancelled|Top-up|Created/);
    expect(labels[0]).toHaveTextContent('Cancelled');
    expect(labels[1]).toHaveTextContent('Top-up');
    expect(labels[2]).toHaveTextContent('Created');
  });

  it('truncates the tx hash in each entry', () => {
    const entry = makeEntry({ txHash: 'ABCDEFGHIJKLMNOP' });
    render(<StreamHistory entries={[entry]} />);
    expect(screen.getByText('ABCD…MNOP')).toBeInTheDocument();
  });

  it('renders multiple entries', () => {
    const entries: HistoryEntry[] = [
      makeEntry({ type: 'creation',   txHash: 'TX_A' }),
      makeEntry({ type: 'withdrawal', txHash: 'TX_B' }),
    ];
    render(<StreamHistory entries={entries} />);
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Withdrawal')).toBeInTheDocument();
  });

  it('renders loading skeleton when loading prop is true', () => {
    const { container } = render(<StreamHistory entries={[]} loading />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  // ── Infinite scroll (issue #457) ────────────────────────────────────────

  it('does NOT render a "Load more" button when entries exceed one page', () => {
    render(<StreamHistory entries={makeManyEntries(25)} />);
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('renders the scroll sentinel element when more entries remain', () => {
    const { container } = render(<StreamHistory entries={makeManyEntries(25)} />);
    // The sentinel has aria-label for accessibility
    const sentinel = container.querySelector('[aria-label="Loading more history events"]');
    expect(sentinel).toBeTruthy();
  });

  it('shows only the first page of entries on initial render', () => {
    const entries = makeManyEntries(25);
    render(<StreamHistory entries={entries} />);
    // Only 20 entries rendered initially; no sentinel needed for ≤20 entries
    const items = screen.getAllByText('Created');
    expect(items.length).toBe(20);
  });

  it('shows end-of-list message when all entries are visible', () => {
    render(<StreamHistory entries={makeManyEntries(5)} />);
    expect(screen.getByText(/reached the end/i)).toBeInTheDocument();
  });
});
