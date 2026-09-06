import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  InternalEnvelopeError,
  verifyInternalEnvelope,
} from "./internal-envelope";

const secret = "unit-test-secret";

function signedEnvelope(nonce = randomUUID()) {
  const timestamp = Date.now().toString();
  const body = JSON.stringify({ ok: true });
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${body}`)
    .digest("hex");
  return { timestamp, nonce, body, signature };
}

afterEach(() => {
  delete process.env.APPS_SCRIPT_HMAC_SECRET;
});

describe("verifyInternalEnvelope", () => {
  it("disables the vulnerable public image optimizer surface", () => {
    const config = readFileSync("next.config.ts", "utf8");
    const proxy = readFileSync("src/proxy.ts", "utf8");

    expect(config).toContain("unoptimized: true");
    expect(proxy).not.toContain("|_next/image");
  });

  it("does not expose relay account details through public readiness probes", () => {
    const smtp = readFileSync("src/app/api/smtp/send/route.ts", "utf8");
    const imap = readFileSync("src/app/api/imap/check/route.ts", "utf8");

    expect(smtp).not.toContain("host: config.host");
    expect(smtp).not.toContain("user: config.user");
    expect(smtp).not.toContain("from: config.from");
    expect(imap).not.toContain("host: config.host");
    expect(imap).not.toContain("user: config.user");
  });

  it("bounds and validates signed IMAP message lists", () => {
    const imap = readFileSync("src/app/api/imap/check/route.ts", "utf8");

    expect(imap).toContain("messages.slice(0, 500)");
    expect(imap).toContain("rfcMessageId.length <= 1000");
    expect(imap).toContain("recipientEmail.length <= 254");
    expect(imap).toContain("const seen = new Set<string>()");
  });

  it("rejects a second use of the same valid nonce", () => {
    process.env.APPS_SCRIPT_HMAC_SECRET = secret;
    const envelope = signedEnvelope();

    expect(verifyInternalEnvelope(envelope)).toEqual({ ok: true });
    expect(() => verifyInternalEnvelope(envelope)).toThrow(InternalEnvelopeError);
  });
});
