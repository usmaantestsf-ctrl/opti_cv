import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { jsonError } from "@/lib/errors";
import { getUserFile, putUserFile, deleteUserFile, getUserMeta, setUserMeta } from "@/lib/storage";
import { parseDocx } from "@/lib/docx/parse";
import { applyOperations } from "@/lib/docx/apply";
import { buildUserPrompt } from "@/lib/llm/prompt";
import { executeGroqFallbackChain } from "@/lib/llm/groq";

export const runtime = "nodejs";

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

    // 2. Parse request body
    const body = await request.json().catch(() => null);
    if (!body || typeof body.jd !== "string") {
      return jsonError("BAD_JD");
    }

    const jd = body.jd.trim();
    if (jd.length < 50 || jd.length > 8000) {
      return jsonError("BAD_JD");
    }

    const label =
      typeof body.label === "string" ? body.label.trim().slice(0, 60) : undefined;

    // 3. Load master CV
    const masterDocx = await getUserFile(`cv/${userId}/master.docx`);
    if (!masterDocx) {
      return jsonError("NO_CV");
    }

    // 4. Parse paragraphs
    let paragraphs;
    try {
      paragraphs = parseDocx(masterDocx);
    } catch {
      return jsonError("BAD_FILE");
    }

    // 5. Build prompt & call Groq fallback chain
    const userPrompt = buildUserPrompt(paragraphs, jd);
    const llmResult = await executeGroqFallbackChain(userPrompt);

    if (!llmResult.ok) {
      return jsonError(llmResult.code, llmResult.message);
    }

    // 6. Apply operations with safety engine
    const applyResult = applyOperations(masterDocx, llmResult.data.operations);

    // 7. Save latest.docx
    await putUserFile(
      `cv/${userId}/latest.docx`,
      applyResult.docx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );

    // 8. Delete previous latest.pdf if existing
    await deleteUserFile(`cv/${userId}/latest.pdf`);

    // 9. Update meta.json
    const meta = (await getUserMeta(userId)) || {
      originalFilename: "master.docx",
      uploadedAt: new Date().toISOString(),
    };

    meta.lastLabel = label || null;
    meta.lastTailoredAt = new Date().toISOString();
    meta.changes = llmResult.data.notes;
    await setUserMeta(userId, meta);

    return NextResponse.json({
      ok: true,
      changes: llmResult.data.notes,
      stats: applyResult.stats,
      warnings: applyResult.warnings,
    });
  } catch {
    return jsonError("INTERNAL");
  }
}
