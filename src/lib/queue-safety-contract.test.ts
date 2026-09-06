import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("apps-script/Queue.gs", "utf8");

describe("Apps Script queue safety", () => {
  it("rechecks the send window and daily quota before every provider call", () => {
    const processQueue = source.match(
      /function processCampaignQueue_\(campaign\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(processQueue).toContain("if (!withinSendWindow_(campaign)) break");
    expect(processQueue).toContain("sentTodayCount_(campaign.id)");
    expect(processQueue).toContain("sendMessage_(campaign, message)");
  });

  it("counts sent messages using the configured Warsaw timezone", () => {
    expect(source).toContain(
      'Utilities.formatDate(new Date(message.sentAt), TIMEZONE, "yyyy-MM-dd")',
    );
  });
});
