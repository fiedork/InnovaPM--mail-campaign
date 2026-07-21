import { sendCommand } from "@/lib/apps-script";

const transparentGif = new Uint8Array(
  Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"),
);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const messageId = url.searchParams.get("id") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (messageId && token) {
    try {
      await sendCommand("recordOpen", { messageId, token });
    } catch {
      // Tracking must never expose backend details or break image rendering.
    }
  }
  return new Response(transparentGif, {
    headers: {
      "content-type": "image/gif",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "content-length": String(transparentGif.byteLength),
    },
  });
}
