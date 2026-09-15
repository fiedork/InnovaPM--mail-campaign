function getInitialData_(payload, meta) {
  // dispatch_ initializes/migrates the workbook before invoking this read-only handler.
  const requestId = meta && meta.requestId ? meta.requestId : "";
  const context = createReadContext_([
    "Campaigns",
    "Contacts",
    "Recipients",
    "Suppression",
    "Messages",
    "Events"
  ], requestId);
  const result = {
    schemaVersion: 1,
    generatedAt: isoNow_(),
    contactSummary: getContactSummaryFromContext_(context),
    seriesStats: getCampaignStatsFromContext_({ includeArchived: false }, context),
    backendStatus: getBackendStatus_()
  };
  const responseBytes = Utilities.newBlob(JSON.stringify(result), "application/json").getBytes().length;
  if (responseBytes > 450000) throw new Error("INITIAL_DATA_TOO_LARGE");
  return result;
}
