"use client";

import React, { useEffect, useState, useRef } from "react";
import {
  LogOut,
  User,
  FileText,
  RefreshCw,
  CheckCircle2,
  Download,
  Sparkles,
  FileType,
  Share2,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Alert } from "@/components/Alert";
import { Spinner } from "@/components/Spinner";
import { FileDrop } from "@/components/FileDrop";
import { ChangesList } from "@/components/ChangesList";

interface UserMeta {
  originalFilename: string;
  uploadedAt: string;
  lastLabel?: string | null;
  lastTailoredAt?: string | null;
  changes?: string[];
  editableParagraphs?: number;
}

interface UserProfile {
  uid: string;
  name: string;
  hasCv: boolean;
  hasTailored?: boolean;
  hasPdf?: boolean;
  meta: UserMeta | null;
}

interface TailorStats {
  reorderedCount?: number;
  rewrittenCount?: number;
  deletedCount?: number;
  charDelta?: number;
}

export default function HomePage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  // Tailor state
  const [label, setLabel] = useState("");
  const [jd, setJd] = useState("");
  const [isTailoring, setIsTailoring] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);
  const [tailorStats, setTailorStats] = useState<TailorStats | null>(null);
  const [tailorNotes, setTailorNotes] = useState<string[]>([]);
  const [hasTailoredResult, setHasTailoredResult] = useState(false);

  // PDF Conversion state
  const [hasPdfResult, setHasPdfResult] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [pdfUnavailable, setPdfUnavailable] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  const replaceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check navigator.share availability on client
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      setCanShare(true);
    }

    async function loadUser() {
      try {
        const res = await fetch("/api/me");
        if (!res.ok) {
          window.location.href = "/login";
          return;
        }
        const data = await res.json();
        setUser(data);

        if (data?.hasTailored || data?.meta?.lastTailoredAt) {
          setHasTailoredResult(true);
          if (data.meta?.changes) {
            setTailorNotes(data.meta.changes);
          }
        }

        if (data?.hasPdf) {
          setHasPdfResult(true);
        }
      } catch {
        window.location.href = "/login";
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, []);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploadError(null);
    setUploadSuccess(null);

    if (!file.name.toLowerCase().endsWith(".docx")) {
      setUploadError("Please upload a .docx Word file under 3 MB.");
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      setUploadError("Please upload a .docx Word file under 3 MB.");
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/cv", {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setUploadError(data?.message || "Failed to upload CV. Please try again.");
        setIsUploading(false);
        return;
      }

      setUploadSuccess(`Found ${data.editableParagraphs} editable paragraphs.`);
      setUser((prev) =>
        prev
          ? {
              ...prev,
              hasCv: true,
              meta: {
                originalFilename: data.filename,
                uploadedAt: data.uploadedAt,
                editableParagraphs: data.editableParagraphs,
              },
            }
          : null
      );
    } catch {
      setUploadError("Network error while uploading. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleTailorSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isTailoring) return;

    if (!user?.hasCv) {
      setTailorError("Upload your CV first.");
      return;
    }

    const trimmedJd = jd.trim();
    if (trimmedJd.length < 50) {
      setTailorError("Paste a job description (at least 50 characters).");
      return;
    }

    setTailorError(null);
    setIsTailoring(true);
    setPdfUnavailable(false);
    setHasPdfResult(false);

    try {
      const res = await fetch("/api/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jd: trimmedJd,
          label: label.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setTailorError(data?.message || "Something went wrong while tailoring. Please try again.");
        setIsTailoring(false);
        return;
      }

      // Success
      setTailorNotes(data.changes || []);
      setTailorStats(data.stats || null);
      setHasTailoredResult(true);
    } catch {
      setTailorError("Network error while communicating with AI. Please try again.");
    } finally {
      setIsTailoring(false);
    }
  };

  const handleConvertToPdf = async () => {
    if (isConverting) return;
    setConvertError(null);
    setPdfUnavailable(false);
    setIsConverting(true);

    try {
      const res = await fetch("/api/convert", { method: "POST" });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        if (data?.code === "PDF_UNAVAILABLE" || res.status === 503) {
          setPdfUnavailable(true);
        } else {
          setConvertError(data?.message || "PDF conversion failed.");
        }
        return;
      }

      setHasPdfResult(true);
    } catch {
      setPdfUnavailable(true);
    } finally {
      setIsConverting(false);
    }
  };

  const handleDownloadDocx = () => {
    window.location.href = "/api/files/latest.docx";
  };

  const handleDownloadPdf = () => {
    window.location.href = "/api/files/latest.pdf";
  };

  const handleSharePdf = async () => {
    try {
      const res = await fetch("/api/files/latest.pdf");
      if (!res.ok) return;
      const blob = await res.blob();
      const fileName = `${user?.name || "User"}_Tailored_CV.pdf`;
      const file = new File([blob], fileName, { type: "application/pdf" });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "Tailored CV",
        });
      } else {
        await navigator.share({
          title: "Tailored CV",
          url: window.location.href,
        });
      }
    } catch {
      // User cancelled or share unhandled
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return isoString;
    }
  };

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center p-4 min-h-dvh">
        <Spinner size="lg" label="Loading application..." />
      </main>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-dvh bg-gray-50 dark:bg-slate-900 pb-24 lg:pb-8">
      {/* Top bar (sticky) */}
      <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm border-b border-gray-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-base tracking-tight text-gray-900 dark:text-white">
              CV Tailor
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
              <User className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              <span>Hi, {user?.name || "User"}</span>
            </span>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              title="Log out"
              aria-label="Log out"
              className="min-h-[44px] min-w-[44px] p-2.5 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 inline-flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container: 1 col on mobile/tablet (max-w-xl), 2 col on lg (max-w-5xl) */}
      <main className="flex-1 max-w-xl lg:max-w-5xl w-full mx-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Left Column: CV Card + Job Description */}
        <div className="flex flex-col gap-5 w-full">
          {/* ① Card: Your CV */}
          <Card className="shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xs font-bold">
                  1
                </span>
                Your CV
              </h2>
              {user?.hasCv && (
                <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Uploaded
                </span>
              )}
            </div>

            {!user?.hasCv ? (
              <div className="space-y-3">
                <FileDrop
                  onFileSelect={handleFileUpload}
                  disabled={isUploading}
                  isUploading={isUploading}
                />
                {isUploading && (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-300 pt-1">
                    <Spinner size="sm" />
                    <span>Checking document and editable paragraphs…</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start justify-between p-3.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/40">
                  <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                    <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 shrink-0">
                      <FileText className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 overflow-hidden">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {user.meta?.originalFilename || "my_cv.docx"}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                        Uploaded {formatDate(user.meta?.uploadedAt)}
                        {user.meta?.editableParagraphs !== undefined && (
                          <span> · {user.meta.editableParagraphs} paragraphs</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <input
                    ref={replaceInputRef}
                    type="file"
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                    disabled={isUploading}
                  />

                  <Button
                    variant="secondary"
                    onClick={() => replaceInputRef.current?.click()}
                    disabled={isUploading}
                    className="text-xs px-3.5 py-2 min-h-[44px] shrink-0"
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    Replace CV
                  </Button>
                </div>

                {isUploading && (
                  <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                    <Spinner size="sm" />
                    <span>Replacing CV…</span>
                  </div>
                )}
              </div>
            )}

            {uploadError && <Alert type="error" message={uploadError} className="mt-3" />}
            {uploadSuccess && <Alert type="success" message={uploadSuccess} className="mt-3" />}
          </Card>

          {/* ② Card: Job Description */}
          <Card className={`shadow-sm ${!user?.hasCv ? "opacity-60" : ""}`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xs font-bold">
                  2
                </span>
                Job Description
              </h2>
              {!user?.hasCv && (
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  Upload CV in step 1 first
                </span>
              )}
            </div>

            <form onSubmit={handleTailorSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="job-label"
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Role or company (optional, max 60 chars)
                </label>
                <input
                  id="job-label"
                  type="text"
                  maxLength={60}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  disabled={!user?.hasCv || isTailoring}
                  placeholder="e.g. Acme Senior Engineer"
                  className="w-full px-3.5 py-2 rounded-xl border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base transition-colors disabled:opacity-60"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="job-desc"
                    className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    Job description (required)
                  </label>
                  <span
                    className={`text-xs ${
                      jd.length > 8000
                        ? "text-red-500 font-semibold"
                        : jd.length < 50 && jd.length > 0
                        ? "text-amber-500 font-medium"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
                  >
                    {jd.length.toLocaleString()} / 8,000
                    {jd.length < 50 && " (min 50 chars)"}
                  </span>
                </div>
                <textarea
                  id="job-desc"
                  rows={8}
                  maxLength={8000}
                  required
                  value={jd}
                  onChange={(e) => setJd(e.target.value)}
                  disabled={!user?.hasCv || isTailoring}
                  placeholder="Paste the job description here (at least 50 characters)…"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-base transition-colors resize-y disabled:opacity-60 font-sans"
                />
              </div>

              {tailorError && <Alert type="error" message={tailorError} />}

              {isTailoring && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-xs">
                  <Spinner size="sm" />
                  <span>Tailoring your CV… this takes about 10 to 20 seconds.</span>
                </div>
              )}

              {/* Desktop inline tailor button */}
              <div className="hidden lg:block pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={isTailoring}
                  disabled={isTailoring || !user?.hasCv}
                  className="w-full"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Tailor my CV
                </Button>
              </div>
            </form>
          </Card>
        </div>

        {/* Right Column: Card ③ Result */}
        <div className="w-full">
          <Card
            className={`shadow-sm transition-opacity ${
              !hasTailoredResult && !isTailoring ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-xs font-bold">
                  3
                </span>
                Result
              </h2>
              {hasTailoredResult && (
                <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Tailored CV ready
                </span>
              )}
            </div>

            {!hasTailoredResult && !isTailoring ? (
              <div className="p-6 text-center text-gray-400 dark:text-gray-500 text-xs border border-dashed border-gray-200 dark:border-slate-700 rounded-xl">
                Paste a job description and tap Tailor to generate your tailored CV.
              </div>
            ) : (
              <div className="space-y-4">
                {tailorNotes.length > 0 && (
                  <ChangesList notes={tailorNotes} stats={tailorStats || undefined} />
                )}

                {/* PDF Conversion Error Alert */}
                {convertError && <Alert type="error" message={convertError} />}

                {/* Fallback Panel (FR-8) when PDF is unavailable */}
                {pdfUnavailable && (
                  <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-4 text-xs space-y-3 text-amber-900 dark:text-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <p className="font-medium">
                        PDF conversion is unavailable right now (monthly limit reached or keys not working). You can convert it yourself in under a minute:
                      </p>
                    </div>

                    <ol className="list-decimal list-inside space-y-1.5 pl-1 text-gray-700 dark:text-gray-300">
                      <li>Download your tailored Word document below.</li>
                      <li>Open the free iLovePDF converter in your browser.</li>
                      <li>Upload the downloaded file there, convert, and download the PDF.</li>
                    </ol>

                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <Button
                        onClick={handleDownloadDocx}
                        variant="primary"
                        className="text-xs py-2 min-h-[40px] flex-1"
                      >
                        <Download className="h-3.5 w-3.5 mr-1.5" />
                        Download DOCX
                      </Button>
                      <a
                        href="https://www.ilovepdf.com/word_to_pdf"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[40px] px-4 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-gray-800 dark:text-white font-medium text-xs inline-flex items-center justify-center hover:bg-amber-50 dark:hover:bg-slate-700 transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        Open iLovePDF
                      </a>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="pt-2 flex flex-col gap-2.5">
                  {/* If PDF converted successfully: primary is Download PDF + Share */}
                  {hasPdfResult ? (
                    <>
                      <Button
                        onClick={handleDownloadPdf}
                        variant="primary"
                        className="w-full text-sm font-semibold shadow-sm"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download PDF
                      </Button>

                      {canShare && (
                        <Button
                          onClick={handleSharePdf}
                          variant="secondary"
                          className="w-full text-sm font-medium"
                        >
                          <Share2 className="h-4 w-4 mr-2" />
                          Share PDF
                        </Button>
                      )}

                      <Button
                        onClick={handleDownloadDocx}
                        variant="secondary"
                        className="w-full text-sm font-medium"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download DOCX
                      </Button>
                    </>
                  ) : (
                    <>
                      {/* Before PDF conversion: primary is Download DOCX + Convert to PDF */}
                      {!pdfUnavailable && (
                        <>
                          <Button
                            onClick={handleDownloadDocx}
                            variant="primary"
                            className="w-full text-sm font-semibold shadow-sm"
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download DOCX
                          </Button>

                          <Button
                            onClick={handleConvertToPdf}
                            variant="secondary"
                            isLoading={isConverting}
                            disabled={isConverting}
                            className="w-full text-sm font-medium"
                          >
                            <FileType className="h-4 w-4 mr-2" />
                            {isConverting ? "Converting to PDF…" : "Convert to PDF"}
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      </main>

      {/* Sticky Bottom Action Bar for Mobile (Hidden on lg) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-20 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-gray-200 dark:border-slate-800 p-3 pb-safe shadow-lg">
        <div className="max-w-xl mx-auto">
          <Button
            type="button"
            onClick={() => handleTailorSubmit()}
            variant="primary"
            isLoading={isTailoring}
            disabled={isTailoring || !user?.hasCv}
            className="w-full shadow-md"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            {isTailoring ? "Tailoring…" : "Tailor my CV"}
          </Button>
        </div>
      </div>
    </div>
  );
}
