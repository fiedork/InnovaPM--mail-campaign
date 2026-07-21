import { sendCommand } from "@/lib/apps-script";
import { parseCampaignFile } from "@/lib/importer";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json(
        { ok: false, error: "Nie przekazano pliku kampanii." },
        { status: 400 },
      );
    }
    const mapping = form.get("mapping");
    const parsedMapping =
      typeof mapping === "string" && mapping ? JSON.parse(mapping) : {};
    const preview = await parseCampaignFile(file, parsedMapping);
    if (form.get("commit") !== "true") {
      return Response.json({ ok: true, data: preview, committed: false });
    }
    if (preview.issues.length > 0 || preview.duplicates.length > 0) {
      return Response.json(
        {
          ok: false,
          error: "Import zawiera błędy walidacji lub konflikty odbiorców.",
          data: preview,
        },
        { status: 422 },
      );
    }
    const data = await sendCommand("importCampaign", {
      fileName: file.name,
      rows: preview.rows,
    });
    return Response.json({
      ok: true,
      data: preview,
      committed: true,
      committedData: data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Błąd importu.";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
