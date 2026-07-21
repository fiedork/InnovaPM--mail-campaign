import { proxyGet, proxyMutation } from "@/lib/api";
import { backendErrorResponse, sendCommand } from "@/lib/apps-script";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/campaigns/[id]">,
) {
  const { id } = await context.params;
  return proxyGet("getCampaign", { id });
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/campaigns/[id]">,
) {
  const { id } = await context.params;
  return proxyMutation(request, "updateCampaign", { id });
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/campaigns/[id]">,
) {
  const { id } = await context.params;
  try {
    const data = await sendCommand("deleteCampaign", { id });
    return Response.json({ ok: true, data });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
