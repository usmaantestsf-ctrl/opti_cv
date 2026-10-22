import { Out, LLMOutput } from "./schema";
import { getSystemPrompt } from "./prompt";
import { ErrorCode } from "../errors";

export interface LLMResult {
  ok: true;
  data: LLMOutput;
  attemptsUsed: number;
}

export interface LLMError {
  ok: false;
  code: ErrorCode;
  message: string;
}

/**
 * Strips markdown code fences (e.g. ```json ... ```)
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceRegex = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i;
  const match = trimmed.match(fenceRegex);
  return match ? match[1].trim() : trimmed;
}

interface AttemptConfig {
  apiKey: string;
  model: string;
}

/**
 * Sanitizes raw LLM JSON before Zod schema validation:
 * Filters out malformed reorders (<2 ids) so they don't discard valid rewrites.
 */
function sanitizeLLMOutput(parsed: any): any {
  if (!parsed || typeof parsed !== "object") return parsed;
  const out = { ...parsed };
  if (Array.isArray(out.operations)) {
    out.operations = out.operations.filter((op: any) => {
      if (!op || typeof op !== "object") return false;
      if (op.type === "reorder") {
        return Array.isArray(op.ids) && op.ids.length >= 2;
      }
      if (op.type === "rewrite") {
        return typeof op.text === "string" && op.text.trim().length > 0;
      }
      return op.type === "delete" && typeof op.id === "number";
    });
  }
  if (!Array.isArray(out.notes)) {
    out.notes = [];
  }
  return out;
}

/**
 * Builds the fallback attempt chain based on environment variables.
 */
function getAttemptChain(): AttemptConfig[] {
  const key1 = process.env.GROQ_API_KEY_1?.trim();
  const key2 = process.env.GROQ_API_KEY_2?.trim();

  const modelPrimary = process.env.GROQ_MODEL_PRIMARY?.trim() || "openai/gpt-oss-120b";
  const modelFallback = process.env.GROQ_MODEL_FALLBACK?.trim() || "openai/gpt-oss-20b";

  const chain: AttemptConfig[] = [];

  if (key1) {
    chain.push({ apiKey: key1, model: modelPrimary });
    chain.push({ apiKey: key1, model: modelFallback });
  }

  if (key2) {
    chain.push({ apiKey: key2, model: modelPrimary });
    chain.push({ apiKey: key2, model: modelFallback });
  }

  return chain;
}

/**
 * Sleep helper for backoff between attempts.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Performs a single chat completion request with a 25s timeout.
 * @param useJsonMode - if false, omits response_format (for models that don't support it)
 */
async function callGroqChatCompletion(
  apiKey: string,
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  useJsonMode = true
): Promise<{ status: number; text: string; retryAfter?: string | null }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout

  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: 0.3,
      max_tokens: 1200,
    };
    if (useJsonMode) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const retryAfter = res.headers.get("retry-after");
    const rawText = await res.text();

    return {
      status: res.status,
      text: rawText,
      retryAfter,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      return { status: 408, text: "Request timed out after 25 seconds." };
    }
    return { status: 500, text: err.message || "Network error" };
  }
}

/**
 * Executes the Groq fallback chain and validates output against Zod schema.
 */
export async function executeGroqFallbackChain(userPrompt: string): Promise<LLMResult | LLMError> {
  const chain = getAttemptChain();

  if (chain.length === 0) {
    return {
      ok: false,
      code: "LLM_KEYS_INVALID",
      message: "AI keys are invalid. Check the server settings.",
    };
  }

  let attemptCount = 0;
  let allAuthErrors = true;
  let lastRetryAfter: string | null = null;

  const systemPrompt = getSystemPrompt(); // compute once, reuse

  for (const attempt of chain) {
    attemptCount++;
    const { apiKey, model } = attempt;

    console.log(`[groq] attempt ${attemptCount}: model=${model} key=...${apiKey.slice(-6)}`);

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    // Attempt call (with JSON mode first)
    let response = await callGroqChatCompletion(apiKey, model, messages, true);

    // If 401/403: note auth error and advance to next attempt
    if (response.status === 401 || response.status === 403) {
      console.log(`[groq] attempt ${attemptCount}: auth error ${response.status}`);
      continue;
    }

    allAuthErrors = false;

    // If 429: wait up to 8s (capped) if retry-after is given, then advance to next key/model
    if (response.status === 429) {
      console.log(`[groq] attempt ${attemptCount}: rate-limited 429`);
      if (response.retryAfter) lastRetryAfter = response.retryAfter;
      const waitSec = Math.min(parseInt(response.retryAfter || "3", 10) || 3, 8);
      await sleep(waitSec * 1000);
      continue;
    }

    // If 5xx or timeout (408): short delay then advance
    if (response.status >= 500 || response.status === 408) {
      console.log(`[groq] attempt ${attemptCount}: error ${response.status}`);
      await sleep(1000);
      continue;
    }

    // HTTP 400: model may not support json_object mode — retry WITHOUT json mode
    if (response.status === 400) {
      console.log(`[groq] attempt ${attemptCount}: 400 with json_mode, retrying without response_format...`);
      response = await callGroqChatCompletion(apiKey, model, messages, false);

      if (response.status !== 200) {
        console.log(`[groq] attempt ${attemptCount}: retry without json_mode also failed (${response.status}), advancing`);
        continue;
      }
      // Fall through to the 200 handler below
    }

    // Success HTTP status (200) -> Parse choices
    if (response.status === 200) {
      try {
        const json = JSON.parse(response.text);
        const rawContent = json?.choices?.[0]?.message?.content || "";
        console.log(`[groq] attempt ${attemptCount}: got response (${rawContent.length} chars)`);
        const cleaned = stripCodeFences(rawContent);
        const parsed = JSON.parse(cleaned);
        const sanitized = sanitizeLLMOutput(parsed);

        const validated = Out.safeParse(sanitized);
        if (validated.success) {
          console.log(`[groq] ✓ success on attempt ${attemptCount} (model=${model})`);
          return {
            ok: true,
            data: validated.data,
            attemptsUsed: attemptCount,
          };
        }

        // Schema validation failed: ONE repair retry on the same key/model
        console.log(`[groq] attempt ${attemptCount}: schema mismatch, trying repair...`);
        messages.push({ role: "assistant", content: rawContent });
        messages.push({
          role: "user",
          content: `Schema error: ${JSON.stringify(
            validated.error.format()
          )}. Return ONLY valid JSON matching the exact schema.`,
        });

        const repairResponse = await callGroqChatCompletion(apiKey, model, messages);
        if (repairResponse.status === 200) {
          const repairJson = JSON.parse(repairResponse.text);
          const repairContent = repairJson?.choices?.[0]?.message?.content || "";
          const repairCleaned = stripCodeFences(repairContent);
          const repairParsed = JSON.parse(repairCleaned);
          const repairSanitized = sanitizeLLMOutput(repairParsed);
          const repairValidated = Out.safeParse(repairSanitized);

          if (repairValidated.success) {
            console.log(`[groq] ✓ repair succeeded on attempt ${attemptCount}`);
            return {
              ok: true,
              data: repairValidated.data,
              attemptsUsed: attemptCount,
            };
          }
        }
        console.log(`[groq] attempt ${attemptCount}: repair failed, advancing`);
      } catch (e: any) {
        // Fall through to next attempt if JSON parsing completely broke
        console.log(`[groq] attempt ${attemptCount}: JSON parse error: ${e.message?.slice(0, 100)}`);
      }
    } else {
      // Catch-all for unexpected status codes (404, 413, etc.)
      console.log(`[groq] attempt ${attemptCount}: unexpected status ${response.status}: ${response.text.slice(0, 200)}`);
    }
  }

  // All attempts exhausted
  if (allAuthErrors) {
    return {
      ok: false,
      code: "LLM_KEYS_INVALID",
      message: "AI keys are invalid. Check the server settings.",
    };
  }

  const retryMessage = lastRetryAfter
    ? ` Try again in ${lastRetryAfter}s.`
    : " Try again in a few minutes or tomorrow.";

  return {
    ok: false,
    code: "LLM_LIMIT_REACHED",
    message: `AI limit reached on both accounts.${retryMessage}`,
  };
}
