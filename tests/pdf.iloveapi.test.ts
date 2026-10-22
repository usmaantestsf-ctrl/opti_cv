import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convertDocxToPdf } from "@/lib/pdf/iloveapi";

describe("iLoveAPI PDF Conversion (convertDocxToPdf)", () => {
  const originalEnv = { ...process.env };
  const dummyDocxBuffer = Buffer.from("dummy docx content");

  beforeEach(() => {
    process.env.ILOVEAPI_PUBLIC_KEY_1 = "pub_key_1";
    process.env.ILOVEAPI_SECRET_KEY_1 = "sec_key_1";
    process.env.ILOVEAPI_PUBLIC_KEY_2 = "pub_key_2";
    process.env.ILOVEAPI_SECRET_KEY_2 = "sec_key_2";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("returns PDF_UNAVAILABLE when no iLoveAPI keys are configured", async () => {
    delete process.env.ILOVEAPI_PUBLIC_KEY_1;
    delete process.env.ILOVEAPI_SECRET_KEY_1;
    delete process.env.ILOVEAPI_PUBLIC_KEY_2;
    delete process.env.ILOVEAPI_SECRET_KEY_2;

    const result = await convertDocxToPdf(dummyDocxBuffer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PDF_UNAVAILABLE");
      expect(result.message).toContain("monthly limit reached or keys not working");
    }
  });

  it("completes full conversion flow with key set 1 on success", async () => {
    const mockPdfContent = "%PDF-1.4 mock pdf data";

    global.fetch = vi
      .fn()
      // Step 1: auth
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "jwt_token_123" }),
      } as any)
      // Step 2: start
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ server: "api11.ilovepdf.com", task: "task_abc_123" }),
      } as any)
      // Step 3: upload
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ server_filename: "uploaded_doc.docx" }),
      } as any)
      // Step 4: process
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "TaskSuccess" }),
      } as any)
      // Step 5: download
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from(mockPdfContent),
      } as any);

    const result = await convertDocxToPdf(dummyDocxBuffer);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pdfBuffer.toString()).toBe(mockPdfContent);
    }
  });

  it("falls back to key set 2 when key set 1 fails auth", async () => {
    const mockPdfContent = "%PDF-1.4 mock pdf data from key 2";

    global.fetch = vi
      .fn()
      // Key set 1 Attempt 1: auth 401
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as any)
      // Key set 1 Attempt 2 (retry): auth 401
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as any)
      // Key set 2 Attempt 1:
      // Step 1: auth success
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "jwt_token_key_2" }),
      } as any)
      // Step 2: start
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ server: "api12.ilovepdf.com", task: "task_key_2" }),
      } as any)
      // Step 3: upload
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ server_filename: "uploaded_doc_2.docx" }),
      } as any)
      // Step 4: process
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "TaskSuccess" }),
      } as any)
      // Step 5: download
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from(mockPdfContent),
      } as any);

    const result = await convertDocxToPdf(dummyDocxBuffer);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pdfBuffer.toString()).toBe(mockPdfContent);
    }
  });

  it("returns PDF_UNAVAILABLE when both key sets fail", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    } as any);

    const result = await convertDocxToPdf(dummyDocxBuffer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PDF_UNAVAILABLE");
    }
  });
});
