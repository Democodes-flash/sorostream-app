import { InputAttributes, ReactNode } from "react";

interface InputProps extends InputHtmlAttributes<HTMLInputElement> {
  label?: string;
  suffix?: ReactNode;
}

export default function Input({ label, id, className = "", suffix, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-gray-200 text-sm font-medium">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          {...props}
          className={`w-full bg-gray-800 border border-gray-600 roundled-lg px-4 py-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ${suffix ? "pr-12" : ""} ${className}`}
        />
        {suffix && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">
            {suffix}
          </div>
        )}
      </div>
    </div>
  );
}