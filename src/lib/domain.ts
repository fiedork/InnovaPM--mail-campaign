import { z } from "zod";

export const campaignStatuses = [
  "draft",
  "needs_review",
  "approved",
  "active",
  "paused",
  "completed",
  "cancelled",
] as const;

export const messageStatuses = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "replied",
  "failed",
  "cancelled",
  "suppressed",
] as const;

export const allowedRoles = [
  "Prezes",
  "CEO",
  "Właściciel",
  "Dyrektor operacyjny",
] as const;

export const campaignStatusSchema = z.enum(campaignStatuses);
export const messageStatusSchema = z.enum(messageStatuses);

export const contactSchema = z.object({
  id: z.string().optional(),
  companyName: z.string().trim().min(2),
  fullName: z.string().trim().min(3),
  role: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().optional().default(""),
  linkedin: z.string().trim().optional().default(""),
  source: z.string().trim().optional().default(""),
  note: z.string().trim().optional().default(""),
});

export const campaignImportRowSchema = z.object({
  seriesName: z.string().trim().optional().default(""),
  companyName: z.string().trim().min(2),
  fullName: z.string().trim().min(3),
  role: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().optional().default(""),
  linkedin: z.string().trim().optional().default(""),
  note: z.string().trim().optional().default(""),
  email1: z.string().trim().min(10),
  email2: z.string().trim().min(10),
  email3: z.string().trim().min(10),
  sector: z.string().trim().optional().default(""),
  trigger: z.string().trim().optional().default(""),
  packageName: z.string().trim().optional().default(""),
  source: z.string().trim().optional().default(""),
});

export type Contact = z.infer<typeof contactSchema>;
export type CampaignImportRow = z.infer<typeof campaignImportRowSchema>;
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export type CampaignReadinessRow = Pick<
  CampaignImportRow,
  "fullName" | "role" | "email" | "email1" | "email2" | "email3"
> & {
  hasActiveRecipient?: boolean;
};

export type CampaignReadiness = {
  ready: boolean;
  recipientsReady: number;
  recipientsTotal: number;
  incompleteMessages: number;
};

export type CampaignMembership = {
  id: string;
  name: string;
  status: CampaignStatus;
};

export type ContactWithCampaigns = Contact & {
  companyId?: string;
  currentCampaign: CampaignMembership | null;
  campaignHistory: CampaignMembership[];
  suppressed: boolean;
};

export type ImportIssue = {
  row: number;
  field: string;
  message: string;
};

export type ImportPreview<T> = {
  rows: T[];
  issues: ImportIssue[];
  duplicates: string[];
  columns: string[];
};

export type DashboardSnapshot = {
  activeCampaigns: number;
  queuedMessages: number;
  sentMessages: number;
  replies: number;
  errors: number;
  nextSendAt: string | null;
};

const campaignTransitions: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["needs_review", "cancelled"],
  needs_review: ["approved", "cancelled"],
  approved: ["active", "needs_review", "cancelled"],
  active: ["paused", "completed", "cancelled", "needs_review"],
  paused: ["active", "needs_review", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionCampaign(
  current: CampaignStatus,
  next: CampaignStatus,
): boolean {
  return campaignTransitions[current].includes(next);
}

export function normalizeCompanyName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(sp\.?\s*z\.?\s*o\.?\s*o\.?|s\.?a\.?|spolka z ograniczona odpowiedzialnoscia)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

export function moveToBusinessDay(date: Date): Date {
  const result = new Date(date);
  while (!isBusinessDay(result)) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
}

export function addBusinessAdjustedDays(date: Date, days: number): Date {
  const result = new Date(date);
  let remaining = Math.max(0, Math.floor(days));
  if (remaining === 0) return moveToBusinessDay(result);
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (isBusinessDay(result)) remaining -= 1;
  }
  return result;
}

export function buildSequenceSchedule(start: Date): [Date, Date, Date] {
  const d0 = moveToBusinessDay(start);
  return [
    d0,
    addBusinessAdjustedDays(d0, 3),
    addBusinessAdjustedDays(d0, 6),
  ];
}

export function parseCampaignMessage(raw: string): { subject: string; body: string } {
  const text = String(raw ?? "").trim();
  const lines = text.split(/\r?\n/);
  const match = lines[0]?.match(/^\s*Temat:\s*(.*)$/i);
  return match
    ? { subject: match[1].trim(), body: lines.slice(1).join("\n").trim() }
    : { subject: "Krótka rozmowa o priorytetach PMO", body: text };
}

export function formatCampaignMessage(subject: string, body: string): string {
  return `Temat: ${subject.trim()}\n\n${body.trim()}`;
}

export function getCampaignReadiness(
  rows: CampaignReadinessRow[],
): CampaignReadiness {
  let recipientsReady = 0;
  let incompleteMessages = 0;

  for (const row of rows) {
    if (
      row.hasActiveRecipient === true &&
      row.fullName.trim() &&
      row.role.trim() &&
      z.string().email().safeParse(row.email.trim()).success
    ) {
      recipientsReady += 1;
    }

    for (const raw of [row.email1, row.email2, row.email3]) {
      const message = parseCampaignMessage(raw);
      if (!message.subject.trim() || !message.body.trim()) {
        incompleteMessages += 1;
      }
    }
  }

  return {
    ready:
      rows.length > 0 &&
      recipientsReady === rows.length &&
      incompleteMessages === 0,
    recipientsReady,
    recipientsTotal: rows.length,
    incompleteMessages,
  };
}
