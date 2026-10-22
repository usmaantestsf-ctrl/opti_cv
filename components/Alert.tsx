import React from "react";

export interface AlertProps {
  type?: "error" | "warning" | "info" | "success";
  message: string;
  className?: string;
}

export function Alert({ type = "error", message, className = "" }: AlertProps) {
  const styles = {
    error:
      "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900",
    warning:
      "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900",
    info:
      "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900",
    success:
      "bg-green-50 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-200 dark:border-green-900",
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`rounded-xl border p-4 text-sm ${styles[type]} ${className}`}
    >
      {message}
    </div>
  );
}
