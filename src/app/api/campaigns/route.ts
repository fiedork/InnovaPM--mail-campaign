import { proxyGet, proxyMutation } from "@/lib/api";

export function GET() {
  return proxyGet("listCampaigns");
}

export function POST(request: Request) {
  return proxyMutation(request, "createCampaign");
}
