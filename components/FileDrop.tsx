import React, { useRef } from "react";
import { UploadCloud } from "lucide-react";

export interface FileDropProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
  isUploading?: boolean;
}

export function FileDrop({ onFileSelect, disabled = false, isUploading = false }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled || isUploading) return;
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      onFileSelect(files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFileSelect(files[0]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || isUploading) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  return (
    <div
      role="button"
      tabIndex={disabled || isUploading ? -1 : 0}
      aria-label="Upload your .docx CV"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onKeyDown={handleKeyDown}
      onClick={() => {
        if (!disabled && !isUploading) {
          inputRef.current?.click();
        }
      }}
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 select-none ${
        disabled || isUploading
          ? "border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30 cursor-not-allowed opacity-60"
          : "border-gray-300 dark:border-slate-600 hover:border-indigo-500 dark:hover:border-indigo-400 bg-gray-50/30 dark:bg-slate-800/50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleChange}
        disabled={disabled || isUploading}
      />
      <div className="flex flex-col items-center justify-center gap-2">
        <UploadCloud className="h-10 w-10 text-gray-400 dark:text-slate-500" />
        <p className="text-base font-medium text-gray-900 dark:text-white">
          Tap or drag to upload your .docx CV
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Word .docx files under 3 MB
        </p>
      </div>
    </div>
  );
}
