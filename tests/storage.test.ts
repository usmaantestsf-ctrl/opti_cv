import { describe, it, expect, afterAll } from "vitest";
import {
  putUserFile,
  getUserFile,
  userFileExists,
  deleteUserFile,
  getUserMeta,
  setUserMeta,
  hasMasterCv,
} from "@/lib/storage";

describe("Storage Module", () => {
  const testUserId = "test_user_storage_phase2";
  const testDocxPath = `cv/${testUserId}/master.docx`;

  afterAll(async () => {
    await deleteUserFile(testDocxPath);
    await deleteUserFile(`cv/${testUserId}/meta.json`);
  });

  it("puts and gets user file correctly", async () => {
    const content = Buffer.from("dummy docx binary data");
    await putUserFile(testDocxPath, content);

    const exists = await userFileExists(testDocxPath);
    expect(exists).toBe(true);

    const retrieved = await getUserFile(testDocxPath);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.toString()).toBe("dummy docx binary data");
  });

  it("checks master CV existence", async () => {
    const hasCv = await hasMasterCv(testUserId);
    expect(hasCv).toBe(true);

    const nonExistent = await hasMasterCv("non_existent_user");
    expect(nonExistent).toBe(false);
  });

  it("sets and gets user metadata", async () => {
    const meta = {
      originalFilename: "my_sample_cv.docx",
      uploadedAt: "2026-10-20T10:00:00.000Z",
      lastLabel: null,
      lastTailoredAt: null,
      changes: [],
      editableParagraphs: 24,
    };

    await setUserMeta(testUserId, meta);
    const retrieved = await getUserMeta(testUserId);

    expect(retrieved).toEqual(meta);
  });
});
