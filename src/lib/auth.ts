export const AUTH_COOKIE = "innovapm_session";
const TOKEN_MESSAGE = "innovapm-mail-campaign:v1";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

export async function constantTimeEqual(
  left: string,
  right: string,
): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index++) {
    difference |= leftHash[index] ^ rightHash[index];
  }
  return difference === 0;
}

export async function sessionToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(TOKEN_MESSAGE),
  );
  return bytesToHex(new Uint8Array(signature));
}

export function authConfigured(): boolean {
  return Boolean(process.env.APP_ACCESS_PASSWORD && process.env.APP_AUTH_SECRET);
}
