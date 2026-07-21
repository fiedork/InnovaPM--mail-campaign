import { proxyGet } from "@/lib/api";

export function GET() {
  return proxyGet("getCampaignStats");
}
