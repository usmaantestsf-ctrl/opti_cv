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
      console.warn("[api/cv] Upload rejected: Missing session cookie");
      return jsonError("UNAUTHORIZED");
    }

    const session = await verifySession(cookie);
    if (!session) {
      console.warn("[api/cv] Upload rejected: Invalid session");
      return jsonError("UNAUTHORIZED");
    }

    const userId = session.uid;
    console.log(`[api/cv] Upload initiated by uid="${userId}" (name="${session.name}")`);

    // 2. Parse multipart form data
    const formData = await request.formData().catch((err) => {
      console.error("[api/cv] Failed to parse formData:", err?.message || err);
      return null;
    });
    if (!formData) {
      return jsonError("BAD_FILE");
    }

    const file = formData.get("file") as File | null;
    if (!file || !(file instanceof File)) {
      console.warn("[api/cv] No valid file provided in formData");
      return jsonError("BAD_FILE");
    }

    console.log(`[api/cv] Received file: name="${file.name}", size=${file.size} bytes, type="${file.type}"`);

    // 3. Validate file size (max 3 MB)
    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      console.warn(`[api/cv] File size rejected: ${file.size} bytes (max ${MAX_FILE_SIZE})`);
      return jsonError("BAD_FILE");
    }

    // 4. Validate extension
    const filename = file.name || "cv.docx";
    if (!filename.toLowerCase().endsWith(".docx")) {
      console.warn(`[api/cv] Non-DOCX extension rejected: "${filename}"`);
      return jsonError("BAD_FILE");
    }

    // 5. Read buffer and validate zip + DOCX structure
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let paragraphs;
    try {
      paragraphs = parseDocx(buffer);
      console.log(`[api/cv] Parsed DOCX: total=${paragraphs.length} paragraphs`);
    } catch (err: any) {
      console.error("[api/cv] parseDocx failed:", err?.message || err);
      return jsonError("BAD_FILE");
    }

    // 6. Check editable paragraphs (unlocked and non-empty text)
    const editableCount = paragraphs.filter(
      (p) => !p.locked && p.text.trim().length > 0
    ).length;

    console.log(`[api/cv] Editable paragraphs count: ${editableCount} of ${paragraphs.length}`);

    if (editableCount === 0) {
      console.warn("[api/cv] Rejected: No editable paragraphs found in document");
      return jsonError("EMPTY_DOC");
    }

    // 7. Save master.docx with overwrite
    console.log(`[api/cv] Saving master.docx for uid="${userId}"...`);
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

    console.log(`[api/cv] ✓ Upload complete for uid="${userId}": filename="${filename}", editableParagraphs=${editableCount}`);

    return NextResponse.json({
      ok: true,
      filename,
      uploadedAt: meta.uploadedAt,
      editableParagraphs: editableCount,
    });
  } catch (err: any) {
    console.error("[api/cv] Unexpected upload error:", err?.stack || err?.message || err);
    return jsonError("INTERNAL");
  }
}
