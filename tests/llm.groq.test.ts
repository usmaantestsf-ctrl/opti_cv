import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeGroqFallbackChain, stripCodeFences } from "@/lib/llm/groq";

describe("Groq Fallback Chain & Utilities", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GROQ_API_KEY_1 = "key_1";
    process.env.GROQ_API_KEY_2 = "key_2";
    process.env.GROQ_MODEL_PRIMARY = "openai/gpt-oss-120b";
    process.env.GROQ_MODEL_FALLBACK = "openai/gpt-oss-20b";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("stripCodeFences", () => {
    it("strips ```json code fences", () => {
      const input = "```json\n{\"operations\":[],\"notes\":[]}\n```";
      expect(stripCodeFences(input)).toBe("{\"operations\":[],\"notes\":[]}");
    });

    it("strips standard ``` fences", () => {
      const input = "```\n{\"operations\":[],\"notes\":[]}\n```";
      expect(stripCodeFences(input)).toBe("{\"operations\":[],\"notes\":[]}");
    });

    it("returns plain JSON unchanged", () => {
      const input = "{\"operations\":[],\"notes\":[]}";
      expect(stripCodeFences(input)).toBe(input);
    });
  });

  describe("executeGroqFallbackChain", () => {
    it("returns LLM_KEYS_INVALID when no keys are defined", async () => {
      delete process.env.GROQ_API_KEY_1;
      delete process.env.GROQ_API_KEY_2;

      const result = await executeGroqFallbackChain("dummy prompt");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("LLM_KEYS_INVALID");
      }
    });

    it("succeeds on first attempt when API returns valid response", async () => {
      const mockPayload = {
        operations: [{ type: "delete", id: 8 }],
        notes: ["Removed least relevant bullet"],
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(mockPayload),
              },
            },
          ],
        }),
      } as any);

      const result = await executeGroqFallbackChain("dummy prompt");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.attemptsUsed).toBe(1);
        expect(result.data.operations).toEqual(mockPayload.operations);
      }
    });

    it("advances to fallback model upon 429 rate limit on first model", async () => {
      // Use fake timers so the sleep(3000) resolves instantly
      vi.useFakeTimers();

      const mockPayload = {
        operations: [{ type: "delete", id: 8 }],
        notes: ["Removed least relevant bullet"],
      };

      global.fetch = vi
        .fn()
        // Attempt 1: Key 1 + Primary Model -> 429
        .mockResolvedValueOnce({
          status: 429,
          headers: new Headers({ "retry-after": "3" }),
          text: async () => JSON.stringify({ error: { message: "Rate limit reached" } }),
        } as any)
        // Attempt 2: Key 1 + Fallback Model -> 200
        .mockResolvedValueOnce({
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(mockPayload),
                },
              },
            ],
          }),
        } as any);

      const promise = executeGroqFallbackChain("dummy prompt");
      // Advance timers to resolve the sleep(3000) backoff
      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.attemptsUsed).toBe(2);
      }

      vi.useRealTimers();
    });

    it("returns LLM_LIMIT_REACHED when all models and keys return 429", async () => {
      vi.useFakeTimers();

      global.fetch = vi.fn().mockResolvedValue({
        status: 429,
        headers: new Headers({ "retry-after": "10" }),
        text: async () => "Rate limit exceeded",
      } as any);

      const promise = executeGroqFallbackChain("dummy prompt");
      // Advance enough for all 4 attempts with 8s (capped) backoff each
      await vi.advanceTimersByTimeAsync(40000);
      const result = await promise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("LLM_LIMIT_REACHED");
        expect(result.message).toContain("10s");
      }

      vi.useRealTimers();
    });

    it("returns LLM_KEYS_INVALID when all attempts return 401/403", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 401,
        headers: new Headers(),
        text: async () => "Invalid API Key",
      } as any);

      const result = await executeGroqFallbackChain("dummy prompt");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("LLM_KEYS_INVALID");
      }
    });
  });
});
