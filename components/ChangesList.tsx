import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface ChangesListProps {
  notes: string[];
  stats?: {
    reorderedCount?: number;
    rewrittenCount?: number;
    deletedCount?: number;
    charDelta?: number;
  };
}

export function ChangesList({ notes, stats }: ChangesListProps) {
  const [isOpen, setIsOpen] = useState(false);

  const totalChanges = notes.length;

  return (
    <div className="border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-800/60 shadow-sm">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-left font-medium text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
      >
        <span className="flex items-center gap-2">
          {isOpen ? <ChevronDown className="h-4 w-4 text-gray-500 dark:text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-500 dark:text-gray-400" />}
          <span>What changed ({totalChanges})</span>
        </span>
        {stats && (
          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            {stats.charDelta !== undefined && (
              <span>{stats.charDelta > 0 ? `+${stats.charDelta}` : stats.charDelta} chars</span>
            )}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="p-4 border-t border-gray-100 dark:border-slate-700/80 bg-gray-50/50 dark:bg-slate-900/40 text-sm space-y-3">
          {stats && (
            <div className="grid grid-cols-3 gap-2 pb-2 text-xs text-center border-b border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300">
              <div>
                <span className="block font-semibold text-gray-900 dark:text-white">
                  {stats.reorderedCount ?? 0}
                </span>
                Reordered
              </div>
              <div>
                <span className="block font-semibold text-gray-900 dark:text-white">
                  {stats.rewrittenCount ?? 0}
                </span>
                Rewritten
              </div>
              <div>
                <span className="block font-semibold text-gray-900 dark:text-white">
                  {stats.deletedCount ?? 0}
                </span>
                Removed
              </div>
            </div>
          )}

          {notes.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 italic">No modifications reported.</p>
          ) : (
            <ul className="list-disc list-inside space-y-1.5 text-xs text-gray-700 dark:text-gray-300">
              {notes.map((note, index) => (
                <li key={index} className="leading-relaxed">
                  {note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
