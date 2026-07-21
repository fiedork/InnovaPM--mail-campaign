import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");

describe("workflow sekwencji", () => {
  it("nie renderuje edytora sekwencji bez jawnie potwierdzonego aktywnego odbiorcy", () => {
    expect(source).toContain("selectedSequenceCompany.hasActiveRecipient === true");
  });
});
