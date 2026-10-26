import { NextRequest, NextResponse } from "next/server";
import {
  authenticateUser,
  signSession,
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  clearLoginRateLimit,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";
import { jsonError } from "@/lib/errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "127.0.0.1";

    // 1. Check rate limit: 5 fails per IP per 15 min returns 429
    const rateLimit = checkLoginRateLimit(ip);
    if (!rateLimit.allowed) {
      console.warn(`[api/login] Rate limit exceeded for ip=${ip}`);
      return jsonError("TOO_MANY_ATTEMPTS");
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body.username !== "string" || typeof body.password !== "string") {
      console.warn(`[api/login] Invalid request body from ip=${ip}`);
      await new Promise((r) => setTimeout(r, 800));
      recordFailedLoginAttempt(ip);
      return jsonError("BAD_LOGIN");
    }

    const { username, password } = body;
    console.log(`[api/login] Attempt: username="${username.trim()}" from ip=${ip}`);
    const user = await authenticateUser(username.trim(), password);

    if (!user) {
      console.warn(`[api/login] ✗ Invalid credentials for user="${username.trim()}" from ip=${ip}`);
      // Artificial delay ~800ms to mitigate timing/brute force attacks
      await new Promise((r) => setTimeout(r, 800));
      recordFailedLoginAttempt(ip);
      return jsonError("BAD_LOGIN");
    }

    // Login succeeded: clear failed rate limit counter for this IP
    clearLoginRateLimit(ip);

    // Sign JWT
    const token = await signSession({
      uid: user.uid,
      name: user.name,
    });

    console.log(`[api/login] ✓ Login success: user="${user.name}" (uid=${user.uid}) from ip=${ip}`);

    const response = NextResponse.json({
      ok: true,
      name: user.name,
    });

    // Set HTTP-only secure cookie
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return response;
  } catch (err: any) {
    console.error("[api/login] Unexpected login error:", err?.stack || err?.message || err);
    return jsonError("INTERNAL");
  }
}
