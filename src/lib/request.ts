export async function jsonPayload(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType || contentType.split(";")[0].trim() !== "application/json") {
    throw new Error("Oczekiwano nagłówka Content-Type: application/json.");
  }

  const raw = await request.text();
  if (raw.length > 65536) {
    throw new Error("Żądanie JSON nie może przekraczać 64 KiB.");
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error("Nie udało się sparsować JSON.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Oczekiwano obiektu JSON.");
  }
  return body as Record<string, unknown>;
}