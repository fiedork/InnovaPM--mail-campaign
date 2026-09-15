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

  const retryableReads = new Set([
    "getBackendStatus",
    "listContacts",
    "getCampaignStats",
    "getSettings",
    "listCampaigns",
  ]);
  const attempts = retryableReads.has(action) ? 2 : 1;
  const deadline = Date.now() + 27_000;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const timestamp = Date.now().toString();
    const nonce = randomUUID();
    const body = JSON.stringify({ action, payload });
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${nonce}.${body}`)
      .digest("hex");
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    try {
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(remainingMs),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timestamp, nonce, body, signature }),
      });
      const responseText = await response.text();
      let result: { ok?: boolean; data?: T; error?: string };
      try {
        result = JSON.parse(responseText) as typeof result;
      } catch {
        throw new Error(`Apps Script zwrócił odpowiedź inną niż JSON (HTTP ${response.status}).`);
      }
      if (!response.ok || !result.ok) {
        throw new Error(result.error || `Apps Script zwrócił HTTP ${response.status}.`);
      }
      return result.data as T;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts || Date.now() >= deadline) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Apps Script nie odpowiedział w limicie czasu.");
}

export function backendErrorResponse(error: unknown): Response {
  if (error instanceof BackendConfigurationError) {
    return Response.json(
      { ok: false, error: error.message, code: "BACKEND_NOT_CONFIGURED" },
      { status: 503 },
    );
  }
  const message = error instanceof Error ? error.message : "Nieznany błąd.";
  console.error("Apps Script backend request failed", {
    message,
    errorType: error instanceof Error ? error.constructor.name : typeof error,
  });
  return Response.json({ ok: false, error: message }, { status: 502 });
}
