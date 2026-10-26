import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { jsonError } from "@/lib/errors";
import { getUserFile, getUserMeta } from "@/lib/storage";

export const runtime = "nodejs";

const ALLOWED_FILES = ["master.docx", "latest.docx", "latest.pdf"];

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name: filename } = await params;
    console.log(`[api/files] File request: filename="${filename}"`);

    if (!ALLOWED_FILES.includes(filename)) {
      console.warn(`[api/files] Invalid file requested: "${filename}"`);
      return jsonError("BAD_FILE", "Invalid file requested.");
    }

    const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!cookie) {
      console.warn("[api/files] Download rejected: Missing session cookie");
      return jsonError("UNAUTHORIZED");
    }

    const session = await verifySession(cookie);
    if (!session) {
      console.warn("[api/files] Download rejected: Invalid session");
      return jsonError("UNAUTHORIZED");
    }

    const userId = session.uid;
    const fileBuffer = await getUserFile(`cv/${userId}/${filename}`);
    if (!fileBuffer) {
      console.warn(`[api/files] File not found: "cv/${userId}/${filename}"`);
      return jsonError("BAD_FILE", "File not found.");
    }

    const meta = await getUserMeta(userId);
    const dateStr = new Date().toISOString().slice(0, 10);
    const extension = filename.endsWith(".pdf") ? "pdf" : "docx";
    const label = meta?.lastLabel ? sanitizeFilename(meta.lastLabel) : "Tailored";
    const downloadName = `${sanitizeFilename(session.name)}_CV_${label}_${dateStr}.${extension}`;

    const contentType = extension === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    console.log(`[api/files] ✓ Serving "${downloadName}" (${fileBuffer.length} bytes, uid="${userId}")`);

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Content-Length": fileBuffer.length.toString(),
      },
    });
  } catch (err: any) {
    console.error("[api/files] Unexpected file download error:", err?.stack || err?.message || err);
    return jsonError("INTERNAL");
  }
}
