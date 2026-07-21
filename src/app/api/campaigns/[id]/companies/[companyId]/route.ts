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
