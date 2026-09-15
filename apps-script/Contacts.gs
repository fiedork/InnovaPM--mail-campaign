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

function listContacts_() {
  return listContactsFromContext_({
    Campaigns: rows_("Campaigns"),
    Recipients: rows_("Recipients"),
    Suppression: rows_("Suppression"),
    Contacts: rows_("Contacts")
  });
}

function listContactsFromContext_(context) {
  const campaignsById = {};
  contextRows_(context, "Campaigns").filter(function(campaign) { return !campaign.archivedAt; }).forEach(function(campaign) {
    campaignsById[campaign.id] = campaign;
  });
  const membershipsByContact = {};
  contextRows_(context, "Recipients").filter(function(recipient) {
    return isActiveFlag_(recipient.active) && campaignsById[recipient.campaignId];
  }).forEach(function(recipient) {
    const membership = campaignsById[recipient.campaignId];
    if (!membershipsByContact[recipient.contactId]) membershipsByContact[recipient.contactId] = [];
    if (!membershipsByContact[recipient.contactId].some(function(item) { return item.id === membership.id; })) {
      membershipsByContact[recipient.contactId].push({ id: membership.id, name: membership.name, status: membership.status, updatedAt: membership.updatedAt });
    }
  });
  const suppressedEmails = {};
  contextRows_(context, "Suppression").forEach(function(item) {
    suppressedEmails[String(item.email || "").trim().toLowerCase()] = true;
  });
  return contextRows_(context, "Contacts").filter(function(contact) { return contact.status !== "deleted"; }).map(function(contact) {
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
      return recipient.contactId === contact.id && isActiveFlag_(recipient.active) && campaign && isInFlightCampaign_(campaign);
    });
    if (conflict) {
      throw new Error("Kontakt jest już przypisany do trwającej kampanii „" + campaignsById[conflict.campaignId].name + "”.");
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
      return recipient.campaignId === campaign.id && recipient.companyId === contact.companyId && isActiveFlag_(recipient.active);
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
      throw new Error("Odbiorcę można zmienić tylko przed zatwierdzeniem kampanii.");
    }
    const companyId = required_(payload.companyId, "Firma");
    if (!rows_("Messages").some(function(message) { return message.campaignId === campaign.id && message.companyId === companyId; })) {
      throw new Error("Firma nie należy do wskazanej kampanii.");
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
      return recipient.contactId === contact.id && recipient.campaignId !== campaign.id && isActiveFlag_(recipient.active) && other && isInFlightCampaign_(other);
    });
    if (conflict) throw new Error("Kontakt jest już w innej trwającej kampanii.");
    const now = isoNow_();
    rows_("Recipients").filter(function(item) {
      return item.campaignId === campaign.id && item.companyId === companyId && isActiveFlag_(item.active);
    }).forEach(function(item) {
      updateObject_("Recipients", item.id, Object.assign({}, item, { active: "false", updatedAt: now }));
    });
    const recipient = { id: uuid_(), campaignId: campaign.id, companyId: companyId, contactId: contact.id, active: "true", createdAt: now, updatedAt: now };
    appendObject_("Recipients", recipient);
    SpreadsheetApp.flush();
    const savedRecipient = requireById_("Recipients", recipient.id);
    if (savedRecipient.campaignId !== campaign.id || savedRecipient.companyId !== companyId || savedRecipient.contactId !== contact.id || !isActiveFlag_(savedRecipient.active)) {
      throw new Error("Przypisanie odbiorcy nie zostało poprawnie zapisane. Spróbuj ponownie.");
    }
    rows_("Messages").filter(function(message) {
      return message.campaignId === campaign.id && message.companyId === companyId && message.status === "draft";
    }).forEach(function(message) {
      updateObject_("Messages", message.id, Object.assign({}, message, { contactId: contact.id, updatedAt: now }));
    });
    audit_("select_recipient", "Recipient", savedRecipient.id, null, savedRecipient, "");
    return savedRecipient;
  });
}

function removeRecipient_(payload) {
  return withMutationLock_(function() {
    const campaign = requireById_("Campaigns", required_(payload.campaignId, "Kampania"));
    if (campaign.archivedAt) throw new Error("Kampania jest zarchiwizowana.");
    if (["draft", "needs_review"].indexOf(campaign.status) === -1) throw new Error("Odbiorcę można usunąć tylko przed zatwierdzeniem kampanii.");
    const companyId = required_(payload.companyId, "Firma");
    assertRecipientMutable_(campaign.id, companyId);
    const now = isoNow_();
    const active = rows_("Recipients").filter(function(recipient) {
      return recipient.campaignId === campaign.id && recipient.companyId === companyId && isActiveFlag_(recipient.active);
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
  if (hasHistory) throw new Error("Nie można zmienić odbiorcy po rozpoczęciu korespondencji. Utwórz nową kampanię.");
}

function pauseCampaignsForContact_(contactId) {
  const campaignIds = unique_(rows_("Recipients").filter(function(item) {
    return item.contactId === contactId && isActiveFlag_(item.active);
  }).map(function(item) { return item.campaignId; }));
  campaignIds.forEach(function(id) { forceNeedsReview_(id, "Zmiana danych aktywnego kontaktu."); });
}
