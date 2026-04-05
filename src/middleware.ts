import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Lightweight middleware for route protection.
 * Does NOT import Prisma or auth (those use node:path which isn't available in edge).
 * Uses next-auth session token cookie to check authentication.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes - no auth required
  const publicRoutes = ["/login", "/simulator", "/api/webhooks", "/api/auth", "/api/simulator"];
  if (publicRoutes.some((r) => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // Static assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/public")
  ) {
    return NextResponse.next();
  }

  // Check for session token cookie (next-auth sets this)
  const sessionToken =
    request.cookies.get("authjs.session-token") ||
    request.cookies.get("__Secure-authjs.session-token");

  if (!sessionToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
