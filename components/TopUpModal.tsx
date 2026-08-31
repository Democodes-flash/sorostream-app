"use client";

import { useState, useRef, useEffect } from "react";
import { useFocusTrap } from "@/src/lib/useFocusTrap";

interface TopUpModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (amount: string) => Promise<void>;
  token: string;
  loading?: boolean;
}

export default function TopUpModal({
  open,
  onClose,
  onConfirm,
  token,
  loading = false,
}: TopUpModalProps) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useFocusTrap(modalRef, open);

  // Focus input when modal opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const handleConfirm = async () => {
    const parsedAmount = parseFloat(amount);
    if (!amount || parsedAmount <= 0) {
      setError("Please enter a valid amount greater than 0");
      return;
    }
    setError("");
    try {
      await onConfirm(amount);
      setAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to top-up stream");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) {
      void handleConfirm();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="topup-modal-title"
        aria-describedby="topup-modal-description"
        className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 space-y-4"
      >
        <h2 id="topup-modal-title" className="text-lg font-semibold text-white">
          Top Up Stream
        </h2>
        <p id="topup-modal-description" className="text-gray-400 text-sm">
          Enter the amount of {token} to add to this stream. This will extend the
          stream's duration or increase the flow rate.
        </p>

        <div className="space-y-2">
          <label htmlFor="topup-amount" className="text-gray-200 text-sm font-medium block">
            Amount ({token})
          </label>
          <input
            ref={inputRef}
            id="topup-amount"
            type="number"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError("");
            }}
            onKeyDown={handleKeyDown}
            placeholder={`Enter amount in ${token}`}
            min="0"
            step="0.01"
            disabled={loading}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:opacity-50"
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? "topup-error" : undefined}
          />
          {error && (
            <p id="topup-error" className="text-red-400 text-xs" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 border border-gray-600 text-gray-300 py-2 rounded-lg hover:bg-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={loading || !amount || parseFloat(amount) <= 0}
            className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg
                  className="animate-spin h-4 w-4 inline-block"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Topping up…
              </>
            ) : (
              "Confirm Top-up"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
