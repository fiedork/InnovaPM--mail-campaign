import { NextResponse } from "next/server";

import {
  AUTH_COOKIE,
  authConfigured,
  constantTimeEqual,
  sessionToken,
} from "@/lib/auth";

export async function POST(request: Request) {
  if (!authConfigured()) {
    return Response.json(
      { ok: false, error: "Ochrona aplikacji nie jest skonfigurowana." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as { password?: unknown };
  const password = typeof body.password === "string" ? body.password : "";
  if (
    !(await constantTimeEqual(password, process.env.APP_ACCESS_PASSWORD!))
  ) {
    return Response.json(
      { ok: false, error: "Niepoprawne hasło." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: AUTH_COOKIE,
    value: await sessionToken(process.env.APP_AUTH_SECRET!),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}
