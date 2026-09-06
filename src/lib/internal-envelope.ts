import { createHmac, timingSafeEqual } from "node:crypto";

const NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_NONCE_CACHE_ENTRIES = 10_000;
// Residual risk: this process-local cache is not shared across serverless instances;
// a durable idempotency store is still required to fully close this P1.
const acceptedNonces = new Map<string, number>();

export class InternalEnvelopeError extends Error {}

function reserveNonce(nonce: string, now: number): void {
  for (const [cachedNonce, expiresAt] of acceptedNonces) {
    if (expiresAt <= now) acceptedNonces.delete(cachedNonce);
  }

  if (acceptedNonces.has(nonce)) {
    throw new InternalEnvelopeError("Żądanie zostało już użyte.");
  }
  if (acceptedNonces.size >= MAX_NONCE_CACHE_ENTRIES) {
    throw new InternalEnvelopeError("Limit aktywnych żądań został osiągnięty.");
  }

  acceptedNonces.set(nonce, now + NONCE_TTL_MS);
}

export function verifyInternalEnvelope<T>(input: unknown): T {
  const secret = process.env.APPS_SCRIPT_HMAC_SECRET;
  if (!secret) {
    throw new InternalEnvelopeError("Brak APPS_SCRIPT_HMAC_SECRET.");
  }
  if (!input || typeof input !== "object") {
    throw new InternalEnvelopeError("Niepoprawna koperta żądania.");
  }
  const envelope = input as {
    timestamp?: unknown;
    nonce?: unknown;
    body?: unknown;
    signature?: unknown;
  };
  const timestamp = String(envelope.timestamp || "");
  const nonce = String(envelope.nonce || "");
  const body = String(envelope.body || "");
  const signature = String(envelope.signature || "");
  const numericTimestamp = Number(timestamp);

  if (!numericTimestamp || Math.abs(Date.now() - numericTimestamp) > 5 * 60 * 1000) {
    throw new InternalEnvelopeError("Żądanie wygasło.");
  }
  if (!nonce || !body || !signature) {
    throw new InternalEnvelopeError("Niekompletna koperta żądania.");
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new InternalEnvelopeError("Niepoprawny podpis HMAC.");
  }

  reserveNonce(nonce, Date.now());
  return JSON.parse(body) as T;
}
