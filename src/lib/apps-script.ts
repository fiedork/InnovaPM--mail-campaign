import "server-only";

import { createHmac, randomUUID } from "node:crypto";

type CommandPayload = Record<string, unknown>;

export class BackendConfigurationError extends Error {}

export class BackendTimeoutError extends Error {
  constructor() {
    super("Apps Script nie odpowiedział w limicie czasu.");
    this.name = "BackendTimeoutError";
  }
}

export function backendConfigured(): boolean {
  return Boolean(
    process.env.APPS_SCRIPT_URL && process.env.APPS_SCRIPT_HMAC_SECRET,
  );
}

export async function sendCommand<T>(
  action: string,
  payload: CommandPayload = {},
): Promise<T> {
  let url = process.env.APPS_SCRIPT_URL?.trim();
  const secret = process.env.APPS_SCRIPT_HMAC_SECRET?.trim();
  if (!url || !secret) {
    throw new BackendConfigurationError(
      "Brak APPS_SCRIPT_URL lub APPS_SCRIPT_HMAC_SECRET.",
    );
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }

  const startedAt = Date.now();
  const requestId = randomUUID();
  const timestamp = startedAt.toString();
  const nonce = randomUUID();
  const body = JSON.stringify({ action, payload, requestId });
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest("hex");

  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(22_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp, nonce, body, signature }),
    });
    const responseText = await response.text();
    const responseBytes = Buffer.byteLength(responseText, "utf8");
    let result: { ok?: boolean; data?: T; error?: string };
    try {
      result = JSON.parse(responseText) as typeof result;
    } catch {
      throw new Error(`Apps Script zwrócił odpowiedź inną niż JSON (HTTP ${response.status}).`);
    }
    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Apps Script zwrócił HTTP ${response.status}.`);
    }
    console.info("Apps Script backend request completed", {
      action,
      requestId,
      elapsedMs: Date.now() - startedAt,
      hostname: new URL(url).hostname,
      status: response.status,
      responseBytes,
      stage: "response",
    });
    return result.data as T;
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
    console.error("Apps Script backend request failed", {
      action,
      requestId,
      elapsedMs: Date.now() - startedAt,
      hostname: new URL(url).hostname,
      stage: isTimeout ? "timeout" : "request",
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });
    if (isTimeout) throw new BackendTimeoutError();
    throw error;
  }
}

export function backendErrorResponse(error: unknown): Response {
  if (error instanceof BackendConfigurationError) {
    return Response.json(
      { ok: false, error: error.message, code: "BACKEND_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  if (error instanceof BackendTimeoutError) {
    return Response.json(
      { ok: false, error: error.message, code: "APPS_SCRIPT_TIMEOUT" },
      { status: 504 },
    );
  }
  const message = error instanceof Error ? error.message : "Nieznany błąd.";
  console.error("Apps Script backend request failed", {
    message,
    errorType: error instanceof Error ? error.constructor.name : typeof error,
  });
  return Response.json({ ok: false, error: message }, { status: 502 });
}
