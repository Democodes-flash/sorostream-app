"use client";

import { useState, useCallback } from "react";
import DurationPicker from "@/components/DurationPicker";
import FlowRatePreview from "@/components/FlowRatePreview";
import RecipientAutocomplete from "@/components/RecipientAutocomplete";
import SchedulingToggle from "@/components/SchedulingToggle";
import FeeEstimationPanel from "@/components/FeeEstimationPanel";
import StreamCostCalculator from "@/components/StreamCostCalculator";
import NetReceivedDisplay from "@/components/NetReceivedDisplay";
import EndDatePicker from "@/components/EndDatePicker";
import TransactionStepper, { TxStage } from "@/components/TransactionStepper";
import StatusBadge from "@/components/StatusBadge";

// ── Types ─────────────────────────────────────────────────────────────────

export type StreamCreationStep = "recipient" | "amount" | "preview" | "confirm";

const SUPPORTED_TOKENS = [
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "XLM", name: "Stellar Lumens" },
  { symbol: "AQUA", name: "Aquarius" },
  { symbol: "yXLM", name: "Yield XLM" },
] as const;

const STEP_LABELS: Record<StreamCreationStep, { title: string; number: number }> = {
  recipient: { title: "Recipient", number: 1 },
  amount: { title: "Amount & Duration", number: 2 },
  preview: { title: "Preview", number: 3 },
  confirm: { title: "Review & Confirm", number: 4 },
};

const ALL_STEPS: StreamCreationStep[] = ["recipient", "amount", "preview", "confirm"];

const ADDRESS_BOOK_STORAGE_KEYS = [
  "addressBook",
  "stellarAddressBook",
  "stellar-address-book",
  "address-book",
  "stellar_address_book",
  "contacts",
] as const;

interface AddressBookEntry {
  address: string;
  alias: string;
}

function getAddressBookContacts(): AddressBookEntry[] {
  if (typeof window === "undefined") return [];
  for (const key of ADDRESS_BOOK_STORAGE_KEYS) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      const parsed: unknown = JSON.parse(raw);
      let list: unknown = [];
      if (Array.isArray(parsed)) {
        list = parsed;
      } else if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.contacts)) list = obj.contacts;
        else if (Array.isArray(obj.entries)) list = obj.entries;
      }
      const entries: AddressBookEntry[] = (list as unknown[])
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          address: String((item.address as string) || (item.publicKey as string) || (item.stellarAddress as string) || ""),
          alias: String((item.alias as string) || (item.name as string) || (item.label as string) || ""),
        }))
        .filter((item) => item.address);
      return entries;
    } catch {
      // Ignore malformed address book data.
    }
  }
  return [];
}

function validateRecipient(value: string): string {
  if (!value.trim()) return "Recipient address is required.";
  if (!/^G[A-Z2-7]{55}$/.test(value.trim()))
    return "Must be a valid Stellar public key (starts with G, 56 chars).";
  return "";
}

function validateAmount(value: string): string {
  if (!value.trim()) return "Amount is required.";
  const num = Number(value);
  if (isNaN(num) || num <= 0) return "Amount must be greater than 0.";
  return "";
}

function validateDuration(seconds: number): string {
  if (seconds <= 0) return "Duration must be greater than 0.";
  return "";
}

// ── Sub-components ────────────────────────────────────────────────────────

/** Progress indicator showing 4 numbered steps with connectors. */
function StepProgress({
  currentStep,
}: {
  currentStep: StreamCreationStep;
}) {
  const currentIdx = ALL_STEPS.indexOf(currentStep);
  return (
    <div className="flex items-center justify-center gap-2 mb-8" role="list" aria-label="Form progress">
      {ALL_STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-2" role="listitem">
          <div
            className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold transition-colors ${
              s === currentStep
                ? "bg-green-700 text-white ring-2 ring-green-500 ring-offset-2 ring-offset-gray-900"
                : currentIdx > i
                ? "bg-green-800 text-green-300"
                : "bg-gray-700 text-gray-400"
            }`}
            aria-current={s === currentStep ? "step" : undefined}
          >
            {currentIdx > i ? "✓" : i + 1}
          </div>
          <span
            className={`text-xs hidden sm:inline ${s === currentStep ? "text-white font-medium" : "text-gray-500"}`}
          >
            {STEP_LABELS[s].title}
          </span>
          {i < ALL_STEPS.length - 1 && (
            <div
              className={`w-8 h-px ${currentIdx > i ? "bg-green-600" : "bg-gray-700"}`}
              aria-hidden="true"
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** Navigation row: Back + Continue / Submit buttons. */
function StepNav({
  step,
  onBack,
  onNext,
  isLastStep,
  disabled,
}: {
  step: StreamCreationStep;
  onBack: () => void;
  onNext: () => void;
  isLastStep: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-3 pt-4">
      {step !== "recipient" && (
        <button
          type="button"
          onClick={onBack}
          className="flex-1 border border-gray-600 text-gray-300 py-3 rounded-lg font-medium hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
        >
          ← Back
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={disabled}
        className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLastStep ? "Create Stream" : "Continue →"}
      </button>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────

export interface StreamCreationFormProps {
  /**
   * Which step of the 4-step wizard to display.
   * @default "recipient"
   */
  initialStep?: StreamCreationStep;

  /**
   * Pre-fill the recipient address field (e.g. from a URL param or clone action).
   */
  defaultRecipient?: string;

  /**
   * Pre-fill the token selection.
   * @default "XLM"
   */
  defaultToken?: string;

  /**
   * Pre-fill the amount field.
   */
  defaultAmount?: string;

  /**
   * Pre-fill the duration in seconds.
   */
  defaultDuration?: number;

  /**
   * When true the form shows a transaction-in-progress overlay instead of
   * the form fields.
   * @default false
   */
  submitting?: boolean;

  /**
   * Which transaction stage to show when `submitting` is true.
   */
  txStage?: TxStage;

  /**
   * When provided together with a failed `txStage`, surfaces an error message
   * in the TransactionStepper.
   */
  txError?: string;

  /**
   * Fired when the user completes the final step and confirms stream creation.
   * In Storybook this is a no-op; in production this triggers the SDK call.
   */
  onSubmit?: (data: {
    recipient: string;
    amount: string;
    durationSeconds: number;
    token: string;
  }) => void;

  /**
   * Fired when the user navigates away (back button on the first step, or
   * post-success redirect). In Storybook this is a no-op.
   */
  onCancel?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────

/**
 * **StreamCreationForm**
 *
 * A self-contained, router-free wrapper around the four-step stream creation
 * wizard. Designed for isolated development and visual testing in Storybook.
 *
 * It assembles the same sub-components used by the `/stream/new` Next.js page
 * (`RecipientAutocomplete`, `DurationPicker`, `FlowRatePreview`, etc.) but
 * removes the router, form-persistence, and SDK dependencies so each story
 * renders without a backend.
 */
export default function StreamCreationForm({
  initialStep = "recipient",
  defaultRecipient = "",
  defaultToken = "XLM",
  defaultAmount = "",
  defaultDuration = 0,
  submitting = false,
  txStage,
  txError,
  onSubmit,
  onCancel,
}: StreamCreationFormProps) {
  const [step, setStep] = useState<StreamCreationStep>(initialStep);
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [amount, setAmount] = useState(defaultAmount);
  const [duration, setDuration] = useState(defaultDuration);
  const [selectedToken, setSelectedToken] = useState(defaultToken);
  const [endDate, setEndDate] = useState("");
  const [schedulingEnabled, setSchedulingEnabled] = useState(false);
  const [scheduledStart, setScheduledStart] = useState("");
  const [memo, setMemo] = useState("");
  const [errors, setErrors] = useState({
    recipient: "",
    amount: "",
    duration: "",
  });
  const [touched, setTouched] = useState({ recipient: false, amount: false });
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contacts, setContacts] = useState<AddressBookEntry[]>([]);
  const [selectedAlias, setSelectedAlias] = useState("");

  const currentIdx = ALL_STEPS.indexOf(step);
  const isLastStep = step === "confirm";

  const goBack = useCallback(() => {
    if (currentIdx > 0) setStep(ALL_STEPS[currentIdx - 1]);
    else onCancel?.();
  }, [currentIdx, onCancel]);

  const goNext = useCallback(() => {
    if (step === "recipient") {
      const err = validateRecipient(recipient);
      if (err) {
        setErrors((p) => ({ ...p, recipient: err }));
        setTouched((p) => ({ ...p, recipient: true }));
        return;
      }
      setStep("amount");
    } else if (step === "amount") {
      const aErr = validateAmount(amount);
      const dErr = validateDuration(duration);
      if (aErr || dErr) {
        setErrors((p) => ({ ...p, amount: aErr, duration: dErr }));
        return;
      }
      setStep("preview");
    } else if (step === "preview") {
      setStep("confirm");
    } else if (step === "confirm") {
      onSubmit?.({ recipient, amount, durationSeconds: duration, token: selectedToken });
    }
  }, [step, recipient, amount, duration, selectedToken, onSubmit]);

  const toggleContactPicker = useCallback(() => {
    setContacts(getAddressBookContacts());
    setContactPickerOpen((open) => !open);
  }, []);

  const selectContact = useCallback((contact: AddressBookEntry) => {
    setRecipient(contact.address);
    setSelectedAlias(contact.alias);
    setContactPickerOpen(false);
    setTouched((p) => ({ ...p, recipient: true }));
    setErrors((p) => ({ ...p, recipient: validateRecipient(contact.address) }));
  }, []);

  // Token-derived helpers
  const amountNum = parseFloat(amount) || 0;
  const flowRatePerSec = duration > 0 ? (amountNum * 1e7) / duration : 0;

  // ── Transaction overlay ─────────────────────────────────────────────
  if (submitting && txStage != null) {
    return (
      <div className="bg-gray-800 rounded-xl p-8 space-y-6 max-w-lg mx-auto">
        <h2 className="text-lg font-semibold text-center text-white">
          {txStage === TxStage.Done ? "🎉 Stream Created!" : "Creating your stream…"}
        </h2>
        <TransactionStepper
          currentStage={txStage}
          failedStage={txStage === TxStage.Confirming && txError ? txStage : undefined}
          errorMessage={txError}
        />
        {txError && (
          <button
            type="button"
            className="w-full border border-gray-600 text-gray-300 py-3 rounded-lg font-medium hover:bg-gray-700 transition-colors"
            onClick={() => onCancel?.()}
          >
            Back to Form
          </button>
        )}
      </div>
    );
  }

  // ── Main form ───────────────────────────────────────────────────────
  return (
    <div className="bg-gray-900 text-white min-h-screen p-6">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">New Stream</h1>
          {step !== "recipient" && (
            <StatusBadge status="Active" compact />
          )}
        </div>

        {/* Progress */}
        <StepProgress currentStep={step} />

        {/* ── Step 1: Recipient ──────────────────────────────────────── */}
        {step === "recipient" && (
          <div className="space-y-6">
            <div>
              <label
                htmlFor="recipient"
                className="text-gray-200 text-sm font-medium block mb-2"
              >
                Recipient address
              </label>
              <div
                className="relative [&_input]:pr-12"
                onBlur={(e) => {
                  if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) {
                    setContactPickerOpen(false);
                  }
                }}
              >
              <RecipientAutocomplete
                value={recipient}
                onChange={(v) => {
                  setRecipient(v);
                  setSelectedAlias("");
                  setContactPickerOpen(false);
                  if (touched.recipient)
                    setErrors((p) => ({ ...p, recipient: validateRecipient(v) }));
                }}
                onBlur={() => {
                  setTouched((p) => ({ ...p, recipient: true }));
                  setErrors((p) => ({
                    ...p,
                    recipient: validateRecipient(recipient),
                  }));
                }}
                placeholder="G… (56-character Stellar public key)"
                error={errors.recipient}
                touched={touched.recipient}
              />
              <button
                type="button"
                onClick={toggleContactPicker}
                onMouseDown={(e) => e.preventDefault()}
                aria-label="Open address book"
                aria-expanded={contactPickerOpen}
                aria-haspopup="listbox"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a4 4 0 10-4-4 4 4 0 004 4z" />
                </svg>
              </button>
              {contactPickerOpen && (
                <div
                  role="listbox"
                  aria-label="Saved contacts"
                  className="absolute left-0 right-0 top-full z-10 mt-2 max-h-64 overflow-auto rounded-lg border border-gray-700 bg-gray-800 shadow-xl"
                >
                  {contacts.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-400">
                      No saved contacts yet.
                    </div>
                  ) : (
                    contacts.map((contact, index) => (
                      <button
                        key={`${contact.address}-${index}`}
                        type="button"
                        role="option"
                        aria-selected={contact.address === recipient}
                        onClick={() => selectContact(contact)}
                        onMouseDown={(e) => e.preventDefault()}
                        className="w-full px-4 py-2.5 text-left flex flex-col gap-0.5 hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                      >
                        <span className="text-sm font-medium text-white">
                          {contact.alias || "Unnamed contact"}
                        </span>
                        <span className="text-xs font-mono text-gray-400 truncate">
                          {contact.address}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
              </div>
              {selectedAlias && (
                <p className="text-green-400 text-xs mt-1">✓ {selectedAlias}</p>
              )}
              {errors.recipient && touched.recipient && (
                <p className="text-red-400 text-sm mt-1" role="alert">
                  {errors.recipient}
                </p>
              )}
            </div>

            <StepNav
              step={step}
              onBack={goBack}
              onNext={goNext}
              isLastStep={isLastStep}
            />
          </div>
        )}

        {/* ── Step 2: Amount & Duration ─────────────────────────────── */}
        {step === "amount" && (
          <div className="space-y-6">
            {/* Token */}
            <div>
              <label
                htmlFor="token-select"
                className="text-gray-200 text-sm font-medium block mb-2"
              >
                Token
              </label>
              <select
                id="token-select"
                value={selectedToken}
                onChange={(e) => setSelectedToken(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              >
                {SUPPORTED_TOKENS.map((t) => (
                  <option key={t.symbol} value={t.symbol}>
                    {t.symbol} — {t.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div>
              <label
                htmlFor="amount"
                className="text-gray-200 text-sm font-medium block mb-2"
              >
                Total amount
              </label>
              <input
                id="amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const v = e.target.value.replace(/^-/, "");
                  setAmount(v);
                  if (touched.amount)
                    setErrors((p) => ({ ...p, amount: validateAmount(v) }));
                }}
                onBlur={() => {
                  setTouched((p) => ({ ...p, amount: true }));
                  setErrors((p) => ({ ...p, amount: validateAmount(amount) }));
                }}
                placeholder={`Amount in ${selectedToken}`}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                aria-required="true"
                aria-invalid={!!(touched.amount && errors.amount)}
              />
              {touched.amount && errors.amount && (
                <p className="text-red-400 text-sm mt-1" role="alert">
                  {errors.amount}
                </p>
              )}
            </div>

            {/* Duration */}
            <div>
              <DurationPicker
                onChange={(s) => {
                  setDuration(s);
                  setErrors((p) => ({ ...p, duration: validateDuration(s) }));
                }}
                error={errors.duration}
              />
            </div>

            {/* End date (optional) */}
            <EndDatePicker
              value={endDate}
              onChange={setEndDate}
              error=""
            />

            {/* Scheduling toggle */}
            <SchedulingToggle
              enabled={schedulingEnabled}
              onToggle={setSchedulingEnabled}
              value={scheduledStart}
              onChange={setScheduledStart}
              onBlur={() => {}}
              error=""
            />

            {/* Live flow-rate preview */}
            {amountNum > 0 && duration > 0 && (
              <FlowRatePreview
                amount={amount}
                durationSeconds={duration}
              />
            )}

            {/* Fee estimation */}
            <FeeEstimationPanel active={amountNum > 0 && duration > 0} />

            <StepNav
              step={step}
              onBack={goBack}
              onNext={goNext}
              isLastStep={isLastStep}
            />
          </div>
        )}

        {/* ── Step 3: Preview ───────────────────────────────────────── */}
        {step === "preview" && (
          <div className="space-y-6">
            <div className="bg-gray-800 rounded-xl p-6 space-y-4 border border-gray-700">
              <h2 className="font-semibold text-lg">Stream summary</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-400">Recipient</dt>
                  <dd className="text-white font-mono text-xs truncate max-w-[200px]">
                    {recipient}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Amount</dt>
                  <dd className="text-white">
                    {amount} {selectedToken}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Duration</dt>
                  <dd className="text-white">
                    {duration > 0
                      ? `${(duration / 86400).toFixed(1)} days`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Flow rate</dt>
                  <dd className="text-green-400">
                    {flowRatePerSec > 0
                      ? `${(flowRatePerSec / 1e7).toFixed(7)} ${selectedToken}/sec`
                      : "—"}
                  </dd>
                </div>
              </dl>
            </div>

            {amountNum > 0 && duration > 0 && (
              <>
                <StreamCostCalculator
                  amount={amount}
                  durationSeconds={duration}
                  tokenSymbol={selectedToken}
                />
                <NetReceivedDisplay
                  amount={amount}
                  tokenSymbol={selectedToken}
                />
              </>
            )}

            <StepNav
              step={step}
              onBack={goBack}
              onNext={goNext}
              isLastStep={isLastStep}
            />
          </div>
        )}

        {/* ── Step 4: Confirm ───────────────────────────────────────── */}
        {step === "confirm" && (
          <div className="space-y-6">
            <div className="bg-gray-800 rounded-xl p-6 space-y-4 border border-gray-700">
              <h2 className="font-semibold text-lg">Confirm stream creation</h2>
              <p className="text-gray-400 text-sm">
                Review the details below. Once you click &quot;Create Stream&quot; you will be
                prompted to sign the transaction with your Stellar wallet.
              </p>
              <dl className="space-y-3 text-sm border-t border-gray-700 pt-4">
                <div className="flex justify-between">
                  <dt className="text-gray-400">Recipient</dt>
                  <dd className="text-white font-mono text-xs">{recipient}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Amount</dt>
                  <dd className="text-white font-semibold">
                    {amount} {selectedToken}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Duration</dt>
                  <dd className="text-white">
                    {duration > 0 ? `${(duration / 86400).toFixed(1)} days` : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Token</dt>
                  <dd className="text-white">{selectedToken}</dd>
                </div>
              </dl>
            </div>

            {/* Optional memo */}
            <div>
              <label
                htmlFor="memo"
                className="text-gray-200 text-sm font-medium block mb-2"
              >
                Memo{" "}
                <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <input
                id="memo"
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="e.g. Salary Q1 2026"
                maxLength={28}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
              />
            </div>

            <StepNav
              step={step}
              onBack={goBack}
              onNext={goNext}
              isLastStep={isLastStep}
            />
          </div>
        )}
      </div>
    </div>
  );
}
