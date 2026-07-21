import { sendCommand } from "@/lib/apps-script";
import { parseContactsFile } from "@/lib/importer";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json(
        { ok: false, error: "Nie przekazano pliku kontaktów." },
        { status: 400 },
      );
    }
    const mapping = form.get("mapping");
    const parsedMapping =
      typeof mapping === "string" && mapping ? JSON.parse(mapping) : {};
    const preview = await parseContactsFile(file, parsedMapping);
    if (form.get("commit") !== "true") {
      return Response.json({ ok: true, data: preview, committed: false });
    }
    if (preview.rows.length === 0) {
      return Response.json(
        {
          ok: false,
          error: "Plik nie zawiera poprawnych kontaktów do importu.",
          data: preview,
        },
        { status: 422 },
      );
    }
    const data = await sendCommand("importContacts", {
      fileName: file.name,
      rows: preview.rows,
    });
    return Response.json({
      ok: true,
      data: preview,
      committed: true,
      committedData: data,
      excluded: preview.issues.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Błąd importu.";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
