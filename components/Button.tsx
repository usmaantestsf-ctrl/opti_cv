import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  isLoading?: boolean;
}

export function Button({
  children,
  variant = "primary",
  isLoading = false,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles =
    "min-h-[48px] px-5 py-2.5 rounded-xl font-medium text-base inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed select-none";

  const variantStyles = {
    primary:
      "bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm active:bg-indigo-800",
    secondary:
      "border border-gray-300 dark:border-slate-600 bg-white/50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-800 dark:text-gray-100 active:bg-gray-200 dark:active:bg-slate-600",
    danger:
      "bg-red-600 hover:bg-red-700 text-white shadow-sm active:bg-red-800",
  };

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="inline-flex items-center gap-2">
          <svg
            className="animate-spin motion-reduce:animate-none h-5 w-5 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          <span>Loading…</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
