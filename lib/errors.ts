import { NextResponse } from "next/server";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "BAD_LOGIN"
  | "TOO_MANY_ATTEMPTS"
  | "NO_CV"
  | "BAD_FILE"
  | "EMPTY_DOC"
  | "BAD_JD"
  | "LLM_LIMIT_REACHED"
  | "LLM_KEYS_INVALID"
  | "LLM_BAD_OUTPUT"
  | "PDF_UNAVAILABLE"
  | "INTERNAL";

export const ERROR_MESSAGES: Record<ErrorCode, { status: number; message: string }> = {
  UNAUTHORIZED: { status: 401, message: "Please log in again." },
  BAD_LOGIN: { status: 401, message: "Wrong username or password." },
  TOO_MANY_ATTEMPTS: { status: 429, message: "Too many attempts. Try again in a few minutes." },
  NO_CV: { status: 400, message: "Upload your CV first." },
  BAD_FILE: { status: 400, message: "Please upload a .docx Word file under 3 MB." },
  EMPTY_DOC: { status: 400, message: "I couldn't find editable text in this file." },
  BAD_JD: { status: 400, message: "Paste a job description (at least 50 characters)." },
  LLM_LIMIT_REACHED: { status: 503, message: "AI limit reached on both accounts. Try again in a few minutes or tomorrow." },
  LLM_KEYS_INVALID: { status: 503, message: "AI keys are invalid. Check the server settings." },
  LLM_BAD_OUTPUT: { status: 502, message: "The AI returned something unusable. Please try again." },
  PDF_UNAVAILABLE: { status: 503, message: "PDF conversion is unavailable right now (monthly limit reached or keys not working)." },
  INTERNAL: { status: 500, message: "Something went wrong. Please try again." },
};

export function jsonError(code: ErrorCode, customMessage?: string, extraHeaders?: HeadersInit) {
  const { status, message } = ERROR_MESSAGES[code];
  return NextResponse.json(
    {
      ok: false,
      code,
      message: customMessage || message,
    },
    {
      status,
      headers: extraHeaders,
    }
  );
}
