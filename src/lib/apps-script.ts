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
  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_HMAC_SECRET;
  if (!url || !secret) {
    throw new BackendConfigurationError(
      "Brak APPS_SCRIPT_URL lub APPS_SCRIPT_HMAC_SECRET.",
    );
  }

  const timestamp = Date.now().toString();
  const nonce = randomUUID();
  const body = JSON.stringify({ action, payload });
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest("hex");

  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
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
