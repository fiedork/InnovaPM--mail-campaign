function installTriggers() {
  const ownedHandlers = ownedTriggerHandlers_();
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
    const activeCampaigns = rows_("Campaigns").filter(function(item) { return item.status === "active" && !item.archivedAt; });
    activeCampaigns.filter(withinSendWindow_).forEach(function(campaign) {
      assertSender_(campaign);
      processCampaignQueue_(campaign);
    });
  } finally {
    lock.releaseLock();
  }
}

function processCampaignQueue_(campaign) {
  const dryRun = isDryRun_(campaign.dryRun);
  const dailyLimit = Math.max(1, Math.min(Number(campaign.dailyLimit || 20), MAX_DAILY_LIMIT));
  const due = rows_("Messages").filter(function(message) {
    return message.campaignId === campaign.id &&
      message.status === "scheduled" &&
      new Date(message.scheduledAt).getTime() <= Date.now();
  }).slice(0, 100);
  for (let index = 0; index < due.length; index += 1) {
    if (!withinSendWindow_(campaign)) break;
    if (!dryRun && sentTodayCount_(campaign.id) >= dailyLimit) break;
    const message = due[index];
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
  }
  completeCampaignIfFinished_(campaign.id);
}

function sentTodayCount_(campaignId) {
  const today = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  return rows_("Messages").filter(function(message) {
    return message.campaignId === campaignId &&
      message.sentAt &&
      Utilities.formatDate(new Date(message.sentAt), TIMEZONE, "yyyy-MM-dd") === today;
  }).length;
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

function checkReplies() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    initializeWorkbook_();
    const allMessages = rows_("Messages");
    const campaignsById = {};
    rows_("Campaigns").forEach(function(campaign) { campaignsById[campaign.id] = campaign; });
    const sentMessages = allMessages.filter(function(message) {
      const campaign = campaignsById[message.campaignId];
      return message.status === "sent" && message.threadId && campaign &&
        message.sendMode === deliveryMode_(campaign);
    });
    if (sendTransport_() === "smtp") {
      checkSmtpMailbox_(sentMessages);
      return;
    }
    const seenThreads = {};
    sentMessages.forEach(function(message) {
      if (String(message.threadId).indexOf("smtp:") === 0) return;
      if (seenThreads[message.threadId]) return;
      seenThreads[message.threadId] = true;
      const campaign = campaignsById[message.campaignId] || {};
      const dryRun = isDryRun_(campaign.dryRun);
      const campaignThreadMessages = allMessages.filter(function(item) {
        return item.threadId === message.threadId && item.sentAt && item.sendMode === message.sendMode;
      });
      const thread = Gmail.Users.Threads.get("me", message.threadId, { format: "metadata" });
      const external = (thread.messages || []).find(function(item) {
        const headers = headersToObject_(item.payload && item.payload.headers || []);
        const from = String(headers.from || "").toLowerCase();
        return from && from.indexOf(OWNER_EMAIL.toLowerCase()) === -1 && !isAutoReply_(headers);
      });
      if (external) markThreadReplied_(message.threadId);
      else if (dryRun && isDryRunReply_(thread, campaignThreadMessages)) markThreadReplied_(message.threadId);
    });
    detectBounces_();
  } finally {
    lock.releaseLock();
  }
}

function checkSmtpMailbox_(sentMessages) {
  const contactsById = {};
  rows_("Contacts").forEach(function(contact) { contactsById[contact.id] = contact; });
  const payloadMessages = sentMessages.filter(function(message) {
    return message.gmailMessageId && contactsById[message.contactId] && contactsById[message.contactId].email;
  }).map(function(message) {
    return {
      id: message.id,
      rfcMessageId: message.gmailMessageId,
      recipientEmail: String(contactsById[message.contactId].email).toLowerCase()
    };
  });
  if (!payloadMessages.length) return;
  const result = callImapRelay_({ messages: payloadMessages, sinceDays: 14 });
  (result.repliedMessageIds || []).forEach(function(messageId) {
    const message = findBy_("Messages", "id", messageId);
    if (message && message.threadId) markThreadReplied_(message.threadId);
  });
  (result.bouncedEmails || []).forEach(function(email) {
    markEmailBounced_(String(email).toLowerCase(), "hostinger-imap");
  });
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
  const sendFrom = String(campaign && campaign.sendFrom || settings_().sendFrom || "09:00").split(":");
  const sendTo = String(campaign && campaign.sendTo || settings_().sendTo || "15:00").split(":");
  const start = new Date(date);
  start.setHours(Number(sendFrom[0]), Number(sendFrom[1]), 0, 0);
  const end = new Date(date);
  end.setHours(Number(sendTo[0]), Number(sendTo[1]), 0, 0);
  const weekday = date.getDay();
  if (weekday === 0 || weekday === 6 || date.getTime() > end.getTime()) {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    next.setHours(Number(sendFrom[0]), Number(sendFrom[1]), 0, 0);
    return moveToWeekday_(next);
  }
  if (date.getTime() < start.getTime()) return start;
  return date;
}

function todayCampaignDate_() {
  return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
}

function normalizeCampaignStartDate_(value) {
  const startDate = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error("Data startu kampanii musi mieć format RRRR-MM-DD.");
  }
  const parsed = Utilities.parseDate(startDate + " 12:00", TIMEZONE, "yyyy-MM-dd HH:mm");
  if (Utilities.formatDate(parsed, TIMEZONE, "yyyy-MM-dd") !== startDate) {
    throw new Error("Data startu kampanii jest niepoprawna.");
  }
  return startDate;
}

function assertCampaignStartNotPast_(value) {
  const startDate = normalizeCampaignStartDate_(value || todayCampaignDate_());
  if (startDate < todayCampaignDate_()) {
    throw new Error("Data startu kampanii nie może być wcześniejsza niż dzisiaj.");
  }
  return startDate;
}

function plannedCampaignStart_(campaign) {
  const startDate = normalizeCampaignStartDate_(campaign.startDate || todayCampaignDate_());
  return Utilities.parseDate(startDate + " " + String(campaign.sendFrom || "09:00"), TIMEZONE, "yyyy-MM-dd HH:mm");
}

function addBusinessDays_(date, days) {
  const result = new Date(date);
  let remaining = normalizeDelayDays_(days);
  if (remaining === 0) return moveToWeekday_(result);
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    if ([0, 6].indexOf(result.getDay()) === -1) remaining -= 1;
  }
  return result;
}

function addHours_(date, hours) {
  const result = new Date(date);
  result.setHours(result.getHours() + Number(hours || 0));
  return result;
}

function moveToWeekday_(date) {
  const result = new Date(date);
  while ([0, 6].indexOf(result.getDay()) !== -1) result.setDate(result.getDate() + 1);
  return result;
}

function normalizeDelayDays_(value) {
  const days = Number(value);
  if (!isFinite(days) || Math.floor(days) !== days || days < 0 || days > 30) {
    throw new Error("Odstęp między mailami musi być liczbą całkowitą od 0 do 30 dni roboczych.");
  }
  return days;
}

function markThreadReplied_(threadId) {
  const affected = rows_("Messages").filter(function(message) { return message.threadId === threadId; });
  if (!affected.length) return;
  const campaignId = affected[0].campaignId;
  const companyId = affected[0].companyId;
  const deliveryMode = affected[0].sendMode;
  rows_("Messages").filter(function(message) {
    return message.campaignId === campaignId && message.companyId === companyId &&
      message.sendMode === deliveryMode &&
      ["draft", "scheduled", "sent"].indexOf(message.status) !== -1;
  }).forEach(function(message) {
    updateObject_("Messages", message.id, Object.assign({}, message, { status: "replied", updatedAt: isoNow_() }));
  });
  audit_("reply_detected", "Thread", threadId, null, { campaignId: campaignId, companyId: companyId }, "");
}

function isDryRunReply_(thread, campaignThreadMessages) {
  const nonAutomaticMessages = (thread.messages || []).filter(function(item) {
    return !isAutoReply_(headersToObject_(item.payload && item.payload.headers || []));
  });
  return nonAutomaticMessages.length > campaignThreadMessages.length;
}

function detectBounces_() {
  const threads = GmailApp.search("newer_than:2d from:(mailer-daemon OR postmaster) (subject:(undeliverable OR failure OR niedostarczona))", 0, 50);
  threads.forEach(function(thread) {
    const body = thread.getMessages().map(function(message) { return message.getPlainBody(); }).join("\n");
    const match = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (!match) return;
    markEmailBounced_(match[0].toLowerCase(), thread.getId());
  });
}

function markEmailBounced_(email, sourceMessageId) {
  const normalizedEmail = String(email || "").toLowerCase();
  if (!normalizedEmail) return;
  if (!isSuppressed_(normalizedEmail)) {
    appendObject_("Suppression", { id: uuid_(), email: normalizedEmail, reason: "bounce", sourceMessageId: sourceMessageId || "", createdAt: isoNow_() });
  }
  rows_("Contacts").filter(function(contact) { return String(contact.email).toLowerCase() === normalizedEmail; }).forEach(function(contact) {
    rows_("Messages").filter(function(message) {
      return message.contactId === contact.id && ["draft", "scheduled", "sent"].indexOf(message.status) !== -1;
    }).forEach(function(message) {
      updateObject_("Messages", message.id, Object.assign({}, message, { status: "failed", lastError: "bounce", updatedAt: isoNow_() }));
    });
  });
  audit_("bounce", "Contact", normalizedEmail, null, { suppressed: true }, sourceMessageId || "");
}
