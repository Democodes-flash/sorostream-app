/**
 * Tests for stream creation form reset — fixes #486
 *
 * Verifies that handleCreateStream resets ALL form fields (including step,
 * memo, and confirmAmountInput) after a successful stream creation so the
 * user sees a fresh form instead of stale data.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Read the source file once for all tests
const src = fs.readFileSync(
  path.resolve(__dirname, '../page.tsx'),
  'utf8',
);

// Locate the FIRST clearDraft() call inside the success try-block.
// The success path matches: `clearDraft();\n\n      setRecipient`
// while the "Back to Form" clearDraft() is inside an onClick inline handler.
const SUCCESS_ANCHOR = 'clearDraft();\n\n      setRecipient';
const successResetStart = src.indexOf(SUCCESS_ANCHOR);

// Find the router.push call that comes after the reset block
const routerPushIdx = src.indexOf('router.push(', successResetStart);

// Extract just the reset block (between clearDraft and router.push)
const resetBlock = successResetStart >= 0 && routerPushIdx > successResetStart
  ? src.slice(successResetStart, routerPushIdx)
  : '';

describe('handleCreateStream reset (#486) — source-level regression guards', () => {
  it('finds the success-path reset block in the source file', () => {
    expect(successResetStart).toBeGreaterThan(-1);
    expect(routerPushIdx).toBeGreaterThan(successResetStart);
    expect(resetBlock.length).toBeGreaterThan(0);
  });

  it('resets the wizard step to "recipient" after creation', () => {
    expect(resetBlock).toContain('setStep("recipient")');
  });

  it('resets the memo field after creation', () => {
    expect(resetBlock).toContain('setMemo("")');
  });

  it('resets the typed-amount confirmation input after creation', () => {
    expect(resetBlock).toContain('setConfirmAmountInput("")');
  });

  it('also resets the pre-existing fields (recipient, amount, duration)', () => {
    expect(resetBlock).toContain('setRecipient("")');
    expect(resetBlock).toContain('setAmount("")');
    expect(resetBlock).toContain('setDuration(0)');
  });

  it('setStep("recipient") comes before router.push so the reset executes before navigation', () => {
    const stepResetIdx  = src.indexOf('setStep("recipient")', successResetStart);
    expect(stepResetIdx).toBeGreaterThan(successResetStart);
    expect(stepResetIdx).toBeLessThan(routerPushIdx);
  });
});
