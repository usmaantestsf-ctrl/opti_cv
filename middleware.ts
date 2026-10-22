import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public paths exempt from auth check
  const isPublicPath = pathname === "/login" || pathname === "/api/login";

  // Check Origin for mutating routes (basic CSRF defence)
  if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");

    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return new NextResponse(
            JSON.stringify({ ok: false, code: "UNAUTHORIZED", message: "Invalid request origin." }),
            { status: 403, headers: { "content-type": "application/json" } }
          );
        }
      } catch {
        return new NextResponse(
          JSON.stringify({ ok: false, code: "UNAUTHORIZED", message: "Invalid request origin." }),
          { status: 403, headers: { "content-type": "application/json" } }
        );
      }
    }
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;

  // If visiting /login while already logged in, redirect to home
  if (pathname === "/login" && session) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // If public path, allow through
  if (isPublicPath) {
    return NextResponse.next();
  }

  // If unauthenticated:
  if (!session) {
    // API routes return 401 JSON
    if (pathname.startsWith("/api/")) {
      return new NextResponse(
        JSON.stringify({ ok: false, code: "UNAUTHORIZED", message: "Please log in again." }),
        { status: 401, headers: { "content-type": "application/json" } }
      );
    }

    // Page routes redirect to /login
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Inject user info into request headers for downstream API routes / RSC
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", session.uid);
  requestHeaders.set("x-user-name", session.name);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}
