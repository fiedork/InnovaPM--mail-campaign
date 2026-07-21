import { describe, expect, it } from "vitest";

import {
  allowedRoles,
  buildSequenceSchedule,
  campaignImportRowSchema,
  canTransitionCampaign,
  contactSchema,
  formatCampaignMessage,
  getCampaignReadiness,
  normalizeCompanyName,
  parseCampaignMessage,
} from "./domain";
import { parseCampaignFile } from "./importer";

function csvFile(headers: string[], rows: string[][]): File {
  const encode = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return new File(
    [[headers, ...rows].map((row) => row.map(encode).join(";")).join("\n")],
    "kampania.csv",
    { type: "text/csv" },
  );
}

const legacyCampaignHeaders = [
  "Seria",
  "Firma",
  "Imię i nazwisko",
  "Stanowisko",
  "Email",
  "Mail 1",
  "Mail 2",
  "Mail 3",
];

function legacyCampaignRow(
  series: string,
  company: string,
  email: string,
): string[] {
  return [
    series,
    company,
    "Jan Kowalski",
    "Prezes",
    email,
    "Temat: Pierwszy kontakt\n\nTreść pierwszej wiadomości.",
    "Temat: Przypomnienie\n\nTreść drugiej wiadomości.",
    "Temat: Ostatni kontakt\n\nTreść trzeciej wiadomości.",
  ];
}

describe("allowedRoles", () => {
  it("contains the supported contact roles", () => {
    expect(allowedRoles).toEqual([
      "Prezes",
      "CEO",
      "Właściciel",
      "Dyrektor operacyjny",
    ]);
  });

  it("accepts a manually entered role", () => {
    const result = contactSchema.safeParse({
      companyName: "InnovaPM",
      fullName: "Jan Kowalski",
      role: "Pełnomocnik zarządu",
      email: "jan.kowalski@example.com",
    });
    expect(result.success).toBe(true);
  });
});

describe("normalizeCompanyName", () => {
  it("normalizes Polish legal suffixes and diacritics", () => {
    expect(normalizeCompanyName("Żabka Polska sp. z o.o.")).toBe("zabka polska");
  });
});

describe("buildSequenceSchedule", () => {
  it("moves weekend dates to Monday", () => {
    const schedule = buildSequenceSchedule(new Date("2026-07-17T09:00:00Z"));
    expect(schedule.map((date) => date.toISOString().slice(0, 10))).toEqual([
      "2026-07-17",
      "2026-07-20",
      "2026-07-23",
    ]);
  });
});

describe("campaign transitions", () => {
  it("allows pause but not direct completion from approved", () => {
    expect(canTransitionCampaign("active", "paused")).toBe(true);
    expect(canTransitionCampaign("approved", "completed")).toBe(false);
  });
});

describe("campaign message content", () => {
  it("round-trips a personalized subject and body", () => {
    const raw = formatCampaignMessage("Temat dla klienta", "Dzień dobry, Janie.");
    expect(parseCampaignMessage(raw)).toEqual({
      subject: "Temat dla klienta",
      body: "Dzień dobry, Janie.",
    });
  });

  it("reports a campaign ready only with an active recipient and three complete messages", () => {
    const readyRow = {
      fullName: "Jan Kowalski",
      role: "CEO",
      email: "jan@example.com",
      hasActiveRecipient: true,
      email1: "Temat: Pierwszy\n\nTreść pierwsza",
      email2: "Temat: Drugi\n\nTreść druga",
      email3: "Temat: Trzeci\n\nTreść trzecia",
    };

    expect(getCampaignReadiness([readyRow])).toEqual({
      ready: true,
      recipientsReady: 1,
      recipientsTotal: 1,
      incompleteMessages: 0,
    });
    expect(
      getCampaignReadiness([{ ...readyRow, hasActiveRecipient: false }]).ready,
    ).toBe(false);
    expect(
      getCampaignReadiness([
        { ...readyRow, hasActiveRecipient: undefined },
      ]).ready,
    ).toBe(false);
    expect(
      getCampaignReadiness([{ ...readyRow, email2: "Temat: Drugi" }])
        .incompleteMessages,
    ).toBe(1);
  });

  it("treats an empty Temat line as an incomplete subject", () => {
    expect(parseCampaignMessage("Temat:\n\nTreść")).toEqual({
      subject: "",
      body: "Treść",
    });
  });
});

describe("campaign import", () => {
  it("accepts the expanded campaign row domain", () => {
    const parsed = campaignImportRowSchema.safeParse({
      seriesName: "PMO — seria 1",
      companyName: "InnovaPM",
      fullName: "Jan Kowalski",
      role: "Prezes",
      email: "jan@example.com",
      email1: "Pierwsza wiadomość kampanii",
      email2: "Druga wiadomość kampanii",
      email3: "Trzecia wiadomość kampanii",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phone).toBe("");
      expect(parsed.data.source).toBe("");
    }
  });

  it("maps contact aliases and composes separate subjects and bodies", async () => {
    const file = csvFile(
      [
        "Seria",
        "Nazwa firmy",
        "Imię i nazwisko",
        "Rola",
        "Email",
        "Telefon",
        "Profil LinkedIn",
        "Uwagi",
        "Temat 1",
        "Treść 1",
        "Temat 2",
        "Treść 2",
        "Temat 3",
        "Treść 3",
        "Branża",
        "Wyzwanie",
        "Oferta",
        "Źródło",
      ],
      [[
        "PMO — seria 1",
        "Acme sp. z o.o.",
        "Anna Nowak",
        "CEO",
        "anna@example.com",
        "+48 123 456 789",
        "https://linkedin.com/in/anna",
        "Kontakt z konferencji",
        "Rozmowa o PMO",
        "Dzień dobry, porozmawiajmy o priorytetach.",
        "Wracam do tematu",
        "Czy temat jest nadal aktualny?",
        "Ostatnia wiadomość",
        "Zamykam pętlę kontaktu.",
        "Produkcja",
        "Wzrost portfela projektów",
        "PMO Launch",
        "Konferencja",
      ]],
    );

    const preview = await parseCampaignFile(file);

    expect(preview.issues).toEqual([]);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({
      seriesName: "PMO — seria 1",
      companyName: "Acme sp. z o.o.",
      fullName: "Anna Nowak",
      role: "CEO",
      email: "anna@example.com",
      phone: "+48 123 456 789",
      linkedin: "https://linkedin.com/in/anna",
      note: "Kontakt z konferencji",
      email1:
        "Temat: Rozmowa o PMO\n\nDzień dobry, porozmawiajmy o priorytetach.",
      sector: "Produkcja",
      trigger: "Wzrost portfela projektów",
      packageName: "PMO Launch",
      source: "Konferencja",
    });
  });

  it("keeps Email separate from legacy Email 1", async () => {
    const headers = legacyCampaignHeaders.with(5, "Email 1");
    const preview = await parseCampaignFile(
      csvFile(headers, [legacyCampaignRow("Seria A", "Acme", "jan@example.com")]),
    );

    expect(preview.issues).toEqual([]);
    expect(preview.rows[0].email).toBe("jan@example.com");
    expect(preview.rows[0].email1).toContain("Pierwszy kontakt");
  });

  it("reports repeated email and company in a series and contact across series", async () => {
    const preview = await parseCampaignFile(
      csvFile(legacyCampaignHeaders, [
        legacyCampaignRow("Seria A", "Acme sp. z o.o.", "jan@example.com"),
        legacyCampaignRow("Seria A", "ACME", "JAN@example.com"),
        legacyCampaignRow("Seria B", "Beta", "jan@example.com"),
      ]),
    );

    expect(preview.issues).toEqual([]);
    expect(preview.duplicates).toEqual([
      "E-mail JAN@example.com powtórzony w serii „Seria A”",
      "Firma ACME powtórzona w serii „Seria A”",
      "Kontakt jan@example.com występuje w wielu seriach",
    ]);
  });
});
