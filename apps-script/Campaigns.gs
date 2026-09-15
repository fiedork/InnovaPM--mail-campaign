const CAMPAIGN_TRANSITIONS = {
  draft: ["needs_review", "cancelled"],
  needs_review: ["approved", "cancelled"],
  approved: ["active", "needs_review", "cancelled"],
  active: ["paused", "completed", "cancelled", "needs_review"],
  paused: ["active", "needs_review", "cancelled"],
  completed: [],
  cancelled: ["needs_review"]
};

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
      return isActiveFlag_(recipient.active) && campaign && isInFlightCampaign_(campaign);
    }).forEach(function(recipient) {
      inFlightContactCampaigns[recipient.contactId] = campaignsById[recipient.campaignId];
    });

    const groupsByKey = {};
    const groups = [];
    const importedEmailSeries = {};
    const importedEmailCompanies = {};
    const importedCompanies = {};
    const deletedContactIdsToRestore = {};
    payload.rows.forEach(function(row, index) {
      const rowNumber = index + 2;
      const seriesName = String(row.seriesName || fallbackName).trim() || fallbackName;
      const seriesKey = seriesName.toLowerCase();
      if (existingCampaignNames[seriesKey]) {
        throw new Error("Kampania „" + seriesName + "” już istnieje.");
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
        throw new Error("Firma „" + companyName + "” występuje więcej niż raz w kampanii „" + seriesName + "”.");
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
        throw new Error("Kontakt " + email + " nie może być jednocześnie przypisany do kilku importowanych kampanii.");
      }
      if (importedEmailCompanies[email] && importedEmailCompanies[email] !== companyKey) {
        throw new Error("Kontakt " + email + " ma w imporcie przypisane różne firmy.");
      }
      importedEmailSeries[email] = seriesKey;
      importedEmailCompanies[email] = companyKey;
      const existingContact = contactsByEmail[email];
      const existingCompany = companiesByNormalizedName[companyKey];
      if (existingContact) {
        const contactCompany = companiesById[existingContact.companyId];
        if (!contactCompany || contactCompany.normalizedName !== companyKey) {
          throw new Error("Kontakt " + email + " jest już przypisany do innej firmy.");
        }
        if (existingContact.status === "deleted") {
          deletedContactIdsToRestore[existingContact.id] = true;
        } else if (inFlightContactCampaigns[existingContact.id]) {
          throw new Error("Kontakt " + email + " jest już w kampanii „" + inFlightContactCampaigns[existingContact.id].name + "”.");
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
    const defaultFooterId = defaultFooterId_(defaults, footerProfiles_(defaults));
    rows_("Recipients").filter(function(recipient) {
      return deletedContactIdsToRestore[recipient.contactId] && isActiveFlag_(recipient.active);
    }).forEach(function(recipient) {
      updateObject_("Recipients", recipient.id, Object.assign({}, recipient, {
        active: "false",
        updatedAt: now
      }));
    });
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
        if (current) {
          updateObject_("Contacts", current.id, contact);
          if (deletedContactIdsToRestore[current.id]) {
            audit_("restore", "Contact", current.id, redactContact_(current), redactContact_(contact), "Przywrócenie podczas importu kampanii.");
          }
        } else contactsToCreate.push(contact);
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
        dryRun: normalizeDryRun_(defaults.dryRun || "true"),
        dailyLimit: String(Math.min(Number(defaults.dailyLimit || 20), MAX_DAILY_LIMIT)),
        sendFrom: defaults.sendFrom || "09:00",
        sendTo: defaults.sendTo || "15:00",
        startDate: todayCampaignDate_(),
        mail2DelayBusinessDays: normalizeDelayDays_(defaults.mail2DelayBusinessDays || 3),
        mail3DelayBusinessDays: normalizeDelayDays_(defaults.mail3DelayBusinessDays || 3),
        footerId: defaultFooterId,
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

function listCampaigns_(payload) {
  const includeArchived = payload && payload.includeArchived === true;
  return rows_("Campaigns").filter(function(campaign) {
    return includeArchived || !campaign.archivedAt;
  });
}

function getCampaignStats_(payload) {
  return getCampaignStatsFromContext_(payload, {
    Messages: rows_("Messages"),
    Events: rows_("Events"),
    Recipients: rows_("Recipients"),
    Campaigns: rows_("Campaigns")
  });
}

function getCampaignStatsFromContext_(payload, context) {
  const includeArchived = payload && payload.includeArchived === true;
  const messages = contextRows_(context, "Messages");
  const events = contextRows_(context, "Events");
  const recipients = contextRows_(context, "Recipients");
  return contextRows_(context, "Campaigns").filter(function(campaign) { return includeArchived || !campaign.archivedAt; }).map(function(campaign) {
    const campaignMessages = messages.filter(function(message) { return message.campaignId === campaign.id; });
    const campaignRecipients = recipients.filter(function(recipient) {
      return recipient.campaignId === campaign.id && isActiveFlag_(recipient.active);
    });
    const removedCompanyIds = {};
    recipients.filter(function(recipient) {
      return recipient.campaignId === campaign.id && Boolean(recipient.removedAt);
    }).forEach(function(recipient) { removedCompanyIds[recipient.companyId] = true; });
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
    const steps = [1, 2, 3].map(function(step) {
      const stepMessages = campaignMessages.filter(function(message) { return Number(message.step) === step; });
      const stepSent = stepMessages.filter(function(message) { return Boolean(message.sentAt); }).length;
      const stepOpened = stepMessages.filter(function(message) { return Boolean(message.openedAt); }).length;
      const stepReplies = stepMessages.filter(function(message) {
        return Boolean(message.sentAt) && message.status === "replied";
      }).length;
      const stepBounces = stepMessages.filter(function(message) {
        return Boolean(message.sentAt) && message.lastError === "bounce";
      }).length;
      return {
        step: step,
        sent: stepSent,
        opened: stepOpened,
        replies: stepReplies,
        bounces: stepBounces,
        openRate: percent_(stepOpened, stepSent),
        replyRate: percent_(stepReplies, stepSent),
        bounceRate: percent_(stepBounces, stepSent)
      };
    });
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      sent: campaignMessages.filter(function(message) { return Boolean(message.sentAt); }).length,
      opened: campaignMessages.filter(function(message) { return Boolean(message.openedAt); }).length,
      replies: Object.keys(replyCompanyIds).length,
      bounces: Object.keys(bouncedContacts).length,
      steps: steps,
      companies: unique_(campaignMessages.map(function(message) { return message.companyId; }).filter(function(companyId) {
        return !removedCompanyIds[companyId];
      })).length,
      recipients: unique_(campaignRecipients.map(function(recipient) { return recipient.companyId; })).length,
      updatedAt: campaign.updatedAt || campaign.createdAt || "",
      archivedAt: campaign.archivedAt || ""
    };
  });
}

function percent_(value, base) {
  return base > 0 ? Math.round((Number(value || 0) / Number(base)) * 100) : 0;
}

function recordOpen_(payload) {
  const messageId = required_(payload.messageId, "Wiadomość");
  const current = requireById_("Messages", messageId);
  const secret = PropertiesService.getScriptProperties().getProperty("HMAC_SECRET");
  const tokenPayload = messageId + (current.trackingKey ? ":" + current.trackingKey : "");
  const expected = bytesToHex_(Utilities.computeHmacSha256Signature(
    tokenPayload,
    secret,
    Utilities.Charset.UTF_8
  ));
  if (!constantTimeEqual_(expected, String(payload.token || ""))) throw new Error("Niepoprawny token śledzenia.");
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
  const activeRecipientsByCompany = {};
  recipients.filter(function(recipient) { return isActiveFlag_(recipient.active); }).forEach(function(recipient) {
    const current = activeRecipientsByCompany[recipient.companyId];
    if (!current || recipientTimestamp_(current) <= recipientTimestamp_(recipient)) {
      activeRecipientsByCompany[recipient.companyId] = recipient;
    }
  });
  const contactsById = {};
  const contactsByCompany = {};
  rows_("Contacts").forEach(function(contact) {
    contactsById[contact.id] = contact;
    if (contact.status !== "deleted") {
      if (!contactsByCompany[contact.companyId]) contactsByCompany[contact.companyId] = [];
      contactsByCompany[contact.companyId].push(contact);
    }
  });
  const removedCompanyIds = {};
  recipients.filter(function(recipient) { return Boolean(recipient.removedAt); }).forEach(function(recipient) {
    removedCompanyIds[recipient.companyId] = true;
  });
  const companyIds = unique_(messages.map(function(item) { return item.companyId; })).filter(function(companyId) {
    return !removedCompanyIds[companyId];
  });
  const companies = rows_("Companies").filter(function(item) {
    return companyIds.indexOf(item.id) !== -1;
  }).map(function(company) {
    const companyMessages = messages.filter(function(message) {
      return message.companyId === company.id;
    }).sort(function(a, b) { return Number(a.step) - Number(b.step); });
    const activeRecipient = activeRecipientsByCompany[company.id];
    const contact = activeRecipient ? contactsById[activeRecipient.contactId] : null;
    const openedSteps = companyMessages.filter(function(message) {
      return Boolean(message.openedAt);
    }).map(function(message) { return Number(message.step); }).sort(function(a, b) { return a - b; });
    const replied = companyMessages.some(function(message) { return message.status === "replied"; });
    const bounced = companyMessages.some(function(message) { return message.lastError === "bounce"; });
    const sentSteps = companyMessages.filter(function(message) {
      return Boolean(message.sentAt);
    }).map(function(message) { return Number(message.step); }).sort(function(a, b) { return a - b; });
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
      activity: {
        sentSteps: sentSteps,
        openedSteps: openedSteps,
        replied: replied,
        bounced: bounced
      },
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
  if (campaign.archivedAt) throw new Error("Kampania jest zarchiwizowana.");
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

function deleteCampaignCompany_(payload) {
  return withMutationLock_(function() {
    const campaign = requireById_("Campaigns", required_(payload.campaignId, "Kampania"));
    if (campaign.archivedAt) throw new Error("Kampania jest zarchiwizowana.");
    if (["draft", "needs_review", "active", "paused"].indexOf(campaign.status) === -1) {
      throw new Error("Firmę można usunąć ze szkicu albo trwającej kampanii.");
    }
    const companyId = required_(payload.companyId, "Firma");
    const company = requireById_("Companies", companyId);
    const campaignMessages = rows_("Messages").filter(function(message) {
      return message.campaignId === campaign.id && message.companyId === company.id;
    });
    if (!campaignMessages.length) throw new Error("Firma nie należy do wskazanej kampanii.");

    if (["active", "paused"].indexOf(campaign.status) !== -1) {
      validateCampaignReady_(campaign.id, {
        allowPastStartDate: true,
        excludedCompanyIds: [company.id]
      });
    }

    const hasSentHistory = campaignMessages.some(function(message) {
      return Boolean(message.sentAt || message.openedAt) || ["sent", "replied"].indexOf(message.status) !== -1;
    });
    let deletedMessages = 0;
    let deletedRecipients = 0;
    let cancelledMessages = 0;
    let disabledRecipients = 0;
    const now = isoNow_();

    if (hasSentHistory) {
      cancelledMessages = updateRowsWhere_("Messages", function(message) {
        return message.campaignId === campaign.id && message.companyId === company.id && !message.sentAt &&
          ["sent", "replied"].indexOf(message.status) === -1;
      }, function(message) {
        return Object.assign({}, message, { status: "cancelled", scheduledAt: "", updatedAt: now });
      });
      disabledRecipients = updateRowsWhere_("Recipients", function(recipient) {
        return recipient.campaignId === campaign.id && recipient.companyId === company.id;
      }, function(recipient) {
        return Object.assign({}, recipient, { active: "false", updatedAt: now, removedAt: now });
      });
    } else {
      deletedMessages = deleteRowsWhereBatch_("Messages", function(message) {
        return message.campaignId === campaign.id && message.companyId === company.id;
      });
      deletedRecipients = deleteRowsWhereBatch_("Recipients", function(recipient) {
        return recipient.campaignId === campaign.id && recipient.companyId === company.id;
      });
    }

    if (["active", "paused"].indexOf(campaign.status) !== -1) {
      upsertSetting_("approvalSnapshot:" + campaign.id, JSON.stringify(buildApprovalSnapshot_(campaign.id)));
    }

    audit_("delete_company", "Campaign", campaign.id, company, null,
      "Usunięto firmę " + company.name + " z kampanii. Zachowano historię wysłanych wiadomości; anulowano " +
      cancelledMessages + " przyszłych wiadomości, wyłączono " + disabledRecipients + " odbiorców, usunięto " +
      deletedMessages + " niewysłanych wiadomości i " + deletedRecipients + " przypisań.");
    return {
      campaignId: campaign.id,
      companyId: company.id,
      companyName: company.name,
      deletedMessages: deletedMessages,
      deletedRecipients: deletedRecipients,
      cancelledMessages: cancelledMessages,
      disabledRecipients: disabledRecipients,
      preservedHistory: hasSentHistory
    };
  });
}

function createCampaign_(payload) {
  const now = isoNow_();
  const defaults = settings_();
  const defaultFooterId = defaultFooterId_(defaults, footerProfiles_(defaults));
  const name = required_(payload.name, "Nazwa kampanii");
  const duplicate = rows_("Campaigns").find(function(campaign) {
    return !campaign.archivedAt && String(campaign.name || "").trim().toLowerCase() === name.toLowerCase();
  });
  if (duplicate) throw new Error("Kampania o tej nazwie już istnieje.");
  const campaign = {
    id: uuid_(),
    name: name,
    status: "draft",
    dryRun: payload.dryRun === undefined ? normalizeDryRun_(defaults.dryRun || "true") : normalizeDryRun_(payload.dryRun),
    dailyLimit: Math.min(Number(payload.dailyLimit || defaults.dailyLimit || 20), MAX_DAILY_LIMIT),
    sendFrom: payload.sendFrom || defaults.sendFrom || "09:00",
    sendTo: payload.sendTo || defaults.sendTo || "15:00",
    startDate: normalizeCampaignStartDate_(payload.startDate || todayCampaignDate_()),
    mail2DelayBusinessDays: normalizeDelayDays_(payload.mail2DelayBusinessDays || defaults.mail2DelayBusinessDays || 3),
    mail3DelayBusinessDays: normalizeDelayDays_(payload.mail3DelayBusinessDays || defaults.mail3DelayBusinessDays || 3),
    footerId: payload.footerId || defaultFooterId,
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
  if (current.archivedAt) throw new Error("Kampania jest zarchiwizowana.");
  const allowed = ["name", "dryRun", "dailyLimit", "sendFrom", "sendTo", "startDate", "mail2DelayBusinessDays", "mail3DelayBusinessDays", "footerId"];
  const next = Object.assign({}, current);
  const changesOperationalSettings = hasOperationalSettingChanges_(current, payload);
  if (changesOperationalSettings && ["draft", "needs_review"].indexOf(current.status) === -1) {
    throw new Error("Ustawienia wysyłki można zmieniać tylko przed zatwierdzeniem kampanii.");
  }
  allowed.forEach(function(key) {
    if (payload[key] !== undefined) next[key] = payload[key];
  });
  next.dryRun = normalizeDryRun_(next.dryRun);
  next.dailyLimit = Math.max(1, Math.min(Number(next.dailyLimit || 20), MAX_DAILY_LIMIT));
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(next.sendFrom)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(next.sendTo))) {
    throw new Error("Godziny wysyłki muszą mieć format HH:mm.");
  }
  if (next.sendFrom >= next.sendTo) throw new Error("Początek okna wysyłki musi być wcześniejszy niż koniec.");
  next.startDate = assertCampaignStartNotPast_(next.startDate);
  next.mail2DelayBusinessDays = normalizeDelayDays_(next.mail2DelayBusinessDays || 3);
  next.mail3DelayBusinessDays = normalizeDelayDays_(next.mail3DelayBusinessDays || 3);
  if (!effectiveFooterProfile_(next, settings_())) throw new Error("Wybrana stopka nie istnieje.");
  next.updatedAt = isoNow_();
  updateObject_("Campaigns", next.id, next);
  audit_("update", "Campaign", next.id, current, next, "");
  return next;
}

function hasOperationalSettingChanges_(current, payload) {
  return ["dryRun", "dailyLimit", "sendFrom", "sendTo", "startDate", "mail2DelayBusinessDays", "mail3DelayBusinessDays", "footerId"].some(function(key) {
    if (payload[key] === undefined) return false;
    if (key === "dryRun") return normalizeDryRun_(payload[key]) !== normalizeDryRun_(current[key]);
    if (key === "dailyLimit") return Number(payload[key]) !== Number(current[key]);
    if (key === "mail2DelayBusinessDays" || key === "mail3DelayBusinessDays") {
      return normalizeDelayDays_(payload[key]) !== normalizeDelayDays_(current[key] || 3);
    }
    return String(payload[key]) !== String(current[key]);
  });
}

function transitionCampaign_(payload) {
  return withMutationLock_(function() {
    const current = requireById_("Campaigns", payload.id);
    if (current.archivedAt) throw new Error("Kampania jest zarchiwizowana.");
    const targetByAction = { review: "needs_review", approve: "approved", start: "active", pause: "paused", resume: "active", cancel: "cancelled", reopen: "needs_review", "prepare-correction": "needs_review" };
    const target = targetByAction[payload.action];
    if (current.status === target) return current;
    if (!target || CAMPAIGN_TRANSITIONS[current.status].indexOf(target) === -1) {
      throw new Error("Niedozwolona zmiana statusu: " + current.status + " -> " + target);
    }
    if (target === "needs_review" || target === "approved" || target === "active") {
      validateCampaignReady_(current.id, { allowPastStartDate: target === "needs_review" });
    }
    if (target === "approved") {
      assertTransportCompatibleWithHistory_(current);
      const approvalSnapshot = buildApprovalSnapshot_(current.id);
      upsertSetting_("approvalSnapshot:" + current.id, JSON.stringify(approvalSnapshot));
    }
    if (payload.action === "start" && target === "active" && current.status === "approved") {
      const stored = settings_()["approvalSnapshot:" + current.id];
      if (stored) {
        const approvedSnapshot = JSON.parse(stored);
        const currentSnapshot = buildApprovalSnapshot_(current.id);
        assertApprovalSnapshotMatch_(approvedSnapshot, currentSnapshot);
      } else {
        throw new Error("Brak zatwierdzonego snapshota. Kampania musi być ponownie zatwierdzona.");
      }
      if (!isDryRun_(current.dryRun) && payload.confirmLive !== true) {
        throw new Error("Start LIVE wymaga jawnego potwierdzenia checklisty wysyłki.");
      }
      assertSender_(current);
      assertOperationalTriggers_();
    }
    const next = Object.assign({}, current, { status: target, updatedAt: isoNow_() });
    updateObject_("Campaigns", current.id, next);
    if (target === "active") scheduleCampaign_(current.id);
    if (target === "cancelled") cancelPendingMessages_(current.id);
    if (payload.action === "reopen") restoreCancelledMessages_(current.id);
    if (payload.action === "prepare-correction") {
      cancelPendingMessages_(current.id);
      restoreCancelledMessages_(current.id);
    }
    audit_("transition_" + payload.action, "Campaign", current.id, current, next, "");
    return next;
  });
}

function assertTransportCompatibleWithHistory_(campaign) {
  const currentTransport = sendTransport_(campaign);
  const incompatible = rows_("Messages").some(function(message) {
    if (message.campaignId !== campaign.id || !message.sentAt || !message.threadId) return false;
    const historicTransport = String(message.threadId).indexOf("smtp:") === 0 ? "smtp" : "gmail";
    return historicTransport !== currentTransport;
  });
  if (incompatible) {
    throw new Error("Transport wysyłki różni się od historii kampanii. Utwórz nową serię, aby bezpiecznie zmienić transport.");
  }
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
      return { id: campaign.id, archived: true, deleted: false, archivedAt: now };
    }
    audit_("delete", "Campaign", campaign.id, campaign, null, JSON.stringify({
      recipients: recipients.length,
      messages: messages.length
    }));
    const deletedMessages = deleteRowsWhereBatch_("Messages", function(message) { return message.campaignId === campaign.id; });
    const deletedRecipients = deleteRowsWhereBatch_("Recipients", function(recipient) { return recipient.campaignId === campaign.id; });
    const deletedCampaigns = deleteRowsWhereBatch_("Campaigns", function(item) { return item.id === campaign.id; });
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

function restoreCampaign_(payload) {
  return withMutationLock_(function() {
    const campaign = requireById_("Campaigns", required_(payload.id, "Kampania"));
    if (!campaign.archivedAt) throw new Error("Kampania nie jest zarchiwizowana.");
    validateCampaignReady_(campaign.id, { allowPastStartDate: true });
    const now = isoNow_();
    const restored = Object.assign({}, campaign, {
      status: "needs_review",
      archivedAt: "",
      updatedAt: now
    });
    updateObject_("Campaigns", campaign.id, restored);
    audit_("restore", "Campaign", campaign.id, campaign, restored, "Przywrócono z archiwum do ponownej akceptacji; historia wysyłki została zachowana.");
    return restored;
  });
}

function clearCampaignActivity_(payload) {
  return withMutationLock_(function() {
    const campaign = requireById_("Campaigns", required_(payload.id, "Kampania"));
    if (["active", "paused"].indexOf(campaign.status) !== -1) {
      throw new Error("Najpierw wstrzymaj kampanię. Nie można czyścić aktywnej wysyłki.");
    }
    const messages = rows_("Messages").filter(function(message) { return message.campaignId === campaign.id; });
    if (!messages.length) throw new Error("Kampania nie zawiera wiadomości do wyczyszczenia.");
    const messageIds = {};
    messages.forEach(function(message) { messageIds[message.id] = true; });
    const now = isoNow_();
    const clearedMessages = updateRowsWhere_("Messages", function(message) {
      return message.campaignId === campaign.id;
    }, function(message) {
      return Object.assign({}, message, {
        scheduledAt: "",
        status: "draft",
        gmailMessageId: "",
        threadId: "",
        sendMode: "",
        attempts: 0,
        lastError: "",
        sentAt: "",
        openedAt: "",
        trackingKey: Utilities.getUuid(),
        updatedAt: now
      });
    });
    const clearedEvents = deleteRowsWhereBatch_("Events", function(event) {
      if (event.entityType === "Message" && messageIds[event.entityId]) return true;
      if (event.entityType !== "Thread") return false;
      try {
        return JSON.parse(event.afterJson || "{}").campaignId === campaign.id;
      } catch (error) {
        return false;
      }
    });
    const nextCampaign = campaign.archivedAt ? campaign : Object.assign({}, campaign, {
      status: "needs_review",
      updatedAt: now
    });
    if (!campaign.archivedAt) updateObject_("Campaigns", campaign.id, nextCampaign);
    return {
      id: campaign.id,
      clearedMessages: clearedMessages,
      clearedEvents: clearedEvents,
      status: nextCampaign.status,
      archived: Boolean(campaign.archivedAt),
      preserved: ["contacts", "recipients", "message_content", "global_suppression"]
    };
  });
}

function scheduleCampaign_(campaignId) {
  const campaign = requireById_("Campaigns", campaignId);
  const recipients = rows_("Recipients").filter(function(item) {
    return item.campaignId === campaignId && isActiveFlag_(item.active);
  });
  const activeByCompany = {};
  recipients.forEach(function(item) { activeByCompany[item.companyId] = item.contactId; });
  const plannedStart = plannedCampaignStart_(campaign);
  const start = nextWindowStart_(plannedStart.getTime() > Date.now() ? plannedStart : new Date(), campaign);
  const delayToMail2 = normalizeDelayDays_(campaign.mail2DelayBusinessDays || 3);
  const delayToMail3 = normalizeDelayDays_(campaign.mail3DelayBusinessDays || 3);
  const delaysByStep = { "1": 0, "2": delayToMail2, "3": delayToMail2 + delayToMail3 };
  const dryRun = isDryRun_(campaign.dryRun);
  rows_("Messages").filter(function(message) {
    return message.campaignId === campaignId && ["draft", "scheduled"].indexOf(message.status) !== -1;
  }).forEach(function(message) {
    const contactId = activeByCompany[message.companyId];
    if (!contactId) return;
    const scheduled = dryRun
      ? addHours_(start, Math.max(0, Number(message.step || 1) - 1))
      : addBusinessDays_(start, delaysByStep[String(message.step)] || 0);
    updateObject_("Messages", message.id, Object.assign({}, message, {
      contactId: contactId,
      scheduledAt: scheduled.toISOString(),
      status: "scheduled",
      updatedAt: isoNow_()
    }));
  });
}

function validateCampaignReady_(campaignId, options) {
  const campaign = requireById_("Campaigns", campaignId);
  const excludedCompanyIds = options && Array.isArray(options.excludedCompanyIds) ? options.excludedCompanyIds : [];
  const activeRecipients = rows_("Recipients").filter(function(item) {
    return item.campaignId === campaignId && isActiveFlag_(item.active) &&
      excludedCompanyIds.indexOf(item.companyId) === -1;
  });
  const activeCompanyIds = unique_(activeRecipients.map(function(item) { return item.companyId; }));
  const messages = rows_("Messages").filter(function(message) {
    return message.campaignId === campaignId && activeCompanyIds.indexOf(message.companyId) !== -1;
  });
  const contactsById = {};
  rows_("Contacts").forEach(function(contact) { contactsById[contact.id] = contact; });
  if (!messages.length) throw new Error("Kampania nie zawiera wiadomości.");
  const companyIds = unique_(messages.map(function(message) { return message.companyId; }));
  if (activeRecipients.some(function(recipient) { return companyIds.indexOf(recipient.companyId) === -1; })) {
    throw new Error("Kampania zawiera odbiorcę bez odpowiadającej sekwencji wiadomości.");
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
    const contact = contactsById[recipient.contactId];
    if (!contact) throw new Error("Nie znaleziono kontaktu przypisanego do odbiorcy kampanii.");
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
  if (!isFinite(limit) || Math.floor(limit) !== limit || limit < 1 || limit > MAX_DAILY_LIMIT) throw new Error("Kampania ma niepoprawny limit dzienny.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(campaign.sendFrom)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(campaign.sendTo)) || campaign.sendFrom >= campaign.sendTo) {
    throw new Error("Kampania ma niepoprawne okno wysyłki.");
  }
  if (!(options && options.allowPastStartDate)) assertCampaignStartNotPast_(campaign.startDate);
  normalizeDelayDays_(campaign.mail2DelayBusinessDays || 3);
  normalizeDelayDays_(campaign.mail3DelayBusinessDays || 3);
  if (!effectiveFooterProfile_(campaign, settings_())) throw new Error("Kampania nie ma poprawnie wybranej stopki.");
}

function forceNeedsReview_(campaignId, detail) {
  const campaign = requireById_("Campaigns", campaignId);
  if (["approved", "active", "paused"].indexOf(campaign.status) === -1) return;
  const next = Object.assign({}, campaign, { status: "needs_review", updatedAt: isoNow_() });
  updateObject_("Campaigns", campaign.id, next);
  audit_("needs_review", "Campaign", campaign.id, campaign, next, detail);
}

function isInFlightCampaign_(campaign) {
  return ["draft", "needs_review", "approved", "active", "paused"].indexOf(campaign.status) !== -1;
}

function buildApprovalSnapshot_(campaignId) {
  const campaign = requireById_("Campaigns", campaignId);
  const recipients = rows_("Recipients").filter(function(item) { return item.campaignId === campaignId && isActiveFlag_(item.active); });
  const companyIds = unique_(recipients.map(function(recipient) { return recipient.companyId; }));
  const messages = rows_("Messages").filter(function(message) {
    return message.campaignId === campaignId && companyIds.indexOf(message.companyId) !== -1;
  });
  const footerProfile = effectiveFooterProfile_(campaign, settings_());
  if (!footerProfile) throw new Error("Kampania nie ma poprawnie wybranej stopki.");
  const footerHash = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, footerProfile.html, Utilities.Charset.UTF_8));
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
    dryRun: normalizeDryRun_(campaign.dryRun),
    dailyLimit: Number(campaign.dailyLimit),
    sendFrom: String(campaign.sendFrom),
    sendTo: String(campaign.sendTo),
    startDate: String(normalizeCampaignStartDate_(campaign.startDate || todayCampaignDate_())),
    sendTransport: sendTransport_(campaign),
    mail2DelayBusinessDays: normalizeDelayDays_(campaign.mail2DelayBusinessDays || 3),
    mail3DelayBusinessDays: normalizeDelayDays_(campaign.mail3DelayBusinessDays || 3),
    footerId: footerProfile.id,
    footerHash: footerHash,
    companyCount: companyIds.length,
    contentHash: approvalContentHash_(companies)
  };
}

function approvalContentHash_(companies) {
  return bytesToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(companies || []),
    Utilities.Charset.UTF_8
  ));
}

function assertApprovalSnapshotMatch_(approved, current) {
  if (approved.campaignId !== current.campaignId) {
    throw new Error("Snapshots nie pasują — ID kampanii się różni.");
  }
  if (Number(approved.companyCount) !== Number(current.companyCount)) {
    throw new Error("Liczba firm w snapshocie się różni — kampania wymaga ponownej akceptacji.");
  }
  if (normalizeDryRun_(approved.dryRun) !== normalizeDryRun_(current.dryRun)) {
    throw new Error("Tryb testowy/live zmieniony od zatwierdzenia — kampania wymaga ponownej akceptacji.");
  }
  if (Number(approved.dailyLimit) !== Number(current.dailyLimit)) {
    throw new Error("Limit dzienny zmieniony od zatwierdzenia — kampania wymaga ponownej akceptacji.");
  }
  if (String(approved.sendFrom) !== String(current.sendFrom) || String(approved.sendTo) !== String(current.sendTo)) {
    throw new Error("Okno wysyłki zmienione od zatwierdzenia — kampania wymaga ponownej akceptacji.");
  }
  if (String(approved.startDate) !== String(current.startDate)) {
    throw new Error("Data startu zmieniona od zatwierdzenia — kampania wymaga ponownej akceptacji.");
  }
  if (String(approved.sendTransport) !== String(current.sendTransport)) {
    throw new Error("Transport wysyłki zmieniony od zatwierdzenia — kampania wymaga ponownej akceptacji.");
  }
  if (Number(approved.mail2DelayBusinessDays || 3) !== Number(current.mail2DelayBusinessDays || 3) || Number(approved.mail3DelayBusinessDays || 3) !== Number(current.mail3DelayBusinessDays || 3)) {
    throw new Error("Harmonogram sekwencji zmieniony od zatwierdzenia — kampania wymaga ponownej akceptacji.");
  }
  if ((approved.footerId && String(approved.footerId) !== String(current.footerId)) || String(approved.footerHash) !== String(current.footerHash)) {
    throw new Error("Stopka kampanii zmieniona od zatwierdzenia — kampania wymaga ponownej akceptacji.");
  }
  const approvedContentHash = approved.contentHash || approvalContentHash_(approved.companies || []);
  if (String(approvedContentHash) !== String(current.contentHash)) {
    throw new Error("Odbiorcy lub treści wiadomości zmienione od zatwierdzenia — kampania wymaga ponownej akceptacji.");
  }
}
