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
      console.warn("[api/tailor] Tailor rejected: Missing session cookie");
      return jsonError("UNAUTHORIZED");
    }

    const session = await verifySession(cookie);
    if (!session) {
      console.warn("[api/tailor] Tailor rejected: Invalid session");
      return jsonError("UNAUTHORIZED");
    }

    const userId = session.uid;

    // 2. Parse request body
    const body = await request.json().catch(() => null);
    if (!body || typeof body.jd !== "string") {
      console.warn(`[api/tailor] Invalid body payload from uid="${userId}"`);
      return jsonError("BAD_JD");
    }

    const jd = body.jd.trim();
    if (jd.length < 50 || jd.length > 8000) {
      console.warn(`[api/tailor] Invalid JD length (${jd.length} chars) from uid="${userId}" (must be 50-8000)`);
      return jsonError("BAD_JD");
    }

    const label =
      typeof body.label === "string" ? body.label.trim().slice(0, 60) : undefined;

    console.log(`[api/tailor] Tailor request started: uid="${userId}", label="${label || 'none'}", jdLength=${jd.length} chars`);

    // 3. Load master CV
    const masterDocx = await getUserFile(`cv/${userId}/master.docx`);
    if (!masterDocx) {
      console.warn(`[api/tailor] Master CV not found for uid="${userId}"`);
      return jsonError("NO_CV");
    }
    console.log(`[api/tailor] Loaded master CV: ${masterDocx.length} bytes`);

    // 4. Parse paragraphs
    let paragraphs;
    try {
      paragraphs = parseDocx(masterDocx);
      const editableCount = paragraphs.filter((p) => !p.locked && p.text.trim().length > 0).length;
      console.log(`[api/tailor] Master CV parsed: total=${paragraphs.length} paragraphs, editable=${editableCount}`);
    } catch (err: any) {
      console.error("[api/tailor] parseDocx failed on master CV:", err?.message || err);
      return jsonError("BAD_FILE");
    }

    // 5. Build prompt & call Groq fallback chain
    console.log(`[api/tailor] Building prompt and calling Groq fallback chain...`);
    const userPrompt = buildUserPrompt(paragraphs, jd);
    const llmResult = await executeGroqFallbackChain(userPrompt);

    if (!llmResult.ok) {
      console.error(`[api/tailor] Groq chain failed: code=${llmResult.code}, msg="${llmResult.message}"`);
      return jsonError(llmResult.code, llmResult.message);
    }

    console.log(`[api/tailor] Groq chain succeeded in ${llmResult.attemptsUsed} attempt(s). Operations: ${llmResult.data.operations.length}, notes: ${llmResult.data.notes.length}`);

    // 6. Apply operations with safety engine
    console.log(`[api/tailor] Applying ${llmResult.data.operations.length} operations to DOCX...`);
    const applyResult = applyOperations(masterDocx, llmResult.data.operations);
    console.log(`[api/tailor] Operations applied: rewrites=${applyResult.stats.rewrittenCount}, deletes=${applyResult.stats.deletedCount}, reorders=${applyResult.stats.reorderedCount}, charDelta=${applyResult.stats.charDelta}`);
    if (applyResult.warnings.length > 0) {
      console.log(`[api/tailor] Apply warnings: ${applyResult.warnings.join("; ")}`);
    }

    // 7. Save latest.docx
    console.log(`[api/tailor] Saving tailored latest.docx (${applyResult.docx.length} bytes)...`);
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

    console.log(`[api/tailor] ✓ Tailor complete for uid="${userId}"`);

    return NextResponse.json({
      ok: true,
      changes: llmResult.data.notes,
      stats: applyResult.stats,
      warnings: applyResult.warnings,
    });
  } catch (err: any) {
    console.error("[api/tailor] Unexpected tailor error:", err?.stack || err?.message || err);
    return jsonError("INTERNAL");
  }
}
