import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 p-4 sm:p-6 shadow-sm ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
