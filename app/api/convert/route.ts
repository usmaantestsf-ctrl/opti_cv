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
      console.warn("[api/convert] Convert rejected: Missing session cookie");
      return jsonError("UNAUTHORIZED");
    }

    const session = await verifySession(cookie);
    if (!session) {
      console.warn("[api/convert] Convert rejected: Invalid session");
      return jsonError("UNAUTHORIZED");
    }

    const userId = session.uid;
    console.log(`[api/convert] PDF conversion requested by uid="${userId}"`);

    // 2. Load latest tailored DOCX
    const latestDocx = await getUserFile(`cv/${userId}/latest.docx`);
    if (!latestDocx) {
      console.warn(`[api/convert] latest.docx not found for uid="${userId}"`);
      return jsonError("NO_CV", "Tailor your CV first before converting to PDF.");
    }
    console.log(`[api/convert] Loaded latest.docx (${latestDocx.length} bytes) for conversion`);

    // 3. Convert via iLoveAPI fallback chain
    console.log(`[api/convert] Invoking iLoveAPI pipeline...`);
    const result = await convertDocxToPdf(latestDocx);

    if (!result.ok) {
      console.error(`[api/convert] iLoveAPI conversion failed: code=${result.code}, msg="${result.message}"`);
      return jsonError(result.code, result.message);
    }

    console.log(`[api/convert] iLoveAPI succeeded. PDF size: ${result.pdfBuffer.length} bytes. Saving latest.pdf...`);

    // 4. Save latest.pdf
    await putUserFile(`cv/${userId}/latest.pdf`, result.pdfBuffer, "application/pdf");

    console.log(`[api/convert] ✓ PDF converted & saved successfully for uid="${userId}"`);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[api/convert] Unexpected convert error:", err?.stack || err?.message || err);
    return jsonError("INTERNAL");
  }
}
