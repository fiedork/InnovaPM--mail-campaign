import { proxyMutation } from "@/lib/api";

export async function POST(
  request: Request,
  context: RouteContext<"/api/recipients/[companyId]/select">,
) {
  const { companyId } = await context.params;
  return proxyMutation(request, "selectRecipient", { companyId });
}
