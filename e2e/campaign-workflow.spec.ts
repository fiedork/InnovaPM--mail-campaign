import { expect, test, type Route } from "@playwright/test";

test("bezpieczny workflow: import → odbiorca → sekwencja → review → approve → start", async ({ page }) => {
  let status = "draft";
  const campaignId = "workflow-series";
  const company = {
    id: "workflow-company", seriesName: "Seria workflow", companyName: "Firma Testowa", fullName: "Anna Testowa", role: "CEO", email: "anna@example.test",
    email1: "Temat: Pierwszy\n\nTreść pierwszej wiadomości", email2: "Temat: Drugi\n\nTreść drugiej wiadomości", email3: "Temat: Trzeci\n\nTreść trzeciej wiadomości",
    sector: "B2B", trigger: "Test", packageName: "PMO", source: "E2E", contactId: "contact-anna", hasActiveRecipient: true,
    candidateContacts: [{ id: "contact-anna", fullName: "Anna Testowa", role: "CEO", email: "anna@example.test" }], messageIds: ["m1", "m2", "m3"],
  };
  const json = (route: Route, body: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/auth/login") return route.continue();
    if (url.pathname === "/api/health") return json(route, { backendConfigured: true, ownerEmail: "owner@example.test" });
    if (url.pathname === "/api/contacts") return json(route, { data: [] });
    if (url.pathname === "/api/settings") return json(route, { data: { emailFooterHtml: "<p>Stopka</p>", dryRun: true, dailyLimit: 20, sendFrom: "09:00", sendTo: "15:00", timezone: "Europe/Warsaw" } });
    if (url.pathname === "/api/status") return json(route, { data: [{ id: campaignId, name: "Seria workflow", status, sent: 0, opened: 0, replies: 0, bounces: 0, companies: 1, recipients: 1, updatedAt: new Date().toISOString() }] });
    if (url.pathname === "/api/import/campaign" && request.method() === "POST") {
      const committing = (request.postData() || "").includes("commit\"");
      const data = { rows: [company], issues: [], duplicates: [] };
      return json(route, committing ? { data, committedData: { campaigns: [{ id: campaignId }] } } : { data });
    }
    if (url.pathname === `/api/campaigns/${campaignId}` && request.method() === "GET") return json(route, { data: { campaign: { id: campaignId, name: "Seria workflow", status, dryRun: true, dailyLimit: 20, sendFrom: "09:00", sendTo: "15:00" }, companies: [company] } });
    if (url.pathname.startsWith(`/api/campaigns/${campaignId}/`) && request.method() === "POST") {
      const action = url.pathname.split("/").at(-1);
      status = action === "review" ? "needs_review" : action === "approve" ? "approved" : action === "start" ? "active" : status;
      return json(route, { data: { status } });
    }
    if (url.pathname.startsWith("/api/messages/") && request.method() === "PATCH") return json(route, { data: {} });
    return json(route, { data: {} });
  });

  await page.goto("/login");
  await page.getByLabel("Hasło").fill("workflow-test-password");
  await page.getByRole("button", { name: "Zaloguj" }).click();
  await expect(page.getByText("Dashboard").first()).toBeVisible();

  await page.getByRole("button", { name: "Kampanie" }).click();
  await page.getByRole("button", { name: "Importuj nową serię" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "workflow.csv", mimeType: "text/csv", buffer: Buffer.from("Seria,Firma\nSeria workflow,Firma Testowa") });
  await page.getByRole("button", { name: "Sprawdź plik" }).click();
  await expect(page.getByRole("heading", { name: "1 poprawnych rekordów" })).toBeVisible();
  await page.getByRole("button", { name: "Utwórz serię/serie" }).click();

  await expect(page.getByRole("tab", { name: "Odbiorcy" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("table", { name: "Odbiorcy serii" }).getByText("Anna Testowa")).toBeVisible();
  await page.getByRole("tab", { name: "Sekwencja" }).click();
  await expect(page.getByText("Mail 1", { exact: true })).toBeVisible();
  await page.getByLabel("Temat").first().fill("Temat zweryfikowany E2E");
  await page.getByRole("button", { name: "Zapisz całą sekwencję odbiorcy" }).click();
  await expect(page.getByText("Cała sekwencja odbiorcy została zapisana.")).toBeVisible();

  await page.getByRole("tab", { name: "Podsumowanie" }).click();
  await expect(page.getByText("Seria kompletna")).toBeVisible();
  await page.getByRole("button", { name: "Przekaż do akceptacji" }).click();
  await page.getByRole("button", { name: "Zatwierdź serię" }).click();
  await page.getByRole("button", { name: "Uruchom serię" }).click();
  await expect(page.getByText("Uruchomiona").first()).toBeVisible();
  await page.getByRole("tab", { name: "Wyniki" }).click();
  await expect(page.getByText("Monitoring serii")).toBeVisible();
});
