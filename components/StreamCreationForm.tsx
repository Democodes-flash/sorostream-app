"use client";

import { useState, useCallback, useMemo } from "react";
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

type AddressBookEntry = { id?: string; name: string; address: string };

const ADDRESS_BOOK_STORAGE_KEYS = [
  "addressBook",
  "stellar-address-book",
  "stellarAddressBook",
  "contacts",
] as const;

function readAddressBook(): AddressBookEntry[] {
  if (typeof window === "undefined") return [];
  for (const key of ADDRESS_BOOK_STORAGE_KEYS) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).contacts ??
          (parsed as Record<string, unknown>).entries ??
          (parsed as Record<string, unknown>).addresses
        : [];
      if (!Array.isArray(list)) continue;
      const contacts = list
        .map((entry): AddressBookEntry | null => {
          if (typeof entry === "string") {
            const address = entry.trim();
            return address ? { name: "", address } : null;
          }
          if (!entry || typeof entry !== "object") return null;
          const e = entry as Record<string, unknown>;
          const address =
            typeof e.address === "string"
              ? e.address.trim()
              : typeof e.publicKey === "string"
              ? e.publicKey.trim()
              : "";
          const name =
            typeof e.name === "string"
              ? e.name
              : typeof e.alias === "string"
              ? e.alias
              : "";
          return address
            ? { id: typeof e.id === "string" ? e.id : address, name, address }
            : null;
        })
        .filter(
          (c): c is AddressBookEntry =>
            !!c && /^G[A-Z2-7]{55}$/.test(c.address),
        );
      if (contacts.length > 0) return contacts;
    } catch {
      // Ignore malformed address book entries.
    }
  }
  return [];
}

const STEP_LABELS: Record<StreamCreationStep, { title: string; number: number }> = {
  recipient: { title: "Recipient", number: 1 },
  amount: { title: "Amount & Duration", number: 2 },
  preview: { title: "Preview", number: 3 },
  confirm: { title: "Review & Confirm", number: 4 },
};

const ALL_STEPS: StreamCreationStep[] = ["recipient", "amount", "preview", "confirm"];

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

/** Address-book quick-fill dropdown. */
function AddressBookPicker({
  onSelect,
  onClose,
}: {
  onSelect: (contact: AddressBookEntry) => void;
  onClose: () => void;
}) {
  const contacts = useMemo(() => readAddressBook(), []);

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-10 cursor-default"
        aria-label="Close address book"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        className="absolute z-20 mt-2 w-full bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden"
        role="listbox"
        aria-label="Address book"
      >
        {contacts.length === 0 ? (
          <p className="text-gray-400 text-sm px-4 py-3">
            No saved contacts yet. Add recipients in your address book to quick-fill.
          </p>
        ) : (
          <ul className="max-h-60 overflow-y-auto py-1">
            {contacts.map((contact) => (
              <li key={contact.id ?? contact.address}>
                <button
                  type="button"
                  onClick={() => onSelect(contact)}
                  className="w-full text-left px-4 py-2 hover:bg-gray-700 focus-visible:outline-none focus-visible:bg-gray-700 transition-colors"
                  role="option"
                  aria-selected="false"
                >
                  {contact.name && (
                    <span className="block text-sm text-white">{contact.name}</span>
                  )}
                  <span className="block text-xs text-gray-400 font-mono truncate">
                    {contact.address}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
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
  const [selectedAlias, setSelectedAlias] = useState("");
  const [showAddressBook, setShowAddressBook] = useState(false);

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
              <div className="relative">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <RecipientAutocomplete
                      value={recipient}
                      onChange={(v) => {
                        setRecipient(v);
                        setSelectedAlias("");
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
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddressBook((v) => !v)}
                    className="shrink-0 text-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded-md p-2"
                    aria-label="Open address book"
                    aria-haspopup="listbox"
                    aria-expanded={showAddressBook}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                      />
                    </svg>
                  </button>
                </div>
                {showAddressBook && (
                  <AddressBookPicker
                    onSelect={(contact) => {
                      setRecipient(contact.address);
                      setSelectedAlias(contact.name);
                      setTouched((p) => ({ ...p, recipient: true }));
                      setErrors((p) => ({
                        ...p,
                        recipient: validateRecipient(contact.address),
                      }));
                      setShowAddressBook(false);
                    }}
                    onClose={() => setShowAddressBook(false)}
                  />
                )}
              </div>
              {selectedAlias && (
                <p className="text-green-400 text-sm mt-1">
                  Saved contact: <span className="font-medium">{selectedAlias}</span>
                </p>
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
