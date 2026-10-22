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

    if (!ALLOWED_FILES.includes(filename)) {
      return jsonError("BAD_FILE", "Invalid file requested.");
    }

    const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!cookie) {
      return jsonError("UNAUTHORIZED");
    }

    const session = await verifySession(cookie);
    if (!session) {
      return jsonError("UNAUTHORIZED");
    }

    const userId = session.uid;
    const fileBuffer = await getUserFile(`cv/${userId}/${filename}`);
    if (!fileBuffer) {
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

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Content-Length": fileBuffer.length.toString(),
      },
    });
  } catch {
    return jsonError("INTERNAL");
  }
}
