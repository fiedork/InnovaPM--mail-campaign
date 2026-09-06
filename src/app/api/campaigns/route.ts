import { proxyGet, proxyMutation } from "@/lib/api";

export function GET(request: Request) {
  const url = new URL(request.url);
  return proxyGet("listCampaigns", {
    includeArchived: url.searchParams.get("includeArchived") === "true",
  });
}

export function POST(request: Request) {
  return proxyMutation(request, "createCampaign");
}
