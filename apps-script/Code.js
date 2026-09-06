const OWNER_EMAIL = "krzysztof.fiedorowicz@innova.pm";
const TIMEZONE = "Europe/Warsaw";
const MAX_DAILY_LIMIT = 40;

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
  if (!action || typeof action !== "string") {
    throw new Error("Nieprawidłowa lub brakująca akcja w żądaniu.");
  }
  if (payload !== null && typeof payload !== "object") {
    throw new Error("Payload musi być obiektem.");
  }
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
    restoreCampaign: restoreCampaign_,
    clearCampaignActivity: clearCampaignActivity_,
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
    getBackendStatus: getBackendStatus_,
    getCampaignStats: getCampaignStats_,
    recordOpen: recordOpen_,
    listEvents: listEvents_
  };
  if (!handlers[action]) throw new Error("Nieobsługiwana akcja: " + action);
  return handlers[action](payload || {});
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
