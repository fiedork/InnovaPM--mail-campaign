function authorizeTestProject() {
  const spreadsheetId = "1-wf1zrIHiOacpQMPNpFRv-N-GZaj2bQKzn5RfGWZv-U";
  const sheet = SpreadsheetApp.openById(spreadsheetId);
  return { authorized: true, spreadsheetId: sheet.getId() };
}

function configureTestEnvironment(spreadsheetId, hmacSecret) {
  if (!/^[-_A-Za-z0-9]{20,}$/.test(String(spreadsheetId || ""))) {
    throw new Error("Nieprawidłowy identyfikator arkusza testowego.");
  }
  if (String(hmacSecret || "").length < 32) throw new Error("Sekret HMAC testu jest zbyt krótki.");
  PropertiesService.getScriptProperties().setProperties({
    SPREADSHEET_ID: String(spreadsheetId),
    HMAC_SECRET: String(hmacSecret),
    TRACKING_BASE_URL: "https://invalid.test/innova-pm-tracking-disabled"
  }, false);
  initializeWorkbook_();
  upsertSetting_("dryRun", "true");
  return { configured: true, dryRun: settings_().dryRun, spreadsheetId: String(spreadsheetId) };
}
