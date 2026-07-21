import { proxyMutation } from "@/lib/api";
import { backendErrorResponse, sendCommand } from "@/lib/apps-script";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/contacts/[id]">,
) {
  const { id } = await context.params;
  return proxyMutation(request, "updateContact", { id });
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/contacts/[id]">,
) {
  const { id } = await context.params;
  try {
    const data = await sendCommand("deleteContact", { id });
    return Response.json({ ok: true, data });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
