import { put, head, del } from "@vercel/blob";
import fs from "fs";
import path from "path";

export interface UserMeta {
  originalFilename: string;
  uploadedAt: string;
  lastLabel?: string | null;
  lastTailoredAt?: string | null;
  changes?: string[];
  editableParagraphs?: number;
}

const LOCAL_STORAGE_DIR = path.resolve(process.cwd(), ".local_storage");

function isVercelBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function getLocalFilePath(pathname: string): string {
  return path.join(LOCAL_STORAGE_DIR, pathname);
}

/**
 * Put a user file with fixed pathname and overwrite (addRandomSuffix: false).
 */
export async function putUserFile(
  pathname: string,
  data: Buffer | string,
  contentType?: string
): Promise<{ url?: string }> {
  const byteLength = typeof data === "string" ? Buffer.byteLength(data) : data.length;
  const provider = isVercelBlobConfigured() ? "vercel-blob" : "local-fs";
  console.log(`[storage] putUserFile: "${pathname}" (${byteLength} bytes, provider: ${provider})`);

  if (isVercelBlobConfigured()) {
    try {
      const blob = await put(pathname, data, {
        access: "public",
        addRandomSuffix: false,
        contentType,
      });
      console.log(`[storage] ✓ putUserFile saved to blob: "${pathname}" (${blob.url})`);
      return { url: blob.url };
    } catch (err: any) {
      console.error(`[storage] ✗ putUserFile error for "${pathname}":`, err?.message || err);
      throw err;
    }
  }

  // Local filesystem fallback
  try {
    const localPath = getLocalFilePath(pathname);
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await fs.promises.writeFile(localPath, data);
    console.log(`[storage] ✓ putUserFile saved to local disk: "${pathname}"`);
    return { url: `local://${pathname}` };
  } catch (err: any) {
    console.error(`[storage] ✗ putUserFile local fs error for "${pathname}":`, err?.message || err);
    throw err;
  }
}

/**
 * Get a user file as Buffer. Returns null if file not found.
 */
export async function getUserFile(pathname: string): Promise<Buffer | null> {
  const provider = isVercelBlobConfigured() ? "vercel-blob" : "local-fs";
  console.log(`[storage] getUserFile: "${pathname}" (provider: ${provider})`);

  if (isVercelBlobConfigured()) {
    try {
      const blob = await head(pathname);
      if (!blob || !blob.url) {
        console.log(`[storage] getUserFile: head("${pathname}") returned no blob url (file not found)`);
        return null;
      }
      const res = await fetch(blob.url);
      if (!res.ok) {
        console.warn(`[storage] getUserFile: fetch blob url returned ${res.status} for "${pathname}"`);
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      console.log(`[storage] ✓ getUserFile retrieved: "${pathname}" (${buffer.length} bytes)`);
      return buffer;
    } catch (err: any) {
      console.log(`[storage] getUserFile: head("${pathname}") error/not found: ${err?.message || err}`);
      return null;
    }
  }

  // Local filesystem fallback
  const localPath = getLocalFilePath(pathname);
  try {
    const buf = await fs.promises.readFile(localPath);
    console.log(`[storage] ✓ getUserFile retrieved from local disk: "${pathname}" (${buf.length} bytes)`);
    return buf;
  } catch {
    console.log(`[storage] getUserFile: local file not found "${pathname}"`);
    return null;
  }
}

/**
 * Check if a file exists.
 */
export async function userFileExists(pathname: string): Promise<boolean> {
  if (isVercelBlobConfigured()) {
    try {
      const blob = await head(pathname);
      const exists = Boolean(blob && blob.url);
      console.log(`[storage] userFileExists: "${pathname}" -> ${exists}`);
      return exists;
    } catch {
      return false;
    }
  }

  const localPath = getLocalFilePath(pathname);
  const exists = fs.existsSync(localPath);
  return exists;
}

/**
 * Delete a user file.
 */
export async function deleteUserFile(pathname: string): Promise<void> {
  console.log(`[storage] deleteUserFile: "${pathname}"`);
  if (isVercelBlobConfigured()) {
    try {
      await del(pathname);
      console.log(`[storage] ✓ deleteUserFile removed: "${pathname}"`);
    } catch (err: any) {
      console.log(`[storage] deleteUserFile (ignored error): ${err?.message || err}`);
    }
    return;
  }

  const localPath = getLocalFilePath(pathname);
  try {
    await fs.promises.unlink(localPath);
    console.log(`[storage] ✓ deleteUserFile removed from local disk: "${pathname}"`);
  } catch {
    // Ignore not found
  }
}

/**
 * Get metadata for user CV
 */
export async function getUserMeta(userId: string): Promise<UserMeta | null> {
  const metaPath = `cv/${userId}/meta.json`;
  const data = await getUserFile(metaPath);
  if (!data) return null;

  try {
    return JSON.parse(data.toString("utf-8")) as UserMeta;
  } catch {
    return null;
  }
}

/**
 * Set metadata for user CV
 */
export async function setUserMeta(userId: string, meta: UserMeta): Promise<void> {
  const metaPath = `cv/${userId}/meta.json`;
  console.log(`[storage] setUserMeta: for uid="${userId}"`);
  await putUserFile(metaPath, JSON.stringify(meta, null, 2), "application/json");
}

/**
 * Check if user has uploaded a master CV
 */
export async function hasMasterCv(userId: string): Promise<boolean> {
  return userFileExists(`cv/${userId}/master.docx`);
}
