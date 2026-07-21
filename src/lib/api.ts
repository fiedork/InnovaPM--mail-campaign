import {
  backendErrorResponse,
  sendCommand,
} from "@/lib/apps-script";
import { jsonPayload } from "@/lib/request";

export async function proxyGet(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<Response> {
  try {
    const data = await sendCommand(action, payload);
    return Response.json({ ok: true, data });
  } catch (error) {
    return backendErrorResponse(error);
  }
}

export async function proxyMutation(
  request: Request,
  action: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  try {
    const payload = await jsonPayload(request);
    const data = await sendCommand(action, { ...payload, ...extra });
    return Response.json({ ok: true, data });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
