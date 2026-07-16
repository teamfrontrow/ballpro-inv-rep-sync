import { NextRequest, NextResponse } from "next/server";

function publicRoute(pathname: string) {
  return pathname === "/api/health"
    || pathname === "/api/shopify/callback";
}

function sameValue(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function middleware(request: NextRequest) {
  if (publicRoute(request.nextUrl.pathname)) return NextResponse.next();
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const authorization = request.headers.get("authorization");

  if (username && password && authorization?.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice(6));
      const separator = decoded.indexOf(":");
      const suppliedUser = separator >= 0 ? decoded.slice(0, separator) : "";
      const suppliedPassword = separator >= 0 ? decoded.slice(separator + 1) : "";
      if (sameValue(suppliedUser, username) && sameValue(suppliedPassword, password)) return NextResponse.next();
    } catch {
      // Invalid base64 falls through to the challenge.
    }
  }

  return new NextResponse(username && password ? "Authentication required" : "Admin credentials are not configured", {
    status: username && password ? 401 : 503,
    headers: { "WWW-Authenticate": 'Basic realm="BallPro Inventory", charset="UTF-8"', "Cache-Control": "no-store" },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
