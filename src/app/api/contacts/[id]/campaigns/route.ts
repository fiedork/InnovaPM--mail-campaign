import { proxyMutation } from "@/lib/api";

export async function POST(
  request: Request,
  context: RouteContext<"/api/contacts/[id]/campaigns">,
) {
  const { id } = await context.params;
  return proxyMutation(request, "assignContactToCampaign", { contactId: id });
}
