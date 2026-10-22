/**
 * Universal structure detection across ANY resume or CV format.
 * Deterministic and industry-agnostic (Tech, Healthcare, Finance, Law, Academia, Business, etc.).
 * Used by BOTH lib/llm/prompt.ts and lib/docx/apply.ts.
 */

export const CONTACT_RE =
  /@|https?:\/\/|www\.|linkedin\.com|github\.com|(\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}/i;

export const DATE_RE =
  /\b(19|20)\d{2}\b\s*(-|–|—|to)\s*((19|20)\d{2}|present|current|now)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(19|20)\d{2}/i;

export const SECTION_RE = new RegExp(
  "^(" +
    [
      "(professional\\s+|career\\s+|executive\\s+)?(summary|profile|objective|about(\\s+me)?)",
      "career\\s+objective",
      "((technical|core|key|professional)\\s+)?skills(\\s*(&|and)\\s*(tools|technologies|competencies))?",
      "technical\\s+proficiency|tech(nology)?\\s+stack|core\\s+competencies|competencies|areas\\s+of\\s+expertise",
      "((work|professional|relevant|employment|clinical|teaching|academic)\\s+)?(experience|history)",
      "work\\s+history|professional\\s+background|employment(\\s+history)?",
      "projects?|personal\\s+projects?|key\\s+projects?",
      "education(\\s*(&|and)\\s*(training|credentials))?",
      "certifications?|licenses?|credentials?|courses|achievements?|awards?|languages|interests|references|publications?|volunteer(ing)?",
    ].join("|") +
    ")$",
  "i"
);

export interface ParaLite {
  id: number;
  text: string;
  style: string | null;
  isList: boolean;
}

export interface Mark {
  /** Must never be edited, deleted or reordered (name, contacts, headings, company/date lines). */
  structural: boolean;
  /** The headline/title line under the name. Editable. */
  headline: boolean;
  /** A section heading line (SUMMARY, SKILLS, EXPERIENCE...). */
  heading: boolean;
  /** True if this is a bullet or experience achievement item. */
  isBullet: boolean;
}

export function isHeading(text: string, style: string | null): boolean {
  const t = text.replace(/[:：]\s*$/, "").trim();
  if (SECTION_RE.test(t)) return true;
  return /^heading/i.test(style || "") && t.length <= 40;
}

/**
 * Classifies every paragraph. Deterministic: same input -> same marks.
 * Works universally across any CV format or industry.
 */
export function markStructure(paras: ParaLite[]): Map<number, Mark> {
  const out = new Map<number, Mark>();
  let nonEmpty = 0;
  let seenSection = false;
  let headlineFound = false;
  let currentSection = "";

  // Pre-scan for dates and headings
  const scan = paras.map((p) => {
    const text = p.text.trim();
    if (!text) return { heading: false, hasDate: false, hasContact: false };
    return {
      heading: isHeading(text, p.style),
      hasDate: DATE_RE.test(text),
      hasContact: CONTACT_RE.test(text),
    };
  });

  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const text = p.text.trim();
    if (!text) {
      out.set(p.id, { structural: false, headline: false, heading: false, isBullet: false });
      continue;
    }
    nonEmpty++;

    const { heading, hasDate, hasContact } = scan[i];
    if (heading) {
      seenSection = true;
      currentSection = text.toUpperCase();
    }

    let structural = false;
    if (nonEmpty === 1) {
      // First non-empty line is universally the candidate name
      structural = true;
    } else if (heading) {
      // Section dividers
      structural = true;
    } else if (/^(heading|title)/i.test(p.style || "")) {
      structural = true;
    } else if (!p.isList && text.length <= 140 && (hasContact || hasDate)) {
      // Direct contact or date line
      structural = true;
    } else if (
      !p.isList &&
      text.length <= 80 &&
      !/^[•–\-*▪▫➢—]/.test(text) &&
      !/[.!?]$/.test(text) &&
      currentSection.includes("EXPERIENCE") &&
      (scan[i - 1]?.hasDate || scan[i + 1]?.hasDate || scan[i + 2]?.hasDate || scan[i - 2]?.hasDate)
    ) {
      // Universal employer or job title line: short, non-sentence, adjacent to date line
      structural = true;
    }

    let headline = false;
    if (
      !seenSection &&
      !headlineFound &&
      nonEmpty >= 2 &&
      !structural &&
      !p.isList &&
      text.length <= 100
    ) {
      headline = true;
      headlineFound = true;
    }

    // Detect if this is an experience bullet/achievement item
    const startsWithBulletChar = /^([•–\-*▪▫➢—]|[\d]+\.)\s+/.test(text);
    const isExperienceItem =
      !structural &&
      !headline &&
      !heading &&
      currentSection.includes("EXPERIENCE") &&
      text.length >= 25;

    const isBullet = p.isList || startsWithBulletChar || isExperienceItem;

    out.set(p.id, { structural, headline, heading, isBullet });
  }
  return out;
}
