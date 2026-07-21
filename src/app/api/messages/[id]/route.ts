import { proxyMutation } from "@/lib/api";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/messages/[id]">,
) {
  const { id } = await context.params;
  return proxyMutation(request, "updateMessage", { id });
}
