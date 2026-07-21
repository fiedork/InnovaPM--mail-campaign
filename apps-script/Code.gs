const OWNER_EMAIL = "krzysztof.fiedorowicz@innova.pm";
const TIMEZONE = "Europe/Warsaw";
const SHEETS = {
  Campaigns: ["id", "name", "status", "dryRun", "dailyLimit", "sendFrom", "sendTo", "createdAt", "updatedAt", "archivedAt"],
  Companies: ["id", "name", "normalizedName", "sector", "trigger", "packageName", "source", "createdAt", "updatedAt"],
  Contacts: ["id", "companyId", "companyName", "fullName", "role", "email", "phone", "linkedin", "source", "note", "status", "createdAt", "updatedAt"],
  Recipients: ["id", "campaignId", "companyId", "contactId", "active", "createdAt", "updatedAt"],
  Messages: ["id", "campaignId", "companyId", "contactId", "step", "subject", "body", "scheduledAt", "status", "gmailMessageId", "threadId", "attempts", "lastError", "sentAt", "openedAt", "updatedAt"],
  Events: ["id", "timestamp", "actor", "type", "entityType", "entityId", "beforeJson", "afterJson", "detail"],
  Suppression: ["id", "email", "reason", "sourceMessageId", "createdAt"],
  Settings: ["key", "value", "updatedAt"]
};

const CAMPAIGN_TRANSITIONS = {
  draft: ["needs_review", "cancelled"],
  needs_review: ["approved", "cancelled"],
  approved: ["active", "needs_review", "cancelled"],
  active: ["paused", "completed", "cancelled", "needs_review"],
  paused: ["active", "needs_review", "cancelled"],
  completed: [],
  cancelled: []
};

function doPost(e) {
  try {
    const envelope = JSON.parse(e.postData.contents || "{}");
    verifyEnvelope_(envelope);
    const request = JSON.parse(envelope.body);
    const data = dispatch_(request.action, request.payload || {});
    return json_({ ok: true, data: data });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return json_({ ok: false, error: error.message || String(error) });
  }
}

function dispatch_(action, payload) {
  initializeWorkbook_();
  const handlers = {
    importCampaign: importCampaign_,
    importContacts: importContacts_,
    listCampaigns: listCampaigns_,
    getCampaign: getCampaign_,
    createCampaign: createCampaign_,
    updateCampaign: updateCampaign_,
    updateCampaignCompany: updateCampaignCompany_,
    transitionCampaign: transitionCampaign_,
    deleteCampaign: deleteCampaign_,
    listContacts: listContacts_,
    createContact: createContact_,
    updateContact: updateContact_,
    deleteContact: deleteContact_,
    assignContactToCampaign: assignContactToCampaign_,
    selectRecipient: selectRecipient_,
    removeRecipient: removeRecipient_,
    updateMessage: updateMessage_,
    getSettings: getSettings_,
    updateSettings: updateSettings_,
    getCampaignStats: getCampaignStats_,
    recordOpen: recordOpen_,
    listEvents: listEvents_
  };
  if (!handlers[action]) throw new Error("Nieobsługiwana akcja: " + action);
  return handlers[action](payload);
}

function verifyEnvelope_(envelope) {
  const secret = PropertiesService.getScriptProperties().getProperty("HMAC_SECRET");
  if (!secret) throw new Error("Brak HMAC_SECRET w Script Properties.");
  const timestamp = Number(envelope.timestamp);
  if (!timestamp || Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    throw new Error("Żądanie wygasło.");
  }
  if (!envelope.nonce || !envelope.body || !envelope.signature) {
    throw new Error("Niekompletna koperta żądania.");
  }
  const cache = CacheService.getScriptCache();
  if (cache.get("nonce:" + envelope.nonce)) throw new Error("Powtórzone żądanie.");
  const expected = bytesToHex_(Utilities.computeHmacSha256Signature(
    envelope.timestamp + "." + envelope.nonce + "." + envelope.body,
    secret,
    Utilities.Charset.UTF_8
  ));
  if (!constantTimeEqual_(expected, String(envelope.signature))) {
    throw new Error("Niepoprawny podpis HMAC.");
  }
  cache.put("nonce:" + envelope.nonce, "1", 600);
}

function initializeWorkbook_() {
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
  setDefault_("dryRun", "true");
  setDefault_("emailFooterHtml", "");
  if (Number(settings_().schemaVersion || 1) < 2) migrateLegacyRecipients_();
}

function migrateLegacyRecipients_() {
  return withMutationLock_(function() {
    if (Number(settings_().schemaVersion || 1) >= 2) return { migrated: 0, unresolved: 0 };
    const contactsById = {};
    rows_("Contacts").forEach(function(contact) { contactsById[contact.id] = contact; });
    const campaignsById = {};
    rows_("Campaigns").forEach(function(campaign) { campaignsById[campaign.id] = campaign; });
    const activeKeys = {};
    rows_("Recipients").filter(function(recipient) { return String(recipient.active) === "true"; }).forEach(function(recipient) {
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

function configureProject() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Uruchom configureProject z projektu powiązanego z arkuszem Google Sheet.");
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", spreadsheet.getId());
  initializeWorkbook_();
  return { spreadsheetId: spreadsheet.getId(), configured: true };
}

function importCampaign_(payload) {
  return withMutationLock_(function() {
    if (!Array.isArray(payload.rows) || !payload.rows.length) throw new Error("Brak rekordów kampanii.");
    const fallbackName = String(payload.fileName || "Nowa kampania").replace(/\.(xlsx|xls|csv)$/i, "").trim() || "Nowa kampania";
    const existingCampaigns = rows_("Campaigns").filter(function(campaign) { return !campaign.archivedAt; });
    const existingCampaignNames = {};
    existingCampaigns.forEach(function(campaign) {
      existingCampaignNames[String(campaign.name || "").trim().toLowerCase()] = campaign;
    });
    const existingCompanies = rows_("Companies");
    const companiesByNormalizedName = {};
    const companiesById = {};
    existingCompanies.forEach(function(company) {
      companiesByNormalizedName[company.normalizedName] = company;
      companiesById[company.id] = company;
    });
    const existingContacts = rows_("Contacts");
    const contactsByEmail = {};
    existingContacts.forEach(function(contact) {
      contactsByEmail[String(contact.email || "").trim().toLowerCase()] = contact;
    });
    const campaignsById = {};
    existingCampaigns.forEach(function(campaign) { campaignsById[campaign.id] = campaign; });
    const inFlightContactCampaigns = {};
    rows_("Recipients").filter(function(recipient) {
      const campaign = campaignsById[recipient.campaignId];
      return String(recipient.active) === "true" && campaign && isInFlightCampaign_(campaign);
    }).forEach(function(recipient) {
      inFlightContactCampaigns[recipient.contactId] = campaignsById[recipient.campaignId];
    });

    const groupsByKey = {};
    const groups = [];
    const importedEmailSeries = {};
    const importedEmailCompanies = {};
    const importedCompanies = {};
    payload.rows.forEach(function(row, index) {
      const rowNumber = index + 2;
      const seriesName = String(row.seriesName || fallbackName).trim() || fallbackName;
      const seriesKey = seriesName.toLowerCase();
      if (existingCampaignNames[seriesKey]) {
        throw new Error("Seria „" + seriesName + "” już istnieje.");
      }
      let group = groupsByKey[seriesKey];
      if (!group) {
        group = { name: seriesName, rows: [], companyKeys: {} };
        groupsByKey[seriesKey] = group;
        groups.push(group);
      }
      const companyName = required_(row.companyName, "Nazwa firmy w wierszu " + rowNumber);
      const companyKey = normalizeCompany_(companyName);
      if (group.companyKeys[companyKey]) {
        throw new Error("Firma „" + companyName + "” występuje więcej niż raz w serii „" + seriesName + "”.");
      }
      group.companyKeys[companyKey] = true;
      const email = String(required_(row.email, "E-mail w wierszu " + rowNumber)).trim().toLowerCase();
      validateEmail_(email);
      required_(row.fullName, "Imię i nazwisko w wierszu " + rowNumber);
      required_(row.role, "Stanowisko w wierszu " + rowNumber);
      [row.email1, row.email2, row.email3].forEach(function(value, messageIndex) {
        required_(value, "Email " + (messageIndex + 1) + " w wierszu " + rowNumber);
      });
      if (importedEmailSeries[email] && importedEmailSeries[email] !== seriesKey) {
        throw new Error("Kontakt " + email + " nie może być jednocześnie przypisany do kilku importowanych serii.");
      }
      if (importedEmailCompanies[email] && importedEmailCompanies[email] !== companyKey) {
        throw new Error("Kontakt " + email + " ma w imporcie przypisane różne firmy.");
      }
      importedEmailSeries[email] = seriesKey;
      importedEmailCompanies[email] = companyKey;
      const existingContact = contactsByEmail[email];
      const existingCompany = companiesByNormalizedName[companyKey];
      if (existingContact) {
        if (existingContact.status === "deleted") throw new Error("Kontakt " + email + " jest usunięty i nie może zostać zaimportowany.");
        const contactCompany = companiesById[existingContact.companyId];
        if (!contactCompany || contactCompany.normalizedName !== companyKey) {
          throw new Error("Kontakt " + email + " jest już przypisany do innej firmy.");
        }
        if (inFlightContactCampaigns[existingContact.id]) {
          throw new Error("Kontakt " + email + " jest już w serii „" + inFlightContactCampaigns[existingContact.id].name + "”.");
        }
      }
      const companyData = importedCompanies[companyKey];
      if (companyData) {
        ["sector", "trigger", "packageName"].forEach(function(key) {
          if (row[key] && companyData[key] && String(row[key]).trim() !== companyData[key]) {
            throw new Error("Sprzeczne dane firmy „" + companyName + "” w polu " + key + ".");
          }
          if (!companyData[key] && row[key]) companyData[key] = String(row[key]).trim();
        });
      } else {
        importedCompanies[companyKey] = {
          name: companyName,
          normalizedName: companyKey,
          sector: String(row.sector || "").trim(),
          trigger: String(row.trigger || "").trim(),
          packageName: String(row.packageName || "").trim(),
          source: String(row.source || payload.fileName || "Import").trim(),
          existing: existingCompany || null
        };
      }
      group.rows.push({ row: row, email: email, companyKey: companyKey });
    });

    const now = isoNow_();
    const defaults = settings_();
    const companiesToCreate = [];
    Object.keys(importedCompanies).forEach(function(companyKey) {
      const planned = importedCompanies[companyKey];
      if (planned.existing) {
        const next = Object.assign({}, planned.existing, {
          name: planned.name,
          sector: planned.sector || planned.existing.sector,
          trigger: planned.trigger || planned.existing.trigger,
          packageName: planned.packageName || planned.existing.packageName,
          source: planned.source || planned.existing.source,
          updatedAt: now
        });
        updateObject_("Companies", planned.existing.id, next);
        planned.record = next;
      } else {
        planned.record = {
          id: uuid_(),
          name: planned.name,
          normalizedName: planned.normalizedName,
          sector: planned.sector,
          trigger: planned.trigger,
          packageName: planned.packageName,
          source: planned.source,
          createdAt: now,
          updatedAt: now
        };
        companiesToCreate.push(planned.record);
      }
    });
    appendObjects_("Companies", companiesToCreate);

    const contactRecords = {};
    const contactsToCreate = [];
    groups.forEach(function(group) {
      group.rows.forEach(function(item) {
        if (contactRecords[item.email]) return;
        const row = item.row;
        const company = importedCompanies[item.companyKey].record;
        const current = contactsByEmail[item.email];
        const contact = Object.assign({}, current || {}, {
          id: current ? current.id : uuid_(),
          companyId: company.id,
          companyName: company.name,
          fullName: String(row.fullName).trim(),
          role: String(row.role).trim(),
          email: item.email,
          phone: String(row.phone || "").trim(),
          linkedin: String(row.linkedin || "").trim(),
          source: String(row.source || payload.fileName || "Import").trim(),
          note: String(row.note || "").trim(),
          status: "active",
          createdAt: current ? current.createdAt : now,
          updatedAt: now
        });
        if (current) updateObject_("Contacts", current.id, contact);
        else contactsToCreate.push(contact);
        contactRecords[item.email] = contact;
      });
    });
    appendObjects_("Contacts", contactsToCreate);

    const campaigns = [];
    const recipients = [];
    const messages = [];
    groups.forEach(function(group) {
      const campaign = {
        id: uuid_(),
        name: group.name,
        status: "needs_review",
        dryRun: String(defaults.dryRun || "true"),
        dailyLimit: String(Math.min(Number(defaults.dailyLimit || 20), 20)),
        sendFrom: defaults.sendFrom || "09:00",
        sendTo: defaults.sendTo || "15:00",
        createdAt: now,
        updatedAt: now,
        archivedAt: ""
      };
      campaigns.push(campaign);
      group.rows.forEach(function(item) {
        const company = importedCompanies[item.companyKey].record;
        const contact = contactRecords[item.email];
        recipients.push({
          id: uuid_(),
          campaignId: campaign.id,
          companyId: company.id,
          contactId: contact.id,
          active: "true",
          createdAt: now,
          updatedAt: now
        });
        [item.row.email1, item.row.email2, item.row.email3].forEach(function(raw, messageIndex) {
          const parsed = splitSubject_(raw);
          messages.push(newDraftMessage_(campaign.id, company.id, contact.id, messageIndex + 1, parsed, now));
        });
      });
    });
    appendObjects_("Campaigns", campaigns);
    appendObjects_("Recipients", recipients);
    appendObjects_("Messages", messages);
    campaigns.forEach(function(campaign) {
      const companyCount = groupsByKey[campaign.name.toLowerCase()].rows.length;
      audit_("import_campaign", "Campaign", campaign.id, null, campaign, JSON.stringify({
        fileName: payload.fileName || "",
        companies: companyCount,
        messages: companyCount * 3
      }));
    });
    return {
      campaigns: campaigns.map(function(campaign) {
        const companyCount = groupsByKey[campaign.name.toLowerCase()].rows.length;
        return { id: campaign.id, name: campaign.name, status: campaign.status, companies: companyCount, messages: companyCount * 3 };
      })
    };
  });
}

function importContacts_(payload) {
  if (!Array.isArray(payload.rows)) throw new Error("Brak rekordów kontaktów.");
  const contactsByEmail = {};
  rows_("Contacts").forEach(function(contact) {
    contactsByEmail[String(contact.email || "").trim().toLowerCase()] = true;
  });
  const companiesByName = {};
  rows_("Companies").forEach(function(company) {
    companiesByName[company.normalizedName] = company;
  });
  const companiesToCreate = [];
  const contactsToCreate = [];
  const eventsToCreate = [];
  const actor = Session.getEffectiveUser().getEmail() || OWNER_EMAIL;
  let created = 0;
  let skipped = 0;
  payload.rows.forEach(function(row) {
    const email = String(row.email || "").trim().toLowerCase();
    if (!email || email === "brak" || contactsByEmail[email]) {
      skipped++;
      return;
    }
    const companyName = required_(row.companyName, "Nazwa firmy");
    const normalizedName = normalizeCompany_(companyName);
    let company = companiesByName[normalizedName];
    if (!company) {
      const companyNow = isoNow_();
      company = {
        id: uuid_(),
        name: companyName,
        normalizedName: normalizedName,
        sector: "",
        trigger: "",
        packageName: "",
        source: row.source || payload.fileName || "Import",
        createdAt: companyNow,
        updatedAt: companyNow
      };
      companiesByName[normalizedName] = company;
      companiesToCreate.push(company);
    }
    const now = isoNow_();
    const contact = {
      id: uuid_(),
      companyId: company.id,
      companyName: company.name,
      fullName: required_(row.fullName, "Imię i nazwisko"),
      role: row.role || "",
      email: email,
      phone: row.phone || "",
      linkedin: row.linkedin || "",
      source: row.source || payload.fileName || "Import",
      note: row.note || "",
      status: row.role ? "active" : "needs_review",
      createdAt: now,
      updatedAt: now
    };
    contactsByEmail[email] = true;
    contactsToCreate.push(contact);
    eventsToCreate.push({
      id: uuid_(),
      timestamp: now,
      actor: actor,
      type: "import",
      entityType: "Contact",
      entityId: contact.id,
      beforeJson: "",
      afterJson: JSON.stringify(redactContact_(contact)),
      detail: contact.role ? "" : "Brak stanowiska."
    });
    created++;
  });
  eventsToCreate.push({
    id: uuid_(),
    timestamp: isoNow_(),
    actor: actor,
    type: "import_contacts",
    entityType: "Contact",
    entityId: "",
    beforeJson: "",
    afterJson: JSON.stringify({ created: created, skipped: skipped }),
    detail: payload.fileName || ""
  });
  appendObjects_("Companies", companiesToCreate);
  appendObjects_("Contacts", contactsToCreate);
  appendObjects_("Events", eventsToCreate);
  return { created: created, skipped: skipped };
}

function listCampaigns_() {
  return rows_("Campaigns").filter(function(campaign) { return !campaign.archivedAt; });
}

function getCampaignStats_() {
  const messages = rows_("Messages");
  const events = rows_("Events");
  const recipients = rows_("Recipients");
  return rows_("Campaigns").filter(function(campaign) { return !campaign.archivedAt; }).map(function(campaign) {
    const campaignMessages = messages.filter(function(message) { return message.campaignId === campaign.id; });
    const campaignRecipients = recipients.filter(function(recipient) {
      return recipient.campaignId === campaign.id && String(recipient.active) === "true";
    });
    const replyCompanyIds = {};
    events.filter(function(event) { return event.type === "reply_detected"; }).forEach(function(event) {
      try {
        const detail = JSON.parse(event.afterJson || "{}");
        if (detail.campaignId === campaign.id && detail.companyId) replyCompanyIds[detail.companyId] = true;
      } catch (_error) {}
    });
    const bouncedContacts = {};
    campaignMessages.filter(function(message) {
      return message.sentAt && message.lastError === "bounce";
    }).forEach(function(message) { bouncedContacts[message.contactId || message.id] = true; });
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      sent: campaignMessages.filter(function(message) { return Boolean(message.sentAt); }).length,
      opened: campaignMessages.filter(function(message) { return Boolean(message.openedAt); }).length,
      replies: Object.keys(replyCompanyIds).length,
      bounces: Object.keys(bouncedContacts).length,
      companies: unique_(campaignMessages.map(function(message) { return message.companyId; })).length,
      recipients: campaignRecipients.length,
      updatedAt: campaign.updatedAt || campaign.createdAt || ""
    };
  });
}

function recordOpen_(payload) {
  const messageId = required_(payload.messageId, "Wiadomość");
  const secret = PropertiesService.getScriptProperties().getProperty("HMAC_SECRET");
  const expected = bytesToHex_(Utilities.computeHmacSha256Signature(
    messageId,
    secret,
    Utilities.Charset.UTF_8
  ));
  if (!constantTimeEqual_(expected, String(payload.token || ""))) throw new Error("Niepoprawny token śledzenia.");
  const current = requireById_("Messages", messageId);
  if (current.openedAt) return { recorded: false };
  const next = Object.assign({}, current, { openedAt: isoNow_(), updatedAt: isoNow_() });
  updateObject_("Messages", current.id, next);
  audit_("opened", "Message", current.id, null, { campaignId: current.campaignId }, "");
  return { recorded: true };
}

function getCampaign_(payload) {
  const campaign = requireById_("Campaigns", payload.id);
  const messages = rows_("Messages").filter(function(item) { return item.campaignId === payload.id; });
  const recipients = rows_("Recipients").filter(function(item) { return item.campaignId === payload.id; });
  const contactsById = {};
  const contactsByCompany = {};
  rows_("Contacts").forEach(function(contact) {
    contactsById[contact.id] = contact;
    if (contact.status !== "deleted") {
      if (!contactsByCompany[contact.companyId]) contactsByCompany[contact.companyId] = [];
      contactsByCompany[contact.companyId].push(contact);
    }
  });
  const companyIds = unique_(messages.map(function(item) { return item.companyId; }));
  const companies = rows_("Companies").filter(function(item) {
    return companyIds.indexOf(item.id) !== -1;
  }).map(function(company) {
    const companyMessages = messages.filter(function(message) {
      return message.companyId === company.id;
    }).sort(function(a, b) { return Number(a.step) - Number(b.step); });
    const activeRecipient = recipients.find(function(recipient) {
      return recipient.companyId === company.id && String(recipient.active) === "true";
    });
    const contact = activeRecipient ? contactsById[activeRecipient.contactId] : null;
    const candidateContacts = (contactsByCompany[company.id] || []).map(function(candidate) {
      return {
        id: candidate.id,
        fullName: candidate.fullName,
        role: candidate.role,
        email: candidate.email
      };
    });
    const result = {
      id: company.id,
      seriesName: campaign.name,
      companyName: company.name,
      fullName: contact ? contact.fullName : "",
      role: contact ? contact.role : "",
      email: contact ? contact.email : "",
      phone: contact ? contact.phone || "" : "",
      linkedin: contact ? contact.linkedin || "" : "",
      note: contact ? contact.note || "" : "",
      contactId: contact ? contact.id : "",
      hasActiveRecipient: Boolean(contact),
      candidateContacts: candidateContacts,
      sector: company.sector || "",
      trigger: company.trigger || "",
      packageName: company.packageName || "",
      source: company.source || "",
      messageIds: companyMessages.map(function(message) { return message.id; })
    };
    companyMessages.forEach(function(message, index) {
      result["email" + (index + 1)] = "Temat: " + message.subject + "\n\n" + message.body;
    });
    return result;
  });
  return {
    campaign: campaign,
    recipients: recipients,
    messages: messages,
    companies: companies
  };
}

function updateCampaignCompany_(payload) {
  const campaign = requireById_("Campaigns", payload.campaignId);
  const current = requireById_("Companies", payload.companyId);
  const belongsToCampaign = rows_("Messages").some(function(message) {
    return message.campaignId === campaign.id && message.companyId === current.id;
  });
  if (!belongsToCampaign) throw new Error("Firma nie należy do wskazanej kampanii.");

  const next = Object.assign({}, current);
  if (payload.companyName !== undefined) {
    const name = required_(payload.companyName, "Nazwa firmy");
    const normalized = normalizeCompany_(name);
    const duplicate = findBy_("Companies", "normalizedName", normalized);
    if (duplicate && duplicate.id !== current.id) {
      throw new Error("Firma o tej nazwie już istnieje.");
    }
    next.name = name;
    next.normalizedName = normalized;
  }
  ["sector", "trigger", "packageName", "source"].forEach(function(key) {
    if (payload[key] !== undefined) next[key] = String(payload[key]).trim();
  });
  next.updatedAt = isoNow_();
  updateObject_("Companies", current.id, next);

  if (next.name !== current.name) {
    rows_("Contacts").filter(function(contact) {
      return contact.companyId === current.id;
    }).forEach(function(contact) {
      updateObject_("Contacts", contact.id, Object.assign({}, contact, {
        companyName: next.name,
        updatedAt: isoNow_()
      }));
    });
  }

  forceNeedsReview_(campaign.id, "Zmiana danych firmy w kampanii.");
  audit_("update", "Company", current.id, current, next, "Edycja z listy firm kampanii.");
  return {
    id: next.id,
    companyName: next.name,
    sector: next.sector || "",
    trigger: next.trigger || "",
    packageName: next.packageName || "",
    source: next.source || ""
  };
}

function createCampaign_(payload) {
  const now = isoNow_();
  const defaults = settings_();
  const name = required_(payload.name, "Nazwa kampanii");
  const duplicate = rows_("Campaigns").find(function(campaign) {
    return !campaign.archivedAt && String(campaign.name || "").trim().toLowerCase() === name.toLowerCase();
  });
  if (duplicate) throw new Error("Seria o tej nazwie już istnieje.");
  const campaign = {
    id: uuid_(),
    name: name,
    status: "draft",
    dryRun: payload.dryRun === undefined ? String(defaults.dryRun || "true") : String(payload.dryRun !== false),
    dailyLimit: Math.min(Number(payload.dailyLimit || defaults.dailyLimit || 20), 20),
    sendFrom: payload.sendFrom || defaults.sendFrom || "09:00",
    sendTo: payload.sendTo || defaults.sendTo || "15:00",
    createdAt: now,
    updatedAt: now,
    archivedAt: ""
  };
  appendObject_("Campaigns", campaign);
  audit_("create", "Campaign", campaign.id, null, campaign, "");
  return campaign;
}

function updateCampaign_(payload) {
  const current = requireById_("Campaigns", payload.id);
  const allowed = ["name", "dryRun", "dailyLimit", "sendFrom", "sendTo"];
  const next = Object.assign({}, current);
  const changesOperationalSettings = ["dryRun", "dailyLimit", "sendFrom", "sendTo"].some(function(key) {
    return payload[key] !== undefined;
  });
  if (changesOperationalSettings && ["draft", "needs_review"].indexOf(current.status) === -1) {
    throw new Error("Ustawienia wysyłki można zmieniać tylko przed zatwierdzeniem serii.");
  }
  allowed.forEach(function(key) {
    if (payload[key] !== undefined) next[key] = payload[key];
  });
  next.dryRun = String(next.dryRun) === "false" || next.dryRun === false ? "false" : "true";
  next.dailyLimit = Math.max(1, Math.min(Number(next.dailyLimit || 20), 20));
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(next.sendFrom)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(next.sendTo))) {
    throw new Error("Godziny wysyłki muszą mieć format HH:mm.");
  }
  if (next.sendFrom >= next.sendTo) throw new Error("Początek okna wysyłki musi być wcześniejszy niż koniec.");
  next.updatedAt = isoNow_();
  updateObject_("Campaigns", next.id, next);
  audit_("update", "Campaign", next.id, current, next, "");
  return next;
}

function transitionCampaign_(payload) {
  return withMutationLock_(function() {
    const current = requireById_("Campaigns", payload.id);
    if (current.archivedAt) throw new Error("Kampania jest zarchiwizowana.");
    const targetByAction = { review: "needs_review", approve: "approved", start: "active", pause: "paused", resume: "active", cancel: "cancelled" };
    const target = targetByAction[payload.action];
    if (!target || CAMPAIGN_TRANSITIONS[current.status].indexOf(target) === -1) {
      throw new Error("Niedozwolona zmiana statusu: " + current.status + " -> " + target);
    }
    if (target === "needs_review" || target === "approved" || target === "active") validateCampaignReady_(current.id);
    if (target === "approved") {
      const approvalSnapshot = buildApprovalSnapshot_(current.id);
      upsertSetting_("approvalSnapshot:" + current.id, JSON.stringify(approvalSnapshot));
    }
    if (target === "start" && current.status === "approved") {
      const stored = settings_()["approvalSnapshot:" + current.id];
      if (stored) {
        const approvedSnapshot = JSON.parse(stored);
        const currentSnapshot = buildApprovalSnapshot_(current.id);
        assertApprovalSnapshotMatch_(approvedSnapshot, currentSnapshot);
      } else {
        throw new Error("Brak zatwierdzonego snapshota. Seria musi być ponownie zatwierdzona.");
      }
    }
    const next = Object.assign({}, current, { status: target, updatedAt: isoNow_() });
    updateObject_("Campaigns", current.id, next);
    if (target === "active") scheduleCampaign_(current.id);
    if (target === "cancelled") cancelPendingMessages_(current.id);
    audit_("transition_" + payload.action, "Campaign", current.id, current, next, "");
    return next;
  });
}

function deleteCampaign_(payload) {
  return withMutationLock_(function() {
    const campaign = requireById_("Campaigns", required_(payload.id, "Kampania"));
    if (campaign.archivedAt) throw new Error("Kampania jest już zarchiwizowana.");
    if (["active", "paused"].indexOf(campaign.status) !== -1) {
      throw new Error("Aktywną lub wstrzymaną kampanię należy najpierw anulować.");
    }
    const messages = rows_("Messages").filter(function(message) { return message.campaignId === campaign.id; });
    const recipients = rows_("Recipients").filter(function(recipient) { return recipient.campaignId === campaign.id; });
    if (messages.some(function(message) { return Boolean(message.sentAt); })) {
      const now = isoNow_();
      const archived = Object.assign({}, campaign, { archivedAt: now, updatedAt: now });
      updateObject_("Campaigns", campaign.id, archived);
      audit_("archive", "Campaign", campaign.id, campaign, archived, "Kampania zawiera wysłane wiadomości.");
      return { id: campaign.id, archived: true, deleted: false };
    }
    audit_("delete", "Campaign", campaign.id, campaign, null, JSON.stringify({
      recipients: recipients.length,
      messages: messages.length
    }));
    const deletedMessages = deleteRowsWhere_("Messages", function(message) { return message.campaignId === campaign.id; });
    const deletedRecipients = deleteRowsWhere_("Recipients", function(recipient) { return recipient.campaignId === campaign.id; });
    const deletedCampaigns = deleteRowsWhere_("Campaigns", function(item) { return item.id === campaign.id; });
    if (deletedCampaigns !== 1) throw new Error("Nie udało się bezpiecznie usunąć kampanii.");
    return {
      id: campaign.id,
      archived: false,
      deleted: true,
      deletedRecipients: deletedRecipients,
      deletedMessages: deletedMessages
    };
  });
}

function listContacts_() {
  const campaignsById = {};
  rows_("Campaigns").filter(function(campaign) { return !campaign.archivedAt; }).forEach(function(campaign) {
    campaignsById[campaign.id] = campaign;
  });
  const membershipsByContact = {};
  rows_("Recipients").filter(function(recipient) {
    return String(recipient.active) === "true" && campaignsById[recipient.campaignId];
  }).forEach(function(recipient) {
    const membership = campaignsById[recipient.campaignId];
    if (!membershipsByContact[recipient.contactId]) membershipsByContact[recipient.contactId] = [];
    if (!membershipsByContact[recipient.contactId].some(function(item) { return item.id === membership.id; })) {
      membershipsByContact[recipient.contactId].push({ id: membership.id, name: membership.name, status: membership.status, updatedAt: membership.updatedAt });
    }
  });
  const suppressedEmails = {};
  rows_("Suppression").forEach(function(item) {
    suppressedEmails[String(item.email || "").trim().toLowerCase()] = true;
  });
  return rows_("Contacts").filter(function(contact) { return contact.status !== "deleted"; }).map(function(contact) {
    const memberships = (membershipsByContact[contact.id] || []).sort(function(a, b) {
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
    const current = memberships.find(function(membership) { return isInFlightCampaign_(membership); }) || null;
    return Object.assign({}, contact, {
      currentCampaign: current ? { id: current.id, name: current.name, status: current.status } : null,
      campaignHistory: memberships.filter(function(membership) { return !isInFlightCampaign_(membership); }).map(function(membership) {
        return { id: membership.id, name: membership.name, status: membership.status };
      }),
      suppressed: Boolean(suppressedEmails[String(contact.email || "").trim().toLowerCase()])
    });
  });
}

function createContact_(payload) {
  validateEmail_(payload.email);
  if (findBy_("Contacts", "email", String(payload.email).toLowerCase())) {
    throw new Error("Kontakt z tym adresem już istnieje.");
  }
  const now = isoNow_();
  const company = payload.companyId
    ? requireById_("Companies", payload.companyId)
    : findOrCreateCompany_({ companyName: payload.companyName });
  const contact = {
    id: uuid_(),
    companyId: company.id,
    companyName: company.name,
    fullName: required_(payload.fullName, "Imię i nazwisko"),
    role: required_(payload.role, "Stanowisko"),
    email: String(payload.email).trim().toLowerCase(),
    phone: payload.phone || "",
    linkedin: payload.linkedin || "",
    source: payload.source || "Wpis ręczny",
    note: payload.note || "",
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  appendObject_("Contacts", contact);
  audit_("create", "Contact", contact.id, null, redactContact_(contact), "");
  return contact;
}

function updateContact_(payload) {
  const current = requireById_("Contacts", payload.id);
  assertContactIdentityMutable_(current, payload);
  const allowed = ["fullName", "role", "email", "phone", "linkedin", "source", "note"];
  Object.keys(payload).forEach(function(key) {
    if (key !== "id" && allowed.indexOf(key) === -1) {
      throw new Error("Niedozwolona zmiana pola kontaktu: " + key);
    }
  });
  const next = Object.assign({}, current);
  allowed.forEach(function(key) {
    if (payload[key] !== undefined) next[key] = payload[key];
  });
  next.fullName = required_(next.fullName, "Imię i nazwisko");
  next.role = required_(next.role, "Stanowisko");
  next.email = String(next.email || "").trim().toLowerCase();
  validateEmail_(next.email);
  const duplicate = rows_("Contacts").find(function(contact) {
    return contact.id !== current.id && String(contact.email || "").trim().toLowerCase() === next.email;
  });
  if (duplicate) throw new Error("Adres e-mail jest już przypisany do innego kontaktu.");
  next.updatedAt = isoNow_();
  updateObject_("Contacts", current.id, next);
  pauseCampaignsForContact_(current.id);
  audit_("update", "Contact", current.id, redactContact_(current), redactContact_(next), "Zmiana kontaktu wymaga ponownej akceptacji.");
  return next;
}

function assertContactIdentityMutable_(current, payload) {
  const nextEmail = payload.email === undefined ? current.email : String(payload.email).trim().toLowerCase();
  const nextCompanyId = payload.companyId === undefined ? current.companyId : String(payload.companyId);
  if (nextEmail === String(current.email).trim().toLowerCase() && nextCompanyId === current.companyId) return;
  const hasHistory = rows_("Messages").some(function(message) {
    return message.contactId === current.id && (message.sentAt || message.threadId || message.gmailMessageId);
  });
  if (hasHistory) {
    throw new Error("Nie można zmienić adresu e-mail ani firmy kontaktu po rozpoczęciu korespondencji.");
  }
}

function deleteContact_(payload) {
  const current = requireById_("Contacts", payload.id);
  const next = Object.assign({}, current, { status: "deleted", updatedAt: isoNow_() });
  updateObject_("Contacts", current.id, next);
  pauseCampaignsForContact_(current.id);
  audit_("delete", "Contact", current.id, redactContact_(current), redactContact_(next), "");
  return { id: current.id, deleted: true };
}

function assignContactToCampaign_(payload) {
  return withMutationLock_(function() {
    const contact = requireById_("Contacts", required_(payload.contactId, "Kontakt"));
    if (contact.status === "deleted") throw new Error("Nie można przypisać usuniętego kontaktu.");
    const mode = required_(payload.mode, "Tryb przypisania");
    if (["new", "existing"].indexOf(mode) === -1) throw new Error("Nieobsługiwany tryb przypisania: " + mode);

    const campaignsById = {};
    rows_("Campaigns").filter(function(campaign) { return !campaign.archivedAt; }).forEach(function(campaign) {
      campaignsById[campaign.id] = campaign;
    });
    const conflict = rows_("Recipients").find(function(recipient) {
      const campaign = campaignsById[recipient.campaignId];
      return recipient.contactId === contact.id && String(recipient.active) === "true" && campaign && isInFlightCampaign_(campaign);
    });
    if (conflict) {
      throw new Error("Kontakt jest już przypisany do trwającej serii „" + campaignsById[conflict.campaignId].name + "”.");
    }

    let campaign;
    if (mode === "new") {
      campaign = createCampaign_({ name: required_(payload.name, "Nazwa kampanii") });
    } else {
      campaign = requireById_("Campaigns", required_(payload.campaignId, "Kampania"));
      if (campaign.archivedAt) throw new Error("Nie można przypisać kontaktu do zarchiwizowanej kampanii.");
      if (["draft", "needs_review"].indexOf(campaign.status) === -1) {
        throw new Error("Kontakt można przypisać tylko do kampanii draft lub needs_review.");
      }
    }

    const now = isoNow_();
    let messages = rows_("Messages").filter(function(message) {
      return message.campaignId === campaign.id && message.companyId === contact.companyId;
    });
    let messagesCreated = 0;
    if (!messages.length) {
      messages = [1, 2, 3].map(function(step) {
        return newDraftMessage_(campaign.id, contact.companyId, contact.id, step, { subject: "", body: "" }, now);
      });
      appendObjects_("Messages", messages);
      messagesCreated = messages.length;
    } else {
      messages.filter(function(message) { return message.status === "draft"; }).forEach(function(message) {
        updateObject_("Messages", message.id, Object.assign({}, message, { contactId: contact.id, updatedAt: now }));
      });
    }

    rows_("Recipients").filter(function(recipient) {
      return recipient.campaignId === campaign.id && recipient.companyId === contact.companyId && String(recipient.active) === "true";
    }).forEach(function(recipient) {
      updateObject_("Recipients", recipient.id, Object.assign({}, recipient, { active: "false", updatedAt: now }));
    });
    const recipient = {
      id: uuid_(),
      campaignId: campaign.id,
      companyId: contact.companyId,
      contactId: contact.id,
      active: "true",
      createdAt: now,
      updatedAt: now
    };
    appendObject_("Recipients", recipient);
    audit_("assign_contact", "Recipient", recipient.id, null, recipient, JSON.stringify({
      mode: mode,
      campaignName: campaign.name,
      messagesCreated: messagesCreated
    }));
    return {
      campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
      recipient: recipient,
      messagesCreated: messagesCreated
    };
  });
}

function selectRecipient_(payload) {
  return withMutationLock_(function() {
    const campaign = requireById_("Campaigns", required_(payload.campaignId, "Kampania"));
    if (campaign.archivedAt) throw new Error("Kampania jest zarchiwizowana.");
    if (["draft", "needs_review"].indexOf(campaign.status) === -1) {
      throw new Error("Odbiorcę można zmienić tylko przed zatwierdzeniem serii.");
    }
    const companyId = required_(payload.companyId, "Firma");
    if (!rows_("Messages").some(function(message) { return message.campaignId === campaign.id && message.companyId === companyId; })) {
      throw new Error("Firma nie należy do wskazanej serii.");
    }
    assertRecipientMutable_(campaign.id, companyId);
    const contact = requireById_("Contacts", payload.contactId);
    if (contact.status === "deleted") throw new Error("Nie można przypisać usuniętego kontaktu.");
    if (contact.companyId !== companyId) throw new Error("Kontakt nie należy do wskazanej firmy.");
    if (isSuppressed_(contact.email)) throw new Error("Kontakt jest wykluczony z wysyłki.");
    const campaignsById = {};
    rows_("Campaigns").forEach(function(item) { campaignsById[item.id] = item; });
    const conflict = rows_("Recipients").find(function(recipient) {
      const other = campaignsById[recipient.campaignId];
      return recipient.contactId === contact.id && recipient.campaignId !== campaign.id && String(recipient.active) === "true" && other && isInFlightCampaign_(other);
    });
    if (conflict) throw new Error("Kontakt jest już w innej trwającej serii.");
    const now = isoNow_();
    rows_("Recipients").filter(function(item) {
      return item.campaignId === campaign.id && item.companyId === companyId && String(item.active) === "true";
    }).forEach(function(item) {
      updateObject_("Recipients", item.id, Object.assign({}, item, { active: "false", updatedAt: now }));
    });
    const recipient = { id: uuid_(), campaignId: campaign.id, companyId: companyId, contactId: contact.id, active: "true", createdAt: now, updatedAt: now };
    appendObject_("Recipients", recipient);
    rows_("Messages").filter(function(message) {
      return message.campaignId === campaign.id && message.companyId === companyId && message.status === "draft";
    }).forEach(function(message) {
      updateObject_("Messages", message.id, Object.assign({}, message, { contactId: contact.id, updatedAt: now }));
    });
    audit_("select_recipient", "Recipient", recipient.id, null, recipient, "");
    return recipient;
  });
}

function removeRecipient_(payload) {
  return withMutationLock_(function() {
    const campaign = requireById_("Campaigns", required_(payload.campaignId, "Kampania"));
    if (["draft", "needs_review"].indexOf(campaign.status) === -1) throw new Error("Odbiorcę można usunąć tylko przed zatwierdzeniem serii.");
    const companyId = required_(payload.companyId, "Firma");
    assertRecipientMutable_(campaign.id, companyId);
    const now = isoNow_();
    const active = rows_("Recipients").filter(function(recipient) {
      return recipient.campaignId === campaign.id && recipient.companyId === companyId && String(recipient.active) === "true";
    });
    if (!active.length) return { campaignId: campaign.id, companyId: companyId, removed: false };
    active.forEach(function(recipient) {
      updateObject_("Recipients", recipient.id, Object.assign({}, recipient, { active: "false", updatedAt: now }));
    });
    rows_("Messages").filter(function(message) {
      return message.campaignId === campaign.id && message.companyId === companyId && message.status === "draft";
    }).forEach(function(message) {
      updateObject_("Messages", message.id, Object.assign({}, message, { contactId: "", scheduledAt: "", updatedAt: now }));
    });
    audit_("remove_recipient", "Campaign", campaign.id, active, null, "Usunięto aktywnego odbiorcę firmy " + companyId + ".");
    return { campaignId: campaign.id, companyId: companyId, removed: true };
  });
}

function assertRecipientMutable_(campaignId, companyId) {
  const hasHistory = rows_("Messages").some(function(message) {
    return message.campaignId === campaignId && message.companyId === companyId && (message.sentAt || message.threadId || message.gmailMessageId);
  });
  if (hasHistory) throw new Error("Nie można zmienić odbiorcy po rozpoczęciu korespondencji. Utwórz nową serię.");
}

function updateMessage_(payload) {
  const current = requireById_("Messages", payload.id);
  if (["sent", "replied", "cancelled", "suppressed"].indexOf(current.status) !== -1) {
    throw new Error("Nie można edytować wysłanej lub zamkniętej wiadomości.");
  }
  const campaign = requireById_("Campaigns", current.campaignId);
  if (["approved", "active", "paused", "completed"].indexOf(campaign.status) !== -1) {
    throw new Error("Nie można edytować wiadomości po zatwierdzeniu serii.");
  }
  const activeRecipients = rows_("Recipients").filter(function(recipient) {
    return recipient.campaignId === current.campaignId &&
      recipient.companyId === current.companyId &&
      String(recipient.active) === "true";
  });
  if (activeRecipients.length !== 1) {
    throw new Error("Firma w serii nie ma dokładnie jednego aktywnego odbiorcy.");
  }
  if (!current.contactId || current.contactId !== activeRecipients[0].contactId) {
    throw new Error("Wiadomość nie wskazuje aktywnego odbiorcy serii.");
  }
  const next = Object.assign({}, current, {
    subject: payload.subject !== undefined ? payload.subject : current.subject,
    body: payload.body !== undefined ? payload.body : current.body,
    status: "draft",
    scheduledAt: "",
    updatedAt: isoNow_()
  });
  updateObject_("Messages", current.id, next);
  forceNeedsReview_(current.campaignId, "Zmiana treści wiadomości.");
  audit_("update", "Message", current.id, current, next, "");
  return next;
}

function getSettings_() {
  const current = settings_();
  return {
    emailFooterHtml: current.emailFooterHtml || "",
    dryRun: String(current.dryRun) !== "false",
    dailyLimit: Math.max(1, Math.min(Number(current.dailyLimit || 20), 20)),
    sendFrom: current.sendFrom || "09:00",
    sendTo: current.sendTo || "15:00",
    timezone: current.timezone || TIMEZONE
  };
}

function updateSettings_(payload) {
  return withMutationLock_(function() {
    const currentSettings = settings_();
    const html = String(payload.emailFooterHtml === undefined ? currentSettings.emailFooterHtml || "" : payload.emailFooterHtml).trim();
    if (html.length > 20000) throw new Error("Stopka HTML może mieć maksymalnie 20 000 znaków.");
    if (payload.dryRun !== undefined && typeof payload.dryRun !== "boolean") throw new Error("Tryb testowy musi być wartością logiczną.");
    const dryRun = payload.dryRun === undefined ? String(currentSettings.dryRun) !== "false" : payload.dryRun;
    const rawLimit = payload.dailyLimit === undefined ? Number(currentSettings.dailyLimit || 20) : Number(payload.dailyLimit);
    if (!isFinite(rawLimit) || Math.floor(rawLimit) !== rawLimit || rawLimit < 1 || rawLimit > 20) throw new Error("Limit dzienny musi być liczbą całkowitą od 1 do 20.");
    const sendFrom = String(payload.sendFrom === undefined ? currentSettings.sendFrom || "09:00" : payload.sendFrom);
    const sendTo = String(payload.sendTo === undefined ? currentSettings.sendTo || "15:00" : payload.sendTo);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendFrom) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTo)) throw new Error("Godziny wysyłki muszą mieć format HH:mm.");
    if (sendFrom >= sendTo) throw new Error("Początek okna wysyłki musi być wcześniejszy niż koniec.");
    const nextValues = { emailFooterHtml: html, dryRun: String(dryRun), dailyLimit: String(rawLimit), sendFrom: sendFrom, sendTo: sendTo };
    Object.keys(nextValues).forEach(function(key) { upsertSetting_(key, nextValues[key]); });
    if (html !== String(currentSettings.emailFooterHtml || "")) {
      rows_("Campaigns").filter(function(campaign) { return ["approved", "active", "paused"].indexOf(campaign.status) !== -1; }).forEach(function(campaign) {
        forceNeedsReview_(campaign.id, "Zmiana stopki HTML.");
      });
    }
    audit_("update", "Settings", "defaults", currentSettings, nextValues, "Zmiana domyślnych ustawień wysyłki.");
    return getSettings_();
  });
}

function listEvents_(payload) {
  const events = rows_("Events");
  return events.slice(Math.max(0, events.length - Number(payload.limit || 100))).reverse();
}

function installTriggers() {
  const ownedHandlers = ["runQueue", "checkReplies"];
  ScriptApp.getProjectTriggers().filter(function(trigger) {
    return ownedHandlers.indexOf(trigger.getHandlerFunction()) !== -1;
  }).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger("runQueue").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("checkReplies").timeBased().everyMinutes(15).create();
}

function runQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    initializeWorkbook_();
    assertSender_();
    const activeCampaigns = rows_("Campaigns").filter(function(item) { return item.status === "active" && !item.archivedAt; });
    activeCampaigns.filter(withinSendWindow_).forEach(processCampaignQueue_);
  } finally {
    lock.releaseLock();
  }
}

function processCampaignQueue_(campaign) {
  const sentToday = rows_("Messages").filter(function(message) {
    return message.campaignId === campaign.id &&
      message.sentAt &&
      String(message.sentAt).slice(0, 10) === Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  }).length;
  let remaining = Math.max(0, Math.min(Number(campaign.dailyLimit || 20), 20) - sentToday);
  if (!remaining) return;
  const due = rows_("Messages").filter(function(message) {
    return message.campaignId === campaign.id &&
      message.status === "scheduled" &&
      new Date(message.scheduledAt).getTime() <= Date.now();
  }).slice(0, remaining);
  due.forEach(function(message) {
    try {
      sendMessage_(campaign, message);
    } catch (error) {
      const failed = Object.assign({}, message, {
        status: "failed",
        attempts: Number(message.attempts || 0) + 1,
        lastError: error.message || String(error),
        updatedAt: isoNow_()
      });
      updateObject_("Messages", message.id, failed);
      audit_("send_failed", "Message", message.id, message, failed, failed.lastError);
    }
  });
  completeCampaignIfFinished_(campaign.id);
}

function completeCampaignIfFinished_(campaignId) {
  const campaign = requireById_("Campaigns", campaignId);
  if (campaign.status !== "active") return;
  const messages = rows_("Messages").filter(function(message) { return message.campaignId === campaignId; });
  const terminal = ["sent", "replied", "failed", "cancelled", "suppressed"];
  if (!messages.length || messages.some(function(message) { return terminal.indexOf(message.status) === -1; })) return;
  const next = Object.assign({}, campaign, { status: "completed", updatedAt: isoNow_() });
  updateObject_("Campaigns", campaign.id, next);
  audit_("completed", "Campaign", campaign.id, campaign, next, "Wszystkie wiadomości osiągnęły stan końcowy.");
}

function sendMessage_(campaign, message) {
  const contact = requireById_("Contacts", message.contactId);
  assertMessageSafeToSend_(campaign, message, contact);

  const stored = settings_()["approvalSnapshot:" + campaign.id];
  if (!stored) {
    throw new Error("Brak zatwierdzonego snapshota kampanii. Wymagana ponowna akceptacja.");
  }
  const approvedSnapshot = JSON.parse(stored);
  const currentSnapshot = buildApprovalSnapshot_(campaign.id);
  assertApprovalSnapshotMatch_(approvedSnapshot, currentSnapshot);

  if (isSuppressed_(contact.email)) {
    updateObject_("Messages", message.id, Object.assign({}, message, { status: "suppressed", updatedAt: isoNow_() }));
    return;
  }
  const dryRun = String(campaign.dryRun) !== "false";
  const recipient = dryRun ? OWNER_EMAIL : contact.email;
  const subject = dryRun ? "[DRY-RUN: " + contact.email + "] " + message.subject : message.subject;
  const mime = buildMime_(recipient, subject, message.body, message, !dryRun);
  const sent = Gmail.Users.Messages.send(
    { raw: Utilities.base64EncodeWebSafe(mime, Utilities.Charset.UTF_8), threadId: message.threadId || undefined },
    "me"
  );
  const sentMetadata = Gmail.Users.Messages.get("me", sent.id, {
    format: "metadata",
    metadataHeaders: ["Message-ID"]
  });
  const sentHeaders = headersToObject_(sentMetadata.payload && sentMetadata.payload.headers || []);
  const rfcMessageId = sentHeaders["message-id"] || "";
  const next = Object.assign({}, message, {
    status: "sent",
    gmailMessageId: rfcMessageId,
    threadId: sent.threadId || message.threadId || "",
    attempts: Number(message.attempts || 0) + 1,
    sentAt: isoNow_(),
    updatedAt: isoNow_()
  });
  updateObject_("Messages", message.id, next);
  propagateThread_(message.campaignId, message.companyId, next.threadId, rfcMessageId);
  audit_("sent", "Message", message.id, message, next, dryRun ? "dry-run" : "live");
}

function assertMessageSafeToSend_(campaign, message, contact) {
  if (campaign.id !== message.campaignId) {
    throw new Error("Wiadomość nie należy do aktywnej serii.");
  }
  if (campaign.status !== "active" || campaign.archivedAt) {
    throw new Error("Wysyłka jest dozwolona wyłącznie dla aktywnej serii.");
  }
  const activeRecipients = rows_("Recipients").filter(function(recipient) {
    return recipient.campaignId === message.campaignId &&
      recipient.companyId === message.companyId &&
      String(recipient.active) === "true";
  });
  if (activeRecipients.length !== 1) {
    throw new Error("Firma musi mieć dokładnie jednego aktywnego odbiorcę przed wysyłką.");
  }
  const recipient = activeRecipients[0];
  if (message.threadId && recipient.contactId !== message.contactId) {
    throw new Error("Nie można użyć istniejącego wątku Gmail dla innego odbiorcy.");
  }
  if (recipient.contactId !== message.contactId) {
    throw new Error("Wiadomość nie wskazuje aktywnego odbiorcy.");
  }
  if (contact.companyId !== message.companyId) {
    throw new Error("Odbiorca nie należy do firmy przypisanej do wiadomości.");
  }
  if (contact.status !== "active") {
    throw new Error("Odbiorca nie jest aktywnym kontaktem.");
  }
  validateEmail_(contact.email);
  required_(message.subject, "Temat wiadomości");
  required_(message.body, "Treść wiadomości");
}

function checkReplies() {
  initializeWorkbook_();
  const sentMessages = rows_("Messages").filter(function(message) {
    return message.status === "sent" && message.threadId;
  });
  const seenThreads = {};
  sentMessages.forEach(function(message) {
    if (seenThreads[message.threadId]) return;
    seenThreads[message.threadId] = true;
    const thread = Gmail.Users.Threads.get("me", message.threadId, { format: "metadata" });
    const external = (thread.messages || []).find(function(item) {
      const headers = headersToObject_(item.payload && item.payload.headers || []);
      const from = String(headers.from || "").toLowerCase();
      return from && from.indexOf(OWNER_EMAIL.toLowerCase()) === -1 && !isAutoReply_(headers);
    });
    if (external) markThreadReplied_(message.threadId);
  });
  detectBounces_();
}

function scheduleCampaign_(campaignId) {
  const campaign = requireById_("Campaigns", campaignId);
  const recipients = rows_("Recipients").filter(function(item) {
    return item.campaignId === campaignId && String(item.active) === "true";
  });
  const activeByCompany = {};
  recipients.forEach(function(item) { activeByCompany[item.companyId] = item.contactId; });
  const start = nextWindowStart_(new Date(), campaign);
  rows_("Messages").filter(function(message) {
    return message.campaignId === campaignId && ["draft", "scheduled"].indexOf(message.status) !== -1;
  }).forEach(function(message) {
    const contactId = activeByCompany[message.companyId];
    if (!contactId) return;
    const scheduled = addAdjustedDays_(start, [0, 3, 6][Number(message.step) - 1]);
    updateObject_("Messages", message.id, Object.assign({}, message, {
      contactId: contactId,
      scheduledAt: scheduled.toISOString(),
      status: "scheduled",
      updatedAt: isoNow_()
    }));
  });
}

function validateCampaignReady_(campaignId) {
  const campaign = requireById_("Campaigns", campaignId);
  const messages = rows_("Messages").filter(function(message) { return message.campaignId === campaignId; });
  if (!messages.length) throw new Error("Kampania nie zawiera wiadomości.");
  const companyIds = unique_(messages.map(function(message) { return message.companyId; }));
  const activeRecipients = rows_("Recipients").filter(function(item) {
    return item.campaignId === campaignId && String(item.active) === "true";
  });
  if (activeRecipients.some(function(recipient) { return companyIds.indexOf(recipient.companyId) === -1; })) {
    throw new Error("Seria zawiera odbiorcę bez odpowiadającej sekwencji wiadomości.");
  }
  companyIds.forEach(function(companyId) {
    const companyMessages = messages.filter(function(message) { return message.companyId === companyId; });
    const steps = {};
    companyMessages.forEach(function(message) {
      steps[String(message.step)] = true;
      required_(message.subject, "Temat wiadomości " + message.step);
      required_(message.body, "Treść wiadomości " + message.step);
    });
    if (companyMessages.length !== 3 || !steps["1"] || !steps["2"] || !steps["3"]) {
      throw new Error("Firma " + companyId + " musi mieć kompletną sekwencję trzech wiadomości.");
    }
    const companyRecipients = activeRecipients.filter(function(item) { return item.companyId === companyId; });
    if (companyRecipients.length !== 1) throw new Error("Firma " + companyId + " musi mieć dokładnie jednego aktywnego odbiorcę.");
    const recipient = companyRecipients[0];
    const contact = requireById_("Contacts", recipient.contactId);
    if (contact.status !== "active") throw new Error("Odbiorca nie jest aktywnym kontaktem: " + contact.email);
    if (contact.companyId !== companyId) throw new Error("Odbiorca nie należy do firmy przypisanej do sekwencji.");
    required_(contact.fullName, "Imię i nazwisko odbiorcy");
    validateEmail_(contact.email);
    required_(contact.role, "Stanowisko odbiorcy");
    if (isSuppressed_(contact.email)) throw new Error("Odbiorca jest na suppression list: " + contact.email);
    if (companyMessages.some(function(message) { return message.contactId !== contact.id; })) {
      throw new Error("Wiadomości firmy " + companyId + " nie wskazują aktywnego odbiorcy.");
    }
  });
  const limit = Number(campaign.dailyLimit);
  if (!isFinite(limit) || Math.floor(limit) !== limit || limit < 1 || limit > 20) throw new Error("Seria ma niepoprawny limit dzienny.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(campaign.sendFrom)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(campaign.sendTo)) || campaign.sendFrom >= campaign.sendTo) {
    throw new Error("Seria ma niepoprawne okno wysyłki.");
  }
}

function assertSender_() {
  const sender = String(Session.getEffectiveUser().getEmail()).toLowerCase();
  const owner = OWNER_EMAIL.toLowerCase();
  const aliases = GmailApp.getAliases().map(function(alias) { return String(alias).toLowerCase(); });
  if (sender !== owner && aliases.indexOf(owner) === -1) {
    throw new Error("Wysyłka zablokowana: konto " + sender + " nie ma zweryfikowanego aliasu " + OWNER_EMAIL + ".");
  }
}

function findOrCreateCompany_(row) {
  const name = required_(row.companyName, "Nazwa firmy");
  const normalized = normalizeCompany_(name);
  const existing = findBy_("Companies", "normalizedName", normalized);
  if (existing) return existing;
  const now = isoNow_();
  const company = {
    id: uuid_(),
    name: name,
    normalizedName: normalized,
    sector: row.sector || "",
    trigger: row.trigger || "",
    packageName: row.packageName || "",
    source: row.source || "",
    createdAt: now,
    updatedAt: now
  };
  appendObject_("Companies", company);
  return company;
}

function buildApprovalSnapshot_(campaignId) {
  const campaign = requireById_("Campaigns", campaignId);
  const messages = rows_("Messages").filter(function(message) { return message.campaignId === campaignId; });
  const recipients = rows_("Recipients").filter(function(item) { return item.campaignId === campaignId && String(item.active) === "true"; });
  const footerHash = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(settings_().emailFooterHtml || ""), Utilities.Charset.UTF_8));
  const companyIds = unique_(messages.map(function(message) { return message.companyId; }));
  const companies = companyIds.map(function(companyId) {
    const recipient = recipients.find(function(item) { return item.companyId === companyId; });
    const contact = recipient ? requireById_("Contacts", recipient.contactId) : null;
    const companyMessages = messages.filter(function(message) { return message.companyId === companyId; }).sort(function(a, b) { return Number(a.step) - Number(b.step); });
    return {
      companyId: companyId,
      contactId: contact ? contact.id : "",
      contactEmail: contact ? String(contact.email).trim().toLowerCase() : "",
      contactFullName: contact ? String(contact.fullName).trim() : "",
      contactRole: contact ? String(contact.role).trim() : "",
      messages: companyMessages.map(function(message) { return { step: message.step, subject: message.subject, body: message.body }; })
    };
  });
  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    approvedAt: isoNow_(),
    dryRun: String(campaign.dryRun),
    dailyLimit: Number(campaign.dailyLimit),
    sendFrom: String(campaign.sendFrom),
    sendTo: String(campaign.sendTo),
    footerHash: footerHash,
    companyCount: companyIds.length,
    companies: companies
  };
}

function assertApprovalSnapshotMatch_(approved, current) {
  if (approved.campaignId !== current.campaignId) {
    throw new Error("Snapshots nie pasują — ID serii się różni.");
  }
  if (Number(approved.companyCount) !== Number(current.companyCount)) {
    throw new Error("Liczba firm w snapshocie się różni — seria wymaga ponownej akceptacji.");
  }
  if (String(approved.dryRun) !== String(current.dryRun)) {
    throw new Error("Tryb testowy/live zmieniony od zatwierdzenia — seria wymaga ponownej akceptacji.");
  }
  if (Number(approved.dailyLimit) !== Number(current.dailyLimit)) {
    throw new Error("Limit dzienny zmieniony od zatwierdzenia — seria wymaga ponownej akceptacji.");
  }
  if (String(approved.sendFrom) !== String(current.sendFrom) || String(approved.sendTo) !== String(current.sendTo)) {
    throw new Error("Okno wysyłki zmienione od zatwierdzenia — seria wymaga ponownej akceptacji.");
  }
  if (String(approved.footerHash) !== String(current.footerHash)) {
    throw new Error("Stopka HTML zmieniona od zatwierdzenia — seria wymaga ponownej akceptacji.");
  }
  const approvedCompanies = approved.companies || [];
  const currentCompanies = current.companies || [];
  if (approvedCompanies.length !== currentCompanies.length) {
    throw new Error("Zmieniona lista firm odbiorców od zatwierdzenia — seria wymaga ponownej akceptacji.");
  }
  for (let i = 0; i < approvedCompanies.length; i++) {
    const ac = approvedCompanies[i];
    const cc = currentCompanies[i];
    if (String(ac.companyId) !== String(cc.companyId)) {
      throw new Error("Nieoczekiwana zamiana firm — seria wymaga ponownej akceptacji.");
    }
    if (String(ac.contactId) !== String(cc.contactId) || String(ac.contactEmail) !== String(cc.contactEmail)) {
      throw new Error("Odbiorca zmieniony od zatwierdzenia — seria wymaga ponownej akceptacji.");
    }
    const amsgs = ac.messages || [];
    const cmsgs = cc.messages || [];
    if (amsgs.length !== cmsgs.length || amsgs.length !== 3 || cmsgs.length !== 3) {
      throw new Error("Liczba wiadomości dla firmy różni się od zatwierdzonej — seria wymaga ponownej akceptacji.");
    }
    for (let j = 0; j < 3; j++) {
      if (String(amsgs[j].subject) !== String(cmsgs[j].subject) || String(amsgs[j].body) !== String(cmsgs[j].body)) {
        throw new Error("Treść wiadomości maila " + (j + 1) + " zmieniona od zatwierdzenia — seria wymaga ponownej akceptacji.");
      }
    }
  }
}

function forceNeedsReview_(campaignId, detail) {
  const campaign = requireById_("Campaigns", campaignId);
  if (["approved", "active", "paused"].indexOf(campaign.status) === -1) return;
  const next = Object.assign({}, campaign, { status: "needs_review", updatedAt: isoNow_() });
  updateObject_("Campaigns", campaign.id, next);
  audit_("needs_review", "Campaign", campaign.id, campaign, next, detail);
}

function pauseCampaignsForContact_(contactId) {
  const campaignIds = unique_(rows_("Recipients").filter(function(item) {
    return item.contactId === contactId && String(item.active) === "true";
  }).map(function(item) { return item.campaignId; }));
  campaignIds.forEach(function(id) { forceNeedsReview_(id, "Zmiana danych aktywnego kontaktu."); });
}

function cancelPendingMessages_(campaignId) {
  rows_("Messages").filter(function(message) {
    return message.campaignId === campaignId && ["draft", "scheduled", "failed"].indexOf(message.status) !== -1;
  }).forEach(function(message) {
    updateObject_("Messages", message.id, Object.assign({}, message, { status: "cancelled", updatedAt: isoNow_() }));
  });
}

function markThreadReplied_(threadId) {
  const affected = rows_("Messages").filter(function(message) { return message.threadId === threadId; });
  if (!affected.length) return;
  const campaignId = affected[0].campaignId;
  const companyId = affected[0].companyId;
  rows_("Messages").filter(function(message) {
    return message.campaignId === campaignId && message.companyId === companyId &&
      ["draft", "scheduled", "sent"].indexOf(message.status) !== -1;
  }).forEach(function(message) {
    updateObject_("Messages", message.id, Object.assign({}, message, { status: "replied", updatedAt: isoNow_() }));
  });
  audit_("reply_detected", "Thread", threadId, null, { campaignId: campaignId, companyId: companyId }, "");
}

function detectBounces_() {
  const threads = GmailApp.search("newer_than:2d from:(mailer-daemon OR postmaster) (subject:(undeliverable OR failure OR niedostarczona))", 0, 50);
  threads.forEach(function(thread) {
    const body = thread.getMessages().map(function(message) { return message.getPlainBody(); }).join("\n");
    const match = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (!match) return;
    const email = match[0].toLowerCase();
    if (!isSuppressed_(email)) {
      appendObject_("Suppression", { id: uuid_(), email: email, reason: "bounce", sourceMessageId: thread.getId(), createdAt: isoNow_() });
      rows_("Contacts").filter(function(contact) { return contact.email === email; }).forEach(function(contact) {
        rows_("Messages").filter(function(message) {
          return message.contactId === contact.id && ["draft", "scheduled", "sent"].indexOf(message.status) !== -1;
        }).forEach(function(message) {
          updateObject_("Messages", message.id, Object.assign({}, message, { status: "failed", lastError: "bounce", updatedAt: isoNow_() }));
        });
      });
      audit_("bounce", "Contact", email, null, { suppressed: true }, "");
    }
  });
}

function buildMime_(to, subject, body, message, includeTracking) {
  const footerHtml = sanitizeEmailHtml_(settings_().emailFooterHtml || "");
  const boundary = "innova_" + Utilities.getUuid().replace(/-/g, "");
  const plainFooter = htmlToText_(footerHtml);
  const plainBody = String(body || "") + (plainFooter ? "\n\n" + plainFooter : "");
  const trackingPixel = includeTracking ? trackingPixelHtml_(message.id) : "";
  const htmlBody = "<div style=\"white-space:pre-wrap\">" + escapeHtml_(body) + "</div>" + footerHtml + trackingPixel;
  const headers = [
    "MIME-Version: 1.0",
    "Content-Type: multipart/alternative; boundary=\"" + boundary + "\"",
    "From: " + OWNER_EMAIL,
    "To: " + to,
    "Subject: =?UTF-8?B?" + Utilities.base64Encode(subject, Utilities.Charset.UTF_8) + "?="
  ];
  if (message.gmailMessageId) {
    headers.push("In-Reply-To: " + message.gmailMessageId);
    headers.push("References: " + message.gmailMessageId);
  }
  return headers.join("\r\n") + "\r\n\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Type: text/plain; charset=UTF-8\r\n" +
    "Content-Transfer-Encoding: 8bit\r\n\r\n" +
    plainBody + "\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Type: text/html; charset=UTF-8\r\n" +
    "Content-Transfer-Encoding: 8bit\r\n\r\n" +
    htmlBody + "\r\n" +
    "--" + boundary + "--";
}

function trackingPixelHtml_(messageId) {
  const properties = PropertiesService.getScriptProperties();
  const secret = properties.getProperty("HMAC_SECRET");
  const baseUrl = properties.getProperty("TRACKING_BASE_URL") || "https://innovapm-mail-campaign.netlify.app/api/track/open";
  const token = bytesToHex_(Utilities.computeHmacSha256Signature(
    messageId,
    secret,
    Utilities.Charset.UTF_8
  ));
  return '<img src="' + baseUrl + '?id=' + encodeURIComponent(messageId) + '&amp;token=' + token + '" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">';
}

function sanitizeEmailHtml_(html) {
  return String(html || "")
    .replace(/<(script|iframe|object|embed|form|input|button|meta|link)[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|iframe|object|embed|form|input|button|meta|link)\b[^>]*\/?\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1="#"');
}

function escapeHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r?\n/g, "<br>");
}

function htmlToText_(html) {
  return String(html || "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function splitSubject_(raw) {
  const text = String(raw || "").trim();
  const lines = text.split(/\r?\n/);
  const match = lines[0].match(/^\s*Temat:\s*(.*)$/i);
  return match
    ? { subject: match[1].trim(), body: lines.slice(1).join("\n").trim() }
    : { subject: "Krótka rozmowa o priorytetach PMO", body: text };
}

function newDraftMessage_(campaignId, companyId, contactId, step, content, now) {
  return {
    id: uuid_(),
    campaignId: campaignId,
    companyId: companyId,
    contactId: contactId || "",
    step: step,
    subject: content.subject || "",
    body: content.body || "",
    scheduledAt: "",
    status: "draft",
    gmailMessageId: "",
    threadId: "",
    attempts: 0,
    lastError: "",
    sentAt: "",
    openedAt: "",
    updatedAt: now || isoNow_()
  };
}

function isInFlightCampaign_(campaign) {
  return ["draft", "needs_review", "approved", "active", "paused"].indexOf(campaign.status) !== -1;
}

function withinSendWindow_(campaign) {
  const now = Utilities.formatDate(new Date(), TIMEZONE, "u HH:mm").split(" ");
  const weekday = Number(now[0]);
  if (weekday > 5) return false;
  const settings = settings_();
  const sendFrom = campaign && campaign.sendFrom || settings.sendFrom || "09:00";
  const sendTo = campaign && campaign.sendTo || settings.sendTo || "15:00";
  return now[1] >= sendFrom && now[1] <= sendTo;
}

function nextWindowStart_(date, campaign) {
  let candidate = new Date(date);
  const start = String(campaign && campaign.sendFrom || settings_().sendFrom || "09:00").split(":");
  candidate.setHours(Number(start[0]), Number(start[1]), 0, 0);
  if (candidate.getTime() < date.getTime()) candidate = new Date(date);
  return moveToWeekday_(candidate);
}

function addAdjustedDays_(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return moveToWeekday_(result);
}

function moveToWeekday_(date) {
  const result = new Date(date);
  while ([0, 6].indexOf(result.getDay()) !== -1) result.setDate(result.getDate() + 1);
  return result;
}

function propagateThread_(campaignId, companyId, threadId, rfcMessageId) {
  rows_("Messages").filter(function(message) {
    return message.campaignId === campaignId && message.companyId === companyId && !message.threadId;
  }).forEach(function(message) {
    updateObject_("Messages", message.id, Object.assign({}, message, {
      threadId: threadId,
      gmailMessageId: rfcMessageId,
      updatedAt: isoNow_()
    }));
  });
}

function isAutoReply_(headers) {
  const autoSubmitted = String(headers["auto-submitted"] || "").toLowerCase();
  const precedence = String(headers.precedence || "").toLowerCase();
  const subject = String(headers.subject || "").toLowerCase();
  return (autoSubmitted && autoSubmitted !== "no") ||
    ["bulk", "junk", "list"].indexOf(precedence) !== -1 ||
    /(out of office|automatic reply|autoresponder|poza biurem|automatyczna odpowied)/i.test(subject);
}

function headersToObject_(headers) {
  const result = {};
  headers.forEach(function(header) { result[String(header.name).toLowerCase()] = header.value; });
  return result;
}

function isSuppressed_(email) {
  return Boolean(findBy_("Suppression", "email", String(email).toLowerCase()));
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

function appendObject_(sheetName, object) {
  const sheet = workbook_().getSheetByName(sheetName);
  sheet.appendRow(SHEETS[sheetName].map(function(key) { return object[key] === undefined ? "" : object[key]; }));
}

function appendObjects_(sheetName, objects) {
  if (!objects.length) return;
  const sheet = workbook_().getSheetByName(sheetName);
  const values = objects.map(function(object) {
    return SHEETS[sheetName].map(function(key) { return object[key] === undefined ? "" : object[key]; });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, SHEETS[sheetName].length).setValues(values);
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

function withMutationLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("Inna operacja modyfikuje dane. Spróbuj ponownie za chwilę.");
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function workbook_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("Brak SPREADSHEET_ID. Uruchom configureProject w edytorze Apps Script.");
  return SpreadsheetApp.openById(spreadsheetId);
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

function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index++) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function bytesToHex_(bytes) {
  return bytes.map(function(byte) {
    const value = byte < 0 ? byte + 256 : byte;
    return ("0" + value.toString(16)).slice(-2);
  }).join("");
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function uuid_() {
  return Utilities.getUuid();
}

function isoNow_() {
  return new Date().toISOString();
}
