import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export async function middleware(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Accounts with a temporary password must set their own before using anything else.
  if (session.mcp && req.nextUrl.pathname !== "/account") {
    if (req.nextUrl.pathname.startsWith("/api/")) return new Response("Set a new password first.", { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = "/account";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// /api/v1 uses API keys, not sessions, and is checked in the route handlers.
export const config = {
  matcher: ["/((?!login|api/v1|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/).*)"],
};
