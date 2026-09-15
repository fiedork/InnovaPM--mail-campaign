const SHEETS = {
  Campaigns: ["id", "name", "status", "dryRun", "dailyLimit", "sendFrom", "sendTo", "startDate", "mail2DelayBusinessDays", "mail3DelayBusinessDays", "footerId", "createdAt", "updatedAt", "archivedAt"],
  Companies: ["id", "name", "normalizedName", "sector", "trigger", "packageName", "source", "createdAt", "updatedAt"],
  Contacts: ["id", "companyId", "companyName", "fullName", "role", "email", "phone", "linkedin", "source", "note", "status", "createdAt", "updatedAt"],
  Recipients: ["id", "campaignId", "companyId", "contactId", "active", "createdAt", "updatedAt", "removedAt"],
  Messages: ["id", "campaignId", "companyId", "contactId", "step", "subject", "body", "scheduledAt", "status", "gmailMessageId", "threadId", "sendMode", "attempts", "lastError", "sentAt", "openedAt", "trackingKey", "updatedAt"],
  Events: ["id", "timestamp", "actor", "type", "entityType", "entityId", "beforeJson", "afterJson", "detail"],
  Suppression: ["id", "email", "reason", "sourceMessageId", "createdAt"],
  Settings: ["key", "value", "updatedAt"]
};
const WORKBOOK_SCHEMA_VERSION = "8";
let WORKBOOK_HANDLE_CACHE_ = null;

function initializeWorkbook_() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty("WORKBOOK_SCHEMA_VERSION") === WORKBOOK_SCHEMA_VERSION) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("Trwa inicjalizacja struktury danych. Spróbuj ponownie za chwilę.");
  try {
    if (properties.getProperty("WORKBOOK_SCHEMA_VERSION") === WORKBOOK_SCHEMA_VERSION) return;
  const spreadsheet = workbook_();
  Object.keys(SHEETS).forEach(function(name) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(SHEETS[name]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, SHEETS[name].length)
        .setBackground("#0C2340")
        .setFontColor("#FFFFFF")
        .setFontWeight("bold");
    } else {
      const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
      const missingHeaders = SHEETS[name].filter(function(header) { return currentHeaders.indexOf(header) === -1; });
      if (missingHeaders.length) {
        sheet.getRange(1, currentHeaders.length + 1, 1, missingHeaders.length)
          .setValues([missingHeaders])
          .setBackground("#0C2340")
          .setFontColor("#FFFFFF")
          .setFontWeight("bold");
      }
    }
  });
  setDefault_("ownerEmail", OWNER_EMAIL);
  setDefault_("timezone", TIMEZONE);
  setDefault_("dailyLimit", "20");
  setDefault_("sendFrom", "09:00");
  setDefault_("sendTo", "15:00");
  setDefault_("mail2DelayBusinessDays", "3");
  setDefault_("mail3DelayBusinessDays", "3");
  setDefault_("dryRun", "true");
  setDefault_("sendTransport", "smtp");
  setDefault_("emailFooterHtml", "");
  migrateFooterProfiles_();
  if (Number(settings_().schemaVersion || 1) < 2) migrateLegacyRecipients_();
  repairRecipientAssignments_();
    properties.setProperty("WORKBOOK_SCHEMA_VERSION", WORKBOOK_SCHEMA_VERSION);
  } finally {
    lock.releaseLock();
  }
}

function migrateLegacyRecipients_() {
  return withMutationLock_(function() {
    if (Number(settings_().schemaVersion || 1) >= 2) return { migrated: 0, unresolved: 0 };
    const contactsById = {};
    rows_("Contacts").forEach(function(contact) { contactsById[contact.id] = contact; });
    const campaignsById = {};
    rows_("Campaigns").forEach(function(campaign) { campaignsById[campaign.id] = campaign; });
    const activeKeys = {};
    rows_("Recipients").filter(function(recipient) { return isActiveFlag_(recipient.active); }).forEach(function(recipient) {
      activeKeys[recipient.campaignId + ":" + recipient.companyId] = true;
    });
    const grouped = {};
    rows_("Messages").forEach(function(message) {
      const key = message.campaignId + ":" + message.companyId;
      if (!grouped[key]) grouped[key] = { campaignId: message.campaignId, companyId: message.companyId, contactIds: {} };
      if (message.contactId) grouped[key].contactIds[message.contactId] = true;
    });
    const recipients = [];
    const unresolvedCampaigns = {};
    Object.keys(grouped).forEach(function(key) {
      if (activeKeys[key]) return;
      const group = grouped[key];
      const contactIds = Object.keys(group.contactIds);
      const contact = contactIds.length === 1 ? contactsById[contactIds[0]] : null;
      if (contact && contact.status !== "deleted" && contact.companyId === group.companyId) {
        recipients.push({
          id: uuid_(),
          campaignId: group.campaignId,
          companyId: group.companyId,
          contactId: contact.id,
          active: "true",
          createdAt: isoNow_(),
          updatedAt: isoNow_()
        });
      } else {
        unresolvedCampaigns[group.campaignId] = true;
      }
    });
    appendObjects_("Recipients", recipients);
    Object.keys(unresolvedCampaigns).forEach(function(campaignId) {
      const campaign = campaignsById[campaignId];
      if (campaign && ["approved", "active", "paused"].indexOf(campaign.status) !== -1) {
        forceNeedsReview_(campaignId, "Migracja wykryła brak jednoznacznego odbiorcy.");
      }
    });
    upsertSetting_("schemaVersion", "2");
    audit_("migrate", "Settings", "schemaVersion", { version: 1 }, { version: 2 }, JSON.stringify({
      recipientsCreated: recipients.length,
      unresolvedCampaigns: Object.keys(unresolvedCampaigns).length
    }));
    return { migrated: recipients.length, unresolved: Object.keys(unresolvedCampaigns).length };
  });
}

function repairRecipientAssignments_() {
  const grouped = {};
  rows_("Recipients").forEach(function(recipient, index) {
    if (!recipient.id || !recipient.campaignId || !recipient.companyId || !isActiveFlag_(recipient.active)) return;
    const key = recipient.campaignId + "|" + recipient.companyId;
    if (!grouped[key]) grouped[key] = [];
    recipient._rowOrder = index;
    grouped[key].push(recipient);
  });
  Object.keys(grouped).forEach(function(key) {
    const activeRecipients = grouped[key];
    if (activeRecipients.length < 2) return;
    activeRecipients.sort(function(a, b) {
      const left = recipientTimestamp_(a);
      const right = recipientTimestamp_(b);
      if (left === right) return Number(a._rowOrder || 0) - Number(b._rowOrder || 0);
      return left < right ? -1 : 1;
    });
    activeRecipients.slice(0, -1).forEach(function(recipient) {
      updateObject_("Recipients", recipient.id, Object.assign({}, recipient, { active: "false", updatedAt: isoNow_() }));
    });
  });
}

function workbook_() {
  if (WORKBOOK_HANDLE_CACHE_) return WORKBOOK_HANDLE_CACHE_;
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("Brak SPREADSHEET_ID. Uruchom configureProject w edytorze Apps Script.");
  WORKBOOK_HANDLE_CACHE_ = SpreadsheetApp.openById(spreadsheetId);
  return WORKBOOK_HANDLE_CACHE_;
}

function isDryRun_(value) {
  return String(value).trim().toLowerCase() !== "false";
}

function normalizeDryRun_(value) {
  return isDryRun_(value) ? "true" : "false";
}

function rows_(sheetName) {
  const sheet = workbook_().getSheetByName(sheetName);
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(function(row) { return row.some(Boolean); }).map(function(row) {
    const item = {};
    headers.forEach(function(header, index) { item[header] = row[index]; });
    return item;
  });
}

function createReadContext_(sheetNames, requestId) {
  const context = {};
  sheetNames.forEach(function(sheetName) {
    const startedAt = Date.now();
    const records = rows_(sheetName);
    context[sheetName] = records;
    console.info(JSON.stringify({
      event: "sheet_read",
      action: "getInitialData",
      requestId: String(requestId || ""),
      sheet: sheetName,
      elapsedMs: Date.now() - startedAt,
      rowCount: records.length
    }));
  });
  return context;
}

function contextRows_(context, sheetName) {
  const records = context && context[sheetName];
  if (!Array.isArray(records)) throw new Error("Brak danych odczytowych arkusza: " + sheetName);
  return records;
}

function appendObject_(sheetName, object) {
  const sheet = workbook_().getSheetByName(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  sheet.appendRow(headers.map(function(key) { return object[key] === undefined ? "" : object[key]; }));
}

function appendObjects_(sheetName, objects) {
  if (!objects.length) return;
  const sheet = workbook_().getSheetByName(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const values = objects.map(function(object) {
    return headers.map(function(key) { return object[key] === undefined ? "" : object[key]; });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

function updateObject_(sheetName, id, object) {
  const sheet = workbook_().getSheetByName(sheetName);
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0];
  const idIndex = headers.indexOf(sheetName === "Settings" ? "key" : "id");
  for (let index = 1; index < values.length; index++) {
    if (values[index][idIndex] === String(id)) {
      const row = headers.map(function(key) { return object[key] === undefined ? "" : object[key]; });
      sheet.getRange(index + 1, 1, 1, row.length).setValues([row]);
      return;
    }
  }
  throw new Error("Nie znaleziono rekordu " + sheetName + ": " + id);
}

function deleteRowsWhere_(sheetName, predicate) {
  const sheet = workbook_().getSheetByName(sheetName);
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return 0;
  const headers = values[0];
  const rowNumbers = [];
  for (let index = 1; index < values.length; index++) {
    const object = {};
    headers.forEach(function(header, columnIndex) { object[header] = values[index][columnIndex]; });
    if (predicate(object)) rowNumbers.push(index + 1);
  }
  rowNumbers.sort(function(a, b) { return b - a; }).forEach(function(rowNumber) {
    if (rowNumber <= 1 || rowNumber > sheet.getLastRow()) {
      throw new Error("Niebezpieczna próba usunięcia wiersza z arkusza " + sheetName + ".");
    }
    sheet.deleteRow(rowNumber);
  });
  return rowNumbers.length;
}

function deleteRowsWhereBatch_(sheetName, predicate) {
  const sheet = workbook_().getSheetByName(sheetName);
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return 0;
  const headers = values[0];
  const kept = [];
  let deleted = 0;
  values.slice(1).forEach(function(row) {
    const object = {};
    headers.forEach(function(header, index) { object[header] = row[index]; });
    if (predicate(object)) deleted += 1;
    else kept.push(row);
  });
  if (!deleted) return 0;
  if (kept.length) sheet.getRange(2, 1, kept.length, headers.length).setValues(kept);
  sheet.deleteRows(kept.length + 2, deleted);
  return deleted;
}

function updateRowsWhere_(sheetName, predicate, transform) {
  const sheet = workbook_().getSheetByName(sheetName);
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return 0;
  const headers = values[0];
  let updated = 0;
  for (let index = 1; index < values.length; index++) {
    const current = {};
    headers.forEach(function(header, columnIndex) { current[header] = values[index][columnIndex]; });
    if (!predicate(current)) continue;
    const next = transform(current);
    values[index] = headers.map(function(header) { return next[header] === undefined ? "" : next[header]; });
    updated += 1;
  }
  if (updated) sheet.getRange(2, 1, values.length - 1, headers.length).setValues(values.slice(1));
  return updated;
}

function withMutationLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("Inna operacja modyfikuje dane. Spróbuj ponownie za chwilę.");
  try {
    const result = callback();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function findBy_(sheetName, key, value) {
  return rows_(sheetName).find(function(item) {
    return String(item[key]).toLowerCase() === String(value).toLowerCase();
  });
}

function requireById_(sheetName, id) {
  const item = findBy_(sheetName, "id", id);
  if (!item) throw new Error("Nie znaleziono " + sheetName + ": " + id);
  return item;
}

function audit_(type, entityType, entityId, before, after, detail) {
  appendObject_("Events", {
    id: uuid_(),
    timestamp: isoNow_(),
    actor: Session.getEffectiveUser().getEmail() || OWNER_EMAIL,
    type: type,
    entityType: entityType,
    entityId: entityId,
    beforeJson: before ? JSON.stringify(before) : "",
    afterJson: after ? JSON.stringify(after) : "",
    detail: detail || ""
  });
}

function redactContact_(contact) {
  return Object.assign({}, contact, { email: maskEmail_(contact.email), phone: contact.phone ? "***" : "" });
}

function maskEmail_(email) {
  const parts = String(email || "").split("@");
  return parts.length === 2 ? parts[0].slice(0, 2) + "***@" + parts[1] : "";
}

function normalizeCompany_(value) {
  return String(value).toLowerCase()
    .replace(/[ąćęłńóśźż]/g, function(char) { return ({ą:"a",ć:"c",ę:"e",ł:"l",ń:"n",ó:"o",ś:"s",ź:"z",ż:"z"})[char]; })
    .replace(/\b(sp\.?\s*z\.?\s*o\.?\s*o\.?|s\.?a\.?)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function validateEmail_(email) {
  const value = String(email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.toLowerCase() === "brak") {
    throw new Error("Niepoprawny adres e-mail: " + value);
  }
}

function required_(value, label) {
  if (!String(value || "").trim()) throw new Error(label + " jest wymagane.");
  return String(value).trim();
}

function unique_(values) {
  return values.filter(function(value, index) { return values.indexOf(value) === index; });
}

function settings_() {
  const result = {};
  rows_("Settings").forEach(function(item) { result[item.key] = item.value; });
  return result;
}

function setDefault_(key, value) {
  if (!findBy_("Settings", "key", key)) appendObject_("Settings", { key: key, value: value, updatedAt: isoNow_() });
}

function upsertSetting_(key, value) {
  const current = findBy_("Settings", "key", key);
  const next = { key: key, value: String(value), updatedAt: isoNow_() };
  if (current) updateObject_("Settings", key, next);
  else appendObject_("Settings", next);
}

function uuid_() {
  return Utilities.getUuid();
}

function isoNow_() {
  return new Date().toISOString();
}

function isActiveFlag_(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function recipientTimestamp_(recipient) {
  return String(recipient.updatedAt || recipient.createdAt || "");
}
