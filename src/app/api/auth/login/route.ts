import { NextResponse } from "next/server";

import {
  AUTH_COOKIE,
  authConfigured,
  constantTimeEqual,
  sessionToken,
} from "@/lib/auth";

import {
  checkLoginAttempt,
  recordLoginFailure,
  resetLoginAttempts,
} from "@/lib/login-rate-limit";
import { jsonPayload } from "@/lib/request";

export async function POST(request: Request) {
  if (!authConfigured()) {
    return Response.json(
      { ok: false, error: "Ochrona aplikacji nie jest skonfigurowana." },
      { status: 503 },
    );
  }

  const clientIp =
    request.headers.get("x-nf-client-connection-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const attempt = checkLoginAttempt(clientIp);
  if (!attempt.allowed) {
    return Response.json(
      { ok: false, error: "Zbyt wiele prób logowania. Spróbuj ponownie później." },
      {
        status: 429,
        headers: { "Retry-After": String(attempt.retryAfterSeconds) },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await jsonPayload(request);
  } catch (error) {
    recordLoginFailure(clientIp);
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Niepoprawne żądanie logowania.",
      },
      { status: 400 },
    );
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (
    !(await constantTimeEqual(password, process.env.APP_ACCESS_PASSWORD!))
  ) {
    recordLoginFailure(clientIp);
    return Response.json(
      { ok: false, error: "Niepoprawne hasło." },
      { status: 401 },
    );
  }

  resetLoginAttempts(clientIp);
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
