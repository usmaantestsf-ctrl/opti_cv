import fs from "fs";
import path from "path";
import { Para } from "@/lib/docx/types";
import { markStructure } from "@/lib/docx/structural";

/**
 * Universal System Prompt — works across ANY industry, role, or CV format.
 * Instructs the LLM to aggressively and accurately tailor the CV to the target JD
 * while strictly preserving paragraph lengths and fact integrity.
 */
export const BASE_SYSTEM_PROMPT = `You are an expert executive CV tailor and ATS optimization specialist.
Tailor the CV paragraphs to directly match the target Job Description (JD).
Your edits must be impactful, noticeable, and targeted to the new role.

INPUT FORMAT:
Lines formatted as: id|flags|text
Flags:
- B = Bullet point or achievement line
- H = Headline role title
- - = Normal body line (Summary, skills, certifications)

HARD RULES:
1. Truthfulness: Only emphasize skills, tools, and experiences supported by the CV. Never invent tools, employers, dates, degrees, or quantitative metrics.
2. STRICT LENGTH & WORD COUNT PARITY (CRITICAL):
   - Every rewrite MUST match the character and word count of the original paragraph within ±10% (if original paragraph has N words, the tailored version must be N ± 10% words).
   - NEVER condense a detailed multi-sentence paragraph into a short snippet, and never inflate short lines with filler.
   - For bullets (B), keep the tailored text approximately the same character length as the original line.
3. Keep label prefixes (e.g. "Languages:", "Core Competencies:", "Tools:") verbatim at the start.
4. Active voice: Start rewritten bullets with powerful action verbs matching the JD (e.g., "Led", "Engineered", "Managed", "Streamlined", "Optimized", "Spearheaded", "Delivered").
5. Put the most critical JD keywords in the first 5 words of each rewritten bullet.

REQUIRED OPERATIONS:
1. HEADLINE (H line): Rewrite to the target role title + 1-2 core specialties from the CV matching the target job description. Max 70 chars.
2. PROFILE / SUMMARY: Comprehensively rewrite this paragraph to position the candidate for the target role, keeping the exact same length and sentence count as the original (within ±10%).
3. SKILLS LINES: Reorder the skills on each line so qualifications most relevant to the JD appear first.
4. EXPERIENCE BULLETS (B lines): In EVERY role, rewrite the 3-4 most relevant achievement bullets to highlight experience, tools, and responsibilities that directly match the target job description.
5. Delete at most 3 bullets total across the entire CV, only if clearly irrelevant.

OUTPUT JSON only, no markdown:
{"operations":[{"type":"rewrite","id":0,"text":"..."},{"type":"reorder","ids":[1,2]},{"type":"delete","id":5}],"notes":["short change description"]}`;

/**
 * Reads knowledge.md from disk (lib/llm/knowledge.md, then root knowledge.md).
 */
export function getKnowledgeContent(): string {
  const possiblePaths = [
    path.resolve(process.cwd(), "lib/llm/knowledge.md"),
    path.resolve(process.cwd(), "knowledge.md"),
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf-8").trim();
        if (content.length > 0) return content;
      }
    } catch {
      // try next path
    }
  }
  return "";
}

export function getSystemPrompt(): string {
  const knowledge = getKnowledgeContent();
  if (!knowledge) return BASE_SYSTEM_PROMPT;
  return `${BASE_SYSTEM_PROMPT}\n\nSTYLE:\n${knowledge}`;
}

export const SYSTEM_PROMPT = BASE_SYSTEM_PROMPT;

/**
 * Token-optimized user payload.
 * Emits section headings and editable paragraphs.
 * Tags bullets with 'B' flag so the LLM recognizes job achievement lines.
 */
export function buildUserPrompt(paras: Para[], jd: string): string {
  const truncatedJd = jd.length > 3000 ? jd.slice(0, 3000) : jd;

  const marks = markStructure(
    paras.map((p) => ({ id: p.id, text: p.text, style: p.style, isList: p.isList }))
  );

  const lines: string[] = [];

  for (const p of paras) {
    const text = p.text.trim();
    if (text.length === 0) continue;

    const mark = marks.get(p.id);

    // Emit section heading markers (e.g. "## EXPERIENCE") for LLM context
    if (mark?.heading) {
      lines.push(`## ${text.replace(/[:：]\s*$/, "").toUpperCase()}`);
      continue; // heading itself is structural
    }

    // Skip locked/structural paragraphs entirely (names, contacts, dates, company titles)
    if (p.locked || mark?.structural) continue;

    let flags = "";
    if (p.isList || mark?.isBullet) flags += "B";
    if (mark?.headline) flags += "H";
    if (flags === "") flags = "-";

    lines.push(`${p.id}|${flags}|${text}`);
  }

  const promptTokenEstimate = Math.ceil((lines.join("\n").length + truncatedJd.length) / 4);
  console.log(`[prompt] ${lines.length} editable lines, ~${promptTokenEstimate} user tokens`);

  return `## CV\n${lines.join("\n")}\n\n## TARGET JOB DESCRIPTION\n${truncatedJd}`;
}
