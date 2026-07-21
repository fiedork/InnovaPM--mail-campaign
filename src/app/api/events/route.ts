import { proxyGet } from "@/lib/api";

export function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  return proxyGet("listEvents", {
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100,
  });
}
