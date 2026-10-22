import { SignJWT, jwtVerify } from "jose";

export interface SessionPayload {
  uid: string;
  name: string;
}

export const SESSION_COOKIE_NAME = "session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET || "default_fallback_session_secret_at_least_32_chars!";
  return new TextEncoder().encode(secret);
}

/**
 * Timing-safe string comparison using SHA-256 hashes.
 * Computes SHA-256 digest via Web Crypto (available in Node and Edge),
 * then compares buffers in strict constant time using bitwise XOR.
 */
async function timingSafeEqualSha256(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [hashABuffer, hashBBuffer] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);

  const hashA = new Uint8Array(hashABuffer);
  const hashB = new Uint8Array(hashBBuffer);

  if (hashA.length !== hashB.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < hashA.length; i++) {
    diff |= hashA[i] ^ hashB[i];
  }

  return diff === 0;
}

/**
 * Scan USER{n}_NAME and USER{n}_PASSWORD starting at n=1.
 * Stops at first missing USER{n}_NAME index.
 */
export async function authenticateUser(
  usernameInput: string,
  passwordInput: string
): Promise<{ uid: string; name: string } | null> {
  let n = 1;

  while (process.env[`USER${n}_NAME`]) {
    const envName = process.env[`USER${n}_NAME`]!;
    const envPass = process.env[`USER${n}_PASSWORD`] || "";

    const [usernameMatches, passwordMatches] = await Promise.all([
      timingSafeEqualSha256(usernameInput, envName),
      timingSafeEqualSha256(passwordInput, envPass),
    ]);

    if (usernameMatches && passwordMatches) {
      return {
        uid: `user${n}`,
        name: envName,
      };
    }

    n++;
  }

  return null;
}

/**
 * Sign session payload into JWT using jose
 */
export async function signSession(payload: SessionPayload): Promise<string> {
  const secretKey = getSecretKey();
  return new SignJWT({ uid: payload.uid, name: payload.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secretKey);
}

/**
 * Verify session JWT using jose (edge-compatible)
 */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const secretKey = getSecretKey();
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });

    if (typeof payload.uid === "string" && typeof payload.name === "string") {
      return {
        uid: payload.uid,
        name: payload.name,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * In-memory attempt counter for login rate limiting.
 * Note: Serverless memory is ephemeral and not persistent across multiple instances,
 * so this is a best-effort defence only as specified in Section 5 (FR-1).
 */
interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const loginAttempts = new Map<string, RateLimitRecord>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export function checkLoginRateLimit(ip: string): { allowed: boolean } {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record || now > record.resetAt) {
    return { allowed: true };
  }

  if (record.count >= MAX_ATTEMPTS) {
    return { allowed: false };
  }

  return { allowed: true };
}

export function recordFailedLoginAttempt(ip: string): void {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, {
      count: 1,
      resetAt: now + WINDOW_MS,
    });
  } else {
    record.count += 1;
  }
}

export function clearLoginRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}
