"use client";

import Image from "next/image";
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

type View = "dashboard" | "contacts" | "campaigns" | "monitoring" | "settings";
type CampaignTab = "summary" | "recipients" | "sequence";
type ImportKind = "campaign" | "contacts";
type ContactFilter = "all" | "available" | "campaign" | "history" | "suppressed";
type CampaignArchiveFilter = "active" | "archived" | "all";
type FooterProfile = { id: string; name: string; html: string };

const MAX_DAILY_LIMIT = 40;

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
  activity?: RecipientActivity;
};

type RecipientActivity = {
  sentSteps?: number[];
  openedSteps?: number[];
  replied?: boolean;
  bounced?: boolean;
};

type SeriesStats = {
  id: string;
  name: string;
  status: CampaignStatus;
  sent: number;
  opened: number;
  replies: number;
  bounces: number;
  steps?: SeriesStepStats[];
  companies: number;
  recipients: number;
  updatedAt: string;
  archivedAt?: string;
};

type SeriesStepStats = {
  step: number;
  sent: number;
  opened: number;
  replies: number;
  bounces: number;
  openRate: number;
  replyRate: number;
  bounceRate: number;
};

type BackendStatus = {
  ownerEmail: string;
  effectiveUser: string;
  queueTriggerInstalled: boolean;
  replyTriggerInstalled: boolean;
  senderReady: boolean;
  senderError: string;
  sendTransport?: "gmail" | "smtp";
  timezone: string;
} | null;

const navigation: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "contacts", label: "Kontakty" },
  { id: "campaigns", label: "Kampanie" },
  { id: "monitoring", label: "Monitoring" },
  { id: "settings", label: "Ustawienia" },
];

const campaignTabs: { id: CampaignTab; label: string }[] = [
  { id: "summary", label: "Podsumowanie" },
  { id: "recipients", label: "Odbiorcy" },
  { id: "sequence", label: "Serie maili" },
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

function isDryRun(value: unknown): boolean {
  return String(value).trim().toLowerCase() !== "false";
}

function todayInWarsaw(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isValidCampaignStartDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= todayInWarsaw();
}

const initialMessages = [
  { day: "D0", subject: "Czy obecne inicjatywy mają jeden rytm decyzyjny?", body: "Dzień dobry,\n\nzwracam uwagę na aktualny punkt rozwoju firmy i liczbę równoległych inicjatyw. W takich momentach największym ryzykiem zwykle nie jest sam harmonogram, lecz rozproszenie decyzji, odpowiedzialności i informacji zarządczej. InnovaPM porządkuje ten obszar bez rozbudowy administracji projektowej. Czy warto porównać Państwa priorytety na krótkiej, 20-minutowej rozmowie?\n\nPozdrawiam,\nKrzysztof Fiedorowicz" },
  { day: "D+3", subject: "Najdroższe ryzyka nie zawsze są widoczne w harmonogramie", body: "Dzień dobry,\n\nwracam z jednym konkretnym pytaniem: które decyzje w kluczowych inicjatywach nie mają dziś jednego właściciela? To zwykle tam powstają koszty opóźnień i przeciążenie zarządu. Możemy szybko zdiagnozować te punkty i zaproponować lekki rytm PMO dopasowany do skali firmy. Czy 20 minut w przyszłym tygodniu będzie zasadne?\n\nPozdrawiam,\nKrzysztof Fiedorowicz" },
  { day: "D+6", subject: "Zamykam temat — krótka diagnoza PMO", body: "Dzień dobry,\n\nzamykam ten wątek, żeby nie dokładać kolejnej wiadomości bez wartości. Jeśli uporządkowanie portfela inicjatyw, decyzji i odpowiedzialności jest teraz aktualne, przygotuję krótką diagnozę punktów zapalnych przed rozmową. Jeżeli temat nie jest priorytetem, proszę o krótką informację — wstrzymam dalszy kontakt.\n\nPozdrawiam,\nKrzysztof Fiedorowicz" },
];

const defaultFooterHtml = `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #dfe6ed;color:#667587;font:13px Arial,sans-serif;line-height:1.5"><strong style="color:#0C2340">Krzysztof Fiedorowicz</strong><br>InnovaPM · <a href="https://innova.pm" style="color:#378ADD">innova.pm</a><br><br><span style="font-size:11px">Jeśli nie chcesz otrzymywać kolejnych wiadomości, odpowiedz „stop”.</span></div>`;
const mediaFooterHtml = `<div style="max-width:600px;font-family:'Montserrat','Inter',Arial,sans-serif;color:#4a5568">
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
</div>`;
const initialFooterProfiles: FooterProfile[] = [
  { id: "footer-default", name: "Domyślna", html: defaultFooterHtml },
  { id: "footer-media", name: "InnovaPM Media", html: mediaFooterHtml },
];

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
  seriesName: "PMO Mazowsze — kampania 1",
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
  name: "PMO Mazowsze — kampania 1",
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
  const [campaignArchiveFilter, setCampaignArchiveFilter] = useState<CampaignArchiveFilter>("active");
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
  const [activeCampaignArchivedAt, setActiveCampaignArchivedAt] = useState("");
  const [editingSeriesName, setEditingSeriesName] = useState(false);
  const [savingSeriesName, setSavingSeriesName] = useState(false);
  const [selectedSequenceIndex, setSelectedSequenceIndex] = useState(0);
  const [savingMessageKey, setSavingMessageKey] = useState<string | null>(null);
  const [savingAllMessages, setSavingAllMessages] = useState(false);
  const [dirtyMessageKeys, setDirtyMessageKeys] = useState<Set<string>>(new Set());
  const [footerProfiles, setFooterProfiles] = useState<FooterProfile[]>(initialFooterProfiles);
  const [defaultFooterId, setDefaultFooterId] = useState("footer-default");
  const [editingFooterId, setEditingFooterId] = useState("footer-default");
  const [defaultDryRun, setDefaultDryRun] = useState(true);
  const [defaultDailyLimit, setDefaultDailyLimit] = useState(20);
  const [defaultSendFrom, setDefaultSendFrom] = useState("09:00");
  const [defaultSendTo, setDefaultSendTo] = useState("15:00");
  const [defaultMail2DelayBusinessDays, setDefaultMail2DelayBusinessDays] = useState(3);
  const [defaultMail3DelayBusinessDays, setDefaultMail3DelayBusinessDays] = useState(3);
  const [, setTimezone] = useState("Europe/Warsaw");
  const [savingSettings, setSavingSettings] = useState(false);
  const [campaignDryRun, setCampaignDryRun] = useState(true);
  const [campaignDailyLimit, setCampaignDailyLimit] = useState(20);
  const [campaignSendFrom, setCampaignSendFrom] = useState("09:00");
  const [campaignSendTo, setCampaignSendTo] = useState("15:00");
  const [campaignStartDate, setCampaignStartDate] = useState(todayInWarsaw);
  const [campaignMail2DelayBusinessDays, setCampaignMail2DelayBusinessDays] = useState(3);
  const [campaignMail3DelayBusinessDays, setCampaignMail3DelayBusinessDays] = useState(3);
  const [campaignFooterId, setCampaignFooterId] = useState("footer-default");
  const [savingCampaignSettings, setSavingCampaignSettings] = useState(false);
  const [seriesStats, setSeriesStats] = useState<SeriesStats[]>([]);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>(null);
  const [backendStatusError, setBackendStatusError] = useState("");
  const [liveStartConfirmed, setLiveStartConfirmed] = useState(false);

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
        // Keep workbook reads sequential. Apps Script serializes access to the
        // campaign sheet, while browser background timers may be heavily throttled.
        const backendStatusResponse = await fetch("/api/backend-status");
        const contactsResponse = await fetch("/api/contacts");
        const statusResponse = await fetch("/api/status?includeArchived=true");
        const settingsResponse = await fetch("/api/settings");
        if (!contactsResponse.ok || !statusResponse.ok || !settingsResponse.ok) {
          const failedResponse = [contactsResponse, statusResponse, settingsResponse].find((response) => !response.ok);
          let backendMessage = "Nie udało się pobrać pełnych danych aplikacji.";
          if (failedResponse) {
            try {
              const errorPayload = await failedResponse.clone().json() as { error?: string };
              if (errorPayload.error) backendMessage = errorPayload.error;
            } catch {
              // Keep the safe generic fallback for non-JSON responses.
            }
          }
          throw new Error(backendMessage);
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
          const loadedFooters = Array.isArray(settings.footerProfiles) && settings.footerProfiles.length
            ? settings.footerProfiles as FooterProfile[]
            : [{ id: "footer-default", name: "Domyślna", html: String(settings.emailFooterHtml || defaultFooterHtml) }];
          const loadedDefaultFooterId = loadedFooters.some((profile) => profile.id === settings.defaultFooterId)
            ? String(settings.defaultFooterId)
            : loadedFooters[0].id;
          setFooterProfiles(loadedFooters);
          setDefaultFooterId(loadedDefaultFooterId);
          setEditingFooterId(loadedDefaultFooterId);
          if (typeof settings.dryRun === "boolean") setDefaultDryRun(settings.dryRun);
          if (Number.isFinite(Number(settings.dailyLimit))) setDefaultDailyLimit(Number(settings.dailyLimit));
          if (typeof settings.sendFrom === "string") setDefaultSendFrom(settings.sendFrom);
          if (typeof settings.sendTo === "string") setDefaultSendTo(settings.sendTo);
          if (Number.isFinite(Number(settings.mail2DelayBusinessDays))) setDefaultMail2DelayBusinessDays(Number(settings.mail2DelayBusinessDays));
          if (Number.isFinite(Number(settings.mail3DelayBusinessDays))) setDefaultMail3DelayBusinessDays(Number(settings.mail3DelayBusinessDays));
          if (typeof settings.timezone === "string") setTimezone(settings.timezone);
        }
        if (backendStatusResponse.ok) {
          const result = await backendStatusResponse.json();
          setBackendStatus(result.data ?? null);
          setBackendStatusError("");
        } else {
          setBackendStatus(null);
          setBackendStatusError("Backend Apps Script nie odpowiada. Uruchomienie kampanii pozostaje zablokowane.");
        }
      } catch (error) {
        setContacts([]);
        setSeriesStats([]);
        setBackendStatus(null);
        setBackendStatusError("Backend Apps Script nie odpowiada. Uruchomienie kampanii pozostaje zablokowane.");
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

  const openSeriesStats = useMemo(() => seriesStats.filter((series) => !series.archivedAt), [seriesStats]);
  const archivedSeriesStats = useMemo(() => seriesStats.filter((series) => Boolean(series.archivedAt)), [seriesStats]);
  const visibleCampaignStats = useMemo(() => {
    if (campaignArchiveFilter === "archived") return archivedSeriesStats;
    if (campaignArchiveFilter === "all") return seriesStats;
    return openSeriesStats;
  }, [archivedSeriesStats, campaignArchiveFilter, openSeriesStats, seriesStats]);
  const monitoringStats = openSeriesStats;
  const activeCampaigns = openSeriesStats.filter((series) => series.status === "active").length;
  const actionRequired = openSeriesStats.filter((series) => ["draft", "needs_review"].includes(series.status)).length;
  const selectedSequenceCompany = campaignCompanies[selectedSequenceIndex];
  const editingFooter = footerProfiles.find((profile) => profile.id === editingFooterId) ?? footerProfiles[0];
  const campaignFooter = footerProfiles.find((profile) => profile.id === campaignFooterId)
    ?? footerProfiles.find((profile) => profile.id === defaultFooterId)
    ?? footerProfiles[0];
  const campaignFooterHtml = campaignFooter?.html ?? "";
  const readiness = getCampaignReadiness(campaignCompanies);
  const isArchivedCampaign = Boolean(activeCampaignArchivedAt);
  const startChecks = [
    { ready: readiness.ready, label: "Dane kampanii", detail: `${readiness.recipientsReady} z ${readiness.recipientsTotal} odbiorców, ${readiness.incompleteMessages} braków w treści` },
    { ready: Boolean(campaignFooterHtml.trim()), label: "Stopka", detail: campaignFooterHtml.trim() ? campaignFooter?.name || "Stopka HTML skonfigurowana" : "Brak stopki HTML" },
    { ready: backend, label: "Backend", detail: backend ? "Apps Script połączony" : "Brak połączenia z backendem" },
    { ready: Boolean(backendStatus?.queueTriggerInstalled), label: "Kolejka wysyłki", detail: backendStatus?.queueTriggerInstalled ? "runQueue aktywny" : "Brak triggera runQueue" },
    { ready: Boolean(backendStatus?.replyTriggerInstalled), label: "Monitoring", detail: backendStatus?.replyTriggerInstalled ? "checkReplies aktywny" : "Brak triggera checkReplies" },
    { ready: Boolean(backendStatus?.senderReady), label: "Nadawca", detail: backendStatus?.senderReady && backendStatus ? senderStatusDetail(backendStatus) : backendStatus?.senderError || "Nadawca niepotwierdzony" },
    { ready: isValidCampaignStartDate(campaignStartDate), label: "Data startu", detail: isValidCampaignStartDate(campaignStartDate) ? campaignStartDate : "Wybierz dzisiejszą lub przyszłą datę" },
  ];
  const startBlocked = startChecks.some((check) => !check.ready);
  const startModeText = campaignDryRun
    ? `TRYB TESTOWY · wiadomości trafią do ${ownerEmail}`
    : `LIVE · wysyłka do ${readiness.recipientsTotal} realnych odbiorców`;

  function navigateTo(nextView: View) {
    if (dirtyMessageKeys.size > 0 && !window.confirm("Masz niezapisane zmiany w seriach maili. Opuścić ten ekran?")) return;
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
    const response = await fetch("/api/status?includeArchived=true");
    const result = await response.json();
    if (response.ok && Array.isArray(result.data)) setSeriesStats(result.data);
  }

  async function loadCampaign(campaignId: string, tab: CampaignTab = "summary") {
    setNotice("Otwieram kampanię…");
    try {
      if (!backend && campaignId === demoSeries.id) {
        setActiveCampaignId(campaignId);
        setSeriesName(demoSeries.name);
        setStatus(demoSeries.status);
        setActiveCampaignArchivedAt("");
        setCampaignFooterId(defaultFooterId);
        setCampaignCompanies([demoCampaignCompany]);
      } else {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        const campaign = result.data?.campaign ?? {};
        setActiveCampaignId(campaignId);
        setSeriesName(String(campaign.name || "Kampania bez nazwy"));
        setStatus(campaign.status as CampaignStatus);
        setActiveCampaignArchivedAt(String(campaign.archivedAt || ""));
        setCampaignDryRun(isDryRun(campaign.dryRun));
        setCampaignDailyLimit(Number(campaign.dailyLimit || 20));
        setCampaignSendFrom(String(campaign.sendFrom || "09:00"));
        setCampaignSendTo(String(campaign.sendTo || "15:00"));
        setCampaignStartDate(String(campaign.startDate || todayInWarsaw()));
        setCampaignMail2DelayBusinessDays(Number(campaign.mail2DelayBusinessDays || 3));
        setCampaignMail3DelayBusinessDays(Number(campaign.mail3DelayBusinessDays || 3));
        setCampaignFooterId(String(campaign.footerId || defaultFooterId));
        setCampaignCompanies(Array.isArray(result.data?.companies) ? result.data.companies : []);
      }
      setSelectedSequenceIndex(0);
      setDirtyMessageKeys(new Set());
      setLiveStartConfirmed(false);
      setCampaignTab(tab);
      setView("campaigns");
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się otworzyć kampanii.");
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
          setNotice(`Utworzono ${created.length} ${created.length === 1 ? "kampanię" : "kampanie"}.`);
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

  async function removeContactFromCampaign(contact: ContactWithCampaigns) {
    if (!contact.id || !contact.companyId || !contact.currentCampaign) return;
    if (!window.confirm(`Usunąć kontakt ${contact.fullName} z kampanii „${contact.currentCampaign.name}”? Kontakt zostanie w bazie.`)) return;
    setBusyContactId(contact.id);
    try {
      if (backend) {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(contact.currentCampaign.id)}/recipients/${encodeURIComponent(contact.companyId)}`, { method: "DELETE" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        await Promise.all([refreshContacts(), refreshSeries()]);
      } else {
        setContacts((current) => current.map((item) => item.id === contact.id ? { ...item, currentCampaign: null } : item));
      }
      setNotice("Kontakt usunięty z kampanii. Rekord pozostał w bazie kontaktów.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się usunąć kontaktu z kampanii.");
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
      if (!backend) throw new Error("Dodawanie do kampanii wymaga połączonego backendu.");
      const response = await fetch(`/api/contacts/${encodeURIComponent(contact.id)}/campaigns`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const campaignId = String(result.data?.campaign?.id ?? result.data?.campaignId ?? (body.mode === "existing" ? body.campaignId : ""));
      await Promise.all([refreshContacts(), refreshSeries()]);
      setCampaignFormContactId(null);
      if (campaignId) await loadCampaign(campaignId, "sequence");
      setNotice("Kontakt dodany do kampanii.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się dodać kontaktu do kampanii.");
    } finally {
      setBusyContactId(null);
    }
  }

  async function deleteCampaign(series: SeriesStats) {
    const action = series.sent > 0 ? "Zarchiwizować" : "Usunąć";
    const detail = series.sent > 0 ? "Historia wysyłki zostanie zachowana." : "Tej operacji nie można cofnąć.";
    if (!window.confirm(`${action} kampanię „${series.name}”? ${detail}`)) return;
    try {
      let archived = false;
      if (backend) {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(series.id)}`, { method: "DELETE" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        archived = Boolean(result.data?.archived);
        await Promise.all([refreshContacts(), refreshSeries()]);
      }
      setNotice(archived ? "Kampania z historią została zarchiwizowana." : "Kampania usunięta.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się usunąć kampanii.");
    }
  }

  async function cancelCampaignFromRegistry(series: SeriesStats) {
    if (!window.confirm(`Anulować kampanię „${series.name}”? Zaplanowane, niewysłane wiadomości nie zostaną wysłane.`)) return;
    try {
      if (backend) {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(series.id)}/cancel`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ actor: ownerEmail }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        await Promise.all([refreshContacts(), refreshSeries()]);
      } else {
        setSeriesStats((current) => current.map((item) => item.id === series.id ? { ...item, status: "cancelled" } : item));
      }
      setNotice("Kampania została anulowana. Zaplanowane wiadomości nie zostaną wysłane.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się anulować kampanii.");
    }
  }

  async function reopenCancelledCampaign() {
    if (!activeCampaignId || !window.confirm("Przywrócić kampanię do korekty? Wysłane maile i ich historia pozostaną bez zmian, a niewysłane wiadomości wrócą do szkicu.")) return;
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(activeCampaignId)}/reopen`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: ownerEmail }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setStatus("needs_review");
      setSeriesStats((current) => current.map((item) => item.id === activeCampaignId ? { ...item, status: "needs_review", updatedAt: result.data?.updatedAt || item.updatedAt } : item));
      await reloadActiveCampaign("summary");
      await refreshContacts();
      setNotice("Kampania została przywrócona do korekty.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się przywrócić kampanii do korekty.");
    }
  }

  async function prepareCampaignForCorrection() {
    if (!window.confirm("Zatrzymać zaplanowaną wysyłkę i przejść do korekty ustawień? Niewysłane wiadomości wrócą do szkicu, a historia wysłanych maili pozostanie bez zmian.")) return;
    await transition("prepare-correction", "needs_review");
    await reloadActiveCampaign("summary");
  }

  async function restoreCampaign() {
    if (!activeCampaignId || !window.confirm("Przywrócić kampanię do ponownej akceptacji? Treści i historia wysyłki pozostaną zachowane.")) return;
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(activeCampaignId)}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: ownerEmail }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setStatus("needs_review");
      setActiveCampaignArchivedAt("");
      setSeriesStats((current) => current.map((item) => item.id === activeCampaignId ? { ...item, status: "needs_review", archivedAt: "", updatedAt: result.data?.updatedAt || item.updatedAt } : item));
      await reloadActiveCampaign("summary");
      await refreshSeries();
      await refreshContacts();
      setNotice("Kampania przywrócona do ponownej akceptacji.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się przywrócić kampanii.");
    }
  }

  async function restoreArchivedCampaign(series: SeriesStats) {
    if (!window.confirm(`Przywrócić kampanię „${series.name}” do ponownej akceptacji? Treści i historia wysyłki pozostaną zachowane.`)) return;
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(series.id)}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: ownerEmail }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSeriesStats((current) => current.map((item) => item.id === series.id ? { ...item, status: "needs_review", archivedAt: "", updatedAt: result.data?.updatedAt || item.updatedAt } : item));
      setCampaignArchiveFilter("active");
      setNotice("Kampania przywrócona do ponownej akceptacji.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się przywrócić kampanii.");
    }
  }

  async function clearCampaignActivity() {
    if (!activeCampaignId || !window.confirm("Usunąć historię wysyłek, otwarć, odpowiedzi i odbić tej kampanii? Kontakty, przypisania oraz treści wiadomości pozostaną bez zmian. Kampania wróci do ponownej akceptacji.")) return;
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(activeCampaignId)}/clear-activity`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: ownerEmail }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setStatus("needs_review");
      setSeriesStats((current) => current.map((item) => item.id === activeCampaignId ? { ...item, status: "needs_review", sent: 0, opened: 0, replies: 0, bounces: 0, updatedAt: item.updatedAt } : item));
      await reloadActiveCampaign("summary");
      await refreshSeries();
      setNotice(`Wyczyszczono aktywność: ${result.data?.clearedMessages || 0} wiadomości.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się wyczyścić aktywności kampanii.");
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

  async function removeCampaignCompany(companyIndex: number) {
    const company = campaignCompanies[companyIndex];
    const runningCampaign = ["active", "paused"].includes(status);
    const confirmation = `Usunąć firmę „${company.companyName}” z tej kampanii? Wraz z nią zniknie przypisany odbiorca i wszystkie niewysłane serie wiadomości. Kontakt i firma pozostaną w bazie kontaktów.${runningCampaign ? " Kampania będzie działać dalej dla pozostałych firm." : ""}`;
    if (!activeCampaignId || !company.id || !window.confirm(confirmation)) return;
    const busyBefore = busyCompanyIndex;
    setBusyCompanyIndex(companyIndex);
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(activeCampaignId)}/companies/${encodeURIComponent(company.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const deleted = result.data ?? {};
      if (String(deleted.companyId || company.id) !== company.id) throw new Error("Backend nie potwierdził usunięcia wskazanej firmy.");
      const remaining = campaignCompanies.filter((_, itemIndex) => itemIndex !== companyIndex);
      setCampaignCompanies(remaining);
      if (selectedSequenceIndex >= remaining.length) setSelectedSequenceIndex(Math.max(0, remaining.length - 1));
      await Promise.all([reloadActiveCampaign("summary"), refreshSeries(), refreshContacts()]);
      setNotice(`Firma „${company.companyName}” usunięta z kampanii: ${deleted.deletedMessages ?? 0} wiadomości, ${deleted.deletedRecipients ?? 0} przypisań odbiorców.`);
    } catch (error) {
      setBusyCompanyIndex(busyBefore ?? null);
      setNotice(error instanceof Error ? error.message : "Nie udało się usunąć firmy z kampanii.");
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
      setNotice("Nazwa kampanii zapisana.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się zmienić nazwy kampanii.");
    } finally {
      setSavingSeriesName(false);
    }
  }

  async function persistCampaignSettings() {
    if (!activeCampaignId) throw new Error("Brak aktywnej kampanii.");
    if (!isValidTimeWindow(campaignSendFrom, campaignSendTo)) {
      throw new Error("Niepoprawne okno wysyłki. Ustaw godziny w formacie HH:mm i upewnij się, że początek jest przed końcem.");
    }
    if (!isValidCampaignStartDate(campaignStartDate)) {
      throw new Error("Data startu kampanii nie może być wcześniejsza niż dzisiaj.");
    }
    if (!backend) return;
    const response = await fetch(`/api/campaigns/${encodeURIComponent(activeCampaignId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: campaignDryRun, dailyLimit: campaignDailyLimit, sendFrom: campaignSendFrom, sendTo: campaignSendTo, startDate: campaignStartDate, mail2DelayBusinessDays: campaignMail2DelayBusinessDays, mail3DelayBusinessDays: campaignMail3DelayBusinessDays, footerId: campaignFooterId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    const saved = result.data ?? {};
    setCampaignDryRun(isDryRun(saved.dryRun));
    setCampaignDailyLimit(Number(saved.dailyLimit ?? campaignDailyLimit));
    setCampaignSendFrom(String(saved.sendFrom || campaignSendFrom));
    setCampaignSendTo(String(saved.sendTo || campaignSendTo));
    setCampaignStartDate(String(saved.startDate || campaignStartDate));
    setCampaignMail2DelayBusinessDays(Number(saved.mail2DelayBusinessDays ?? campaignMail2DelayBusinessDays));
    setCampaignMail3DelayBusinessDays(Number(saved.mail3DelayBusinessDays ?? campaignMail3DelayBusinessDays));
    setCampaignFooterId(String(saved.footerId || campaignFooterId));
  }

  async function saveCampaignSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingCampaignSettings(true);
    try {
      await persistCampaignSettings();
      setNotice("Ustawienia kampanii zapisane.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się zapisać ustawień kampanii.");
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
      setNotice("Wszystkie serie maili odbiorcy zostały zapisane.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się zapisać wszystkich serii maili.");
    } finally {
      setSavingAllMessages(false);
    }
  }

  async function transition(action: string, next: CampaignStatus, extra: Record<string, unknown> = {}) {
    if (!activeCampaignId) return;
    try {
      if (["review", "approve"].includes(action)) await persistCampaignSettings();
      if (backend) {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(activeCampaignId)}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: ownerEmail, ...extra }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
      }
      setStatus(next);
      setLiveStartConfirmed(false);
      setSeriesStats((current) => current.map((item) => item.id === activeCampaignId ? { ...item, status: next } : item));
      if (["cancelled", "completed"].includes(next)) await refreshContacts();
      setNotice(`Status kampanii: ${labels[next]}.`);
    } catch (error) {
      if (backend) {
        try {
          const response = await fetch(`/api/campaigns/${encodeURIComponent(activeCampaignId)}`);
          const result = await response.json();
          if (response.ok && result.data?.campaign?.status === next) {
            setStatus(next);
            setLiveStartConfirmed(false);
            setSeriesStats((current) => current.map((item) => item.id === activeCampaignId ? { ...item, status: next } : item));
            await refreshSeries();
            setNotice(`Status kampanii: ${labels[next]}. Potwierdzenie odpowiedzi backendu było opóźnione.`);
            return;
          }
        } catch {
          // Fall through to the original operational error below.
        }
      }
      setNotice(error instanceof Error ? error.message : "Nie udało się zmienić statusu.");
    }
  }

  async function startCampaign() {
    if (startBlocked) {
      setNotice("Start zablokowany: usuń braki krytyczne z checklisty gotowości.");
      return;
    }
    if (!campaignDryRun && !liveStartConfirmed) {
      setNotice("Przed uruchomieniem LIVE potwierdź checklistę startową.");
      return;
    }
    await transition("start", "active", { confirmLive: !campaignDryRun });
  }

  async function assignCampaignRecipient(companyIndex: number, contactId: string) {
    const company = campaignCompanies[companyIndex];
    if (!activeCampaignId || !company.id) return;
    try {
      const response = await fetch(`/api/recipients/${encodeURIComponent(company.id)}/select`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId: activeCampaignId, contactId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (String(result.data?.contactId || "") !== contactId) throw new Error("Backend nie potwierdził przypisania wybranego kontaktu.");
      await reloadActiveCampaign("recipients");
      await Promise.all([refreshSeries(), refreshContacts()]);
      setNotice("Odbiorca przypisany do kampanii.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się przypisać odbiorcy.");
    }
  }

  async function removeCampaignRecipient(companyIndex: number) {
    const company = campaignCompanies[companyIndex];
    if (!activeCampaignId || !company.id || !window.confirm(`Usunąć ${company.fullName} z tej kampanii?`)) return;
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(activeCampaignId)}/recipients/${encodeURIComponent(company.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await Promise.all([reloadActiveCampaign("recipients"), refreshSeries(), refreshContacts()]);
      setNotice("Odbiorca usunięty z kampanii.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Nie udało się usunąć odbiorcy z kampanii.");
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

  function updateEditingFooter(field: "name" | "html", value: string) {
    setFooterProfiles((current) => current.map((profile) => profile.id === editingFooterId ? { ...profile, [field]: value } : profile));
  }

  function addFooterProfile() {
    if (footerProfiles.length >= 10) {
      setNotice("Możesz utworzyć maksymalnie 10 wersji stopki.");
      return;
    }
    const id = `footer-${crypto.randomUUID()}`;
    setFooterProfiles((current) => [...current, { id, name: `Stopka ${current.length + 1}`, html: defaultFooterHtml }]);
    setEditingFooterId(id);
  }

  function deleteEditingFooter() {
    if (!editingFooter || footerProfiles.length === 1) return;
    if (!window.confirm(`Usunąć stopkę „${editingFooter.name}”? Zapis nie powiedzie się, jeśli używa jej kampania.`)) return;
    const remaining = footerProfiles.filter((profile) => profile.id !== editingFooter.id);
    const nextDefaultId = defaultFooterId === editingFooter.id ? remaining[0].id : defaultFooterId;
    setFooterProfiles(remaining);
    setDefaultFooterId(nextDefaultId);
    setEditingFooterId(nextDefaultId);
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      if (backend) {
        const response = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ footerProfiles, defaultFooterId, dryRun: defaultDryRun, dailyLimit: defaultDailyLimit, sendFrom: defaultSendFrom, sendTo: defaultSendTo, mail2DelayBusinessDays: defaultMail2DelayBusinessDays, mail3DelayBusinessDays: defaultMail3DelayBusinessDays }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        const savedFooters = Array.isArray(result.data.footerProfiles) ? result.data.footerProfiles as FooterProfile[] : footerProfiles;
        setFooterProfiles(savedFooters);
        setDefaultFooterId(String(result.data.defaultFooterId || defaultFooterId));
        if (!savedFooters.some((profile) => profile.id === editingFooterId)) setEditingFooterId(String(result.data.defaultFooterId || savedFooters[0]?.id));
        setDefaultDryRun(Boolean(result.data.dryRun));
        setDefaultDailyLimit(Number(result.data.dailyLimit));
        setDefaultSendFrom(String(result.data.sendFrom));
        setDefaultSendTo(String(result.data.sendTo));
        setDefaultMail2DelayBusinessDays(Number(result.data.mail2DelayBusinessDays));
        setDefaultMail3DelayBusinessDays(Number(result.data.mail3DelayBusinessDays));
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
        <div className="brand"><span className="brand-mark"><Image src="/innova-logo.jpg" alt="InnovaPM" width={64} height={64} priority /></span><div><strong>InnovaPM</strong><small>Mail Campaign</small></div></div>
        <nav aria-label="Nawigacja">{navigation.map((item) => <button type="button" key={item.id} aria-current={view === item.id ? "page" : undefined} className={view === item.id ? "nav active" : "nav"} onClick={() => navigateTo(item.id)}>{item.label}</button>)}</nav>
        <div className="connection"><i className={backend && !backendStatusError ? "online" : ""} />{backendStatusError ? "Apps Script niedostępny" : backend ? "Apps Script połączony" : "Tryb prototypowy"}</div>
      </aside>

      <section className="workspace">
        <header><div><p className="eyebrow">diagnoza · egzekucja · transfer wiedzy</p><h1>{navigation.find((item) => item.id === view)?.label}</h1></div><div className="header-meta"><span>{ownerEmail}</span></div></header>
        {notice && <div className="notice" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Zamknij komunikat">×</button></div>}
        {backendStatusError && <div className="backend-alert" role="alert">{backendStatusError}</div>}

        {initializing && <section className="panel loading-state" aria-live="polite">Pobieram dane aplikacji…</section>}

        {!initializing && view === "dashboard" && <div className="stack">
          <div className="metrics"><Metric label="Kampanie uruchomione" value={String(activeCampaigns)} note={campaignCountLabel(openSeriesStats.length)} /><Metric label="Wymagają decyzji" value={String(actionRequired)} note="Szkic lub do akceptacji" /><Metric label="Wysłane" value={String(openSeriesStats.reduce((sum, item) => sum + item.sent, 0))} note="Łącznie" /><Metric label="Odpowiedzi" value={String(openSeriesStats.reduce((sum, item) => sum + item.replies, 0))} note="Łącznie" /></div>
          <section className="panel action-panel"><SectionTitle eyebrow="Najbliższa decyzja" title={actionRequired ? "Dokończ przygotowanie kampanii" : "Brak kampanii wymagających decyzji"}><button type="button" className="button primary" onClick={() => navigateTo("campaigns")}>Otwórz kampanie</button></SectionTitle><p className="copy">Przejdź kolejno przez odbiorców, treści i kontrolę gotowości. Uruchomienie jest dostępne dopiero po uzupełnieniu wszystkich wymaganych danych.</p></section>
          <div className="columns"><section className="panel"><p className="eyebrow">Baza kontaktów</p><h2>{contacts.length} kontaktów</h2><p className="copy">{contacts.filter((contact) => !contact.currentCampaign && !contact.suppressed).length} osób można przypisać do nowej kampanii.</p><button type="button" className="button" onClick={() => navigateTo("contacts")}>Zarządzaj kontaktami</button></section><section className="panel"><p className="eyebrow">Integracja</p><h2>{backendStatusError ? "Backend niedostępny" : backend ? "Backend gotowy" : "Wymagana konfiguracja"}</h2><p className="copy">{backendStatusError ? "Apps Script nie odpowiedział. Operacje kampanii są zablokowane do czasu przywrócenia połączenia." : backend ? "Połączenie z Apps Script jest aktywne." : "Dane demonstracyjne pozostają wyłącznie lokalne."}</p>{backendStatus && <div className="readiness-grid backend-readiness"><ReadinessItem ready={backendStatus.queueTriggerInstalled} label="Kolejka wysyłki" detail={backendStatus.queueTriggerInstalled ? "runQueue aktywny" : "Brak triggera runQueue"} /><ReadinessItem ready={backendStatus.replyTriggerInstalled} label="Monitoring odpowiedzi" detail={backendStatus.replyTriggerInstalled ? "checkReplies aktywny" : "Brak triggera checkReplies"} /><ReadinessItem ready={backendStatus.senderReady} label="Nadawca" detail={backendStatus.senderReady ? senderStatusDetail(backendStatus) : backendStatus.senderError || "Wymaga autoryzacji"} /></div>}</section></div>
        </div>}

        {!initializing && view === "contacts" && <div className="stack">
          <section className="panel toolbar-panel"><div className="contact-toolbar"><label className="search-field">Szukaj<input type="search" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Imię, firma, stanowisko lub e-mail" /></label><label>Status<select value={contactFilter} onChange={(event) => setContactFilter(event.target.value as ContactFilter)}><option value="all">Wszystkie</option><option value="available">Dostępne</option><option value="campaign">W kampanii</option><option value="history">Po kampanii</option><option value="suppressed">Wykluczone</option></select></label><div className="toolbar-actions"><button type="button" className="button" onClick={() => setShowContactImport((current) => !current)}>{showContactImport ? "Zamknij import" : "Importuj kontakty"}</button><button type="button" className="button primary" onClick={() => setShowAddContact((current) => !current)}>{showAddContact ? "Anuluj dodawanie" : "Dodaj kontakt"}</button></div></div></section>
          {showContactImport && <><ImportPanel kind="contacts" title="Import kontaktów" hint="Dodanie osób do bazy bez tworzenia kampanii" ready={false} onSubmit={(event) => importFile(event, "contacts")} /><ImportSummary result={importKind === "contacts" ? importResult : null} /></>}
          {showAddContact && <section className="panel"><SectionTitle eyebrow="Nowy rekord" title="Dodaj kontakt ręcznie" /><form className="form-grid contact-create-form" key={addFormVersion} onSubmit={addContact}><label>Firma<input name="companyName" required /></label><label>Imię i nazwisko<input name="fullName" required /></label><RoleField /><label>Adres e-mail<input name="email" type="email" required /></label><label>Telefon<input name="phone" /></label><label>LinkedIn<input name="linkedin" type="url" /></label><label className="full">Notatka<textarea name="note" rows={3} /></label><div className="actions full"><button className="button primary">Dodaj kontakt</button><button className="button" type="button" onClick={() => setShowAddContact(false)}>Anuluj</button></div></form></section>}
          <section className="panel contact-list"><SectionTitle title="Kontakty"><span className="hint">{filteredContacts.length} z {contacts.length}</span></SectionTitle>{filteredContacts.length === 0 && <p className="empty-state">Brak kontaktów odpowiadających filtrom.</p>}{filteredContacts.map((contact) => {
            const editing = contact.id === editingContactId;
            const assigning = contact.id === campaignFormContactId;
            const contactStatus = contact.suppressed ? "Wykluczony" : contact.currentCampaign ? `${labels[contact.currentCampaign.status]}: ${contact.currentCampaign.name}` : contact.campaignHistory.length ? "Po kampanii" : "Dostępny";
            return <article className="contact" key={contact.id}>
              {!editing && <><div className="contact-main"><span className="avatar">{initials(contact.fullName)}</span><span><strong>{contact.fullName}</strong><small>{contact.role} · {contact.companyName}</small><small>{contact.email}</small></span><span className={`contact-status ${contact.suppressed ? "suppressed" : ""}`}>{contactStatus}</span></div><div className="contact-actions"><button className="button compact primary" type="button" disabled={contact.suppressed || Boolean(contact.currentCampaign)} onClick={() => { setCampaignFormContactId(assigning ? null : contact.id ?? null); setCampaignMode("new"); }}>Dodaj do kampanii</button>{contact.currentCampaign && <button className="button compact" type="button" disabled={busyContactId === contact.id} onClick={() => removeContactFromCampaign(contact)}>Usuń z kampanii</button>}<button className="button compact" type="button" onClick={() => setEditingContactId(contact.id ?? null)}>Edytuj</button><button className="button compact danger" type="button" disabled={busyContactId === contact.id} onClick={() => deleteContact(contact)}>Usuń</button></div></>}
              {assigning && !editing && <form className="campaign-assign-form" onSubmit={(event) => assignContact(event, contact)}><div className="mode-switch"><button type="button" className={campaignMode === "new" ? "active" : ""} onClick={() => setCampaignMode("new")}>Nowa kampania</button><button type="button" className={campaignMode === "existing" ? "active" : ""} onClick={() => setCampaignMode("existing")}>Istniejąca kampania</button></div>{campaignMode === "new" ? <label>Nazwa nowej kampanii<input name="name" required minLength={2} placeholder={`${contact.companyName} — kampania`} /></label> : <label>Kampania<select name="campaignId" required defaultValue=""><option value="" disabled>Wybierz kampanię</option>{openSeriesStats.filter((series) => ["draft", "needs_review"].includes(series.status)).map((series) => <option key={series.id} value={series.id}>{series.name}</option>)}</select></label>}<div className="actions"><button className="button primary" disabled={busyContactId === contact.id}>Dodaj i otwórz kampanię</button><button className="button" type="button" onClick={() => setCampaignFormContactId(null)}>Anuluj</button></div></form>}
              {editing && <form className="contact-edit-form" onSubmit={(event) => saveContact(event, contact)}><label>Firma<input name="companyName" required minLength={2} defaultValue={contact.companyName} /></label><label>Imię i nazwisko<input name="fullName" required minLength={3} defaultValue={contact.fullName} /></label><RoleField key={contact.id} defaultValue={contact.role} /><label>Adres e-mail<input name="email" type="email" required defaultValue={contact.email} /></label><label>Telefon<input name="phone" defaultValue={contact.phone} /></label><label>LinkedIn<input name="linkedin" type="url" defaultValue={contact.linkedin} /></label><label className="full">Notatka<textarea name="note" rows={2} defaultValue={contact.note} /></label><div className="actions full"><button className="button primary" disabled={busyContactId === contact.id}>Zapisz</button><button className="button" type="button" onClick={() => setEditingContactId(null)}>Anuluj</button></div></form>}
            </article>;
          })}</section>
        </div>}

        {!initializing && view === "campaigns" && !activeCampaignId && <div className="stack">
          <section className="panel action-panel"><SectionTitle eyebrow="Kampanie" title="Zarządzaj wysyłką"><button type="button" className="button primary" onClick={() => setShowCampaignImport((current) => !current)}>{showCampaignImport ? "Zamknij import" : "Importuj nową kampanię"}</button></SectionTitle><p className="copy">Jedna kampania łączy odbiorców, trzy serie wiadomości, harmonogram i wyniki.</p></section>
          {showCampaignImport && <><ImportPanel kind="campaign" title="Import kampanii XLSX/CSV" hint="Jeden plik: kampania, kontakt i Seria 1 / 2 / 3" ready={campaignImportReady} onFileChange={() => { setCampaignImportReady(false); if (importKind === "campaign") setImportResult(null); }} onSubmit={(event) => importFile(event, "campaign")} /><ImportSummary result={importKind === "campaign" ? importResult : null} /></>}
          <section className="panel registry"><SectionTitle eyebrow="Rejestr kampanii" title="Nazwa kampanii"><span className="hint">{campaignCountLabel(visibleCampaignStats.length)}</span></SectionTitle><div className="campaign-filter-tabs mode-switch" aria-label="Filtr kampanii"><button type="button" className={campaignArchiveFilter === "active" ? "active" : ""} onClick={() => setCampaignArchiveFilter("active")}>Aktywne ({openSeriesStats.length})</button><button type="button" className={campaignArchiveFilter === "archived" ? "active" : ""} onClick={() => setCampaignArchiveFilter("archived")}>Zarchiwizowane ({archivedSeriesStats.length})</button><button type="button" className={campaignArchiveFilter === "all" ? "active" : ""} onClick={() => setCampaignArchiveFilter("all")}>Wszystkie ({seriesStats.length})</button></div>{visibleCampaignStats.length ? <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Nazwa kampanii</th><th>Status</th><th>Firmy</th><th>Odbiorcy</th><th>Aktualizacja</th><th>Archiwizacja</th><th>Akcje</th></tr></thead><tbody>{visibleCampaignStats.map((series) => <tr key={series.id}><td><strong>{series.name}</strong></td><td><span className={`pill ${series.archivedAt ? "status-archived" : `status-${series.status}`}`}>{series.archivedAt ? "Zarchiwizowana" : labels[series.status]}</span></td><td>{series.companies}</td><td>{series.recipients}</td><td>{formatDate(series.updatedAt)}</td><td>{series.archivedAt ? formatDate(series.archivedAt) : "—"}</td><td><div className="table-actions">{series.archivedAt ? <button type="button" className="button compact primary" onClick={() => restoreArchivedCampaign(series)}>Przywróć</button> : <><button type="button" className="button compact primary" onClick={() => loadCampaign(series.id)}>Otwórz</button>{["active", "paused"].includes(series.status) && <button type="button" className="button compact danger" onClick={() => cancelCampaignFromRegistry(series)}>Anuluj</button>}<button type="button" className="button compact danger" onClick={() => deleteCampaign(series)}>{series.sent > 0 ? "Archiwizuj" : "Usuń"}</button></>}</div></td></tr>)}</tbody></table></div> : <p className="empty-state">{campaignArchiveFilter === "archived" ? "Brak zarchiwizowanych kampanii." : "Brak utworzonych kampanii. Zaimportuj pierwszy plik kampanii."}</p>}</section>
        </div>}

        {!initializing && view === "monitoring" && <div className="stack">
          <div className="metrics results"><Metric label="Wysłane" value={String(monitoringStats.reduce((sum, item) => sum + item.sent, 0))} note="Łącznie" /><Metric label="Otwarte" value={String(monitoringStats.reduce((sum, item) => sum + item.opened, 0))} note={rate(monitoringStats.reduce((sum, item) => sum + item.opened, 0), monitoringStats.reduce((sum, item) => sum + item.sent, 0))} /><Metric label="Odpowiedzi" value={String(monitoringStats.reduce((sum, item) => sum + item.replies, 0))} note={rate(monitoringStats.reduce((sum, item) => sum + item.replies, 0), monitoringStats.reduce((sum, item) => sum + item.recipients, 0))} /><Metric label="Odbicia" value={String(monitoringStats.reduce((sum, item) => sum + item.bounces, 0))} note={rate(monitoringStats.reduce((sum, item) => sum + item.bounces, 0), monitoringStats.reduce((sum, item) => sum + item.sent, 0))} /></div>
          <AggregateMonitoringPie seriesStats={monitoringStats} />
          <section className="panel registry"><SectionTitle eyebrow="Monitoring" title="Wyniki kampanii"><span className="hint">{campaignCountLabel(monitoringStats.length)}</span></SectionTitle>{monitoringStats.length ? <div className="registry-table-wrap"><table className="registry-table monitoring-table"><thead><tr><th>Kampania</th><th>Status</th><th>Odbiorcy</th><th>Wysłane</th><th>Otwarte</th><th>Odpowiedzi</th><th>Bounce</th><th>Akcje</th></tr></thead><tbody>{monitoringStats.map((series) => <CampaignMonitoringRows key={series.id} series={series} onOpen={() => loadCampaign(series.id)} />)}</tbody></table></div> : <p className="empty-state">Brak kampanii do monitorowania.</p>}</section>
        </div>}

        {!initializing && view === "campaigns" && activeCampaignId && <div className="stack">
          <section className="panel campaign-head"><button type="button" className="back-link" onClick={() => { setActiveCampaignId(null); setCampaignTab("summary"); }}>← Wszystkie kampanie</button><SectionTitle eyebrow="Szczegóły kampanii" title={seriesName}><div className="series-title-actions"><b className={`pill ${isArchivedCampaign ? "status-archived" : `status-${status}`}`}>{isArchivedCampaign ? "Zarchiwizowana" : labels[status]}</b>{isArchivedCampaign ? <button type="button" className="button compact primary" onClick={restoreCampaign}>Przywróć do akceptacji</button> : <button type="button" className="button compact" onClick={() => setEditingSeriesName((current) => !current)}>{editingSeriesName ? "Anuluj" : "Zmień nazwę"}</button>}</div></SectionTitle>{isArchivedCampaign && <p className="archive-note">Archiwum tylko do odczytu. Możesz przeglądać odbiorców, treści i wyniki, ale edycja oraz wysyłka są zablokowane.</p>}{editingSeriesName && !isArchivedCampaign && <form className="series-name-form" onSubmit={saveSeriesName}><label>Nazwa kampanii<input name="seriesName" required minLength={2} defaultValue={seriesName} /></label><button className="button primary" disabled={savingSeriesName}>Zapisz nazwę</button></form>}<div className="campaign-tabs" role="tablist" aria-label="Szczegóły kampanii">{campaignTabs.map((tab) => <button type="button" id={`tab-${tab.id}`} aria-controls={`panel-${tab.id}`} role="tab" aria-selected={campaignTab === tab.id} className={campaignTab === tab.id ? "active" : ""} key={tab.id} onClick={() => setCampaignTab(tab.id)}>{tab.label}{tab.id === "sequence" && dirtyMessageKeys.size > 0 ? ` (${dirtyMessageKeys.size})` : ""}</button>)}</div></section>

          {campaignTab === "summary" && <div id="panel-summary" role="tabpanel" aria-labelledby="tab-summary" className="stack"><section className="panel"><SectionTitle eyebrow="Kontrola gotowości" title={isArchivedCampaign ? "Kampania w archiwum" : readiness.ready ? "Kampania kompletna" : "Uzupełnij kampanię przed akceptacją"}><b className={isArchivedCampaign ? "pill status-archived" : readiness.ready ? "pill" : "pill warning"}>{isArchivedCampaign ? "Tylko podgląd" : readiness.ready ? "Gotowa" : "Wymaga pracy"}</b></SectionTitle><div className="readiness-grid"><ReadinessItem ready={campaignCompanies.length > 0} label="Firmy" detail={`${campaignCompanies.length} rekordów`} /><ReadinessItem ready={readiness.recipientsReady === readiness.recipientsTotal && readiness.recipientsTotal > 0} label="Odbiorcy" detail={`${readiness.recipientsReady} z ${readiness.recipientsTotal} przypisanych`} /><ReadinessItem ready={readiness.incompleteMessages === 0 && campaignCompanies.length > 0} label="Treści" detail={readiness.incompleteMessages ? `${readiness.incompleteMessages} wiadomości do uzupełnienia` : "3 serie wiadomości na odbiorcę"} /><ReadinessItem ready={Boolean(campaignFooterHtml.trim())} label="Stopka" detail={campaignFooterHtml.trim() ? campaignFooter?.name || "Skonfigurowana" : "Brak stopki"} /></div><section className="preflight-card"><SectionTitle eyebrow="Przed uruchomieniem" title="Bezpieczny start wysyłki"><b className={campaignDryRun ? "pill warning" : "pill danger"}>{startModeText}</b></SectionTitle><div className="preflight-grid">{startChecks.map((check) => <ReadinessItem key={check.label} ready={check.ready} label={check.label} detail={check.detail} />)}</div><div className="preflight-summary"><span><strong>Harmonogram:</strong> start {campaignStartDate}, {campaignSendFrom}–{campaignSendTo}, limit {campaignDailyLimit}/dzień, seria 2 po {campaignMail2DelayBusinessDays} dniach roboczych, seria 3 po {campaignMail3DelayBusinessDays} dniach roboczych.</span>{!campaignDryRun && !isArchivedCampaign && <label className="confirm-live"><input type="checkbox" checked={liveStartConfirmed} onChange={(event) => setLiveStartConfirmed(event.target.checked)} />Potwierdzam start LIVE do realnych odbiorców po kontroli danych i treści.</label>}</div></section>{isArchivedCampaign ? <p className="archive-note">Ta kampania została zarchiwizowana {formatDate(activeCampaignArchivedAt)}. Akcje operacyjne są niedostępne.</p> : <div className="primary-workflow-action">{status === "draft" && <button type="button" className="button primary" disabled={!readiness.ready} onClick={() => transition("review", "needs_review")}>Przekaż do akceptacji</button>}{status === "needs_review" && <button type="button" className="button primary" disabled={!readiness.ready} onClick={() => transition("approve", "approved")}>Zatwierdź kampanię</button>}{status === "approved" && <button type="button" className="button primary" disabled={startBlocked || (!campaignDryRun && !liveStartConfirmed)} onClick={startCampaign}>Uruchom kampanię</button>}{status === "active" && <button type="button" className="button" onClick={() => transition("pause", "paused")}>Wstrzymaj</button>}{status === "paused" && <button type="button" className="button primary" onClick={() => transition("resume", "active")}>Wznów</button>}{["approved", "active", "paused"].includes(status) && <button type="button" className="button primary" onClick={prepareCampaignForCorrection}>Przejdź do korekty ustawień</button>}{status === "cancelled" && <button type="button" className="button primary" onClick={reopenCancelledCampaign}>Przywróć do korekty</button>}{status !== "active" && status !== "paused" && status !== "cancelled" && <button type="button" className="button danger" onClick={clearCampaignActivity}>Wyczyść aktywność</button>}{startBlocked && status === "approved" && <span className="hint">Start zablokowany: uzupełnij pozycje oznaczone „!”.</span>}{!readiness.ready && ["draft", "needs_review"].includes(status) && <span className="hint">Najpierw przypisz odbiorców i uzupełnij wszystkie wiadomości.</span>}{!["completed", "cancelled"].includes(status) && <button type="button" className="button danger" onClick={() => transition("cancel", "cancelled")}>Anuluj kampanię</button>}</div>}</section>
            <section className="panel"><SectionTitle eyebrow="Ta kampania" title="Ustawienia wysyłki"><span className="hint">{isArchivedCampaign ? "Tylko podgląd" : "Edycja przed zatwierdzeniem"}</span></SectionTitle><form className="campaign-settings-form" onSubmit={saveCampaignSettings}><label className="toggle"><span><strong>Tryb testowy</strong><small>Wiadomości trafiają wyłącznie do właściciela; kolejne maile testowe idą co godzinę.</small></span><input type="checkbox" checked={campaignDryRun} disabled={!backend || isArchivedCampaign || !["draft", "needs_review"].includes(status)} onChange={(event) => { setCampaignDryRun(event.target.checked); setLiveStartConfirmed(false); }} /></label><label>Stopka kampanii<select value={campaignFooterId} disabled={isArchivedCampaign || !["draft", "needs_review"].includes(status)} onChange={(event) => setCampaignFooterId(event.target.value)}>{footerProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.id === defaultFooterId ? " — domyślna" : ""}</option>)}</select></label>{!["draft", "needs_review"].includes(status) && ["approved", "active", "paused"].includes(status) && !isArchivedCampaign && <p className="hint">Wybór stopki jest zablokowany po zatwierdzeniu. Użyj „Przejdź do korekty ustawień”, wybierz stopkę i ponownie zatwierdź kampanię.</p>}{!["draft", "needs_review"].includes(status) && !["approved", "active", "paused"].includes(status) && <p className="hint">W tej kampanii stopka jest dostępna tylko do odczytu.</p>}<label>Data startu kampanii<input type="date" min={todayInWarsaw()} value={campaignStartDate} disabled={isArchivedCampaign || !["draft", "needs_review"].includes(status)} onChange={(event) => { setCampaignStartDate(event.target.value); setLiveStartConfirmed(false); }} /></label><label>Seria 2 po dniach roboczych<input type="number" min={0} max={30} value={campaignMail2DelayBusinessDays} disabled={isArchivedCampaign || !["draft", "needs_review"].includes(status)} onChange={(event) => setCampaignMail2DelayBusinessDays(Number(event.target.value))} /></label><label>Seria 3 po dniach roboczych<input type="number" min={0} max={30} value={campaignMail3DelayBusinessDays} disabled={isArchivedCampaign || !["draft", "needs_review"].includes(status)} onChange={(event) => setCampaignMail3DelayBusinessDays(Number(event.target.value))} /></label><label>Limit dzienny<input type="number" min={1} max={MAX_DAILY_LIMIT} value={campaignDailyLimit} disabled={isArchivedCampaign || !["draft", "needs_review"].includes(status)} onChange={(event) => setCampaignDailyLimit(Number(event.target.value))} /></label><label>Od<input type="time" value={campaignSendFrom} disabled={isArchivedCampaign || !["draft", "needs_review"].includes(status)} onChange={(event) => setCampaignSendFrom(event.target.value)} /></label><label>Do<input type="time" value={campaignSendTo} disabled={isArchivedCampaign || !["draft", "needs_review"].includes(status)} onChange={(event) => setCampaignSendTo(event.target.value)} /></label><p className="hint">Jeśli wybrana data wypada w weekend, pierwsza wysyłka przejdzie na najbliższy dzień roboczy.</p>{campaignDryRun && !isArchivedCampaign && <p className="hint">W trybie testowym trzy serie maili w kampanii są planowane w odstępach godzinowych. Ustaw okno wysyłki minimum na 3 godziny, np. 09:00–12:00.</p>}{!isArchivedCampaign && <button className="button primary" disabled={savingCampaignSettings || !["draft", "needs_review"].includes(status)}>Zapisz ustawienia kampanii</button>}</form></section>
            <CompanyDataList companies={campaignCompanies} status={status} archived={isArchivedCampaign} editingIndex={editingCompanyIndex} busyIndex={busyCompanyIndex} setEditing={setEditingCompanyIndex} onSave={saveCampaignCompany} onRemove={removeCampaignCompany} onTransition={transition} />
          </div>}

          {campaignTab === "recipients" && <div id="panel-recipients" role="tabpanel" aria-labelledby="tab-recipients"><RecipientList companies={campaignCompanies} status={status} archived={isArchivedCampaign} onAssign={assignCampaignRecipient} onRemove={removeCampaignRecipient} onSaveContact={saveCampaignRecipientContact} onOpenContacts={() => navigateTo("contacts")} /></div>}

          {campaignTab === "sequence" && <div id="panel-sequence" role="tabpanel" aria-labelledby="tab-sequence" className="stack"><section className="panel"><SectionTitle eyebrow="Serie maili w kampanii" title={selectedSequenceCompany?.fullName || "Wybierz odbiorcę"}><span className="hint">{selectedSequenceCompany?.companyName}</span></SectionTitle>{campaignCompanies.length > 0 && <div className="sequence-toolbar"><label>Odbiorca<select value={String(selectedSequenceIndex)} onChange={(event) => setSelectedSequenceIndex(Number(event.target.value))}>{campaignCompanies.map((company, index) => <option key={company.id ?? `${company.companyName}-${index}`} value={index}>{index + 1}. {company.fullName || "Brak odbiorcy"} — {company.role || "brak stanowiska"} — {company.companyName}</option>)}</select></label><div className="sequence-navigation"><button type="button" className="button compact" disabled={selectedSequenceIndex === 0} onClick={() => setSelectedSequenceIndex((current) => current - 1)}>Poprzedni</button><span>{selectedSequenceIndex + 1} / {campaignCompanies.length}</span><button type="button" className="button compact" disabled={selectedSequenceIndex >= campaignCompanies.length - 1} onClick={() => setSelectedSequenceIndex((current) => current + 1)}>Następny</button></div></div>}</section>{selectedSequenceCompany && selectedSequenceCompany.hasActiveRecipient === true ? <><div className="sequence">{([1, 2, 3] as const).map((step, index) => { const emailKey = `email${step}` as "email1" | "email2" | "email3"; const message = parseCampaignMessage(selectedSequenceCompany[emailKey]); const saveKey = `${selectedSequenceIndex}-${step}`; const dirty = dirtyMessageKeys.has(saveKey); return <section className="panel editor" key={saveKey}><div className="message-title"><b>{initialMessages[index].day}</b><strong>Seria {step}</strong>{dirty && <span className="unsaved">Niezapisane zmiany</span>}</div><label>Temat<input value={message.subject} readOnly={isArchivedCampaign} onChange={(event) => editCampaignMessage(selectedSequenceIndex, step, "subject", event.target.value)} /></label><label>Treść<textarea rows={12} value={message.body} readOnly={isArchivedCampaign} onChange={(event) => editCampaignMessage(selectedSequenceIndex, step, "body", event.target.value)} /></label><div className="editor-meta"><small>{message.body.length} znaków</small><small>{selectedSequenceCompany.email}</small></div><details className="message-preview"><summary>Podgląd finalnej wiadomości</summary><iframe title={`Podgląd serii ${step}`} sandbox="" srcDoc={messagePreviewHtml(message.body, campaignFooterHtml)} /></details>{!isArchivedCampaign && <button type="button" className="button" disabled={savingMessageKey === saveKey} onClick={() => saveCampaignMessage(selectedSequenceIndex, step)}>Zapisz serię {step}</button>}</section>; })}</div>{!isArchivedCampaign && <div className="save-all-bar"><span>{dirtyMessageKeys.size ? `${dirtyMessageKeys.size} niezapisanych zmian w kampanii` : "Wszystkie zmiany zapisane"}</span><button type="button" className="button primary" disabled={savingAllMessages} onClick={saveAllCampaignMessages}>Zapisz wszystkie serie maili</button></div>}</> : <section className="panel blocked-state"><h2>Najpierw przypisz odbiorcę</h2><p className="copy">Firma ma przygotowane wiadomości, ale żadna osoba nie jest aktywnym odbiorcą tej kampanii.</p><button type="button" className="button primary" onClick={() => setCampaignTab("recipients")}>Przejdź do odbiorców</button></section>}</div>}

        </div>}

        {view === "settings" && <div className="settings">
          <section className="panel setting">
            <p className="eyebrow">Domyślne dla nowych kampanii</p>
            <h2>Bezpieczeństwo wysyłki</h2>
            <label className="toggle"><span><strong>Tryb testowy</strong><small>Wiadomości wyłącznie do właściciela</small></span><input type="checkbox" checked={defaultDryRun} onChange={(event) => setDefaultDryRun(event.target.checked)} /></label>
            <label>Autoryzowany nadawca<input value={ownerEmail} readOnly /></label>
          </section>
          <section className="panel setting footer-setting">
            <SectionTitle eyebrow="Podpis i rezygnacja" title="Wersje stopki HTML"><span className="hint">Do 10 wersji · 20 000 znaków każda</span></SectionTitle>
            <div className="footer-profile-toolbar">
              <label>Edytowana wersja<select value={editingFooterId} onChange={(event) => setEditingFooterId(event.target.value)}>{footerProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.id === defaultFooterId ? " — domyślna" : ""}</option>)}</select></label>
              <label>Nazwa stopki<input required maxLength={80} value={editingFooter?.name ?? ""} onChange={(event) => updateEditingFooter("name", event.target.value)} /></label>
              <div className="footer-profile-actions">
                <button type="button" className="button" onClick={addFooterProfile}>Nowa stopka</button>
                <button type="button" className="button" disabled={!editingFooter || editingFooter.id === defaultFooterId} onClick={() => editingFooter && setDefaultFooterId(editingFooter.id)}>Ustaw jako domyślną</button>
                <button type="button" className="button danger" disabled={footerProfiles.length === 1} onClick={deleteEditingFooter}>Usuń stopkę</button>
              </div>
            </div>
            <div className="footer-editor">
              <label>Kod HTML<textarea className="code-editor" rows={14} spellCheck={false} value={editingFooter?.html ?? ""} onChange={(event) => updateEditingFooter("html", event.target.value)} /></label>
              <div className="footer-preview"><span>Podgląd stopki</span><iframe title="Podgląd stopki HTML" sandbox="" srcDoc={editingFooter?.html ?? ""} /></div>
            </div>
            <div className="actions">
              <button type="button" className="button primary" disabled={savingSettings} onClick={saveSettings}>Zapisz wszystkie ustawienia</button>
              <button type="button" className="button" onClick={() => updateEditingFooter("html", defaultFooterHtml)}>Przywróć wzór stopki</button>
            </div>
          </section>
        </div>}
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
  const fields = kind === "campaign" ? [["seriesName", "Kampania"], ["companyName", "Firma"], ["fullName", "Imię i nazwisko"], ["role", "Stanowisko"], ["email", "Adres e-mail"], ["email1", "Seria 1"], ["email2", "Seria 2"], ["email3", "Seria 3"]] : [["companyName", "Nazwa firmy"], ["fullName", "Imię i nazwisko"], ["role", "Stanowisko"], ["email", "Adres e-mail"]];
  return <section className="panel"><SectionTitle eyebrow="Źródło danych" title={title}><span className="hint">{hint}</span></SectionTitle><form className="import-form" onSubmit={onSubmit}><div className="import"><input type="file" name="file" accept=".xlsx,.csv" required onChange={onFileChange} /><div className="import-actions"><button className="button primary" name="action" value="preview">Sprawdź plik</button>{kind === "campaign" && <button className="button" name="action" value="commit" disabled={!ready}>Utwórz kampanię/kampanie</button>}{kind === "contacts" && <button className="button" name="action" value="commit">Importuj kontakty</button>}</div></div><details><summary>Ręczne mapowanie kolumn</summary><div className="mapping">{fields.map(([key, label]) => <label key={key}>{label}<input name={`mapping.${key}`} placeholder={`Kolumna: ${label}`} /></label>)}</div></details>{kind === "campaign" && <p className="import-step-hint">Najpierw sprawdź plik. Po poprawnej walidacji odblokuje się utworzenie kampanii.</p>}</form></section>;
}

function RecipientList({ companies, status, archived, onAssign, onRemove, onSaveContact, onOpenContacts }: { companies: CampaignCompany[]; status: CampaignStatus; archived: boolean; onAssign: (index: number, contactId: string) => Promise<void>; onRemove: (index: number) => Promise<void>; onSaveContact: (event: FormEvent<HTMLFormElement>, index: number) => Promise<void>; onOpenContacts: () => void }) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [assigningIndex, setAssigningIndex] = useState<number | null>(null);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const canChangeAssignment = !archived && ["draft", "needs_review"].includes(status);
  const canEditContact = !archived && !["completed", "cancelled"].includes(status);
  const activeCount = companies.filter((company) => company.hasActiveRecipient !== false && company.contactId).length;

  async function assign(index: number, selectedContactId: string) {
    if (!selectedContactId) return;
    setBusyIndex(index);
    await onAssign(index, selectedContactId);
    setBusyIndex(null);
    setAssigningIndex(null);
  }

  return <section className="panel recipient-list"><SectionTitle eyebrow="Osoby objęte kampanią" title="Odbiorcy"><span className="hint">{activeCount} z {companies.length} przypisanych</span></SectionTitle>{companies.length === 0 && <p className="empty-state">Brak firm i odbiorców w kampanii.</p>}{companies.length > 0 && <div className="recipient-table" role="table" aria-label="Odbiorcy kampanii"><div className="recipient-row recipient-header" role="row"><span role="columnheader">Imię i nazwisko</span><span role="columnheader">Stanowisko</span><span role="columnheader">Adres e-mail</span><span role="columnheader">Firma</span><span role="columnheader">Aktywność</span><span role="columnheader">Status</span><span role="columnheader">Akcje</span></div>{companies.map((company, index) => {
    const active = company.hasActiveRecipient !== false && Boolean(company.contactId);
    const editing = editingIndex === index;
    const assigning = assigningIndex === index;
    const defaultCandidateId = company.contactId || company.candidateContacts?.[0]?.id || "";
    return <div className={`recipient-row ${active ? "" : "missing"}`} role="row" key={company.id ?? `${company.companyName}-${index}`}><span role="cell" data-label="Imię i nazwisko"><strong>{company.fullName || "Brak przypisanej osoby"}</strong></span><span role="cell" data-label="Stanowisko">{company.role || "—"}</span><span role="cell" data-label="Adres e-mail">{company.email || "—"}</span><span role="cell" data-label="Firma">{company.companyName}</span><span role="cell" data-label="Aktywność"><RecipientActivityBadges activity={company.activity} /></span><span role="cell" data-label="Status"><b className={active ? "pill" : "pill status-failed"}>{active ? "Przypisany" : "Brak odbiorcy"}</b></span><span role="cell" data-label="Akcje" className="recipient-actions">{active && canEditContact && <button type="button" className="button compact" onClick={() => { setEditingIndex(editing ? null : index); setAssigningIndex(null); }}>{editing ? "Anuluj" : "Edytuj"}</button>}{canChangeAssignment && <button type="button" className="button compact" onClick={() => { setAssigningIndex(assigning ? null : index); setEditingIndex(null); }}>{active ? "Zmień" : "Przypisz"}</button>}{active && canChangeAssignment && <button type="button" className="button compact danger" onClick={() => onRemove(index)}>Usuń z kampanii</button>}</span>{editing && active && <form className="recipient-inline-form" onSubmit={async (event) => { setBusyIndex(index); await onSaveContact(event, index); setBusyIndex(null); setEditingIndex(null); }}><label>Imię i nazwisko<input name="fullName" required minLength={3} defaultValue={company.fullName} /></label><RoleField key={company.contactId} defaultValue={company.role} /><label>Adres e-mail<input name="email" type="email" required defaultValue={company.email} /></label><div className="actions"><button className="button primary" disabled={busyIndex === index}>Zapisz odbiorcę</button><button type="button" className="button" onClick={() => setEditingIndex(null)}>Anuluj</button></div></form>}{assigning && <form className="recipient-assign-form" onSubmit={async (event) => { event.preventDefault(); const formData = new FormData(event.currentTarget); await assign(index, String(formData.get("contactId") || defaultCandidateId)); }}>{company.candidateContacts?.length ? <><label>Kontakt z firmy<select name="contactId" required defaultValue={defaultCandidateId}><option value="" disabled>Wybierz osobę</option>{company.candidateContacts.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.fullName} — {candidate.role} — {candidate.email}</option>)}</select></label><div className="actions"><button className="button primary" disabled={!defaultCandidateId || busyIndex === index}>Zapisz przypisanie</button><button type="button" className="button" onClick={() => setAssigningIndex(null)}>Anuluj</button></div></> : <div className="empty-inline"><span>Brak kontaktów dla tej firmy.</span><button type="button" className="button" onClick={onOpenContacts}>Dodaj kontakt</button></div>}</form>}</div>;
  })}</div>}</section>;
}

function CompanyDataList({ companies, status, archived, editingIndex, busyIndex, setEditing, onSave, onRemove, onTransition }: { companies: CampaignCompany[]; status: CampaignStatus; archived: boolean; editingIndex: number | null; busyIndex: number | null; setEditing: (value: number | null) => void; onSave: (event: FormEvent<HTMLFormElement>, index: number) => void; onRemove: (index: number) => Promise<void>; onTransition: (action: string, next: CampaignStatus) => void }) {
  const canRemove = !archived && ["draft", "needs_review", "active", "paused"].includes(status);
  return <section className="panel company-list"><SectionTitle eyebrow="Dane pomocnicze" title="Firmy w kampanii"><div className="company-list-status"><span className="hint">{companies.length} rekordów</span><b className={`pill ${archived ? "status-archived" : `status-${status}`}`}>{archived ? "Zarchiwizowana" : labels[status]}</b>{!archived && status === "approved" && <button type="button" className="button compact primary" onClick={() => onTransition("start", "active")}>Uruchom</button>}{!archived && status === "active" && <button type="button" className="button compact" onClick={() => onTransition("pause", "paused")}>Wstrzymaj kampanię</button>}{!archived && status === "paused" && <button type="button" className="button compact primary" onClick={() => onTransition("resume", "active")}>Wznów kampanię</button>}</div></SectionTitle>{companies.map((company, index) => { const editing = editingIndex === index; return <article className="company-row" key={company.id ?? `${company.companyName}-${index}`}><div className="company-summary"><div className="company-toggle"><span><strong>{company.companyName}</strong><small>{company.sector || "Brak sektora"} · {company.packageName || "Brak pakietu"}</small></span></div>{!archived && <div className="company-summary-actions"><button type="button" className="button compact" onClick={() => setEditing(editing ? null : index)}>{editing ? "Anuluj" : "Edytuj firmę"}</button>{canRemove && <button type="button" className="button compact danger" disabled={busyIndex === index} onClick={() => onRemove(index)}>Usuń firmę</button>}</div>}</div>{editing && <form className="company-edit-form" onSubmit={(event) => onSave(event, index)}><label>Nazwa firmy<input name="companyName" required minLength={2} defaultValue={company.companyName} /></label><label>Sektor<input name="sector" defaultValue={company.sector} /></label><label>Trigger<input name="trigger" defaultValue={company.trigger} /></label><label>Pakiet<input name="packageName" defaultValue={company.packageName} /></label><label className="full">Źródło<input name="source" defaultValue={company.source} /></label><div className="actions full"><button className="button primary" disabled={busyIndex === index}>Zapisz</button><button type="button" className="button" onClick={() => setEditing(null)}>Anuluj</button></div></form>}</article>; })}</section>;
}

function ReadinessItem({ ready, label, detail }: { ready: boolean; label: string; detail: string }) { return <div className={ready ? "readiness-item ready" : "readiness-item"}><span aria-hidden="true">{ready ? "✓" : "!"}</span><div><strong>{label}</strong><small>{detail}</small></div></div>; }
function RecipientActivityBadges({ activity }: { activity?: RecipientActivity }) {
  const sent = normalizedSteps(activity?.sentSteps);
  const opened = normalizedSteps(activity?.openedSteps);
  const hasAny = sent.length > 0 || opened.length > 0 || activity?.replied || activity?.bounced;
  if (!hasAny) return <span className="activity-empty">Brak zdarzeń</span>;
  return <span className="recipient-activity"><b className="activity-badge sent">Wysłane {sent.length ? sent.join("/") : "—"}</b><b className="activity-badge opened">Otwarte {opened.length ? opened.join("/") : "—"}</b>{activity?.replied && <b className="activity-badge replied">Odpowiedź</b>}{activity?.bounced && <b className="activity-badge bounced">Bounce</b>}</span>;
}
function AggregateMonitoringPie({ seriesStats }: { seriesStats: SeriesStats[] }) {
  const sent = seriesStats.reduce((sum, item) => sum + item.sent, 0);
  const opened = seriesStats.reduce((sum, item) => sum + item.opened, 0);
  const replies = seriesStats.reduce((sum, item) => sum + item.replies, 0);
  const bounces = seriesStats.reduce((sum, item) => sum + item.bounces, 0);
  return <MonitoringPieCard eyebrow="Aktywność" items={monitoringItems(sent, opened, replies, bounces)} denominator={sent} featured />;
}
function CampaignMonitoringRows({ series, onOpen }: { series: SeriesStats; onOpen: () => void }) {
  return <><tr className="monitoring-row" tabIndex={0}><td><strong>{series.name}</strong></td><td><span className={`pill status-${series.status}`}>{labels[series.status]}</span></td><td>{series.recipients}</td><td>{series.sent}</td><td>{series.opened} <small>{rate(series.opened, series.sent)}</small></td><td>{series.replies} <small>{rate(series.replies, series.recipients)}</small></td><td>{series.bounces} <small>{rate(series.bounces, series.sent)}</small></td><td><button type="button" className="button compact primary" onClick={onOpen}>Otwórz kampanię</button></td></tr><tr className="monitoring-detail-row"><td colSpan={8}><SeriesEffectivenessBars series={series} /></td></tr></>;
}
function SeriesEffectivenessBars({ series }: { series: SeriesStats }) {
  const steps = sequenceSteps(series);
  const maxValue = Math.max(1, ...steps.flatMap((step) => [step.opened, step.replies, step.bounces]));
  return <article className="series-bar-panel"><div className="series-bar-head"><div><p className="eyebrow">Skuteczność serii</p><h3>{series.name}</h3></div><span>{series.sent} wysłanych</span></div><div className="mail-bar-grid">{steps.map((step) => <StepBarCard key={`${series.id}-${step.step}`} step={step} maxValue={maxValue} />)}</div></article>;
}
function StepBarCard({ step, maxValue }: { step: SeriesStepStats; maxValue: number }) {
  return <div className="mail-bar-card"><h4>Seria {step.step}</h4><div className="vertical-bars">{barItems(step).map((item) => <div className="vertical-bar" key={item.label}><strong>{item.value}</strong><div className="vertical-track"><i style={{ height: `${Math.max(4, (item.value / maxValue) * 100)}%`, background: item.color }} /></div><span>{item.label}</span><small>{rate(item.value, step.sent)}</small></div>)}</div><small>{step.sent} wysłanych</small></div>;
}
function MonitoringPieCard({ eyebrow, title, items, denominator, featured = false }: { eyebrow: string; title?: string; items: PieItem[]; denominator: number; featured?: boolean }) {
  const activeTotal = items.filter((item) => item.kind !== "inactive").reduce((sum, item) => sum + item.value, 0);
  return <article className={featured ? "pie-card featured" : "pie-card"}><div className="pie-copy"><p className="eyebrow">{eyebrow}</p>{title && <h3>{title}</h3>}<strong>{activeTotal}/{denominator}</strong><span>maili z aktywnością</span></div><div className="pie-visual" style={{ background: pieBackground(items) }}><span>{denominator > 0 ? `${Math.round((activeTotal / denominator) * 100)}%` : "0%"}</span></div><div className="pie-legend">{items.map((item) => <div key={item.label}><i style={{ background: item.color }} /><span>{item.label}</span><b>{item.value}</b><small>{denominator > 0 ? `${Math.round((item.value / denominator) * 100)}%` : "0%"}</small></div>)}</div></article>;
}
function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function SectionTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) { return <div className="section-title"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{children}</div>; }
function senderStatusDetail(status: NonNullable<BackendStatus>) { return status.sendTransport === "smtp" ? `SMTP Hostinger · ${status.ownerEmail}` : `Google/Gmail · ${status.effectiveUser || status.ownerEmail}`; }
function campaignCountLabel(count: number) { if (count === 1) return "1 kampania"; if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return `${count} kampanie`; return `${count} kampanii`; }
function normalizedSteps(value?: number[]) { return Array.from(new Set((value || []).map(Number).filter((step) => [1, 2, 3].includes(step)))).sort((a, b) => a - b); }
function ImportSummary({ result }: { result: ImportResult | null }) { if (!result) return null; const blocked = result.issues.length > 0 || result.duplicates.length > 0; return <section className="panel"><SectionTitle eyebrow="Wynik walidacji" title={`${result.rows.length} poprawnych rekordów`}><b className={blocked ? "pill status-failed" : "pill"}>{blocked ? `${result.issues.length + result.duplicates.length} problemów` : "Gotowe"}</b></SectionTitle>{result.duplicates.length > 0 && <p className="issue">Konflikty: {result.duplicates.join(", ")}</p>}{result.issues.slice(0, 8).map((issue) => <p className="issue" key={`${issue.row}-${issue.field}`}>Wiersz {issue.row}, {issue.field}: {issue.message}</p>)}</section>; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "short" }).format(date); }
function initials(value: string) { return value.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function rate(value = 0, base = 0) { return base > 0 ? `${Math.round((value / base) * 100)}%` : "Brak danych"; }
function isValidTimeWindow(sendFrom: string, sendTo: string) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(sendFrom) && /^([01]\d|2[0-3]):[0-5]\d$/.test(sendTo) && sendFrom < sendTo; }
type PieItem = { label: string; value: number; color: string; kind?: "inactive" };
function monitoringItems(sent: number, opened: number, replies: number, bounces: number): PieItem[] {
  const inactive = Math.max(0, sent - opened - replies - bounces);
  return [
    { label: "Otwarcia", value: opened, color: "#378ADD" },
    { label: "Odpowiedzi", value: replies, color: "#167B55" },
    { label: "Odbicia", value: bounces, color: "#B42318" },
    { label: "Bez aktywności", value: inactive, color: "#DFE8F2", kind: "inactive" },
  ];
}
function sequenceSteps(series: SeriesStats) {
  return [1, 2, 3].map((step) => series.steps?.find((item) => Number(item.step) === step) ?? { step, sent: 0, opened: 0, replies: 0, bounces: 0, openRate: 0, replyRate: 0, bounceRate: 0 });
}
function barItems(step: SeriesStepStats) {
  return [
    { label: "Otwarcia", value: step.opened, color: "#378ADD" },
    { label: "Odpowiedzi", value: step.replies, color: "#167B55" },
    { label: "Odbicia", value: step.bounces, color: "#B42318" },
  ];
}
function pieBackground(items: PieItem[]) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return "conic-gradient(#dfe6ed 0deg 360deg)";
  let cursor = 0;
  const segments = items.map((item) => {
    const start = cursor;
    const end = cursor + (item.value / total) * 360;
    cursor = end;
    return `${item.color} ${start}deg ${end}deg`;
  });
  return `conic-gradient(${segments.join(", ")})`;
}
function messagePreviewHtml(body: string, footerHtml: string) { return `<div style="font:14px/1.6 Arial,sans-serif;color:#152334;padding:16px">${escapeHtml(body).replaceAll("\n", "<br>")}${footerHtml}</div>`; }
function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }