import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { jsonError } from "@/lib/errors";
import { parseDocx } from "@/lib/docx/parse";
import { putUserFile, setUserMeta, UserMeta } from "@/lib/storage";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3 MB limit

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user from session
    const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!cookie) {
      return jsonError("UNAUTHORIZED");
    }

    const session = await verifySession(cookie);
    if (!session) {
      return jsonError("UNAUTHORIZED");
    }

    const userId = session.uid;

    // 2. Parse multipart form data
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return jsonError("BAD_FILE");
    }

    const file = formData.get("file") as File | null;
    if (!file || !(file instanceof File)) {
      return jsonError("BAD_FILE");
    }

    // 3. Validate file size (max 3 MB)
    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      return jsonError("BAD_FILE");
    }

    // 4. Validate extension
    const filename = file.name || "cv.docx";
    if (!filename.toLowerCase().endsWith(".docx")) {
      return jsonError("BAD_FILE");
    }

    // 5. Read buffer and validate zip + DOCX structure
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let paragraphs;
    try {
      paragraphs = parseDocx(buffer);
    } catch {
      return jsonError("BAD_FILE");
    }

    // 6. Check editable paragraphs (unlocked and non-empty text)
    const editableCount = paragraphs.filter(
      (p) => !p.locked && p.text.trim().length > 0
    ).length;

    if (editableCount === 0) {
      return jsonError("EMPTY_DOC");
    }

    // 7. Save master.docx with overwrite
    await putUserFile(
      `cv/${userId}/master.docx`,
      buffer,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );

    // 8. Update meta.json
    const meta: UserMeta = {
      originalFilename: filename,
      uploadedAt: new Date().toISOString(),
      lastLabel: null,
      lastTailoredAt: null,
      changes: [],
      editableParagraphs: editableCount,
    };
    await setUserMeta(userId, meta);

    return NextResponse.json({
      ok: true,
      filename,
      uploadedAt: meta.uploadedAt,
      editableParagraphs: editableCount,
    });
  } catch (err) {
    console.error("[cv] Upload error:", err);
    return jsonError("INTERNAL");
  }
}
