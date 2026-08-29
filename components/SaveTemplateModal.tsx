"use client";

import { useState } from "react";
import { saveTemplate } from "@/src/lib/streamTemplates";
import { useToast } from "@/src/lib/toast";

interface SaveTemplateModalProps {
  open: boolean;
  onClose: () => void;
  // Parameters extracted from the stream
  durationSeconds: number;
  amount?: string;
  recipient?: string;
  token?: string;
  cliffDate?: string;
}

export default function SaveTemplateModal({
  open,
  onClose,
  durationSeconds,
  amount,
  recipient,
  token,
  cliffDate,
}: SaveTemplateModalProps) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const { addToast } = useToast();

  if (!open) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;

    const days = Math.floor(durationSeconds / 86400);
    const hours = Math.floor((durationSeconds % 86400) / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);

    const result = saveTemplate({
      label: label.trim(),
      description: description.trim() || label.trim(),
      days,
      hours,
      minutes,
      suggestedAmount: amount,
      recipient,
      token,
      cliffDate,
    });

    if (result) {
      addToast("Template saved successfully!", "success");
      onClose();
    } else {
      addToast("Failed to save template. You may have reached the maximum limit.", "error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-template-title"
    >
      <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 id="save-template-title" className="text-xl font-bold text-white mb-4">
          Save as Template
        </h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="template-label" className="block text-sm font-medium text-gray-300 mb-1">
              Template Name
            </label>
            <input
              id="template-label"
              type="text"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Weekly Contributor Payout"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            />
          </div>
          <div>
            <label htmlFor="template-desc" className="block text-sm font-medium text-gray-300 mb-1">
              Description (Optional)
            </label>
            <input
              id="template-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description..."
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            />
          </div>
          
          <div className="pt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!label.trim()}
              className="px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
