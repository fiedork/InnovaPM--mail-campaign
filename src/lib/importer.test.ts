// Test regresyjny: plik XLSX z inlineStr nagłówkiem + atrybutem xml:space + danymi t="str"
// (wariant generowany przez niektóre narzędzia — wcześniej 0 rekordów / 133 problemy).
import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { parseCampaignFile } from "./importer";

function xlsxFile(name: string, xml: string): File {
  const blob = new Blob([xml], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const file = new File([blob], name);
  Object.defineProperty(file, "size", { value: blob.size });
  return file;
}

async function buildAttributedXlsx(): Promise<File> {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="utf-8"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="Kampania" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="utf-8"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  // Nagłówek jako inlineStr z xml:space="preserve" (przypadek z pliku użytkownika).
  const headerCells = ["Kampania", "Firma", "Imię i nazwisko", "Stanowisko", "Adres e-mail", "Temat 1", "Treść 1", "Temat 2", "Treść 2", "Temat 3", "Treść 3"]
    .map((header, index) => `<c r="${String.fromCharCode(65 + index)}1" t="inlineStr"><is><t xml:space="preserve">${header}</t></is></c>`)
    .join("");
  const dataCells = [
    "AI-MSP",
    "INXY Payments",
    "Ruslan Zholik",
    "Founder & CEO",
    "r.zholik@inxy.io",
    "Temat D0",
    "Dzień dobry Panie Rusłanie, treść pierwszej wiadomości testowej.",
    "Temat D3",
    "Dzień dobry Panie Rusłanie, treść drugiej wiadomości testowej.",
    "Temat D6",
    "Dzień dobry Panie Rusłanie, treść trzeciej wiadomości testowej.",
  ]
    .map((value, index) => `<c r="${String.fromCharCode(65 + index)}2" t="str"><v>${value}</v></c>`)
    .join("");
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="utf-8"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
      `<row r="1">${headerCells}</row><row r="2">${dataCells}</row></sheetData></worksheet>`,
  );
  const content = await zip.generateAsync({ type: "blob" });
  const file = new File([content], "attributed-inline-header.xlsx");
  Object.defineProperty(file, "size", { value: content.size });
  return file;
}

describe("importer — nagłówek inlineStr z atrybutami (xml:space)", () => {
  it("odczytuje nagłówek inlineStr z xml:space=preserve i importuje wiersze", async () => {
    const file = await buildAttributedXlsx();
    const preview = await parseCampaignFile(file);
    expect(preview.issues).toEqual([]);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({
      seriesName: "AI-MSP",
      companyName: "INXY Payments",
      fullName: "Ruslan Zholik",
      role: "Founder & CEO",
      email: "r.zholik@inxy.io",
    });
    expect(preview.rows[0].email1).toContain("Temat: Temat D0");
    expect(preview.rows[0].email2).toContain("Temat: Temat D3");
    expect(preview.rows[0].email3).toContain("Temat: Temat D6");
  });

  it("nie traktuje wiersza danych jako nagłówka, gdy nagłówek jest atrybutowany", async () => {
    const file = await buildAttributedXlsx();
    const preview = await parseCampaignFile(file);
    expect(preview.columns.slice(0, 5)).toEqual(["Kampania", "Firma", "Imię i nazwisko", "Stanowisko", "Adres e-mail"]);
  });
});

// Brakujący eksport z myślą o przyszłych testach CSV — plik CSV z BOM nadal działa.
describe("importer — sanity CSV z BOM", () => {
  it("pomija BOM i czyta wiersze", async () => {
    const csv = "\uFEFFKampania;Firma;Imię i nazwisko;Stanowisko;Adres e-mail;Temat 1;Treść 1;Temat 2;Treść 2;Temat 3;Treść 3\n" +
      "AI-MSP;Test Sp. z o.o.;Jan Testowicz;CEO;jan@testowicz.pl;T1;Treść pierwsza wystarczająco długa.;T2;Treść druga wystarczająco długa.;T3;Treść trzecia wystarczająco długa.";
    const file = xlsxFile("bom.csv", csv);
    const preview = await parseCampaignFile(file);
    expect(preview.issues).toEqual([]);
    expect(preview.rows).toHaveLength(1);
  });
});
