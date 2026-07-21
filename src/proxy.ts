import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  AUTH_COOKIE,
  authConfigured,
  constantTimeEqual,
  sessionToken,
} from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (!authConfigured()) {
    if (isApi) {
      return Response.json(
        { ok: false, error: "Ochrona aplikacji nie jest skonfigurowana." },
        { status: 503 },
      );
    }
    return new NextResponse("Ochrona aplikacji nie jest skonfigurowana.", {
      status: 503,
    });
  }

  const expected = await sessionToken(process.env.APP_AUTH_SECRET!);
  const supplied = request.cookies.get(AUTH_COOKIE)?.value ?? "";
  if (await constantTimeEqual(supplied, expected)) {
    return NextResponse.next();
  }

  if (isApi) {
    return Response.json(
      { ok: false, error: "Wymagane uwierzytelnienie." },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!login|api/auth|api/track/open|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
