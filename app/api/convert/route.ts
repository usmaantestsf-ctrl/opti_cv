import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { jsonError } from "@/lib/errors";
import { getUserFile, putUserFile } from "@/lib/storage";
import { convertDocxToPdf } from "@/lib/pdf/iloveapi";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user
    const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!cookie) {
      return jsonError("UNAUTHORIZED");
    }

    const session = await verifySession(cookie);
    if (!session) {
      return jsonError("UNAUTHORIZED");
    }

    const userId = session.uid;

    // 2. Load latest tailored DOCX
    const latestDocx = await getUserFile(`cv/${userId}/latest.docx`);
    if (!latestDocx) {
      return jsonError("NO_CV", "Tailor your CV first before converting to PDF.");
    }

    // 3. Convert via iLoveAPI fallback chain
    const result = await convertDocxToPdf(latestDocx);

    if (!result.ok) {
      return jsonError(result.code, result.message);
    }

    // 4. Save latest.pdf
    await putUserFile(`cv/${userId}/latest.pdf`, result.pdfBuffer, "application/pdf");

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[convert] Convert error:", err);
    return jsonError("INTERNAL");
  }
}
