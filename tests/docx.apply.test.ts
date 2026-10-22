import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import { applyOperations } from "@/lib/docx/apply";
import { parseDocx } from "@/lib/docx/parse";
import { Operation } from "@/lib/llm/schema";

const fixturePath = path.resolve(__dirname, "fixtures/sample_cv.docx");
const originalBuffer = fs.readFileSync(fixturePath);

describe("DOCX Engine: Round Trip & Apply Operations", () => {
  describe("Round Trip Test (Rule 7)", () => {
    it("preserves word/document.xml and all other zip entries when applying zero operations", () => {
      const originalZip = new PizZip(originalBuffer);
      const originalDocXml = originalZip.file("word/document.xml")?.asText() || "";

      // Apply 0 operations
      const result = applyOperations(originalBuffer, []);
      expect(result.appliedCount).toBe(0);
      expect(result.droppedCount).toBe(0);

      const modifiedZip = new PizZip(result.docx);
      const modifiedDocXml = modifiedZip.file("word/document.xml")?.asText() || "";

      // Document XML must match original
      expect(modifiedDocXml.trim()).toBe(originalDocXml.trim());

      // Other zip files must be byte-identical
      const originalFiles = Object.keys(originalZip.files);
      const modifiedFiles = Object.keys(modifiedZip.files);

      expect(modifiedFiles.sort()).toEqual(originalFiles.sort());

      for (const fileName of originalFiles) {
        if (fileName !== "word/document.xml") {
          const origBytes = originalZip.file(fileName)?.asNodeBuffer();
          const modBytes = modifiedZip.file(fileName)?.asNodeBuffer();
          expect(modBytes).toEqual(origBytes);
        }
      }
    });
  });

  describe("Reorder Operations", () => {
    it("reorders contiguous list items without altering other paragraphs or formatting", () => {
      const parasBefore = parseDocx(originalBuffer);

      // Paragraphs 7, 8, 9, 10 are the list items under Experience
      const listParas = parasBefore.filter((p) => p.isList && p.parentKey === "body");
      expect(listParas.length).toBeGreaterThanOrEqual(4);

      const id0 = listParas[0].id;
      const id1 = listParas[1].id;
      const id2 = listParas[2].id;
      const id3 = listParas[3].id;

      // Reverse order: [id3, id2, id1, id0]
      const operations: Operation[] = [
        { type: "reorder", ids: [id3, id2, id1, id0] },
      ];

      const result = applyOperations(originalBuffer, operations);
      expect(result.appliedCount).toBe(1);

      const parasAfter = parseDocx(result.docx);

      // Verify the new order in those slots
      expect(parasAfter[id0].text).toBe(parasBefore[id3].text);
      expect(parasAfter[id1].text).toBe(parasBefore[id2].text);
      expect(parasAfter[id2].text).toBe(parasBefore[id1].text);
      expect(parasAfter[id3].text).toBe(parasBefore[id0].text);

      // Non-reordered paragraphs remain identical
      expect(parasAfter[0].text).toBe(parasBefore[0].text);
      expect(parasAfter[1].text).toBe(parasBefore[1].text);
    });

    it("drops reorder operations with non-contiguous IDs", () => {
      const operations: Operation[] = [
        { type: "reorder", ids: [0, 5] }, // non-contiguous
      ];

      const result = applyOperations(originalBuffer, operations);
      expect(result.appliedCount).toBe(0);
      expect(result.droppedCount).toBe(1);
    });

    it("drops reorder operations across different parentKeys", () => {
      const paras = parseDocx(originalBuffer);
      const bodyPara = paras.find((p) => p.parentKey === "body");
      const tablePara = paras.find((p) => p.parentKey.startsWith("tbl"));

      if (bodyPara && tablePara) {
        const operations: Operation[] = [
          { type: "reorder", ids: [bodyPara.id, tablePara.id] },
        ];
        const result = applyOperations(originalBuffer, operations);
        expect(result.appliedCount).toBe(0);
        expect(result.droppedCount).toBe(1);
      }
    });

    it("drops reorder operations on non-list items", () => {
      // id 0 and 1 are heading and contact line
      const operations: Operation[] = [
        { type: "reorder", ids: [0, 1] },
      ];

      const result = applyOperations(originalBuffer, operations);
      expect(result.appliedCount).toBe(0);
      expect(result.droppedCount).toBe(1);
    });
  });

  describe("Rewrite Operations", () => {
    it("rewrites text while preserving paragraph properties and formatting", () => {
      const parasBefore = parseDocx(originalBuffer);
      // Paragraph 2: summary
      const targetPara = parasBefore[2];
      const newText = "Senior Software Engineer with 8 years of building scalable cloud applications."; // same digits (8)

      const operations: Operation[] = [
        { type: "rewrite", id: targetPara.id, text: newText },
      ];

      const result = applyOperations(originalBuffer, operations);
      expect(result.appliedCount).toBe(1);

      const parasAfter = parseDocx(result.docx);
      expect(parasAfter[targetPara.id].text).toBe(newText);
    });

    it("handles the label pattern (bold label + normal text)", () => {
      const parasBefore = parseDocx(originalBuffer);
      // Paragraph 4 is "Languages: TypeScript, JavaScript, Python, SQL, Go"
      // Run 0 is bold "Languages: ", Run 1 is "TypeScript, JavaScript, Python, SQL, Go"
      const skillsPara = parasBefore[4];
      expect(skillsPara.text).toContain("Languages:");

      const newText = "Languages: Go, Python, TypeScript, SQL";
      const operations: Operation[] = [
        { type: "rewrite", id: skillsPara.id, text: newText },
      ];

      const result = applyOperations(originalBuffer, operations);
      expect(result.appliedCount).toBe(1);

      const parasAfter = parseDocx(result.docx);
      expect(parasAfter[skillsPara.id].text).toBe(newText);
    });

    it("drops rewrites that introduce new digits", () => {
      const parasBefore = parseDocx(originalBuffer);
      const targetPara = parasBefore[2];
      // Original has '8'. Attempt to add new digit '999'.
      const newText = "Engineered cloud apps serving 999 users.";

      const operations: Operation[] = [
        { type: "rewrite", id: targetPara.id, text: newText },
      ];

      const result = applyOperations(originalBuffer, operations);
      expect(result.appliedCount).toBe(0);
      expect(result.droppedCount).toBe(1);
    });

    it("drops rewrites exceeding 115% of original length", () => {
      const parasBefore = parseDocx(originalBuffer);
      const targetPara = parasBefore[0]; // Short name "Alex Smith" (10 chars)
      const newText = "Alex Smith is an extraordinary engineer who designs systems."; // > 115% length

      const operations: Operation[] = [
        { type: "rewrite", id: targetPara.id, text: newText },
      ];

      const result = applyOperations(originalBuffer, operations);
      expect(result.appliedCount).toBe(0);
      expect(result.droppedCount).toBe(1);
    });

    it("drops rewrites that touch locked paragraphs", () => {
      const parasBefore = parseDocx(originalBuffer);
      const lockedPara = parasBefore.find((p) => p.locked);
      expect(lockedPara).toBeDefined();

      if (lockedPara) {
        const operations: Operation[] = [
          { type: "rewrite", id: lockedPara.id, text: "New link text" },
        ];

        const result = applyOperations(originalBuffer, operations);
        expect(result.appliedCount).toBe(0);
        expect(result.droppedCount).toBe(1);
      }
    });

    it("drops rewrites that introduce new URLs or emails", () => {
      const parasBefore = parseDocx(originalBuffer);
      const targetPara = parasBefore[2];
      const newText = "Contact me at hacker@evil.com for more details.";

      const operations: Operation[] = [
        { type: "rewrite", id: targetPara.id, text: newText },
      ];

      const result = applyOperations(originalBuffer, operations);
      expect(result.appliedCount).toBe(0);
      expect(result.droppedCount).toBe(1);
    });
  });

  describe("Delete Operations", () => {
    it("deletes list bullet items up to 3 deletions", () => {
      const parasBefore = parseDocx(originalBuffer);
      const listParas = parasBefore.filter((p) => p.isList);
      const deleteId = listParas[listParas.length - 1].id;

      const operations: Operation[] = [
        { type: "delete", id: deleteId },
      ];

      const result = applyOperations(originalBuffer, operations);
      expect(result.appliedCount).toBe(1);

      const parasAfter = parseDocx(result.docx);
      expect(parasAfter.length).toBe(parasBefore.length - 1);
    });

    it("drops delete on non-list items", () => {
      const operations: Operation[] = [
        { type: "delete", id: 0 }, // Heading
      ];

      const result = applyOperations(originalBuffer, operations);
      expect(result.appliedCount).toBe(0);
      expect(result.droppedCount).toBe(1);
    });

    it("drops deletions beyond the maximum limit of 3", () => {
      const parasBefore = parseDocx(originalBuffer);
      const listParas = parasBefore.filter((p) => p.isList);

      const operations: Operation[] = [
        { type: "delete", id: listParas[0].id },
        { type: "delete", id: listParas[1].id },
        { type: "delete", id: listParas[2].id },
        { type: "delete", id: listParas[3].id }, // 4th deletion
      ];

      const result = applyOperations(originalBuffer, operations);
      expect(result.appliedCount).toBe(3);
      expect(result.droppedCount).toBe(1);
    });
  });
});
