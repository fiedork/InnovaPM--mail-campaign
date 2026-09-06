function getSettings_() {
  const current = settings_();
  const footerProfiles = footerProfiles_(current);
  const defaultFooterId = defaultFooterId_(current, footerProfiles);
  const defaultFooter = footerProfiles.find(function(profile) { return profile.id === defaultFooterId; }) || footerProfiles[0];
  return {
    emailFooterHtml: defaultFooter ? defaultFooter.html : "",
    footerProfiles: footerProfiles,
    defaultFooterId: defaultFooterId,
    dryRun: isDryRun_(current.dryRun),
    dailyLimit: Math.max(1, Math.min(Number(current.dailyLimit || 20), MAX_DAILY_LIMIT)),
    sendFrom: current.sendFrom || "09:00",
    sendTo: current.sendTo || "15:00",
    mail2DelayBusinessDays: normalizeDelayDays_(current.mail2DelayBusinessDays || 3),
    mail3DelayBusinessDays: normalizeDelayDays_(current.mail3DelayBusinessDays || 3),
    timezone: current.timezone || TIMEZONE
  };
}

function updateSettings_(payload) {
  return withMutationLock_(function() {
    const currentSettings = settings_();
    const currentProfiles = footerProfiles_(currentSettings);
    let requestedProfiles = payload.footerProfiles === undefined ? currentProfiles : payload.footerProfiles;
    if (payload.footerProfiles === undefined && payload.emailFooterHtml !== undefined) {
      const legacyDefaultId = defaultFooterId_(currentSettings, currentProfiles);
      requestedProfiles = currentProfiles.map(function(profile) {
        return profile.id === legacyDefaultId ? Object.assign({}, profile, { html: String(payload.emailFooterHtml || "") }) : profile;
      });
    }
    const footerProfiles = normalizeFooterProfiles_(requestedProfiles);
    const defaultFooterId = String(payload.defaultFooterId === undefined ? defaultFooterId_(currentSettings, currentProfiles) : payload.defaultFooterId).trim();
    const defaultFooter = footerProfiles.find(function(profile) { return profile.id === defaultFooterId; });
    if (!defaultFooter) throw new Error("Wybierz istniejącą stopkę domyślną.");
    if (payload.dryRun !== undefined && typeof payload.dryRun !== "boolean") throw new Error("Tryb testowy musi być wartością logiczną.");
    const dryRun = payload.dryRun === undefined ? isDryRun_(currentSettings.dryRun) : payload.dryRun;
    const rawLimit = payload.dailyLimit === undefined ? Number(currentSettings.dailyLimit || 20) : Number(payload.dailyLimit);
    if (!isFinite(rawLimit) || Math.floor(rawLimit) !== rawLimit || rawLimit < 1 || rawLimit > MAX_DAILY_LIMIT) throw new Error("Limit dzienny musi być liczbą całkowitą od 1 do " + MAX_DAILY_LIMIT + ".");
    const sendFrom = String(payload.sendFrom === undefined ? currentSettings.sendFrom || "09:00" : payload.sendFrom);
    const sendTo = String(payload.sendTo === undefined ? currentSettings.sendTo || "15:00" : payload.sendTo);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendFrom) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTo)) throw new Error("Godziny wysyłki muszą mieć format HH:mm.");
    if (sendFrom >= sendTo) throw new Error("Początek okna wysyłki musi być wcześniejszy niż koniec.");
    const mail2DelayBusinessDays = normalizeDelayDays_(payload.mail2DelayBusinessDays === undefined ? currentSettings.mail2DelayBusinessDays || 3 : payload.mail2DelayBusinessDays);
    const mail3DelayBusinessDays = normalizeDelayDays_(payload.mail3DelayBusinessDays === undefined ? currentSettings.mail3DelayBusinessDays || 3 : payload.mail3DelayBusinessDays);
    const removedIds = currentProfiles.filter(function(profile) { return !footerProfiles.some(function(nextProfile) { return nextProfile.id === profile.id; }); }).map(function(profile) { return profile.id; });
    if (removedIds.length) {
      const used = rows_("Campaigns").find(function(campaign) { return removedIds.indexOf(String(campaign.footerId || "")) !== -1; });
      if (used) throw new Error("Nie można usunąć stopki używanej przez kampanię „" + used.name + "”.");
    }
    const footerIndex = footerProfiles.map(function(profile) { return { id: profile.id, name: profile.name }; });
    const nextValues = { emailFooterHtml: defaultFooter.html, footerProfileIndexJson: JSON.stringify(footerIndex), defaultFooterId: defaultFooterId, dryRun: String(dryRun), dailyLimit: String(rawLimit), sendFrom: sendFrom, sendTo: sendTo, mail2DelayBusinessDays: String(mail2DelayBusinessDays), mail3DelayBusinessDays: String(mail3DelayBusinessDays) };
    Object.keys(nextValues).forEach(function(key) { upsertSetting_(key, nextValues[key]); });
    footerProfiles.forEach(function(profile) { upsertSetting_("footerProfile:" + profile.id, profile.html); });
    if (removedIds.length) deleteRowsWhere_("Settings", function(setting) { return removedIds.indexOf(String(setting.key || "").replace(/^footerProfile:/, "")) !== -1 && String(setting.key || "").indexOf("footerProfile:") === 0; });
    const nextSettings = Object.assign({}, currentSettings, nextValues);
    footerProfiles.forEach(function(profile) { nextSettings["footerProfile:" + profile.id] = profile.html; });
    rows_("Campaigns").filter(function(campaign) { return ["approved", "active", "paused"].indexOf(campaign.status) !== -1; }).forEach(function(campaign) {
      const beforeFooter = effectiveFooterProfile_(campaign, currentSettings);
      const afterFooter = effectiveFooterProfile_(campaign, nextSettings);
      if (!afterFooter || !beforeFooter || beforeFooter.id !== afterFooter.id || beforeFooter.html !== afterFooter.html) {
        forceNeedsReview_(campaign.id, "Zmiana stopki HTML.");
      }
    });
    audit_("update", "Settings", "defaults",
      { footerProfiles: currentProfiles.map(function(profile) { return { id: profile.id, name: profile.name }; }), defaultFooterId: defaultFooterId_(currentSettings, currentProfiles) },
      { footerProfiles: footerIndex, defaultFooterId: defaultFooterId },
      "Zmiana domyślnych ustawień wysyłki.");
    return getSettings_();
  });
}

function normalizeFooterProfiles_(profiles) {
  if (!Array.isArray(profiles) || !profiles.length) throw new Error("Dodaj co najmniej jedną stopkę.");
  if (profiles.length > 10) throw new Error("Możesz zapisać maksymalnie 10 wersji stopki.");
  const seenIds = {};
  const seenNames = {};
  return profiles.map(function(profile, index) {
    const id = String(profile && profile.id || "").trim();
    const name = String(profile && profile.name || "").trim();
    const html = String(profile && profile.html || "").trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("Stopka " + (index + 1) + " ma nieprawidłowy identyfikator.");
    if (!name || name.length > 80) throw new Error("Nazwa stopki musi mieć od 1 do 80 znaków.");
    if (html.length > 20000) throw new Error("Stopka HTML może mieć maksymalnie 20 000 znaków.");
    const normalizedName = name.toLowerCase();
    if (seenIds[id] || seenNames[normalizedName]) throw new Error("Nazwy i identyfikatory stopek muszą być unikalne.");
    seenIds[id] = true;
    seenNames[normalizedName] = true;
    return { id: id, name: name, html: html };
  });
}

function mediaFooterProfile_() {
  return {
    id: "footer-media",
    name: "InnovaPM Media",
    html: `<div style="max-width:600px;font-family:'Montserrat','Inter',Arial,sans-serif;color:#4a5568">
  <div style="font-size:16px;font-weight:700;color:#0c2340;margin-bottom:2px">Krzysztof Fiedorowicz</div>
  <div style="font-size:11px;color:#378add;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">InnovaPM Media | Kampanie cross-mediowe</div>
  <div style="font-size:11px;color:#64748b;font-weight:500;margin-bottom:12px">Planowanie · zakup mediów · realizacja</div>
  <table style="font-size:12px;color:#4a5568;line-height:1.5" border="0" cellspacing="0" cellpadding="0" role="presentation"><tbody>
    <tr><td style="width:16px;padding-right:8px;padding-bottom:4px;color:#378add;font-weight:700">M:</td><td style="padding-bottom:4px"><a style="color:#4a5568;text-decoration:none" href="tel:+48608103902">+48 608 103 902</a></td></tr>
    <tr><td style="padding-right:8px;padding-bottom:4px;color:#378add;font-weight:700">E:</td><td style="padding-bottom:4px"><a style="color:#378add;text-decoration:underline" href="mailto:krzysztof@innova.pm">krzysztof@innova.pm</a></td></tr>
    <tr><td style="padding-right:8px;padding-bottom:4px;color:#378add;font-weight:700">W:</td><td style="padding-bottom:4px"><a style="color:#378add;text-decoration:underline" href="https://innova.pm/#media">www.innova.pm</a></td></tr>
    <tr><td style="padding-right:8px;padding-bottom:4px;color:#378add;font-weight:700">in:</td><td style="padding-bottom:4px"><a style="color:#378add;text-decoration:underline;font-weight:500" href="https://linkedin.com/in/kfiedorowicz">linkedin.com/in/kfiedorowicz</a></td></tr>
  </tbody></table>
  <div style="margin-top:12px;border-left:3px solid #378add;padding:6px 0 6px 10px;font-size:10px;line-height:1.5;color:#64748b">Radio · internet · social media · sponsoring · akcje specjalne<br>Kampanie lokalne i ogólnopolskie wspierające sprzedaż oraz rozpoznawalność marki</div>
  <div style="margin-top:16px;max-width:600px;font-size:8px;line-height:1.4;color:#a0aec0;text-align:justify"><strong>Podstawa prawna kontaktu:</strong> Twoje dane biznesowe (imię, nazwisko, stanowisko, adres e-mail) pozyskałem z publicznie dostępnych źródeł (m.in. rejestr KRS, strona internetowa firmy). Przetwarzam je w celu marketingu bezpośredniego usług B2B na podstawie prawnie uzasadnionego interesu administratora (art. 6 ust. 1 lit. f RODO). Administratorem danych jest Krzysztof Fiedorowicz, InnovaPM (NIP: 7542663516, REGON: 542921230), Skoroszewska 4/39, 02-495 Warszawa. Masz prawo do sprzeciwu wobec przetwarzania, dostępu do danych, ich sprostowania lub usunięcia — wystarczy odpowiedzieć na tego maila z dopiskiem „REZYGNUJĘ” lub napisać na adres <a href="mailto:krzysztof@innova.pm" style="color:#a0aec0;text-decoration:underline">krzysztof@innova.pm</a>. Pełna informacja o przetwarzaniu danych: <a href="https://innova.pm/polityka-prywatności/" style="color:#a0aec0;text-decoration:underline">innova.pm/polityka-prywatności</a>.</div>
</div>`
  };
}

function footerProfiles_(settings) {
  const current = settings || settings_();
  if (current.footerProfileIndexJson) {
    try {
      const index = JSON.parse(current.footerProfileIndexJson);
      return normalizeFooterProfiles_(index.map(function(profile) {
        return { id: profile.id, name: profile.name, html: current["footerProfile:" + profile.id] || "" };
      }));
    } catch (_error) {}
  }
  if (current.footerProfilesJson) {
    try {
      return normalizeFooterProfiles_(JSON.parse(current.footerProfilesJson));
    } catch (_error) {}
  }
  return [{ id: "footer-default", name: "Domyślna", html: String(current.emailFooterHtml || "").trim() }];
}

function defaultFooterId_(settings, profiles) {
  const current = settings || settings_();
  const available = profiles || footerProfiles_(current);
  const configured = String(current.defaultFooterId || "").trim();
  return available.some(function(profile) { return profile.id === configured; }) ? configured : available[0].id;
}

function effectiveFooterProfile_(campaign, settings) {
  const current = settings || settings_();
  const profiles = footerProfiles_(current);
  const selectedId = String(campaign && campaign.footerId || defaultFooterId_(current, profiles));
  return profiles.find(function(profile) { return profile.id === selectedId; }) || null;
}

function effectiveCampaignFooterHtml_(campaign) {
  const profile = effectiveFooterProfile_(campaign, settings_());
  return profile ? profile.html : "";
}

function migrateFooterProfiles_() {
  const current = settings_();
  const profiles = footerProfiles_(current);
  const mediaFooter = mediaFooterProfile_();
  const hasMediaFooter = profiles.some(function(profile) {
    return profile.id === mediaFooter.id || profile.name.toLowerCase() === mediaFooter.name.toLowerCase();
  });
  if (!hasMediaFooter && profiles.length < 10) profiles.push(mediaFooter);
  const defaultId = defaultFooterId_(current, profiles);
  upsertSetting_("footerProfileIndexJson", JSON.stringify(profiles.map(function(profile) { return { id: profile.id, name: profile.name }; })));
  profiles.forEach(function(profile) { upsertSetting_("footerProfile:" + profile.id, profile.html); });
  upsertSetting_("defaultFooterId", defaultId);
  rows_("Campaigns").filter(function(campaign) { return !campaign.footerId; }).forEach(function(campaign) {
    updateObject_("Campaigns", campaign.id, Object.assign({}, campaign, { footerId: defaultId }));
  });
}

function listEvents_(payload) {
  const events = rows_("Events");
  return events.slice(Math.max(0, events.length - Number(payload.limit || 100))).reverse();
}

function ownedTriggerHandlers_() {
  return ["runQueue", "checkReplies"];
}

function triggerCounts_() {
  const triggerCounts = {};
  ownedTriggerHandlers_().forEach(function(handler) { triggerCounts[handler] = 0; });
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    const handler = trigger.getHandlerFunction();
    if (triggerCounts[handler] !== undefined) triggerCounts[handler] += 1;
  });
  return triggerCounts;
}

function assertOperationalTriggers_() {
  const triggerCounts = triggerCounts_();
  if (triggerCounts.runQueue !== 1) throw new Error("Start zablokowany: brak aktywnego triggera runQueue.");
  if (triggerCounts.checkReplies !== 1) throw new Error("Start zablokowany: brak aktywnego triggera checkReplies.");
}

function getBackendStatus_() {
  const triggers = ScriptApp.getProjectTriggers().map(function(trigger) {
    return {
      handler: trigger.getHandlerFunction(),
      source: String(trigger.getTriggerSource()),
      eventType: String(trigger.getEventType())
    };
  });
  const triggerCounts = triggerCounts_();
  let senderReady = false;
  let senderError = "";
  const transport = sendTransport_();
  try {
    assertSender_();
    senderReady = true;
  } catch (error) {
    senderError = error.message || String(error);
  }
  return {
    ownerEmail: OWNER_EMAIL,
    effectiveUser: Session.getEffectiveUser().getEmail() || "",
    queueTriggerInstalled: triggerCounts.runQueue === 1,
    replyTriggerInstalled: triggerCounts.checkReplies === 1,
    triggerCounts: triggerCounts,
    senderReady: senderReady,
    senderError: senderError,
    sendTransport: transport,
    timezone: TIMEZONE
  };
}

function configureProject() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Uruchom configureProject z projektu powiązanego z arkuszem Google Sheet.");
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", spreadsheet.getId());
  initializeWorkbook_();
  return { spreadsheetId: spreadsheet.getId(), configured: true };
}

function enableHostingerSmtp() {
  assertSmtpRelay_();
  PropertiesService.getScriptProperties().setProperty("SEND_TRANSPORT", "smtp");
  invalidateTransportApprovals_("Włączono transport SMTP.");
  return getBackendStatus_();
}

function disableHostingerSmtp() {
  PropertiesService.getScriptProperties().setProperty("SEND_TRANSPORT", "gmail");
  invalidateTransportApprovals_("Włączono transport Gmail.");
  return getBackendStatus_();
}

function invalidateTransportApprovals_(detail) {
  rows_("Campaigns").filter(function(campaign) {
    return ["approved", "active", "paused"].indexOf(campaign.status) !== -1;
  }).forEach(function(campaign) {
    forceNeedsReview_(campaign.id, detail);
  });
}
