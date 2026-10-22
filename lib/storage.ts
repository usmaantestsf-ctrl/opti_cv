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
  if (isVercelBlobConfigured()) {
    const blob = await put(pathname, data, {
      access: "public",
      addRandomSuffix: false,
      contentType,
    });
    return { url: blob.url };
  }

  // Local filesystem fallback
  const localPath = getLocalFilePath(pathname);
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  await fs.promises.writeFile(localPath, data);
  return { url: `local://${pathname}` };
}

/**
 * Get a user file as Buffer. Returns null if file not found.
 */
export async function getUserFile(pathname: string): Promise<Buffer | null> {
  if (isVercelBlobConfigured()) {
    try {
      const blob = await head(pathname);
      if (!blob || !blob.url) return null;
      const res = await fetch(blob.url);
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch {
      return null;
    }
  }

  // Local filesystem fallback
  const localPath = getLocalFilePath(pathname);
  try {
    return await fs.promises.readFile(localPath);
  } catch {
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
      return Boolean(blob && blob.url);
    } catch {
      return false;
    }
  }

  const localPath = getLocalFilePath(pathname);
  return fs.existsSync(localPath);
}

/**
 * Delete a user file.
 */
export async function deleteUserFile(pathname: string): Promise<void> {
  if (isVercelBlobConfigured()) {
    try {
      await del(pathname);
    } catch {
      // Ignore not found
    }
    return;
  }

  const localPath = getLocalFilePath(pathname);
  try {
    await fs.promises.unlink(localPath);
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
  await putUserFile(metaPath, JSON.stringify(meta, null, 2), "application/json");
}

/**
 * Check if user has uploaded a master CV
 */
export async function hasMasterCv(userId: string): Promise<boolean> {
  return userFileExists(`cv/${userId}/master.docx`);
}
