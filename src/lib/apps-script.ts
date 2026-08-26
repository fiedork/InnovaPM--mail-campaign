import "server-only";

import { createHmac, randomUUID } from "node:crypto";

type CommandPayload = Record<string, unknown>;

export class BackendConfigurationError extends Error {}

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

  const timestamp = Date.now().toString();
  const nonce = randomUUID();
  const body = JSON.stringify({ action, payload });
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest("hex");
  // Apps Script may need a cold start before it can open the campaign workbook.
  // Keep this bounded, but leave enough time for the first request after idle.
  const signal = AbortSignal.timeout(30_000);

  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ timestamp, nonce, body, signature }),
  });

  const result = (await response.json()) as {
    ok?: boolean;
    data?: T;
    error?: string;
  };
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `Apps Script zwrócił HTTP ${response.status}.`);
  }
  return result.data as T;
}

export function backendErrorResponse(error: unknown): Response {
  if (error instanceof BackendConfigurationError) {
    return Response.json(
      { ok: false, error: error.message, code: "BACKEND_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  const message = error instanceof Error ? error.message : "Nieznany błąd.";
  return Response.json({ ok: false, error: message }, { status: 502 });
}
