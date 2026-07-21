import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Apps Script HMAC contract", () => {
  it("uses UTF-8 explicitly for every HMAC-SHA256 signature", () => {
    const source = readFileSync("apps-script/Code.gs", "utf8");
    const calls = source.match(/Utilities\.computeHmacSha256Signature\([\s\S]*?\)/g) ?? [];

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call).toContain("Utilities.Charset.UTF_8");
    }
  });

  it("writes imported contacts and audit events in batches", () => {
    const source = readFileSync("apps-script/Code.gs", "utf8");
    const importContacts = source.match(
      /function importContacts_\(payload\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(importContacts).toContain('appendObjects_("Companies", companiesToCreate)');
    expect(importContacts).toContain('appendObjects_("Contacts", contactsToCreate)');
    expect(importContacts).toContain('appendObjects_("Events", eventsToCreate)');
    expect(importContacts).not.toContain('appendObject_("Contacts"');
  });

  it("supports legacy recipient migration and the complete review transition", () => {
    const source = readFileSync("apps-script/Code.gs", "utf8");

    expect(source).toContain("migrateLegacyRecipients_");
    expect(source).toContain('upsertSetting_("schemaVersion", "2")');
    expect(source).toContain('review: "needs_review"');
    expect(source).toContain("assertRecipientMutable_");
    expect(source).toContain("dokładnie jednego aktywnego odbiorcę");
  });

  it("changes active campaigns only when the global footer actually changes", () => {
    const source = readFileSync("apps-script/Code.gs", "utf8");
    const updateSettings = source.match(
      /function updateSettings_\(payload\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(updateSettings).toContain(
      'html !== String(currentSettings.emailFooterHtml || "")',
    );
    expect(updateSettings).toContain("withMutationLock_");
  });

  it("locks recipient identity after correspondence and revalidates it before sending", () => {
    const source = readFileSync("apps-script/Code.gs", "utf8");

    expect(source).toContain("assertContactIdentityMutable_(current, payload)");
    expect(source).toContain("function assertContactIdentityMutable_(current, payload)");
    expect(source).toContain("Nie można zmienić adresu e-mail ani firmy kontaktu po rozpoczęciu korespondencji.");
    expect(source).toContain("Adres e-mail jest już przypisany do innego kontaktu.");
    expect(source).toContain("Odbiorca nie jest aktywnym kontaktem: ");
    expect(source).toContain("assertMessageSafeToSend_(campaign, message, contact);");
    expect(source).toContain("function assertMessageSafeToSend_(campaign, message, contact)");
    expect(source).toContain("Wiadomość nie należy do aktywnej serii.");
    expect(source).toContain("Wiadomość nie wskazuje aktywnego odbiorcy.");
    expect(source).toContain("Nie można użyć istniejącego wątku Gmail dla innego odbiorcy.");
  });

  it("updateMessage_ requires active recipient and refuses edits after approval", () => {
    const source = readFileSync("apps-script/Code.gs", "utf8");
    const updateMessage = source.match(
      /function updateMessage_\(payload\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(updateMessage).toContain("requireById_(\"Campaigns\", current.campaignId)");
    expect(updateMessage).toContain("Nie można edytować wiadomości po zatwierdzeniu serii.");
    expect(updateMessage).toContain("Firma w serii nie ma dokładnie jednego aktywnego odbiorcy.");
    expect(updateMessage).toContain("Wiadomość nie wskazuje aktywnego odbiorcy serii.");
  });
});
