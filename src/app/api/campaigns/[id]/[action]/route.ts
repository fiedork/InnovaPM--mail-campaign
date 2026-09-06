import { proxyMutation } from "@/lib/api";

const actions = new Set([
  "review",
  "approve",
  "start",
  "pause",
  "resume",
  "cancel",
  "reopen",
  "prepare-correction",
  "restore",
  "clear-activity",
]);

export async function POST(
  request: Request,
  context: RouteContext<"/api/campaigns/[id]/[action]">,
) {
  const { id, action } = await context.params;
  if (!actions.has(action)) {
    return Response.json(
      { ok: false, error: "Nieobsługiwana operacja kampanii." },
      { status: 404 },
    );
  }
  if (action === "restore") {
    return proxyMutation(request, "restoreCampaign", { id });
  }
  if (action === "clear-activity") {
    return proxyMutation(request, "clearCampaignActivity", { id });
  }
  return proxyMutation(request, "transitionCampaign", { id, action });
}
