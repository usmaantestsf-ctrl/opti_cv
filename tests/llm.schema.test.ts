import { describe, it, expect } from "vitest";
import { Out } from "@/lib/llm/schema";

describe("LLM Output Schema", () => {
  it("validates valid operations and notes", () => {
    const validData = {
      operations: [
        { type: "reorder", ids: [1, 2, 3] },
        { type: "rewrite", id: 4, text: "Updated paragraph text" },
        { type: "delete", id: 5 },
      ],
      notes: ["Reordered experience bullets", "Emphasized relevant skills"],
    };

    const parsed = Out.safeParse(validData);
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid operation types", () => {
    const invalidData = {
      operations: [{ type: "unknown_type", id: 1 }],
      notes: [],
    };

    const parsed = Out.safeParse(invalidData);
    expect(parsed.success).toBe(false);
  });

  it("rejects reorder with fewer than 2 ids", () => {
    const invalidData = {
      operations: [{ type: "reorder", ids: [1] }],
      notes: [],
    };

    const parsed = Out.safeParse(invalidData);
    expect(parsed.success).toBe(false);
  });
});
