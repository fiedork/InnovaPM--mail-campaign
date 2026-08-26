import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function getAppsScriptSource(): string {
  const dir = "apps-script";
  const files = readdirSync(dir).filter((f) => f.endsWith(".gs"));
  return files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n\n");
}

describe("Apps Script HMAC contract", () => {
  it("publishes the modular backend through clasp", () => {
    const ignore = readFileSync("apps-script/.claspignore", "utf8");

    expect(ignore).toContain("!*.gs");
  });

  it("times out calls to an unresponsive Apps Script backend", () => {
    const source = readFileSync("src/lib/apps-script.ts", "utf8");

    expect(source).toContain("AbortSignal.timeout(55_000)");
    expect(source).toContain("signal,");
  });

  it("uses UTF-8 explicitly for every HMAC-SHA256 signature", () => {
    const source = getAppsScriptSource();
    const calls = source.match(/Utilities\.computeHmacSha256Signature\([\s\S]*?\)/g) ?? [];

    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call).toContain("Utilities.Charset.UTF_8");
    }
  });

  it("writes imported contacts and audit events in batches", () => {
    const source = getAppsScriptSource();
    const importContacts = source.match(
      /function importContacts_\(payload\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(importContacts).toContain('appendObjects_("Companies", companiesToCreate)');
    expect(importContacts).toContain('appendObjects_("Contacts", contactsToCreate)');
    expect(importContacts).toContain('appendObjects_("Events", eventsToCreate)');
    expect(importContacts).not.toContain('appendObject_("Contacts"');
  });

  it("supports legacy recipient migration and the complete review transition", () => {
    const source = getAppsScriptSource();

    expect(source).toContain("migrateLegacyRecipients_");
    expect(source).toContain('upsertSetting_("schemaVersion", "2")');
    expect(source).toContain('review: "needs_review"');
    expect(source).toContain("assertRecipientMutable_");
    expect(source).toContain("dokładnie jednego aktywnego odbiorcę");
  });

  it("restores archived campaigns without scheduling a send", () => {
    const source = getAppsScriptSource();
    const restoreCampaign = source.match(
      /function restoreCampaign_\(payload\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(restoreCampaign).toContain('status: "needs_review"');
    expect(restoreCampaign).toContain('archivedAt: ""');
    expect(restoreCampaign).not.toContain("scheduleCampaign_");
  });

  it("restores cancelled campaigns to correction without touching sent messages", () => {
    const source = getAppsScriptSource();

    expect(source).toContain('cancelled: ["needs_review"]');
    expect(source).toContain('reopen: "needs_review"');
    expect(source).toContain('if (payload.action === "reopen") restoreCancelledMessages_(current.id);');
    expect(source).toContain('"prepare-correction": "needs_review"');
    expect(source).toContain('if (payload.action === "prepare-correction")');
    expect(source).toContain("function restoreCancelledMessages_(campaignId)");
    expect(source).toContain('message.status === "cancelled"');
    expect(source).toContain('status: "draft"');
  });

  it("clears campaign activity without deleting contacts, content, or global suppression", () => {
    const source = getAppsScriptSource();
    const reset = source.match(
      /function clearCampaignActivity_\(payload\) \{[\s\S]*?\n\}/,
    )?.[0] ?? "";

    expect(reset).toContain('status: "draft"');
    expect(reset).toContain('trackingKey: Utilities.getUuid()');
    expect(reset).toContain('status: "needs_review"');
    expect(reset).toContain('preserved: ["contacts", "recipients", "message_content", "global_suppression"]');
    expect(reset).not.toContain('deleteRowsWhere_("Contacts"');
    expect(reset).not.toContain('deleteRowsWhere_("Suppression"');
  });

  it("invalidates old tracking pixels when activity is cleared", () => {
    const source = getAppsScriptSource();

    expect(source).toContain('message.id + (message.trackingKey ? ":" + message.trackingKey : "")');
    expect(source).toContain('const tokenPayload = messageId + (current.trackingKey ? ":" + current.trackingKey : "");');
  });

  it("validates campaign recipients using one contact lookup pass", () => {
    const source = getAppsScriptSource();
    const validation = source.match(
      /function validateCampaignReady_\(campaignId, options\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(validation).toContain("const contactsById = {};");
    expect(validation).toContain("const contact = contactsById[recipient.contactId];");
    expect(validation).not.toContain('requireById_("Contacts", recipient.contactId)');
  });

  it("initializes the workbook schema only once per version", () => {
    const source = getAppsScriptSource();

    expect(source).toContain('const WORKBOOK_SCHEMA_VERSION = "7"');
    expect(source).toContain('getProperty("WORKBOOK_SCHEMA_VERSION") === WORKBOOK_SCHEMA_VERSION');
    expect(source).toContain('setProperty("WORKBOOK_SCHEMA_VERSION", WORKBOOK_SCHEMA_VERSION)');
  });

  it("stores named footer profiles and invalidates only campaigns whose effective footer changes", () => {
    const source = getAppsScriptSource();
    const updateSettings = source.match(
      /function updateSettings_\(payload\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(source).toContain('"footerId"');
    expect(source).toContain("function footerProfiles_");
    expect(source).toContain("function effectiveFooterProfile_");
    expect(source).toContain("function migrateFooterProfiles_");
    expect(source).toContain('upsertSetting_("footerProfile:" + profile.id, profile.html)');
    expect(source).toContain("footerProfileIndexJson");
    expect(updateSettings).toContain("effectiveFooterProfile_(campaign, currentSettings)");
    expect(updateSettings).toContain("effectiveFooterProfile_(campaign, nextSettings)");
    expect(updateSettings).toContain("withMutationLock_");
    expect(updateSettings).not.toContain('footerProfilesJson: JSON.stringify(footerProfiles)');
  });

  it("seeds the InnovaPM Media footer in existing workbooks", () => {
    const source = getAppsScriptSource();

    expect(source).toContain("function mediaFooterProfile_");
    expect(source).toContain('id: "footer-media"');
    expect(source).toContain('name: "InnovaPM Media"');
    expect(source).toContain("InnovaPM Media | Kampanie cross-mediowe");
  });

  it("uses the footer selected for a campaign in approval and MIME output", () => {
    const source = getAppsScriptSource();

    expect(source).toContain("footerId: footerProfile.id");
    expect(source).toContain("footerHash: footerHash");
    expect(source).toContain("const footerHtml = sanitizeEmailHtml_(effectiveCampaignFooterHtml_(campaign));");
    expect(source).toContain("buildMime_(recipient, subject, message.body, outboundMessage, campaign, true");
    expect(source).toContain("Stopka kampanii zmieniona od zatwierdzenia");
  });

  it("locks recipient identity after correspondence and revalidates it before sending", () => {
    const source = getAppsScriptSource();
    const assertContactIdentityMutable = source.match(
      /function assertContactIdentityMutable_\(current, payload\) \{[\s\S]*?\n\}/,
    )?.[0];
    const assertMessageSafeToSend = source.match(
      /function assertMessageSafeToSend_\(campaign, message, contact\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(assertContactIdentityMutable).toContain(
      'message.contactId === current.id && (message.sentAt || message.threadId || message.gmailMessageId)',
    );
    expect(assertMessageSafeToSend).toContain(
      'recipient.contactId !== message.contactId',
    );
    expect(assertMessageSafeToSend).toContain(
      'contact.companyId !== message.companyId',
    );
  });

  it("flushes and verifies a recipient assignment before reporting success", () => {
    const source = getAppsScriptSource();
    const selectRecipient = source.match(
      /function selectRecipient_\(payload\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(selectRecipient).toContain("SpreadsheetApp.flush();");
    expect(selectRecipient).toContain('requireById_("Recipients", recipient.id)');
    expect(selectRecipient).toContain("!isActiveFlag_(savedRecipient.active)");
    expect(selectRecipient).toContain("Przypisanie odbiorcy nie zostało poprawnie zapisane.");
    expect(source).toContain('function isActiveFlag_(value)');
    expect(source).toContain("repairRecipientAssignments_();");
    expect(source).toContain("function repairRecipientAssignments_()");
    expect(source).toContain("recipientTimestamp_(a)");
    expect(source).toContain("unique_(campaignRecipients.map(function(recipient) { return recipient.companyId; })).length");
    expect(source).toContain("const activeRecipientsByCompany = {};");
    expect(source).not.toContain('String(recipient.active) === "true"');
    expect(source).toContain("const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];");
    expect(source).toContain("values.length, headers.length).setValues(values)");
    expect(source).toContain("SpreadsheetApp.flush();\n    return result;");
  });

  it("submits recipient assignment from the select value instead of transient component state", () => {
    const source = readFileSync("src/app/page.tsx", "utf8");

    expect(source).toContain("async function assign(index: number, selectedContactId: string)");
    expect(source).toContain("await onAssign(index, selectedContactId)");
  });

  it("updateMessage_ requires active recipient and refuses edits after approval", () => {
    const source = getAppsScriptSource();
    const updateMessage = source.match(
      /function updateMessage_\(payload\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(updateMessage).toContain("Firma w kampanii nie ma dokładnie jednego aktywnego odbiorcy.");
    expect(updateMessage).toContain("Wiadomość nie wskazuje aktywnego odbiorcy kampanii.");
    expect(updateMessage).toContain("Nie można edytować wiadomości po zatwierdzeniu kampanii.");
  });

  it("normalizes sequence delays and saves them in settings and campaign records", () => {
    const source = getAppsScriptSource();

    expect(source).toContain('"mail2DelayBusinessDays"');
    expect(source).toContain('"mail3DelayBusinessDays"');
    expect(source).toContain('setDefault_("mail2DelayBusinessDays", "3")');
    expect(source).toContain('setDefault_("mail3DelayBusinessDays", "3")');
    expect(source).toContain("function normalizeDelayDays_(value)");
  });

  it("stores and validates a campaign start date before scheduling", () => {
    const source = getAppsScriptSource();

    expect(source).toContain('"startDate"');
    expect(source).toContain("function normalizeCampaignStartDate_(value)");
    expect(source).toContain("function plannedCampaignStart_(campaign)");
    expect(source).toContain("assertCampaignStartNotPast_(campaign.startDate)");
    expect(source).toContain('allowPastStartDate: target === "needs_review"');
    expect(source).toContain("allowPastStartDate: true");
    expect(source).toContain("startDate: String(normalizeCampaignStartDate_");
    expect(source).toContain("Data startu zmieniona od zatwierdzenia");
  });

  it("uses hourly spacing and rechecks the live daily cap before every send", () => {
    const source = getAppsScriptSource();

    expect(source).toContain("const MAX_DAILY_LIMIT = 40;");
    expect(source).toContain("Math.min(Number(campaign.dailyLimit || 20), MAX_DAILY_LIMIT)");
    expect(source).toContain("limit > MAX_DAILY_LIMIT");
    expect(source).toContain("function isDryRun_(value)");
    expect(source).toContain('String(value).trim().toLowerCase() !== "false"');
    expect(source).toContain("const dryRun = isDryRun_(campaign.dryRun);");
    expect(source).toContain("if (!withinSendWindow_(campaign)) break;");
    expect(source).toContain("if (!dryRun && sentTodayCount_(campaign.id) >= dailyLimit) break;");
    expect(source).toContain('addHours_(start, Math.max(0, Number(message.step || 1) - 1))');
  });

  it("tracks dry-run opens and dry-run self replies for campaign monitoring", () => {
    const source = getAppsScriptSource();

    expect(source).toContain("buildMime_(recipient, subject, message.body, outboundMessage, campaign, true)");
    expect(source).toContain("else if (dryRun && isDryRunReply_(thread, campaignThreadMessages)) markThreadReplied_(message.threadId);");
  });

  it("keeps dry-run and live thread identities separate", () => {
    const source = getAppsScriptSource();
    const messages = source.match(/function sendMessage_\(campaign, message\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    const propagate = source.match(/function propagateThread_\([\s\S]*?\n\}/)?.[0] ?? "";

    expect(source).toContain('Messages: ["id", "campaignId", "companyId", "contactId", "step", "subject", "body", "scheduledAt", "status", "gmailMessageId", "threadId", "sendMode", "attempts"');
    expect(source).toContain("function deliveryMode_(campaign)");
    expect(messages).toContain("const deliveryMode = deliveryMode_(campaign);");
    expect(messages).toContain("message.sendMode === deliveryMode");
    expect(messages).toContain("sendMode: deliveryMode");
    expect(propagate).toContain("message.sendMode === deliveryMode || !message.sendMode");
    expect(propagate).toContain("message.contactId === contactId");
    expect(propagate).toContain('["draft", "scheduled", "failed"].indexOf(message.status) !== -1');
    expect(propagate).toContain("sendMode: deliveryMode");
    expect(source).toContain("message.sendMode === deliveryMode_(campaign)");
    expect(source).toContain("item.sendMode === message.sendMode");
    expect(source).toContain("const deliveryMode = affected[0].sendMode;");
    expect(source).toContain('"smtp:" + deliveryMode + ":" + message.campaignId + ":" + message.companyId');
  });

  it("returns per-step monitoring percentages for the three sequence charts", () => {
    const source = getAppsScriptSource();

    expect(source).toContain("const steps = [1, 2, 3].map(function(step)");
    expect(source).toContain("openRate: percent_(stepOpened, stepSent)");
    expect(source).toContain("replyRate: percent_(stepReplies, stepSent)");
    expect(source).toContain("bounceRate: percent_(stepBounces, stepSent)");
  });

  it("checks approval snapshot at start and exposes backend trigger readiness", () => {
    const source = getAppsScriptSource();
    const transitionCampaign = source.match(
      /function transitionCampaign_\(payload\) \{[\s\S]*?\n\}/,
    )?.[0];
    const nextWindowStart = source.match(
      /function nextWindowStart_\(date, campaign\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(transitionCampaign).toContain('payload.action === "start" && target === "active" && current.status === "approved"');
    expect(source).toContain("getBackendStatus: getBackendStatus_");
    expect(source).toContain("function getBackendStatus_()");
    expect(source).toContain("queueTriggerInstalled: triggerCounts.runQueue === 1");
    expect(source).toContain("replyTriggerInstalled: triggerCounts.checkReplies === 1");
    expect(source).toContain('payload.confirmLive !== true');
    expect(source).toContain("Start LIVE wymaga jawnego potwierdzenia checklisty wysyłki.");
    expect(source).toContain("function assertOperationalTriggers_()");
    expect(source).toContain("assertOperationalTriggers_();");
    expect(source).toContain('throw new Error("Start zablokowany: brak aktywnego triggera runQueue.")');
    expect(nextWindowStart).toContain("date.getTime() > end.getTime()");
    expect(nextWindowStart).toContain("next.setHours(Number(sendFrom[0]), Number(sendFrom[1]), 0, 0)");
  });

  it("can route campaign sends through the Hostinger SMTP relay without requiring a Gmail alias", () => {
    const source = getAppsScriptSource();

    expect(source).toContain('setDefault_("sendTransport", "smtp")');
    expect(source).toContain('sendTransport_(campaign) === "smtp"');
    expect(source).toContain("function sendViaSmtpRelay_(payload)");
    expect(source).toContain("https://innovapm-mail-campaign.netlify.app/api/smtp/send");
    expect(source).toContain('threadId = threadId || "smtp:" + deliveryMode + ":" + message.campaignId + ":" + message.companyId;');
    expect(source).toContain('if (String(message.threadId).indexOf("smtp:") === 0) return;');
  });

  it("binds the send transport to approval and rechecks it immediately before send", () => {
    const source = getAppsScriptSource();
    const snapshot = source.match(/function buildApprovalSnapshot_\(campaignId\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    const preSend = source.match(/function assertPreSendApproval_\(campaign\) \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(snapshot).toContain("sendTransport: sendTransport_(campaign)");
    expect(source).toContain("String(approved.sendTransport) !== String(current.sendTransport)");
    expect(preSend).toContain("assertApprovalSnapshotMatch_(approvedSnapshot, currentSnapshot)");
    expect(preSend).toContain("String(approvedSnapshot.sendTransport) !== String(sendTransport_(campaign))");
    expect(source).toContain("assertTransportCompatibleWithHistory_(current)");
    expect(source).toContain("function assertTransportCompatibleWithHistory_(campaign)");
    expect(source).toContain("if (sendTransport_(campaign) === \"smtp\")");
    expect(source).toContain("invalidateTransportApprovals_");
  });

  it("stores a compact approval content hash instead of all personalized messages", () => {
    const source = getAppsScriptSource();
    const snapshot = source.match(
      /function buildApprovalSnapshot_\(campaignId\) \{[\s\S]*?\n\}/,
    )?.[0] ?? "";

    expect(snapshot).toContain("contentHash: approvalContentHash_(companies)");
    expect(snapshot).not.toContain("companies: companies");
    expect(source).toContain(
      "const approvedContentHash = approved.contentHash || approvalContentHash_(approved.companies || []);",
    );
  });

  it("allows idempotent retries after an approval response is interrupted", () => {
    const source = getAppsScriptSource();

    expect(source).toContain("function hasOperationalSettingChanges_(current, payload)");
    expect(source).toContain("if (current.status === target) return current;");
  });

  it("exposes recipient-level activity in campaign recipient details", () => {
    const source = getAppsScriptSource();

    expect(source).toContain("openedSteps: openedSteps");
    expect(source).toContain("sentSteps: sentSteps");
    expect(source).toContain("replied: replied");
    expect(source).toContain("bounced: bounced");
    expect(source).toContain("message.lastError === \"bounce\"");
  });

  it("reserves request nonces atomically before accepting an envelope", () => {
    const source = getAppsScriptSource();
    const verifyEnvelope = source.match(
      /function verifyEnvelope_\(envelope\) \{[\s\S]*?\n\}/,
    )?.[0] ?? "";

    expect(verifyEnvelope).toContain("LockService.getUserLock()");
    expect(verifyEnvelope).not.toContain("LockService.getScriptLock()");
    expect(verifyEnvelope).toContain("lock.tryLock(");
    expect(verifyEnvelope).toContain('cache.put("nonce:" + envelope.nonce, "1", 600)');
    expect(verifyEnvelope.indexOf("lock.tryLock(")).toBeLessThan(
      verifyEnvelope.indexOf('cache.get("nonce:" + envelope.nonce)'),
    );
    expect(verifyEnvelope.indexOf('cache.put("nonce:" + envelope.nonce')).toBeLessThan(
      verifyEnvelope.indexOf("lock.releaseLock()"),
    );
  });

  it("checks Hostinger IMAP mailbox when SMTP transport is active", () => {
    const source = getAppsScriptSource();

    expect(source).toContain('if (sendTransport_() === "smtp")');
    expect(source).toContain("checkSmtpMailbox_(sentMessages)");
    expect(source).toContain("function callImapRelay_(payload)");
    expect(source).toContain("https://innovapm-mail-campaign.netlify.app/api/imap/check");
    expect(source).toContain("markEmailBounced_(String(email).toLowerCase(), \"hostinger-imap\")");
  });
});
