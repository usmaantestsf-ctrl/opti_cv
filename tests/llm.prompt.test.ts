import { describe, it, expect } from "vitest";
import { buildUserPrompt, getSystemPrompt, getKnowledgeContent, BASE_SYSTEM_PROMPT } from "@/lib/llm/prompt";
import { Para } from "@/lib/docx/types";

describe("Prompt Builder & System Prompt", () => {
  describe("getSystemPrompt", () => {
    it("contains the base system prompt instructions", () => {
      const prompt = getSystemPrompt();
      expect(prompt).toContain("RULES");
      expect(prompt).toContain("OUTPUT JSON only");
    });

    it("injects knowledge.md into the system prompt when present", () => {
      const knowledge = getKnowledgeContent();
      const prompt = getSystemPrompt();

      if (knowledge) {
        expect(prompt).toContain("STYLE:");
        expect(prompt).toContain(knowledge);
      } else {
        expect(prompt).toBe(BASE_SYSTEM_PROMPT);
      }
    });
  });

  describe("buildUserPrompt", () => {
    it("sends only editable paragraphs and omits locked/structural ones", () => {
      const paras: Para[] = [
        {
          id: 0,
          text: "John Doe",
          style: "Heading1",
          isList: false,
          parentKey: "body",
          runCount: 1,
          mixedFormatting: false,
          locked: false,
        },
        {
          id: 1,
          text: "   ", // empty paragraph
          style: "Normal",
          isList: false,
          parentKey: "body",
          runCount: 1,
          mixedFormatting: false,
          locked: false,
        },
        {
          id: 2,
          text: "Built REST APIs in Node.js",
          style: "ListParagraph",
          isList: true,
          parentKey: "body",
          runCount: 1,
          mixedFormatting: false,
          locked: false,
        },
        {
          id: 3,
          text: "https://github.com/profile",
          style: "Normal",
          isList: false,
          parentKey: "body",
          runCount: 1,
          mixedFormatting: false,
          locked: true,
        },
      ];

      const jd = "Looking for a backend engineer proficient in Node.js and REST APIs.";
      const prompt = buildUserPrompt(paras, jd);

      // id 0 is "John Doe" with Heading1 → structural → NOT sent as a piped line
      expect(prompt).not.toContain("0|");
      // id 1 is empty → omitted
      expect(prompt).not.toContain("1|");
      // id 2 is an editable bullet
      expect(prompt).toContain("2|B|Built REST APIs in Node.js");
      // id 3 is locked → NOT sent
      expect(prompt).not.toContain("3|");
      // JD is included
      expect(prompt).toContain(jd);
    });

    it("truncates job descriptions longer than 3000 characters", () => {
      const paras: Para[] = [
        {
          id: 0,
          text: "Summary line",
          style: "Normal",
          isList: false,
          parentKey: "body",
          runCount: 1,
          mixedFormatting: false,
          locked: false,
        },
      ];

      const longJd = "A".repeat(4000);
      const prompt = buildUserPrompt(paras, longJd);

      expect(prompt).toContain("A".repeat(3000));
      expect(prompt).not.toContain("A".repeat(3001));
    });
  });
});
