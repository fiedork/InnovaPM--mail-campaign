import { proxyGet, proxyMutation } from "@/lib/api";

export function GET() {
  return proxyGet("getSettings");
}

export function PATCH(request: Request) {
  return proxyMutation(request, "updateSettings");
}
