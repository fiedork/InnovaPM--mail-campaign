function updateMessage_(payload) {
  const current = requireById_("Messages", payload.id);
  if (["sent", "replied", "cancelled", "suppressed"].indexOf(current.status) !== -1) {
    throw new Error("Nie można edytować wysłanej lub zamkniętej wiadomości.");
  }
  const campaign = requireById_("Campaigns", current.campaignId);
  if (campaign.archivedAt) throw new Error("Kampania jest zarchiwizowana.");
  if (["approved", "active", "paused", "completed"].indexOf(campaign.status) !== -1) {
    throw new Error("Nie można edytować wiadomości po zatwierdzeniu kampanii.");
  }
  const activeRecipients = rows_("Recipients").filter(function(recipient) {
    return recipient.campaignId === current.campaignId &&
      recipient.companyId === current.companyId &&
      isActiveFlag_(recipient.active);
  });
  if (activeRecipients.length !== 1) {
    throw new Error("Firma w kampanii nie ma dokładnie jednego aktywnego odbiorcy.");
  }
  if (!current.contactId || current.contactId !== activeRecipients[0].contactId) {
    throw new Error("Wiadomość nie wskazuje aktywnego odbiorcy kampanii.");
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

function sendMessage_(campaign, message) {
  const contact = requireById_("Contacts", message.contactId);
  assertMessageSafeToSend_(campaign, message, contact);

  assertPreSendApproval_(campaign);

  if (isSuppressed_(contact.email)) {
    updateObject_("Messages", message.id, Object.assign({}, message, { status: "suppressed", updatedAt: isoNow_() }));
    return;
  }
  const dryRun = isDryRun_(campaign.dryRun);
  const deliveryMode = deliveryMode_(campaign);
  const sameDeliveryMode = message.sendMode === deliveryMode;
  const recipient = dryRun ? OWNER_EMAIL : contact.email;
  const subject = dryRun ? "[DRY-RUN: " + contact.email + "] " + message.subject : message.subject;
  let rfcMessageId = "";
  let threadId = sameDeliveryMode ? message.threadId || "" : "";
  const outboundMessage = Object.assign({}, message, {
    gmailMessageId: sameDeliveryMode ? message.gmailMessageId || "" : ""
  });
  if (sendTransport_(campaign) === "smtp") {
    rfcMessageId = "<" + Utilities.getUuid() + "@innova.pm>";
    const smtpMime = buildMime_(recipient, subject, message.body, outboundMessage, campaign, true, rfcMessageId);
    const smtpResult = sendViaSmtpRelay_({
      messageId: rfcMessageId,
      to: recipient,
      from: OWNER_EMAIL,
      rawMime: smtpMime
    });
    rfcMessageId = smtpResult.messageId || rfcMessageId;
    threadId = threadId || "smtp:" + deliveryMode + ":" + message.campaignId + ":" + message.companyId;
  } else {
    const gmailMime = buildMime_(recipient, subject, message.body, outboundMessage, campaign, true);
    const sent = Gmail.Users.Messages.send(
      { raw: Utilities.base64EncodeWebSafe(gmailMime, Utilities.Charset.UTF_8), threadId: threadId || undefined },
      "me"
    );
    const sentMetadata = Gmail.Users.Messages.get("me", sent.id, {
      format: "metadata",
      metadataHeaders: ["Message-ID"]
    });
    const sentHeaders = headersToObject_(sentMetadata.payload && sentMetadata.payload.headers || []);
    rfcMessageId = sentHeaders["message-id"] || "";
    threadId = sent.threadId || threadId || "";
  }
  const next = Object.assign({}, message, {
    status: "sent",
    gmailMessageId: rfcMessageId,
    threadId: threadId,
    sendMode: deliveryMode,
    attempts: Number(message.attempts || 0) + 1,
    sentAt: isoNow_(),
    updatedAt: isoNow_()
  });
  updateObject_("Messages", message.id, next);
  propagateThread_(message.campaignId, message.companyId, message.contactId, deliveryMode, next.threadId, rfcMessageId);
  audit_("sent", "Message", message.id, message, next, dryRun ? "dry-run" : "live");
}

function deliveryMode_(campaign) {
  return isDryRun_(campaign.dryRun) ? "dry-run" : "live";
}

function assertPreSendApproval_(campaign) {
  const stored = settings_()["approvalSnapshot:" + campaign.id];
  if (!stored) {
    throw new Error("Brak zatwierdzonego snapshota kampanii. Wymagana ponowna akceptacja.");
  }
  let approvedSnapshot;
  try {
    approvedSnapshot = JSON.parse(stored);
  } catch (error) {
    throw new Error("Nieprawidłowy snapshot akceptacji. Wymagana ponowna akceptacja.");
  }
  const currentSnapshot = buildApprovalSnapshot_(campaign.id);
  assertApprovalSnapshotMatch_(approvedSnapshot, currentSnapshot);
  if (String(approvedSnapshot.sendTransport) !== String(sendTransport_(campaign))) {
    throw new Error("Transport wysyłki zmieniony od zatwierdzenia — wysyłka zablokowana do ponownej akceptacji.");
  }
}

function assertMessageSafeToSend_(campaign, message, contact) {
  if (campaign.id !== message.campaignId) {
    throw new Error("Wiadomość nie należy do aktywnej kampanii.");
  }
  if (campaign.status !== "active" || campaign.archivedAt) {
    throw new Error("Wysyłka jest dozwolona wyłącznie dla aktywnej kampanii.");
  }
  const activeRecipients = rows_("Recipients").filter(function(recipient) {
    return recipient.campaignId === message.campaignId &&
      recipient.companyId === message.companyId &&
      isActiveFlag_(recipient.active);
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

function assertSender_(campaign) {
  if (sendTransport_(campaign) === "smtp") {
    assertSmtpRelay_();
    return;
  }
  const sender = String(Session.getEffectiveUser().getEmail()).toLowerCase();
  const owner = OWNER_EMAIL.toLowerCase();
  const aliases = GmailApp.getAliases().map(function(alias) { return String(alias).toLowerCase(); });
  if (sender !== owner && aliases.indexOf(owner) === -1) {
    throw new Error("Wysyłka zablokowana: konto " + sender + " nie ma zweryfikowanego aliasu " + OWNER_EMAIL + ".");
  }
}

function sendTransport_(campaign) {
  const property = PropertiesService.getScriptProperties().getProperty("SEND_TRANSPORT");
  const value = String(property || (campaign && campaign.sendTransport) || "smtp").toLowerCase();
  return value === "smtp" ? "smtp" : "gmail";
}

function smtpRelayUrl_() {
  return PropertiesService.getScriptProperties().getProperty("SMTP_RELAY_URL") ||
    "https://innovapm-mail-campaign.netlify.app/api/smtp/send";
}

function imapRelayUrl_() {
  return PropertiesService.getScriptProperties().getProperty("IMAP_RELAY_URL") ||
    "https://innovapm-mail-campaign.netlify.app/api/imap/check";
}

function assertSmtpRelay_() {
  const response = UrlFetchApp.fetch(smtpRelayUrl_(), {
    method: "get",
    muteHttpExceptions: true
  });
  const body = JSON.parse(response.getContentText() || "{}");
  if (response.getResponseCode() >= 400 || !body.ok || !body.configured) {
    throw new Error("Wysyłka SMTP nie jest gotowa: " + (body.error || "brak konfiguracji relay."));
  }
}

function sendViaSmtpRelay_(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty("HMAC_SECRET");
  if (!secret) throw new Error("Brak HMAC_SECRET w Script Properties.");
  const timestamp = String(Date.now());
  const nonce = Utilities.getUuid();
  const body = JSON.stringify(payload);
  const signature = bytesToHex_(Utilities.computeHmacSha256Signature(
    timestamp + "." + nonce + "." + body,
    secret,
    Utilities.Charset.UTF_8
  ));
  const response = UrlFetchApp.fetch(smtpRelayUrl_(), {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({ timestamp: timestamp, nonce: nonce, body: body, signature: signature })
  });
  const result = JSON.parse(response.getContentText() || "{}");
  if (response.getResponseCode() >= 400 || !result.ok) {
    throw new Error("SMTP relay odrzucił wysyłkę: " + (result.error || ("HTTP " + response.getResponseCode())));
  }
  return result.data || {};
}

function callImapRelay_(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty("HMAC_SECRET");
  if (!secret) throw new Error("Brak HMAC_SECRET w Script Properties.");
  const timestamp = String(Date.now());
  const nonce = Utilities.getUuid();
  const body = JSON.stringify(payload);
  const signature = bytesToHex_(Utilities.computeHmacSha256Signature(
    timestamp + "." + nonce + "." + body,
    secret,
    Utilities.Charset.UTF_8
  ));
  const response = UrlFetchApp.fetch(imapRelayUrl_(), {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({ timestamp: timestamp, nonce: nonce, body: body, signature: signature })
  });
  const result = JSON.parse(response.getContentText() || "{}");
  if (response.getResponseCode() >= 400 || !result.ok) {
    throw new Error("IMAP relay odrzucił monitoring: " + (result.error || ("HTTP " + response.getResponseCode())));
  }
  return result.data || {};
}

function buildMime_(to, subject, body, message, campaign, includeTracking, forcedMessageId) {
  const footerHtml = sanitizeEmailHtml_(effectiveCampaignFooterHtml_(campaign));
  const boundary = "innova_" + Utilities.getUuid().replace(/-/g, "");
  const plainFooter = htmlToText_(footerHtml);
  const plainBody = String(body || "") + (plainFooter ? "\n\n" + plainFooter : "");
  const trackingPixel = includeTracking ? trackingPixelHtml_(message) : "";
  const htmlBody = "<div style=\"white-space:pre-wrap\">" + escapeHtml_(body) + "</div>" + footerHtml + trackingPixel;
  const headers = [
    "MIME-Version: 1.0",
    "Content-Type: multipart/alternative; boundary=\"" + boundary + "\"",
    "From: " + OWNER_EMAIL,
    "To: " + to,
    "Subject: =?UTF-8?B?" + Utilities.base64Encode(subject, Utilities.Charset.UTF_8) + "?="
  ];
  if (forcedMessageId) headers.push("Message-ID: " + forcedMessageId);
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

function trackingPixelHtml_(message) {
  const properties = PropertiesService.getScriptProperties();
  const secret = properties.getProperty("HMAC_SECRET");
  const baseUrl = properties.getProperty("TRACKING_BASE_URL") || "https://innovapm-mail-campaign.netlify.app/api/track/open";
  const tokenPayload = message.id + (message.trackingKey ? ":" + message.trackingKey : "");
  const token = bytesToHex_(Utilities.computeHmacSha256Signature(
    tokenPayload,
    secret,
    Utilities.Charset.UTF_8
  ));
  return '<img src="' + baseUrl + '?id=' + encodeURIComponent(message.id) + '&amp;token=' + token + '" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">';
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
    sendMode: "",
    attempts: 0,
    lastError: "",
    sentAt: "",
    openedAt: "",
    trackingKey: Utilities.getUuid(),
    updatedAt: now || isoNow_()
  };
}

function propagateThread_(campaignId, companyId, contactId, deliveryMode, threadId, rfcMessageId) {
  rows_("Messages").filter(function(message) {
    return message.campaignId === campaignId && message.companyId === companyId &&
      message.contactId === contactId &&
      ["draft", "scheduled", "failed"].indexOf(message.status) !== -1 &&
      (message.sendMode === deliveryMode || !message.sendMode) && !message.threadId;
  }).forEach(function(message) {
    updateObject_("Messages", message.id, Object.assign({}, message, {
      threadId: threadId,
      gmailMessageId: rfcMessageId,
      sendMode: deliveryMode,
      updatedAt: isoNow_()
    }));
  });
}

function cancelPendingMessages_(campaignId) {
  rows_("Messages").filter(function(message) {
    return message.campaignId === campaignId && ["draft", "scheduled", "failed"].indexOf(message.status) !== -1;
  }).forEach(function(message) {
    updateObject_("Messages", message.id, Object.assign({}, message, { status: "cancelled", updatedAt: isoNow_() }));
  });
}

function restoreCancelledMessages_(campaignId) {
  rows_("Messages").filter(function(message) {
    return message.campaignId === campaignId && message.status === "cancelled";
  }).forEach(function(message) {
    updateObject_("Messages", message.id, Object.assign({}, message, {
      status: "draft",
      scheduledAt: "",
      retryAttempts: 0,
      lastError: "",
      updatedAt: isoNow_()
    }));
  });
}

function isSuppressed_(email) {
  return Boolean(findBy_("Suppression", "email", String(email).toLowerCase()));
}
