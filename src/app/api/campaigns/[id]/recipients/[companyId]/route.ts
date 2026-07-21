import { backendErrorResponse, sendCommand } from "@/lib/apps-script";

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/campaigns/[id]/recipients/[companyId]">,
) {
  const { id, companyId } = await context.params;
  try {
    const data = await sendCommand("removeRecipient", {
      campaignId: id,
      companyId,
    });
    return Response.json({ ok: true, data });
  } catch (error) {
    return backendErrorResponse(error);
  }
}
