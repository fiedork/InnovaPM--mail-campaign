import { backendConfigured } from "@/lib/apps-script";

export function GET() {
  return Response.json({
    ok: true,
    backendConfigured: backendConfigured(),
    ownerEmail:
      process.env.CAMPAIGN_OWNER_EMAIL ?? "krzysztof.fiedorowicz@innova.pm",
  });
}
