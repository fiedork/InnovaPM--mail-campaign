import { proxyGet, proxyMutation } from "@/lib/api";

export function GET() {
  return proxyGet("listContacts");
}

export function POST(request: Request) {
  return proxyMutation(request, "createContact");
}
