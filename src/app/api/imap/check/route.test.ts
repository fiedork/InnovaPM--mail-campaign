import { describe, expect, it } from "vitest";

import { detectActivity } from "./route";

const sent = [{
  id: "message-1",
  rfcMessageId: "<campaign-message@example.com>",
  recipientEmail: "recipient@example.com",
}];

describe("IMAP reply detection", () => {
  it("ignores matching reply headers from a different sender", () => {
    const result = detectActivity(sent, [{
      headers: {
        from: "Attacker <attacker@example.net>",
        "in-reply-to": "<campaign-message@example.com>",
      },
      body: "Unrelated message",
    }]);

    expect(result.repliedMessageIds).toEqual([]);
  });

  it("accepts a matching reply from the campaign recipient", () => {
    const result = detectActivity(sent, [{
      headers: {
        from: "Recipient <recipient@example.com>",
        "in-reply-to": "<campaign-message@example.com>",
      },
      body: "Dziękuję za wiadomość.",
    }]);

    expect(result.repliedMessageIds).toEqual(["message-1"]);
  });
});
