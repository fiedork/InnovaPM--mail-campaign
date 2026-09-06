function verifyEnvelope_(envelope) {
  const secret = PropertiesService.getScriptProperties().getProperty("HMAC_SECRET");
  if (!secret) throw new Error("Brak HMAC_SECRET w Script Properties.");
  const timestamp = Number(envelope.timestamp);
  if (!timestamp || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    throw new Error("Żądanie wygasło.");
  }
  if (!envelope.nonce || !envelope.body || !envelope.signature) {
    throw new Error("Niekompletna koperta żądania.");
  }
  const expected = bytesToHex_(Utilities.computeHmacSha256Signature(
    envelope.timestamp + "." + envelope.nonce + "." + envelope.body,
    secret,
    Utilities.Charset.UTF_8
  ));
  if (!constantTimeEqual_(expected, String(envelope.signature))) {
    throw new Error("Niepoprawny podpis HMAC.");
  }

  const lock = LockService.getUserLock();
  if (!lock.tryLock(3000)) {
    throw new Error("Nie można bezpiecznie zweryfikować unikalności żądania.");
  }
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get("nonce:" + envelope.nonce)) {
      throw new Error("Powtórzone żądanie.");
    }
    cache.put("nonce:" + envelope.nonce, "1", 600);
  } finally {
    lock.releaseLock();
  }
}

function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index++) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function bytesToHex_(bytes) {
  return bytes.map(function(byte) {
    const value = byte < 0 ? byte + 256 : byte;
    return (value < 16 ? "0" : "") + value.toString(16);
  }).join("");
}
