import { backendErrorResponse, sendCommand } from "@/lib/apps-script";
import { proxyMutation } from "@/lib/api";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/campaigns/[id]/companies/[companyId]">,
) {
  const { id, companyId } = await context.params;
  return proxyMutation(request, "updateCampaignCompany", {
    campaignId: id,
    companyId,
  });
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/campaigns/[id]/companies/[companyId]">,
) {
  const { id, companyId } = await context.params;
  try {
    const data = await sendCommand("deleteCampaignCompany", {
      campaignId: id,
      companyId,
    });
    return Response.json({ ok: true, data });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
