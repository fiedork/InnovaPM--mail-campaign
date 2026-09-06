import { proxyGet } from "@/lib/api";

export function GET(request: Request) {
  const url = new URL(request.url);
  return proxyGet("getCampaignStats", {
    includeArchived: url.searchParams.get("includeArchived") === "true",
  });
}
