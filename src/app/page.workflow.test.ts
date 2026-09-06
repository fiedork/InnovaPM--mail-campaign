import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");

describe("workflow sekwencji", () => {
  it("renderuje pełne widoki kampanii i monitoringu", () => {
    expect(source).toContain('view === "campaigns"');
    expect(source).toContain('view === "monitoring"');
  });

  it("ładuje kampanię, wykonuje transitionCampaign i zapisuje wiadomość", () => {
    expect(source).toContain("async function loadCampaign");
    expect(source).toContain("async function transition(");
    expect(source).toContain("async function saveCampaignMessage");
  });

  it("nie renderuje edytora sekwencji bez jawnie potwierdzonego aktywnego odbiorcy", () => {
    expect(source).toContain("selectedSequenceCompany.hasActiveRecipient === true");
  });

  it("pokazuje operatorowi alert, gdy heartbeat Apps Script nie odpowiada", () => {
    expect(source).toContain("Backend Apps Script nie odpowiada");
  });

  it("przywraca archiwalną kampanię wyłącznie do ponownej akceptacji", () => {
    expect(source).toContain("async function restoreCampaign()");
    expect(source).toContain("async function restoreArchivedCampaign");
    expect(source).toContain("/restore");
    expect(source).toContain("Przywróć do akceptacji");
  });

  it("pozwala wyczyścić historię kampanii wyłącznie po potwierdzeniu", () => {
    expect(source).toContain("async function clearCampaignActivity()");
    expect(source).toContain("/clear-activity");
    expect(source).toContain("Wyczyść aktywność");
  });

  it("umożliwia anulowanie uruchomionej kampanii z rejestru", () => {
    expect(source).toContain("async function cancelCampaignFromRegistry");
    expect(source).toContain("/cancel");
    expect(source).toContain("Zaplanowane, niewysłane wiadomości nie zostaną wysłane.");
    expect(source).toContain(">Anuluj</button>");
  });

  it("przywraca anulowaną kampanię do korekty", () => {
    expect(source).toContain("async function reopenCancelledCampaign()");
    expect(source).toContain("/reopen");
    expect(source).toContain("Przywróć do korekty");
  });

  it("przechodzi z uruchomionej kampanii bezpośrednio do korekty ustawień", () => {
    expect(source).toContain("async function prepareCampaignForCorrection()");
    expect(source).toContain('transition("prepare-correction", "needs_review")');
    expect(source).toContain('["approved", "active", "paused"].includes(status)');
    expect(source).toContain("Przejdź do korekty ustawień");
  });

  it("rozpoznaje tryb LIVE niezależnie od wielkości liter zapisu w arkuszu", () => {
    expect(source).toContain("function isDryRun(value: unknown): boolean");
    expect(source).toContain('String(value).trim().toLowerCase() !== "false"');
  });

  it("pozwala ustawić limit dzienny do 40 wiadomości", () => {
    expect(source).toContain("const MAX_DAILY_LIMIT = 40;");
    expect(source).toContain("max={MAX_DAILY_LIMIT}");
  });

  it("pozwala wybrać datę startu kampanii przed zatwierdzeniem", () => {
    expect(source).toContain('type="date"');
    expect(source).toContain("campaignStartDate");
    expect(source).toContain("Data startu kampanii");
  });

  it("pozwala tworzyć nazwane stopki i wybrać stopkę dla kampanii", () => {
    expect(source).toContain("type FooterProfile");
    expect(source).toContain("Nowa stopka");
    expect(source).toContain("Ustaw jako domyślną");
    expect(source).toContain("Usuń stopkę");
    expect(source).toContain("Stopka kampanii");
    expect(source).toContain("campaignFooterId");
  });

  it("udostępnia stopkę InnovaPM Media i wyjaśnia blokadę wyboru po zatwierdzeniu", () => {
    expect(source).toContain('id: "footer-media"');
    expect(source).toContain('name: "InnovaPM Media"');
    expect(source).toContain("Wybór stopki jest zablokowany po zatwierdzeniu");
  });

  it("zapisuje bieżące ustawienia przed przekazaniem kampanii do akceptacji lub zatwierdzeniem", () => {
    expect(source).toContain(
      'if (["review", "approve"].includes(action)) await persistCampaignSettings();',
    );
  });

  it("nie pokazuje globalnej etykiety trybu wysyłki w nagłówku", () => {
    expect(source).not.toContain("displayedDryRun");
  });

  it("pozwala usunąć firmę z kampanii wyłącznie przed zatwierdzeniem", () => {
    expect(source).toContain("async function removeCampaignCompany");
    expect(source).toContain('method: "DELETE"');
    expect(source).toContain("Usuń firmę");
    expect(source).toContain('canRemove && <button type="button" className="button compact danger"');
    expect(source).toContain('const canRemove = !archived && ["draft", "needs_review"].includes(status);');
  });

  it("weryfikuje faktyczny status po przerwanej zmianie statusu", () => {
    expect(source).toContain("if (backend)");
    expect(source).toContain("result.data?.campaign?.status === next");
    expect(source).toContain("Potwierdzenie odpowiedzi backendu było opóźnione.");
  });
});
