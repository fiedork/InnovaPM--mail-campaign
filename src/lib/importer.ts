import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { z, type ZodIssue } from "zod";

import {
  campaignImportRowSchema,
  contactSchema,
  formatCampaignMessage,
  normalizeCompanyName,
  type CampaignImportRow,
  type Contact,
  type ImportIssue,
  type ImportPreview,
} from "./domain";

type RowRecord = Record<string, string>;

const campaignAliases = {
  seriesName: ["seria", "nazwa serii", "kampania", "series", "series name"],
  companyName: ["firma", "nazwa firmy", "company", "company name"],
  fullName: ["imie i nazwisko", "imię i nazwisko", "osoba", "full name"],
  role: ["stanowisko", "rola", "role", "title"],
  email: ["adres e-mail", "email", "e-mail"],
  phone: ["telefon", "phone"],
  linkedin: ["linkedin", "profil linkedin"],
  note: ["notatka", "uwagi", "note"],
  email1: ["mail 1", "email 1", "wiadomosc 1", "wiadomość 1"],
  email2: ["mail 2", "email 2", "wiadomosc 2", "wiadomość 2"],
  email3: ["mail 3", "email 3", "wiadomosc 3", "wiadomość 3"],
  sector: ["sektor", "sector", "branza", "branża"],
  trigger: ["trigger", "trigger zakupowy", "wyzwanie"],
  packageName: ["pakiet", "pakiet innovapm", "oferta"],
  source: ["zrodlo", "źródło", "source"],
} satisfies Record<keyof CampaignImportRow, string[]>;

const messagePartAliases = [1, 2, 3].map((number) => ({
  subject: [`temat ${number}`, `subject ${number}`],
  body: [`tresc ${number}`, `treść ${number}`, `body ${number}`],
}));

const contactAliases = {
  companyName: ["nazwa firmy", "firma", "company", "company name"],
  fullName: ["imie i nazwisko", "imię i nazwisko", "osoba", "full name"],
  role: ["stanowisko", "rola", "role", "title"],
  email: ["adres e-mail", "email", "e-mail"],
  phone: ["telefon", "phone"],
  linkedin: ["linkedin", "profil linkedin"],
  source: ["zrodlo", "źródło", "source"],
  note: ["notatka", "uwagi", "note"],
} satisfies Record<keyof Omit<Contact, "id">, string[]>;

const contactImportSchema = contactSchema.extend({
  role: z.string().trim().default(""),
});

const knownHeaders = [
  ...Object.values(campaignAliases).flat(),
  ...Object.values(contactAliases).flat(),
  ...messagePartAliases.flatMap(({ subject, body }) => [...subject, ...body]),
].map(normalizeHeader);

function normalizeHeader(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function readRows(file: File): Promise<{
  rows: RowRecord[];
  columns: string[];
  rowOffset: number;
  rowNumbers: number[];
}> {
  const bytes = await file.arrayBuffer();
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Plik przekracza limit 10 MB.");
  }
  if (file.size > 2 * 1024 * 1024) {
    // Medium file guard — still allowed, but logged at BFF level.
  }

  if (file.name.toLowerCase().endsWith(".csv")) {
    return readCsv(new TextDecoder("utf-8").decode(bytes));
  }
  return readXlsx(bytes);
}

function recordsFromMatrix(
  matrix: string[][],
  physicalRowNumbers: number[] = matrix.map((_, index) => index + 1),
): {
  rows: RowRecord[];
  columns: string[];
  rowOffset: number;
  rowNumbers: number[];
} {
  const headerIndex = matrix.slice(0, 20).reduce(
    (best, row, index) => {
      const score = row.reduce((total, cell) => {
        const header = normalizeHeader(String(cell ?? ""));
        return (
          total +
          (knownHeaders.some(
            (known) =>
              header === known ||
              header.startsWith(`${known} `) ||
              header.startsWith(`${known} —`),
          )
            ? 1
            : 0)
        );
      }, 0);
      return score > best.score ? { index, score } : best;
    },
    { index: 0, score: 0 },
  ).index;
  const columns = matrix[headerIndex] ?? [];
  const rows: RowRecord[] = [];
  const rowNumbers: number[] = [];
  matrix.slice(headerIndex + 1).forEach((row, index) => {
    const record: RowRecord = {};
    columns.forEach((column, index) => {
      if (column) record[normalizeHeader(column)] = String(row[index] ?? "").trim();
    });
    if (Object.values(record).some(Boolean)) {
      rows.push(record);
      rowNumbers.push(
        physicalRowNumbers[headerIndex + index + 1] ?? headerIndex + index + 2,
      );
    }
  });
  return {
    rows,
    columns,
    rowOffset: (physicalRowNumbers[headerIndex] ?? headerIndex + 1) + 1,
    rowNumbers,
  };
}

function readCsv(text: string): {
  rows: RowRecord[];
  columns: string[];
  rowOffset: number;
  rowNumbers: number[];
} {
  const matrix: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const normalized = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index];
    if (char === '"') {
      if (quoted && normalized[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if ((char === "," || char === ";") && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && normalized[index + 1] === "\n") index++;
      row.push(field);
      if (row.some((value) => value.trim())) matrix.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) matrix.push(row);
  return recordsFromMatrix(matrix);
}

async function readXlsx(bytes: ArrayBuffer): Promise<{
  rows: RowRecord[];
  columns: string[];
  rowOffset: number;
  rowNumbers: number[];
}> {
  const zip = await JSZip.loadAsync(bytes);
  if (Object.keys(zip.files).length > 200) {
    throw new Error("Plik XLSX zawiera zbyt wiele elementów.");
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: false,
  });
  const workbookXml = await requiredZipText(zip, "xl/workbook.xml");
  const relationshipsXml = await requiredZipText(
    zip,
    "xl/_rels/workbook.xml.rels",
  );
  const workbook = parser.parse(workbookXml);
  const relationships = parser.parse(relationshipsXml);
  const sheets = asArray(workbook.workbook?.sheets?.sheet);
  if (!sheets.length) throw new Error("Plik nie zawiera arkusza.");
  const relationshipId = sheets[0].id;
  const relationship = asArray(relationships.Relationships?.Relationship).find(
    (item) => item.Id === relationshipId,
  );
  if (!relationship?.Target) throw new Error("Nie znaleziono danych pierwszego arkusza.");
  const target = String(relationship.Target)
    .replace(/^\/+/, "")
    .replace(/^xl\//, "");
  const sheetXml = await requiredZipText(zip, `xl/${target}`);
  const sheet = parser.parse(sheetXml);
  const sharedStrings = await readSharedStrings(zip, parser);
  const matrix: string[][] = [];
  const physicalRowNumbers: number[] = [];
  asArray(sheet.worksheet?.sheetData?.row).forEach((row) => {
    const values: string[] = [];
    asArray(row.c).forEach((cell) => {
      const reference = String(cell.r || "");
      const column = columnIndex(reference.replace(/[0-9]/g, ""));
      let value = "";
      if (cell.t === "s") value = sharedStrings[Number(cell.v)] ?? "";
      else if (cell.t === "inlineStr") value = richText(cell.is);
      else value = String(cell.v ?? "");
      values[column] = value;
    });
    matrix.push(values);
    physicalRowNumbers.push(Number(row.r) || physicalRowNumbers.length + 1);
  });
  return recordsFromMatrix(matrix, physicalRowNumbers);
}

async function readSharedStrings(
  zip: JSZip,
  parser: XMLParser,
): Promise<string[]> {
  const entry = zip.file("xl/sharedStrings.xml");
  if (!entry) return [];
  const parsed = parser.parse(await entry.async("string"));
  return asArray(parsed.sst?.si).map(richText);
}

function richText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(richText).join("");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.t !== undefined) return richText(record.t);
    if (record.r !== undefined) return richText(record.r);
  }
  return "";
}

function columnIndex(letters: string): number {
  let result = 0;
  for (const letter of letters.toUpperCase()) {
    result = result * 26 + letter.charCodeAt(0) - 64;
  }
  return Math.max(0, result - 1);
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function requiredZipText(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path);
  if (!entry) throw new Error(`Brak wymaganego elementu XLSX: ${path}`);
  return entry.async("string");
}

function valueFor(
  row: RowRecord,
  aliases: readonly string[],
  explicitColumn?: string,
): string {
  if (explicitColumn) return row[normalizeHeader(explicitColumn)] ?? "";
  const normalizedAliases = aliases.map(normalizeHeader);
  for (const alias of normalizedAliases) {
    if (Object.hasOwn(row, alias)) return row[alias];
  }
  for (const alias of normalizedAliases) {
    const key = Object.keys(row).find(
      (header) =>
        header.startsWith(`${alias} `) || header.startsWith(`${alias} —`),
    );
    if (key !== undefined) return row[key];
  }
  return "";
}

function campaignMessageFor(
  row: RowRecord,
  messageNumber: 1 | 2 | 3,
  explicitColumn?: string,
): string {
  const key = `email${messageNumber}` as const;
  if (explicitColumn) {
    return valueFor(row, campaignAliases[key], explicitColumn);
  }
  const { subject, body } = messagePartAliases[messageNumber - 1];
  const subjectValue = valueFor(row, subject);
  const bodyValue = valueFor(row, body);
  if (subjectValue || bodyValue) {
    return formatCampaignMessage(subjectValue, bodyValue);
  }
  return valueFor(row, campaignAliases[key]);
}

function zodIssues(row: number, issues: ZodIssue[]): ImportIssue[] {
  return issues.map((issue) => ({
    row,
    field: issue.path.join("."),
    message: issue.message,
  }));
}

export async function parseCampaignFile(
  file: File,
  mapping: Partial<Record<keyof CampaignImportRow, string>> = {},
): Promise<ImportPreview<CampaignImportRow>> {
  const source = await readRows(file);
  const rows: CampaignImportRow[] = [];
  const issues: ImportIssue[] = [];
  const duplicates = new Set<string>();
  const seenEmailsBySeries = new Set<string>();
  const seenCompaniesBySeries = new Set<string>();
  const seriesByEmail = new Map<string, Set<string>>();

  source.rows.forEach((record, index) => {
    const candidate = Object.fromEntries(
      Object.entries(campaignAliases).map(([key, aliases]) => [
        key,
        key === "email1" || key === "email2" || key === "email3"
          ? campaignMessageFor(
              record,
              Number(key.slice(-1)) as 1 | 2 | 3,
              mapping[key],
            )
          : valueFor(
              record,
              aliases,
              mapping[key as keyof CampaignImportRow],
            ),
      ]),
    );
    const parsed = campaignImportRowSchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push(
        ...zodIssues(
          source.rowNumbers[index] ?? index + source.rowOffset,
          parsed.error.issues,
        ),
      );
      return;
    }
    const series = normalizeHeader(parsed.data.seriesName);
    const seriesLabel = parsed.data.seriesName || "bez nazwy";
    const email = parsed.data.email.toLowerCase();
    const company = normalizeCompanyName(parsed.data.companyName);
    const emailInSeries = `${series}\u0000${email}`;
    const companyInSeries = `${series}\u0000${company}`;

    if (seenEmailsBySeries.has(emailInSeries)) {
      duplicates.add(
        `E-mail ${parsed.data.email} powtórzony w serii „${seriesLabel}”`,
      );
    }
    if (seenCompaniesBySeries.has(companyInSeries)) {
      duplicates.add(
        `Firma ${parsed.data.companyName} powtórzona w serii „${seriesLabel}”`,
      );
    }
    seenEmailsBySeries.add(emailInSeries);
    seenCompaniesBySeries.add(companyInSeries);

    const contactSeries = seriesByEmail.get(email) ?? new Set<string>();
    if (!contactSeries.has(series) && contactSeries.size > 0) {
      duplicates.add(`Kontakt ${parsed.data.email} występuje w wielu seriach`);
    }
    contactSeries.add(series);
    seriesByEmail.set(email, contactSeries);
    rows.push(parsed.data);
  });

  return {
    rows,
    issues,
    duplicates: [...duplicates],
    columns: source.columns,
  };
}

export async function parseContactsFile(
  file: File,
  mapping: Partial<Record<keyof Omit<Contact, "id">, string>> = {},
): Promise<ImportPreview<Contact>> {
  const source = await readRows(file);
  const rows: Contact[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  source.rows.forEach((record, index) => {
    const candidate = Object.fromEntries(
      Object.entries(contactAliases).map(([key, aliases]) => [
        key,
        valueFor(record, aliases, mapping[key as keyof Omit<Contact, "id">]),
      ]),
    );
    const parsed = contactImportSchema.safeParse(candidate);
    if (!parsed.success) {
      issues.push(
        ...zodIssues(
          source.rowNumbers[index] ?? index + source.rowOffset,
          parsed.error.issues,
        ),
      );
      return;
    }
    const duplicateKey = parsed.data.email.toLowerCase();
    if (seen.has(duplicateKey)) duplicates.add(parsed.data.email);
    seen.add(duplicateKey);
    rows.push(parsed.data);
  });

  return {
    rows,
    issues,
    duplicates: [...duplicates],
    columns: source.columns,
  };
}
