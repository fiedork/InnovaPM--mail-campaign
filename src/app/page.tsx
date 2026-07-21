"use client";

import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  allowedRoles,
  formatCampaignMessage,
  getCampaignReadiness,
  parseCampaignMessage,
  type CampaignImportRow,
  type CampaignStatus,
  type ContactWithCampaigns,
} from "@/lib/domain";

type View = "dashboard" | "contacts" | "campaigns" | "settings";
type CampaignTab = "summary" | "recipients" | "sequence" | "results";
type ImportKind = "campaign" | "contacts";
type ContactFilter = "all" | "available" | "campaign" | "history" | "suppressed";

type ImportResult = {
  rows: unknown[];
  issues: { row: number; field: string; message: string }[];
  duplicates: string[];
};

type RecipientCandidate = {
  id: string;
  fullName: string;
  role: string;
  email: string;
};

type CampaignCompany = CampaignImportRow & {
  id?: string;
  messageIds?: string[];
  contactId?: string;
  hasActiveRecipient?: boolean;
  candidateContacts?: RecipientCandidate[];
};

type SeriesStats = {
  id: string;
  name: string;
  status: CampaignStatus;
  sent: number;
  opened: number;
  replies: number;
  bounces: number;
  companies: number;
  recipients: number;
  updatedAt: string;
};

const navigation: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "contacts", label: "Kontakty" },
  { id: "campaigns", label: "Kampanie" },
  { id: "settings", label: "Ustawienia" },
];

const campaignTabs: { id: CampaignTab; label: string }[] = [
  { id: "summary", label: "Podsumowanie" },
  { id: "recipients", label: "Odbiorcy" },
  { id: "sequence", label: "Sekwencja" },
  { id: "results", label: "Wyniki" },
];

const labels: Record<CampaignStatus, string> = {
  draft: "Szkic",
  needs_review: "Do akceptacji",
  approved: "Gotowa",
  active: "Uruchomiona",
  paused: "Wstrzymana",
  completed: "Zakończona",
  cancelled: "Anulowana",
};

const initialMessages = [
  { day: "D0", subject: "Czy obecne inicjatywy mają jeden rytm decyzyjny?", body: "Dzień dobry,\n\nzwracam uwagę na aktualny punkt rozwoju firmy i liczbę równoległych inicjatyw. W takich momentach największym ryzykiem zwykle nie jest sam harmonogram, lecz rozproszenie decyzji, odpowiedzialności i informacji zarządczej. InnovaPM porządkuje ten obszar bez rozbudowy administracji projektowej. Czy warto porównać Państwa priorytety na krótkiej, 20-minutowej rozmowie?\n\nPozdrawiam,\nKrzysztof Fiedorowicz" },
  { day: "D+3", subject: "Najdroższe ryzyka nie zawsze są widoczne w harmonogramie", body: "Dzień dobry,\n\nwracam z jednym konkretnym pytaniem: które decyzje w kluczowych inicjatywach nie mają dziś jednego właściciela? To zwykle tam powstają koszty opóźnień i przeciążenie zarządu. Możemy szybko zdiagnozować te punkty i zaproponować lekki rytm PMO dopasowany do skali firmy. Czy 20 minut w przyszłym tygodniu będzie zasadne?\n\nPozdrawiam,\nKrzysztof Fiedorowicz" },
  { day: "D+6", subject: "Zamykam temat — krótka diagnoza PMO", body: "Dzień dobry,\n\nzamykam ten wątek, żeby nie dokładać kolejnej wiadomości bez wartości. Jeśli uporządkowanie portfela inicjatyw, decyzji i odpowiedzialności jest teraz aktualne, przygotuję krótką diagnozę punktów zapalnych przed rozmową. Jeżeli temat nie jest priorytetem, proszę o krótką informację — wstrzymam dalszy kontakt.\n\nPozdrawiam,\nKrzysztof Fiedorowicz" },
];

const defaultFooterHtml = `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #dfe6ed;color:#667587;font:13px Arial,sans-serif;line-height:1.5"><strong style="color:#0C2340">Krzysztof Fiedorowicz</strong><br>InnovaPM · <a href="https://innova.pm" style="color:#378ADD">innova.pm</a><br><br><span style="font-size:11px">Jeśli nie chcesz otrzymywać kolejnych wiadomości, odpowiedz „stop”.</span></div>`;

const demoContact: ContactWithCampaigns = {
  id: "demo-contact",
  companyName: "Przykładowa firma",
  fullName: "Jan Kowalski",
  role: "CEO",
  email: "jan.kowalski@example.com",
  phone: "",
  linkedin: "",
  source: "Dane demonstracyjne",
  note: "Rekord testowy — nie wysyłać.",
  currentCampaign: null,
  campaignHistory: [],
  suppressed: false,
};

const demoCampaignCompany: CampaignCompany = {
  id: "demo-company",
  seriesName: "PMO Mazowsze — seria 1",
  companyName: "Przykładowa firma",
  fullName: "Jan Kowalski",
  role: "CEO",
  email: "jan.kowalski@example.com",
  phone: "",
  linkedin: "",
  note: "",
  email1: `Temat: ${initialMessages[0].subject}\n\n${initialMessages[0].body}`,
  email2: `Temat: ${initialMessages[1].subject}\n\n${initialMessages[1].body}`,
  email3: `Temat: ${initialMessages[2].subject}\n\n${initialMessages[2].body}`,
  sector: "Usługi B2B",
  trigger: "Rosnąca liczba inicjatyw",
  packageName: "Diagnoza PMO",
  source: "Dane demonstracyjne",
  contactId: "demo-contact",
  hasActiveRecipient: true,
  candidateContacts: [{ id: "demo-contact", fullName: "Jan Kowalski", role: "CEO", email: "jan.kowalski@example.com" }],
};

const demoSeries: SeriesStats = {
  id: "demo-series",
  name: "PMO Mazowsze — seria 1",
  status: "needs_review",
  sent: 0,
  opened: 0,
  replies: 0,
  bounces: 0,
  companies: 1,
  recipients: 1,
  updatedAt: new Date().toISOString(),
};

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [campaignTab, setCampaignTab] = useState<CampaignTab>("summary");
  const [backend, setBackend] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("krzysztof.fiedorowicz@innova.pm");
  const [notice, setNotice] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [contacts, setContacts] = useState<ContactWithCampaigns[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [contactFilter, setContactFilter] = useState<ContactFilter>("all");
  const [showAddContact, setShowAddContact] = useState(false);
  const [showContactImport, setShowContactImport] = useState(false);
  const [showCampaignImport, setShowCampaignImport] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [campaignImportReady, setCampaignImportReady] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [busyContactId, setBusyContactId] = useState<string | null>(null);
  const [campaignFormContactId, setCampaignFormContactId] = useState<string | null>(null);
  const [campaignMode, setCampaignMode] = useState<"new" | "existing">("new");
  const [addFormVersion, setAddFormVersion] = useState(0);
  const [campaignCompanies, setCampaignCompanies] = useState<CampaignCompany[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [editingCompanyIndex, setEditingCompanyIndex] = useState<number | null>(null);
  const [busyCompanyIndex, setBusyCompanyIndex] = useState<number | null>(null);
  const [seriesName, setSeriesName] = useState("");
  const [status, setStatus] = useState<CampaignStatus>("draft");
  const [editingSeriesName, setEditingSeriesName] = useState(false);
  const [savingSeriesName, setSavingSeriesName] = useState(false);
  const [selectedSequenceIndex, setSelectedSequenceIndex] = useState(0);
  const [savingMessageKey, setSavingMessageKey] = useState<string | null>(null);
  const [savingAllMessages, setSavingAllMessages] = useState(false);
  const [dirtyMessageKeys, setDirtyMessageKeys] = useState<Set<string>>(new Set());
  const [emailFooterHtml, setEmailFooterHtml] = useState(defaultFooterHtml);
  const [defaultDryRun, setDefaultDryRun] = useState(true);
  const [defaultDailyLimit, setDefaultDailyLimit] = useState(20);
  const [defaultSendFrom, setDefaultSendFrom] = useState("09:00");
  const [defaultSendTo, setDefaultSendTo] = useState("15:00");
  const [timezone, setTimezone] = useState("Europe/Warsaw");
  const [savingSettings, setSavingSettings] = useState(false);
  const [campaignDryRun, setCampaignDryRun] = useState(true);
  const [campaignDailyLimit, setCampaignDailyLimit] = useState(20);
  const [campaignSendFrom, setCampaignSendFrom] = useState("09:00");
  const [campaignSendTo, setCampaignSendTo] = useState("15:00");
  const [savingCampaignSettings, setSavingCampaignSettings] = useState(false);
  const [seriesStats, setSeriesStats] = useState<SeriesStats[]>([]);

  useEffect(() => {
    async function initialize() {
      try {
        const healthResponse = await fetch("/api/health");
        const health = await healthResponse.json();
        const configured = Boolean(health.backendConfigured);
        setBackend(configured);
        if (typeof health.ownerEmail === "string") setOwnerEmail(health.ownerEmail);
        if (!configured) {
          setContacts([demoContact]);
          setSeriesStats([demoSeries]);
          return;
        }
        const [contactsResponse, statusResponse, settingsResponse] = await Promise.all([
          fetch("/api/contacts"),
          fetch("/api/status"),
          fetch("/api/settings"),
        ]);
        if (!contactsResponse.ok || !statusResponse.ok || !settingsResponse.ok) {
          throw new Error("Nie udało się pobrać pełnych danych aplikacji.");
        }
        {
          const result = await contactsResponse.json();
          if (Array.isArray(result.data)) setContacts(result.data);
        }
        {
          const result = await statusResponse.json();
          if (Array.isArray(result.data)) setSeriesStats(result.data);
        }
        {
          const result = await settingsResponse.json();
          const settings = result.data ?? {};
          if (typeof settings.emailFooterHtml === "string") setEmailFooterHtml(settings.emailFooterHtml);
          if (typeof settings.dryRun === "boolean") setDefaultDryRun(settings.dryRun);
          if (Number.isFinite(Number(settings.dailyLimit))) setDefaultDailyLimit(Number(settings.dailyLimit));
          if (typeof settings.sendFrom === "string") setDefaultSendFrom(settings.sendFrom);
          if (typeof settings.sendTo === "string") setDefaultSendTo(settings.sendTo);
          if (typeof settings.timezone === "string") setTimezone(settings.timezone);
        }
      } catch (error) {
        setContacts([]);
        setSeriesStats([]);
        setNotice(error instanceof Error ? error.message : "Nie udało się pobrać danych startowych.");
      } finally {
        setInitializing(false);
      }
    }
    void initialize();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (dirtyMessageKeys.size === 0) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirtyMessageKeys]);

  const filteredContacts = useMemo(() => {
    const query = contactSearch.trim().toLowerCase();
    return contacts.filter((contact) => {
      const matchesQuery = !query || [contact.fullName, contact.companyName, contact.role, contact.email]
        .some((value) => String(value).toLowerCase().includes(query));
      if (!matchesQuery) return false;
      if (contactFilter === "available") return !contact.suppressed && !contact.currentCampaign && contact.campaignHistory.length === 0;
      if (contactFilter === "campaign") return Boolean(contact.currentCampaign);
      if (contactFilter === "history") return !contact.currentCampaign && contact.campaignHistory.length > 0;
      if (contactFilter === "suppressed") return contact.suppressed;
      return true;
    });
  }, [contactFilter, contactSearch, contacts]);

  const activeStats = seriesStats.find((series) => series.id === activeCampaignId);
  const activeCampaigns = seriesStats.filter((series) => series.status === "active").length;
  const actionRequired = seriesStats.filter((series) => ["draft", "needs_review"].includes(series.status)).length;
  const selectedSequenceCompany = campaignCompanies[selectedSequenceIndex];
  const readiness = getCampaignReadiness(campaignCompanies);
  const displayedDryRun = activeCampaignId ? campaignDryRun : defaultDryRun;

  function navigateTo(nextView: View) {
    if (dirtyMessageKeys.size > 0 && !window.confirm("Masz niezapisane zmiany w sekwencji. Opuścić ten ekran?")) return;
    setView(nextView);
    if (nextView === "campaigns") setActiveCampaignId(null);
  }

  async function refreshContacts() {
    if (!backend) return;
    const response = await fetch("/api/contacts");
    const result = await response.json();
    if (response.ok && Array.isArray(result.data)) setContacts(result.data);
  }

  async function refreshSeries() {
    if (!backend) return;
    const response = await fetch("/api/status");
    const result = await response.json();
    if (response.ok && Array.isArray(result.data)) setSeriesStats(result.data);
  }

  async function loadCampaign(campaignId: string, tab: CampaignTab = "summary") {
    setNotice("Otwieram serię…");
    try {
      if (!backend && campaignId === demoSeries.id) {
        setActiveCampaignId(campaignId);
        setSeriesName(demoSeries.name);
        setStatus(demoSeries.status);
        setCampaignCompanies([demoCampaignCompany]);
      } else {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        const campaign = result.data?.campaign ?? {};
        setActiveCampaignId(campaignId);
        setSeriesName(String(campaign.name || "Seria bez nazwy"));
        setStatus(campaign.status as CampaignStatus);
        setCampaignDryRun(String(campaign.dryRun) !== "false");
        setCampaignDailyLimit(Number(campaign.dailyLimit || 20));
        setCampaignSendFrom(String(campaign.sendFrom || "09:00"));
        setCampaignSendTo(String(campaign.sendTo || "15:00"));
        setCampaignCompanies(Array.isArray(result.data?.companies) ? result.data.companies : []);
      }
      setSelectedSequenceIndex(0);
      setDirtyMessageKeys(new Set());
      setCampaignTab(tab);
      setView("campaigns");
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się otworzyć serii.");
    }
  }

  async function reloadActiveCampaign(tab = campaignTab) {
    if (activeCampaignId) await loadCampaign(activeCampaignId, tab);
  }

  async function importFile(event: FormEvent<HTMLFormElement>, kind: ImportKind) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const commit = submitter?.value === "commit";
    const formData = new FormData(event.currentTarget);
    if (commit) formData.set("commit", "true");
    const mapping: Record<string, string> = {};
    for (const [key, value] of Array.from(formData.entries())) {
      if (key.startsWith("mapping.") && String(value).trim()) mapping[key.slice(8)] = String(value).trim();
      if (key.startsWith("mapping.")) formData.delete(key);
    }
    if (Object.keys(mapping).length) formData.set("mapping", JSON.stringify(mapping));
    setNotice(commit ? "Zapisuję dane…" : "Sprawdzam plik…");
    try {
      const response = await fetch(`/api/import/${kind}`, { method: "POST", body: formData });
      const result = await response.json();
      if (result.data) {
        setImportResult(result.data);
        setImportKind(kind);
      }
      if (!response.ok) throw new Error(result.error);
      if (kind === "campaign") {
        setCampaignImportReady(!commit && result.data?.issues?.length === 0 && result.data?.duplicates?.length === 0 && result.data?.rows?.length > 0);
        if (commit) {
          const created = Array.isArray(result.committedData?.campaigns) ? result.committedData.campaigns : [];
          await refreshSeries();
          setShowCampaignImport(false);
          if (created[0]?.id) await loadCampaign(String(created[0].id), "recipients");
          setNotice(`Utworzono ${created.length} ${created.length === 1 ? "serię" : "serie"}.`);
        } else {
          setNotice(`Plik sprawdzony: ${result.data.rows.length} poprawnych rekordów.`);
        }
      } else if (result.committed) {
        await refreshContacts();
        setShowContactImport(false);
        setNotice("Kontakty zaimportowane.");
      } else {
        setNotice(`Plik sprawdzony: ${result.data.rows.length} poprawnych rekordów.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się przetworzyć pliku.");
    }
  }

  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const contact: ContactWithCampaigns = {
      id: crypto.randomUUID(),
      companyName: String(data.get("companyName") ?? "").trim(),
      fullName: String(data.get("fullName") ?? "").trim(),
      role: String(data.get("role") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      linkedin: String(data.get("linkedin") ?? "").trim(),
      source: "Wpis ręczny",
      note: String(data.get("note") ?? "").trim(),
      currentCampaign: null,
      campaignHistory: [],
      suppressed: false,
    };
    try {
      let saved = contact;
      if (backend) {
        const response = await fetch("/api/contacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(contact) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        saved = { ...contact, ...result.data };
      }
      setContacts((current) => [saved, ...current]);
      event.currentTarget.reset();
      setAddFormVersion((current) => current + 1);
      setShowAddContact(false);
      setNotice("Kontakt zapisany.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się dodać kontaktu.");
    }
  }

  async function saveContact(event: FormEvent<HTMLFormElement>, contact: ContactWithCampaigns) {
    event.preventDefault();
    if (!contact.id) return;
    const data = new FormData(event.currentTarget);
    const updated = {
      ...contact,
      companyName: String(data.get("companyName") ?? "").trim(),
      fullName: String(data.get("fullName") ?? "").trim(),
      role: String(data.get("role") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim(),
      linkedin: String(data.get("linkedin") ?? "").trim(),
      note: String(data.get("note") ?? "").trim(),
    };
    setBusyContactId(contact.id);
    try {
      let saved = updated;
      if (backend) {
        const response = await fetch(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(updated) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        saved = { ...updated, ...result.data };
      }
      setContacts((current) => current.map((item) => item.id === contact.id ? saved : item));
      setEditingContactId(null);
      setNotice("Kontakt zaktualizowany.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się zapisać kontaktu.");
    } finally {
      setBusyContactId(null);
    }
  }

  async function deleteContact(contact: ContactWithCampaigns) {
    if (!contact.id || !window.confirm(`Usunąć kontakt ${contact.fullName}?`)) return;
    setBusyContactId(contact.id);
    try {
      if (backend) {
        const response = await fetch(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: "DELETE" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
      }
      setContacts((current) => current.filter((item) => item.id !== contact.id));
      setNotice("Kontakt usunięty.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się usunąć kontaktu.");
    } finally {
      setBusyContactId(null);
    }
  }

  async function assignContact(event: FormEvent<HTMLFormElement>, contact: ContactWithCampaigns) {
    event.preventDefault();
    if (!contact.id) return;
    const data = new FormData(event.currentTarget);
    const body = campaignMode === "new"
      ? { mode: "new", name: String(data.get("name") ?? "").trim() }
      : { mode: "existing", campaignId: String(data.get("campaignId") ?? "") };
    setBusyContactId(contact.id);
    try {
      if (!backend) throw new Error("Dodawanie do serii wymaga połączonego backendu.");
      const response = await fetch(`/api/contacts/${encodeURIComponent(contact.id)}/campaigns`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const campaignId = String(result.data?.campaign?.id ?? result.data?.campaignId ?? (body.mode === "existing" ? body.campaignId : ""));
      await Promise.all([refreshContacts(), refreshSeries()]);
      setCampaignFormContactId(null);
      if (campaignId) await loadCampaign(campaignId, "sequence");
      setNotice("Kontakt dodany do serii.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się dodać kontaktu do serii.");
    } finally {
      setBusyContactId(null);
    }
  }

  async function deleteCampaign(series: SeriesStats) {
    const action = series.sent > 0 ? "Zarchiwizować" : "Usunąć";
    const detail = series.sent > 0 ? "Historia wysyłki zostanie zachowana." : "Tej operacji nie można cofnąć.";
    if (!window.confirm(`${action} serię „${series.name}”? ${detail}`)) return;
    try {
      let archived = false;
      if (backend) {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(series.id)}`, { method: "DELETE" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        archived = Boolean(result.data?.archived);
        await refreshContacts();
      }
      setSeriesStats((current) => current.filter((item) => item.id !== series.id));
      setNotice(archived ? "Seria z historią została zarchiwizowana." : "Seria usunięta.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się usunąć serii.");
    }
  }

  async function saveCampaignCompany(event: FormEvent<HTMLFormElement>, index: number) {
    event.preventDefault();
    const company = campaignCompanies[index];
    const data = new FormData(event.currentTarget);
    const updated = { ...company, companyName: String(data.get("companyName") ?? "").trim(), sector: String(data.get("sector") ?? "").trim(), trigger: String(data.get("trigger") ?? "").trim(), packageName: String(data.get("packageName") ?? "").trim(), source: String(data.get("source") ?? "").trim() };
    setBusyCompanyIndex(index);
    try {
      let saved = updated;
      if (backend && activeCampaignId && company.id) {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(activeCampaignId)}/companies/${encodeURIComponent(company.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(updated) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        saved = { ...updated, ...result.data };
      }
      setCampaignCompanies((current) => current.map((item, itemIndex) => itemIndex === index ? saved : item));
      setEditingCompanyIndex(null);
      setNotice("Dane firmy zapisane.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się zapisać firmy.");
    } finally {
      setBusyCompanyIndex(null);
    }
  }

  async function saveSeriesName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("seriesName") ?? "").trim();
    setSavingSeriesName(true);
    try {
      if (backend && activeCampaignId) {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(activeCampaignId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
      }
      setSeriesName(name);
      setSeriesStats((current) => current.map((item) => item.id === activeCampaignId ? { ...item, name } : item));
      setEditingSeriesName(false);
      setNotice("Nazwa serii zapisana.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się zmienić nazwy serii.");
    } finally {
      setSavingSeriesName(false);
    }
  }

  async function saveCampaignSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeCampaignId) return;
    setSavingCampaignSettings(true);
    try {
      if (backend) {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(activeCampaignId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dryRun: campaignDryRun, dailyLimit: campaignDailyLimit, sendFrom: campaignSendFrom, sendTo: campaignSendTo }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
      }
      setNotice("Ustawienia serii zapisane.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się zapisać ustawień serii.");
    } finally {
      setSavingCampaignSettings(false);
    }
  }

  function editCampaignMessage(companyIndex: number, step: 1 | 2 | 3, field: "subject" | "body", value: string) {
    const emailKey = `email${step}` as "email1" | "email2" | "email3";
    setCampaignCompanies((current) => current.map((company, index) => {
      if (index !== companyIndex) return company;
      const message = parseCampaignMessage(company[emailKey]);
      return { ...company, [emailKey]: formatCampaignMessage(field === "subject" ? value : message.subject, field === "body" ? value : message.body) };
    }));
    setDirtyMessageKeys((current) => new Set(current).add(`${companyIndex}-${step}`));
  }

  async function persistCampaignMessage(companyIndex: number, step: 1 | 2 | 3) {
    const company = campaignCompanies[companyIndex];
    const emailKey = `email${step}` as "email1" | "email2" | "email3";
    const messageId = company.messageIds?.[step - 1];
    if (backend && !messageId) throw new Error(`Brak identyfikatora maila ${step}.`);
    if (backend && messageId) {
      const response = await fetch(`/api/messages/${encodeURIComponent(messageId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(parseCampaignMessage(company[emailKey])) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
    }
    setDirtyMessageKeys((current) => {
      const next = new Set(current);
      next.delete(`${companyIndex}-${step}`);
      return next;
    });
  }

  async function saveCampaignMessage(companyIndex: number, step: 1 | 2 | 3) {
    const saveKey = `${companyIndex}-${step}`;
    setSavingMessageKey(saveKey);
    try {
      await persistCampaignMessage(companyIndex, step);
      setNotice(`Mail ${step} zapisany.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Nie udało się zapisać maila ${step}.`);
    } finally {
      setSavingMessageKey(null);
    }
  }

  async function saveAllCampaignMessages() {
    if (!selectedSequenceCompany) return;
    setSavingAllMessages(true);
    try {
      for (const step of [1, 2, 3] as const) await persistCampaignMessage(selectedSequenceIndex, step);
      setNotice("Cała sekwencja odbiorcy została zapisana.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się zapisać całej sekwencji.");
    } finally {
      setSavingAllMessages(false);
    }
  }

  async function transition(action: string, next: CampaignStatus) {
    if (!activeCampaignId) return;
    try {
      if (backend) {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(activeCampaignId)}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: ownerEmail }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
      }
      setStatus(next);
      setSeriesStats((current) => current.map((item) => item.id === activeCampaignId ? { ...item, status: next } : item));
      if (["cancelled", "completed"].includes(next)) await refreshContacts();
      setNotice(`Status serii: ${labels[next]}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się zmienić statusu.");
    }
  }

  async function assignCampaignRecipient(companyIndex: number, contactId: string) {
    const company = campaignCompanies[companyIndex];
    if (!activeCampaignId || !company.id) return;
    try {
      const response = await fetch(`/api/recipients/${encodeURIComponent(company.id)}/select`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId: activeCampaignId, contactId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await Promise.all([reloadActiveCampaign("recipients"), refreshSeries(), refreshContacts()]);
      setNotice("Odbiorca przypisany do serii.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się przypisać odbiorcy.");
    }
  }

  async function removeCampaignRecipient(companyIndex: number) {
    const company = campaignCompanies[companyIndex];
    if (!activeCampaignId || !company.id || !window.confirm(`Usunąć ${company.fullName} z tej serii?`)) return;
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(activeCampaignId)}/recipients/${encodeURIComponent(company.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await Promise.all([reloadActiveCampaign("recipients"), refreshSeries(), refreshContacts()]);
      setNotice("Odbiorca usunięty z serii.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się usunąć odbiorcy z serii.");
    }
  }

  async function saveCampaignRecipientContact(event: FormEvent<HTMLFormElement>, companyIndex: number) {
    event.preventDefault();
    const company = campaignCompanies[companyIndex];
    if (!company.contactId) return;
    const data = new FormData(event.currentTarget);
    const payload = {
      fullName: String(data.get("fullName") ?? "").trim(),
      role: String(data.get("role") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
    };
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(company.contactId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await Promise.all([reloadActiveCampaign("recipients"), refreshContacts(), refreshSeries()]);
      setNotice("Dane odbiorcy zapisane.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się zapisać odbiorcy.");
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      if (backend) {
        const response = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ emailFooterHtml, dryRun: defaultDryRun, dailyLimit: defaultDailyLimit, sendFrom: defaultSendFrom, sendTo: defaultSendTo }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setEmailFooterHtml(result.data.emailFooterHtml);
        setDefaultDryRun(Boolean(result.data.dryRun));
        setDefaultDailyLimit(Number(result.data.dailyLimit));
        setDefaultSendFrom(String(result.data.sendFrom));
        setDefaultSendTo(String(result.data.sendTo));
      }
      setNotice("Ustawienia domyślne zapisane.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się zapisać ustawień.");
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>IP</span><div><strong>InnovaPM</strong><small>Mail Campaign</small></div></div>
        <nav aria-label="Nawigacja">{navigation.map((item) => <button type="button" key={item.id} aria-current={view === item.id ? "page" : undefined} className={view === item.id ? "nav active" : "nav"} onClick={() => navigateTo(item.id)}>{item.label}</button>)}</nav>
        <div className="connection"><i className={backend ? "online" : ""} />{backend ? "Apps Script połączony" : "Tryb prototypowy"}</div>
      </aside>

      <section className="workspace">
        <header><div><p className="eyebrow">diagnoza · egzekucja · transfer wiedzy</p><h1>{navigation.find((item) => item.id === view)?.label}</h1></div><div className="header-meta"><b className={displayedDryRun ? "pill warning" : "pill"}>{displayedDryRun ? "TRYB TESTOWY" : "LIVE"}</b><span>{ownerEmail}</span></div></header>
        {notice && <div className="notice" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Zamknij komunikat">×</button></div>}

        {initializing && <section className="panel loading-state" aria-live="polite">Pobieram dane aplikacji…</section>}

        {!initializing && view === "dashboard" && <div className="stack">
          <div className="metrics"><Metric label="Serie uruchomione" value={String(activeCampaigns)} note={`${seriesStats.length} wszystkich`} /><Metric label="Wymagają decyzji" value={String(actionRequired)} note="Szkic lub do akceptacji" /><Metric label="Wysłane" value={String(seriesStats.reduce((sum, item) => sum + item.sent, 0))} note="Łącznie" /><Metric label="Odpowiedzi" value={String(seriesStats.reduce((sum, item) => sum + item.replies, 0))} note="Łącznie" /></div>
          <section className="panel action-panel"><SectionTitle eyebrow="Najbliższa decyzja" title={actionRequired ? "Dokończ przygotowanie serii" : "Brak serii wymagających decyzji"}><button type="button" className="button primary" onClick={() => navigateTo("campaigns")}>Otwórz serie</button></SectionTitle><p className="copy">Przejdź kolejno przez odbiorców, treści i kontrolę gotowości. Uruchomienie jest dostępne dopiero po uzupełnieniu wszystkich wymaganych danych.</p></section>
          <div className="columns"><section className="panel"><p className="eyebrow">Baza kontaktów</p><h2>{contacts.length} kontaktów</h2><p className="copy">{contacts.filter((contact) => !contact.currentCampaign && !contact.suppressed).length} osób można przypisać do nowej serii.</p><button type="button" className="button" onClick={() => navigateTo("contacts")}>Zarządzaj kontaktami</button></section><section className="panel"><p className="eyebrow">Integracja</p><h2>{backend ? "Backend gotowy" : "Wymagana konfiguracja"}</h2><p className="copy">{backend ? "Połączenie z Apps Script jest aktywne." : "Dane demonstracyjne pozostają wyłącznie lokalne."}</p></section></div>
        </div>}

        {!initializing && view === "contacts" && <div className="stack">
          <section className="panel toolbar-panel"><div className="contact-toolbar"><label className="search-field">Szukaj<input type="search" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Imię, firma, stanowisko lub e-mail" /></label><label>Status<select value={contactFilter} onChange={(event) => setContactFilter(event.target.value as ContactFilter)}><option value="all">Wszystkie</option><option value="available">Dostępne</option><option value="campaign">W serii</option><option value="history">Po kampanii</option><option value="suppressed">Wykluczone</option></select></label><div className="toolbar-actions"><button type="button" className="button" onClick={() => setShowContactImport((current) => !current)}>{showContactImport ? "Zamknij import" : "Importuj kontakty"}</button><button type="button" className="button primary" onClick={() => setShowAddContact((current) => !current)}>{showAddContact ? "Anuluj dodawanie" : "Dodaj kontakt"}</button></div></div></section>
          {showContactImport && <><ImportPanel kind="contacts" title="Import kontaktów" hint="Dodanie osób do bazy bez tworzenia serii" ready={false} onSubmit={(event) => importFile(event, "contacts")} /><ImportSummary result={importKind === "contacts" ? importResult : null} /></>}
          {showAddContact && <section className="panel"><SectionTitle eyebrow="Nowy rekord" title="Dodaj kontakt ręcznie" /><form className="form-grid contact-create-form" key={addFormVersion} onSubmit={addContact}><label>Firma<input name="companyName" required /></label><label>Imię i nazwisko<input name="fullName" required /></label><RoleField /><label>Adres e-mail<input name="email" type="email" required /></label><label>Telefon<input name="phone" /></label><label>LinkedIn<input name="linkedin" type="url" /></label><label className="full">Notatka<textarea name="note" rows={3} /></label><div className="actions full"><button className="button primary">Dodaj kontakt</button><button className="button" type="button" onClick={() => setShowAddContact(false)}>Anuluj</button></div></form></section>}
          <section className="panel contact-list"><SectionTitle title="Kontakty"><span className="hint">{filteredContacts.length} z {contacts.length}</span></SectionTitle>{filteredContacts.length === 0 && <p className="empty-state">Brak kontaktów odpowiadających filtrom.</p>}{filteredContacts.map((contact) => {
            const editing = contact.id === editingContactId;
            const assigning = contact.id === campaignFormContactId;
            const contactStatus = contact.suppressed ? "Wykluczony" : contact.currentCampaign ? `${labels[contact.currentCampaign.status]}: ${contact.currentCampaign.name}` : contact.campaignHistory.length ? "Po kampanii" : "Dostępny";
            return <article className="contact" key={contact.id}>
              {!editing && <><div className="contact-main"><span className="avatar">{initials(contact.fullName)}</span><span><strong>{contact.fullName}</strong><small>{contact.role} · {contact.companyName}</small><small>{contact.email}</small></span><span className={`contact-status ${contact.suppressed ? "suppressed" : ""}`}>{contactStatus}</span></div><div className="contact-actions"><button className="button compact primary" type="button" disabled={contact.suppressed || Boolean(contact.currentCampaign)} onClick={() => { setCampaignFormContactId(assigning ? null : contact.id ?? null); setCampaignMode("new"); }}>Dodaj do serii</button><button className="button compact" type="button" onClick={() => setEditingContactId(contact.id ?? null)}>Edytuj</button><button className="button compact danger" type="button" disabled={busyContactId === contact.id} onClick={() => deleteContact(contact)}>Usuń</button></div></>}
              {assigning && !editing && <form className="campaign-assign-form" onSubmit={(event) => assignContact(event, contact)}><div className="mode-switch"><button type="button" className={campaignMode === "new" ? "active" : ""} onClick={() => setCampaignMode("new")}>Nowa seria</button><button type="button" className={campaignMode === "existing" ? "active" : ""} onClick={() => setCampaignMode("existing")}>Istniejąca seria</button></div>{campaignMode === "new" ? <label>Nazwa nowej serii<input name="name" required minLength={2} placeholder={`${contact.companyName} — seria`} /></label> : <label>Seria<select name="campaignId" required defaultValue=""><option value="" disabled>Wybierz serię</option>{seriesStats.filter((series) => ["draft", "needs_review"].includes(series.status)).map((series) => <option key={series.id} value={series.id}>{series.name}</option>)}</select></label>}<div className="actions"><button className="button primary" disabled={busyContactId === contact.id}>Dodaj i otwórz sekwencję</button><button className="button" type="button" onClick={() => setCampaignFormContactId(null)}>Anuluj</button></div></form>}
              {editing && <form className="contact-edit-form" onSubmit={(event) => saveContact(event, contact)}><label>Firma<input name="companyName" required minLength={2} defaultValue={contact.companyName} /></label><label>Imię i nazwisko<input name="fullName" required minLength={3} defaultValue={contact.fullName} /></label><RoleField key={contact.id} defaultValue={contact.role} /><label>Adres e-mail<input name="email" type="email" required defaultValue={contact.email} /></label><label>Telefon<input name="phone" defaultValue={contact.phone} /></label><label>LinkedIn<input name="linkedin" type="url" defaultValue={contact.linkedin} /></label><label className="full">Notatka<textarea name="note" rows={2} defaultValue={contact.note} /></label><div className="actions full"><button className="button primary" disabled={busyContactId === contact.id}>Zapisz</button><button className="button" type="button" onClick={() => setEditingContactId(null)}>Anuluj</button></div></form>}
            </article>;
          })}</section>
        </div>}

        {!initializing && view === "campaigns" && !activeCampaignId && <div className="stack">
          <section className="panel action-panel"><SectionTitle eyebrow="Serie kampanii" title="Zarządzaj wysyłką"><button type="button" className="button primary" onClick={() => setShowCampaignImport((current) => !current)}>{showCampaignImport ? "Zamknij import" : "Importuj nową serię"}</button></SectionTitle><p className="copy">Jedna seria łączy odbiorców, trzy spersonalizowane wiadomości, harmonogram i wyniki.</p></section>
          {showCampaignImport && <><ImportPanel kind="campaign" title="Import serii XLSX/CSV" hint="Jeden plik: seria, kontakt i Mail 1 / 2 / 3" ready={campaignImportReady} onFileChange={() => { setCampaignImportReady(false); if (importKind === "campaign") setImportResult(null); }} onSubmit={(event) => importFile(event, "campaign")} /><ImportSummary result={importKind === "campaign" ? importResult : null} /></>}
          <section className="panel registry"><SectionTitle eyebrow="Rejestr serii" title="Wszystkie serie"><span className="hint">{seriesStats.length} serii</span></SectionTitle>{seriesStats.length ? <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Seria</th><th>Status</th><th>Firmy</th><th>Odbiorcy</th><th>Aktualizacja</th><th>Akcje</th></tr></thead><tbody>{seriesStats.map((series) => <tr key={series.id}><td><strong>{series.name}</strong></td><td><span className={`pill status-${series.status}`}>{labels[series.status]}</span></td><td>{series.companies}</td><td>{series.recipients}</td><td>{formatDate(series.updatedAt)}</td><td><div className="table-actions"><button type="button" className="button compact primary" onClick={() => loadCampaign(series.id)}>Otwórz</button><button type="button" className="button compact danger" onClick={() => deleteCampaign(series)}>{series.sent > 0 ? "Archiwizuj" : "Usuń"}</button></div></td></tr>)}</tbody></table></div> : <p className="empty-state">Brak utworzonych serii. Zaimportuj pierwszy plik kampanii.</p>}</section>
        </div>}

        {!initializing && view === "campaigns" && activeCampaignId && <div className="stack">
          <section className="panel campaign-head"><button type="button" className="back-link" onClick={() => { setActiveCampaignId(null); setCampaignTab("summary"); }}>← Wszystkie serie</button><SectionTitle eyebrow="Szczegóły serii" title={seriesName}><div className="series-title-actions"><b className={`pill status-${status}`}>{labels[status]}</b><button type="button" className="button compact" onClick={() => setEditingSeriesName((current) => !current)}>{editingSeriesName ? "Anuluj" : "Zmień nazwę"}</button></div></SectionTitle>{editingSeriesName && <form className="series-name-form" onSubmit={saveSeriesName}><label>Nazwa serii<input name="seriesName" required minLength={2} defaultValue={seriesName} /></label><button className="button primary" disabled={savingSeriesName}>Zapisz nazwę</button></form>}<div className="campaign-tabs" role="tablist" aria-label="Szczegóły serii">{campaignTabs.map((tab) => <button type="button" id={`tab-${tab.id}`} aria-controls={`panel-${tab.id}`} role="tab" aria-selected={campaignTab === tab.id} className={campaignTab === tab.id ? "active" : ""} key={tab.id} onClick={() => setCampaignTab(tab.id)}>{tab.label}{tab.id === "sequence" && dirtyMessageKeys.size > 0 ? ` (${dirtyMessageKeys.size})` : ""}</button>)}</div></section>

          {campaignTab === "summary" && <div id="panel-summary" role="tabpanel" aria-labelledby="tab-summary" className="stack"><section className="panel"><SectionTitle eyebrow="Kontrola gotowości" title={readiness.ready ? "Seria kompletna" : "Uzupełnij serię przed akceptacją"}><b className={readiness.ready ? "pill" : "pill warning"}>{readiness.ready ? "Gotowa" : "Wymaga pracy"}</b></SectionTitle><div className="readiness-grid"><ReadinessItem ready={campaignCompanies.length > 0} label="Firmy" detail={`${campaignCompanies.length} rekordów`} /><ReadinessItem ready={readiness.recipientsReady === readiness.recipientsTotal && readiness.recipientsTotal > 0} label="Odbiorcy" detail={`${readiness.recipientsReady} z ${readiness.recipientsTotal} przypisanych`} /><ReadinessItem ready={readiness.incompleteMessages === 0 && campaignCompanies.length > 0} label="Treści" detail={readiness.incompleteMessages ? `${readiness.incompleteMessages} wiadomości do uzupełnienia` : "3 wiadomości na odbiorcę"} /><ReadinessItem ready={Boolean(emailFooterHtml.trim())} label="Stopka" detail={emailFooterHtml.trim() ? "Skonfigurowana" : "Brak stopki"} /></div><div className="primary-workflow-action">{status === "draft" && <button type="button" className="button primary" disabled={!readiness.ready} onClick={() => transition("review", "needs_review")}>Przekaż do akceptacji</button>}{status === "needs_review" && <button type="button" className="button primary" disabled={!readiness.ready} onClick={() => transition("approve", "approved")}>Zatwierdź serię</button>}{status === "approved" && <button type="button" className="button primary" onClick={() => transition("start", "active")}>Uruchom serię</button>}{status === "active" && <button type="button" className="button" onClick={() => transition("pause", "paused")}>Wstrzymaj</button>}{status === "paused" && <button type="button" className="button primary" onClick={() => transition("resume", "active")}>Wznów</button>}{!readiness.ready && ["draft", "needs_review"].includes(status) && <span className="hint">Najpierw przypisz odbiorców i uzupełnij wszystkie wiadomości.</span>}{!["completed", "cancelled"].includes(status) && <button type="button" className="button danger" onClick={() => transition("cancel", "cancelled")}>Anuluj serię</button>}</div></section>
            <section className="panel"><SectionTitle eyebrow="Ta seria" title="Ustawienia wysyłki"><span className="hint">Edycja przed zatwierdzeniem</span></SectionTitle><form className="campaign-settings-form" onSubmit={saveCampaignSettings}><label className="toggle"><span><strong>Tryb testowy</strong><small>Wiadomości trafiają wyłącznie do właściciela</small></span><input type="checkbox" checked={campaignDryRun} disabled={!backend || !["draft", "needs_review"].includes(status)} onChange={(event) => setCampaignDryRun(event.target.checked)} /></label><label>Limit dzienny<input type="number" min={1} max={20} value={campaignDailyLimit} disabled={!["draft", "needs_review"].includes(status)} onChange={(event) => setCampaignDailyLimit(Number(event.target.value))} /></label><label>Od<input type="time" value={campaignSendFrom} disabled={!["draft", "needs_review"].includes(status)} onChange={(event) => setCampaignSendFrom(event.target.value)} /></label><label>Do<input type="time" value={campaignSendTo} disabled={!["draft", "needs_review"].includes(status)} onChange={(event) => setCampaignSendTo(event.target.value)} /></label><button className="button primary" disabled={savingCampaignSettings || !["draft", "needs_review"].includes(status)}>Zapisz ustawienia serii</button></form></section>
            <CompanyDataList companies={campaignCompanies} editingIndex={editingCompanyIndex} busyIndex={busyCompanyIndex} setEditing={setEditingCompanyIndex} onSave={saveCampaignCompany} />
          </div>}

          {campaignTab === "recipients" && <div id="panel-recipients" role="tabpanel" aria-labelledby="tab-recipients"><RecipientList companies={campaignCompanies} status={status} onAssign={assignCampaignRecipient} onRemove={removeCampaignRecipient} onSaveContact={saveCampaignRecipientContact} onOpenContacts={() => navigateTo("contacts")} /></div>}

          {campaignTab === "sequence" && <div id="panel-sequence" role="tabpanel" aria-labelledby="tab-sequence" className="stack"><section className="panel"><SectionTitle eyebrow="Spersonalizowana sekwencja" title={selectedSequenceCompany?.fullName || "Wybierz odbiorcę"}><span className="hint">{selectedSequenceCompany?.companyName}</span></SectionTitle>{campaignCompanies.length > 0 && <div className="sequence-toolbar"><label>Odbiorca<select value={String(selectedSequenceIndex)} onChange={(event) => setSelectedSequenceIndex(Number(event.target.value))}>{campaignCompanies.map((company, index) => <option key={company.id ?? `${company.companyName}-${index}`} value={index}>{index + 1}. {company.fullName || "Brak odbiorcy"} — {company.role || "brak stanowiska"} — {company.companyName}</option>)}</select></label><div className="sequence-navigation"><button type="button" className="button compact" disabled={selectedSequenceIndex === 0} onClick={() => setSelectedSequenceIndex((current) => current - 1)}>Poprzedni</button><span>{selectedSequenceIndex + 1} / {campaignCompanies.length}</span><button type="button" className="button compact" disabled={selectedSequenceIndex >= campaignCompanies.length - 1} onClick={() => setSelectedSequenceIndex((current) => current + 1)}>Następny</button></div></div>}</section>{selectedSequenceCompany && selectedSequenceCompany.hasActiveRecipient === true ? <><div className="sequence">{([1, 2, 3] as const).map((step, index) => { const emailKey = `email${step}` as "email1" | "email2" | "email3"; const message = parseCampaignMessage(selectedSequenceCompany[emailKey]); const saveKey = `${selectedSequenceIndex}-${step}`; const dirty = dirtyMessageKeys.has(saveKey); return <section className="panel editor" key={saveKey}><div className="message-title"><b>{initialMessages[index].day}</b><strong>Mail {step}</strong>{dirty && <span className="unsaved">Niezapisane zmiany</span>}</div><label>Temat<input value={message.subject} onChange={(event) => editCampaignMessage(selectedSequenceIndex, step, "subject", event.target.value)} /></label><label>Treść<textarea rows={12} value={message.body} onChange={(event) => editCampaignMessage(selectedSequenceIndex, step, "body", event.target.value)} /></label><div className="editor-meta"><small>{message.body.length} znaków</small><small>{selectedSequenceCompany.email}</small></div><details className="message-preview"><summary>Podgląd finalnej wiadomości</summary><iframe title={`Podgląd maila ${step}`} sandbox="" srcDoc={messagePreviewHtml(message.body, emailFooterHtml)} /></details><button type="button" className="button" disabled={savingMessageKey === saveKey} onClick={() => saveCampaignMessage(selectedSequenceIndex, step)}>Zapisz mail {step}</button></section>; })}</div><div className="save-all-bar"><span>{dirtyMessageKeys.size ? `${dirtyMessageKeys.size} niezapisanych zmian w serii` : "Wszystkie zmiany zapisane"}</span><button type="button" className="button primary" disabled={savingAllMessages} onClick={saveAllCampaignMessages}>Zapisz całą sekwencję odbiorcy</button></div></> : <section className="panel blocked-state"><h2>Najpierw przypisz odbiorcę</h2><p className="copy">Firma ma przygotowane wiadomości, ale żadna osoba nie jest aktywnym odbiorcą tej serii.</p><button type="button" className="button primary" onClick={() => setCampaignTab("recipients")}>Przejdź do odbiorców</button></section>}</div>}

          {campaignTab === "results" && <section id="panel-results" role="tabpanel" aria-labelledby="tab-results" className="panel"><SectionTitle eyebrow="Monitoring serii" title="Wyniki"><span className="hint">Dane dla tej serii</span></SectionTitle><div className="metrics results"><Metric label="Wysłane" value={String(activeStats?.sent ?? 0)} note="Wiadomości" /><Metric label="Otwarte" value={String(activeStats?.opened ?? 0)} note={rate(activeStats?.opened, activeStats?.sent)} /><Metric label="Odpowiedzi" value={String(activeStats?.replies ?? 0)} note={rate(activeStats?.replies, activeStats?.recipients)} /><Metric label="Odbicia" value={String(activeStats?.bounces ?? 0)} note={rate(activeStats?.bounces, activeStats?.sent)} /></div></section>}
        </div>}

        {view === "settings" && <div className="settings"><section className="panel setting"><p className="eyebrow">Domyślne dla nowych serii</p><h2>Bezpieczeństwo wysyłki</h2><label className="toggle"><span><strong>Tryb testowy</strong><small>Wiadomości wyłącznie do właściciela</small></span><input type="checkbox" checked={defaultDryRun} onChange={(event) => setDefaultDryRun(event.target.checked)} /></label><label>Autoryzowany nadawca<input value={ownerEmail} readOnly /></label></section><section className="panel setting"><p className="eyebrow">Domyślne dla nowych serii</p><h2>Limity i okno</h2><label>Limit dzienny<input type="number" min={1} max={20} value={defaultDailyLimit} onChange={(event) => setDefaultDailyLimit(Number(event.target.value))} /></label><div className="inline"><label>Od<input type="time" value={defaultSendFrom} onChange={(event) => setDefaultSendFrom(event.target.value)} /></label><label>Do<input type="time" value={defaultSendTo} onChange={(event) => setDefaultSendTo(event.target.value)} /></label></div><label>Strefa czasowa<input value={timezone} readOnly /></label></section><section className="panel setting footer-setting"><SectionTitle eyebrow="Podpis i rezygnacja" title="Stopka HTML"><span className="hint">Maksymalnie 20 000 znaków</span></SectionTitle><div className="footer-editor"><label>Kod HTML<textarea className="code-editor" rows={14} spellCheck={false} value={emailFooterHtml} onChange={(event) => setEmailFooterHtml(event.target.value)} /></label><div className="footer-preview"><span>Podgląd stopki</span><iframe title="Podgląd stopki HTML" sandbox="" srcDoc={emailFooterHtml} /></div></div><div className="actions"><button type="button" className="button primary" disabled={savingSettings} onClick={saveSettings}>Zapisz wszystkie ustawienia</button><button type="button" className="button" onClick={() => setEmailFooterHtml(defaultFooterHtml)}>Przywróć wzór stopki</button></div></section></div>}
      </section>
    </main>
  );
}

function RoleField({ defaultValue = "" }: { defaultValue?: string }) {
  const isPreset = allowedRoles.some((role) => role === defaultValue);
  const [selection, setSelection] = useState(defaultValue ? (isPreset ? defaultValue : "custom") : "");
  const [customRole, setCustomRole] = useState(isPreset ? "" : defaultValue);
  return <div className="role-field"><label>Stanowisko<select required value={selection} onChange={(event) => setSelection(event.target.value)}><option value="" disabled>Wybierz stanowisko</option>{allowedRoles.map((role) => <option key={role} value={role}>{role}</option>)}<option value="custom">Inne — wpisz ręcznie</option></select></label>{selection === "custom" ? <label className="custom-role">Własne stanowisko<input name="role" required minLength={2} value={customRole} onChange={(event) => setCustomRole(event.target.value)} /></label> : <input type="hidden" name="role" value={selection} />}</div>;
}

function ImportPanel({ kind, title, hint, ready, onSubmit, onFileChange }: { kind: ImportKind; title: string; hint: string; ready: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onFileChange?: () => void }) {
  const fields = kind === "campaign" ? [["seriesName", "Seria"], ["companyName", "Firma"], ["fullName", "Imię i nazwisko"], ["role", "Stanowisko"], ["email", "Adres e-mail"], ["email1", "Mail 1"], ["email2", "Mail 2"], ["email3", "Mail 3"]] : [["companyName", "Nazwa firmy"], ["fullName", "Imię i nazwisko"], ["role", "Stanowisko"], ["email", "Adres e-mail"]];
  return <section className="panel"><SectionTitle eyebrow="Źródło danych" title={title}><span className="hint">{hint}</span></SectionTitle><form className="import-form" onSubmit={onSubmit}><div className="import"><input type="file" name="file" accept=".xlsx,.csv" required onChange={onFileChange} /><div className="import-actions"><button className="button primary" name="action" value="preview">Sprawdź plik</button>{kind === "campaign" && <button className="button" name="action" value="commit" disabled={!ready}>Utwórz serię/serie</button>}{kind === "contacts" && <button className="button" name="action" value="commit">Importuj kontakty</button>}</div></div><details><summary>Ręczne mapowanie kolumn</summary><div className="mapping">{fields.map(([key, label]) => <label key={key}>{label}<input name={`mapping.${key}`} placeholder={`Kolumna: ${label}`} /></label>)}</div></details>{kind === "campaign" && <p className="import-step-hint">Najpierw sprawdź plik. Po poprawnej walidacji odblokuje się utworzenie serii.</p>}</form></section>;
}

function RecipientList({ companies, status, onAssign, onRemove, onSaveContact, onOpenContacts }: { companies: CampaignCompany[]; status: CampaignStatus; onAssign: (index: number, contactId: string) => Promise<void>; onRemove: (index: number) => Promise<void>; onSaveContact: (event: FormEvent<HTMLFormElement>, index: number) => Promise<void>; onOpenContacts: () => void }) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [assigningIndex, setAssigningIndex] = useState<number | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const canChangeAssignment = ["draft", "needs_review"].includes(status);
  const canEditContact = !["completed", "cancelled"].includes(status);
  const activeCount = companies.filter((company) => company.hasActiveRecipient !== false && company.contactId).length;

  async function assign(index: number) {
    if (!candidateId) return;
    setBusyIndex(index);
    await onAssign(index, candidateId);
    setBusyIndex(null);
    setAssigningIndex(null);
    setCandidateId("");
  }

  return <section className="panel recipient-list"><SectionTitle eyebrow="Osoby objęte serią" title="Odbiorcy"><span className="hint">{activeCount} z {companies.length} przypisanych</span></SectionTitle>{companies.length === 0 && <p className="empty-state">Brak firm i odbiorców w serii.</p>}{companies.length > 0 && <div className="recipient-table" role="table" aria-label="Odbiorcy serii"><div className="recipient-row recipient-header" role="row"><span role="columnheader">Imię i nazwisko</span><span role="columnheader">Stanowisko</span><span role="columnheader">Adres e-mail</span><span role="columnheader">Firma</span><span role="columnheader">Status</span><span role="columnheader">Akcje</span></div>{companies.map((company, index) => {
    const active = company.hasActiveRecipient !== false && Boolean(company.contactId);
    const editing = editingIndex === index;
    const assigning = assigningIndex === index;
    return <div className={`recipient-row ${active ? "" : "missing"}`} role="row" key={company.id ?? `${company.companyName}-${index}`}><span role="cell" data-label="Imię i nazwisko"><strong>{company.fullName || "Brak przypisanej osoby"}</strong></span><span role="cell" data-label="Stanowisko">{company.role || "—"}</span><span role="cell" data-label="Adres e-mail">{company.email || "—"}</span><span role="cell" data-label="Firma">{company.companyName}</span><span role="cell" data-label="Status"><b className={active ? "pill" : "pill status-failed"}>{active ? "Przypisany" : "Brak odbiorcy"}</b></span><span role="cell" data-label="Akcje" className="recipient-actions">{active && canEditContact && <button type="button" className="button compact" onClick={() => { setEditingIndex(editing ? null : index); setAssigningIndex(null); }}>{editing ? "Anuluj" : "Edytuj"}</button>}{canChangeAssignment && <button type="button" className="button compact" onClick={() => { setAssigningIndex(assigning ? null : index); setEditingIndex(null); setCandidateId(company.contactId || company.candidateContacts?.[0]?.id || ""); }}>{active ? "Zmień" : "Przypisz"}</button>}{active && canChangeAssignment && <button type="button" className="button compact danger" onClick={() => onRemove(index)}>Usuń z serii</button>}</span>{editing && active && <form className="recipient-inline-form" onSubmit={async (event) => { setBusyIndex(index); await onSaveContact(event, index); setBusyIndex(null); setEditingIndex(null); }}><label>Imię i nazwisko<input name="fullName" required minLength={3} defaultValue={company.fullName} /></label><RoleField key={company.contactId} defaultValue={company.role} /><label>Adres e-mail<input name="email" type="email" required defaultValue={company.email} /></label><div className="actions"><button className="button primary" disabled={busyIndex === index}>Zapisz odbiorcę</button><button type="button" className="button" onClick={() => setEditingIndex(null)}>Anuluj</button></div></form>}{assigning && <div className="recipient-assign-form">{company.candidateContacts?.length ? <><label>Kontakt z firmy<select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="" disabled>Wybierz osobę</option>{company.candidateContacts.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.fullName} — {candidate.role} — {candidate.email}</option>)}</select></label><div className="actions"><button type="button" className="button primary" disabled={!candidateId || busyIndex === index} onClick={() => assign(index)}>Zapisz przypisanie</button><button type="button" className="button" onClick={() => setAssigningIndex(null)}>Anuluj</button></div></> : <div className="empty-inline"><span>Brak kontaktów dla tej firmy.</span><button type="button" className="button" onClick={onOpenContacts}>Dodaj kontakt</button></div>}</div>}</div>;
  })}</div>}</section>;
}

function CompanyDataList({ companies, editingIndex, busyIndex, setEditing, onSave }: { companies: CampaignCompany[]; editingIndex: number | null; busyIndex: number | null; setEditing: (value: number | null) => void; onSave: (event: FormEvent<HTMLFormElement>, index: number) => void }) {
  return <section className="panel company-list"><SectionTitle eyebrow="Dane pomocnicze" title="Firmy w serii"><span className="hint">{companies.length} rekordów</span></SectionTitle>{companies.map((company, index) => { const editing = editingIndex === index; return <article className="company-row" key={company.id ?? `${company.companyName}-${index}`}><div className="company-summary"><div className="company-toggle"><span><strong>{company.companyName}</strong><small>{company.sector || "Brak sektora"} · {company.packageName || "Brak pakietu"}</small></span></div><button type="button" className="button compact" onClick={() => setEditing(editing ? null : index)}>{editing ? "Anuluj" : "Edytuj firmę"}</button></div>{editing && <form className="company-edit-form" onSubmit={(event) => onSave(event, index)}><label>Nazwa firmy<input name="companyName" required minLength={2} defaultValue={company.companyName} /></label><label>Sektor<input name="sector" defaultValue={company.sector} /></label><label>Trigger<input name="trigger" defaultValue={company.trigger} /></label><label>Pakiet<input name="packageName" defaultValue={company.packageName} /></label><label className="full">Źródło<input name="source" defaultValue={company.source} /></label><div className="actions full"><button className="button primary" disabled={busyIndex === index}>Zapisz zmiany</button><button className="button" type="button" onClick={() => setEditing(null)}>Anuluj</button></div></form>}</article>; })}</section>;
}

function ReadinessItem({ ready, label, detail }: { ready: boolean; label: string; detail: string }) { return <div className={ready ? "readiness-item ready" : "readiness-item"}><span aria-hidden="true">{ready ? "✓" : "!"}</span><div><strong>{label}</strong><small>{detail}</small></div></div>; }
function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function SectionTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) { return <div className="section-title"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{children}</div>; }
function ImportSummary({ result }: { result: ImportResult | null }) { if (!result) return null; const blocked = result.issues.length > 0 || result.duplicates.length > 0; return <section className="panel"><SectionTitle eyebrow="Wynik walidacji" title={`${result.rows.length} poprawnych rekordów`}><b className={blocked ? "pill status-failed" : "pill"}>{blocked ? `${result.issues.length + result.duplicates.length} problemów` : "Gotowe"}</b></SectionTitle>{result.duplicates.length > 0 && <p className="issue">Konflikty: {result.duplicates.join(", ")}</p>}{result.issues.slice(0, 8).map((issue) => <p className="issue" key={`${issue.row}-${issue.field}`}>Wiersz {issue.row}, {issue.field}: {issue.message}</p>)}</section>; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "short" }).format(date); }
function initials(value: string) { return value.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function rate(value = 0, base = 0) { return base > 0 ? `${Math.round((value / base) * 100)}%` : "Brak danych"; }
function messagePreviewHtml(body: string, footerHtml: string) { return `<div style="font:14px/1.6 Arial,sans-serif;color:#152334;padding:16px">${escapeHtml(body).replaceAll("\n", "<br>")}${footerHtml}</div>`; }
function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
