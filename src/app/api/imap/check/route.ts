import { connect } from "node:tls";

import {
  InternalEnvelopeError,
  verifyInternalEnvelope,
} from "@/lib/internal-envelope";

export const runtime = "nodejs";

type SentMessage = {
  id: string;
  rfcMessageId: string;
  recipientEmail: string;
};

type ImapPayload = {
  messages: SentMessage[];
  sinceDays?: number;
};

type ImapConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
};

type ParsedEmail = {
  headers: Record<string, string>;
  body: string;
};

export async function POST(request: Request) {
  try {
    const payload = verifyInternalEnvelope<ImapPayload>(await request.json());
    const messages = normalizeMessages(payload.messages);
    const emails = await fetchRecentEmails(imapConfig(), Number(payload.sinceDays || 7));
    const result = detectActivity(messages, emails);
    return Response.json({ ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nieznany błąd IMAP.";
    const status = error instanceof InternalEnvelopeError ? 401 : 502;
    return Response.json({ ok: false, error: message }, { status });
  }
}

export function GET() {
  try {
    imapConfig();
    return Response.json({
      ok: true,
      configured: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "IMAP nie jest skonfigurowany.";
    return Response.json({ ok: true, configured: false, error: message });
  }
}

function imapConfig(): ImapConfig {
  const host = process.env.IMAP_HOST || "imap.hostinger.com";
  const port = Number(process.env.IMAP_PORT || 993);
  const user = process.env.IMAP_USER || process.env.SMTP_USER || "";
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS || "";
  if (!host || !port || !user || !pass) {
    throw new Error("Brak konfiguracji IMAP: IMAP_USER/SMTP_USER i IMAP_PASS/SMTP_PASS są wymagane.");
  }
  return { host, port, user, pass };
}

function normalizeMessages(messages: unknown): SentMessage[] {
  if (!Array.isArray(messages)) return [];
  const seen = new Set<string>();
  return messages.slice(0, 500)
    .map((item) => item as Partial<SentMessage>)
    .map((item) => ({
      id: String(item.id || ""),
      rfcMessageId: String(item.rfcMessageId || ""),
      recipientEmail: String(item.recipientEmail || "").toLowerCase(),
    }))
    .filter(({ id, rfcMessageId, recipientEmail }) =>
      id.length > 0 && id.length <= 128 &&
      rfcMessageId.length > 0 && rfcMessageId.length <= 1000 &&
      recipientEmail.length > 0 && recipientEmail.length <= 254,
    )
    .map((item) => ({
      ...item,
      rfcMessageId: normalizeMessageId(item.rfcMessageId),
    }))
    .filter((item) =>
      /^<[^<>\r\n]{1,998}>$/.test(item.rfcMessageId) &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.recipientEmail),
    )
    .filter((item) => {
      const key = `${item.id}\u0000${item.rfcMessageId}\u0000${item.recipientEmail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function detectActivity(messages: SentMessage[], emails: ParsedEmail[]) {
  const byMessageId = new Map(messages.map((message) => [message.rfcMessageId, message]));
  const byEmail = new Map(messages.map((message) => [message.recipientEmail, message]));
  const repliedMessageIds = new Set<string>();
  const bouncedEmails = new Set<string>();

  for (const email of emails) {
    const headersText = Object.values(email.headers).join(" ");
    const references = Array.from(headersText.matchAll(/<[^>]+>/g)).map((match) =>
      normalizeMessageId(match[0]),
    );
    for (const reference of references) {
      const matched = byMessageId.get(reference);
      if (matched && isFromRecipient(email.headers, matched.recipientEmail) &&
        !isAutoReply(email.headers) && !isBounce(email)) {
        repliedMessageIds.add(matched.id);
      }
    }

    if (isBounce(email)) {
      const haystack = `${headersText}\n${email.body}`.toLowerCase();
      for (const recipientEmail of byEmail.keys()) {
        if (haystack.includes(recipientEmail)) bouncedEmails.add(recipientEmail);
      }
    }
  }

  return {
    repliedMessageIds: Array.from(repliedMessageIds),
    bouncedEmails: Array.from(bouncedEmails),
    checkedMessages: messages.length,
    checkedMailboxMessages: emails.length,
  };
}

function isFromRecipient(headers: Record<string, string>, recipientEmail: string) {
  const addresses = String(headers.from || "").match(
    /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi,
  ) || [];
  return addresses.some((address) => address.toLowerCase() === recipientEmail.toLowerCase());
}

async function fetchRecentEmails(config: ImapConfig, sinceDays: number): Promise<ParsedEmail[]> {
  const session = await ImapSession.connect(config.host, config.port);
  try {
    await session.expect("* OK");
    await session.command(`LOGIN ${quote(config.user)} ${quote(config.pass)}`, "OK");
    await session.command("SELECT INBOX", "OK");
    const since = imapDate(daysAgo(Math.max(1, Math.min(sinceDays, 30))));
    const search = await session.command(`UID SEARCH SINCE ${since}`, "OK");
    const uids = parseUids(search.lines).slice(-200);
    if (!uids.length) return [];
    const fetch = await session.command(`UID FETCH ${uids.join(",")} (BODY.PEEK[])`, "OK");
    await session.command("LOGOUT", "OK");
    return parseFetchedMessages(fetch.lines.join("\r\n"));
  } finally {
    session.close();
  }
}

class ImapSession {
  private buffer = "";
  private tagCounter = 0;
  private waiters: Array<{
    tag?: string;
    resolve: (value: ImapResponse) => void;
    reject: (error: Error) => void;
  }> = [];

  private constructor(private socket: ReturnType<typeof connect>) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on("error", (error) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter.reject(error);
    });
  }

  static connect(host: string, port: number): Promise<ImapSession> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host, port, servername: host, timeout: 15000 });
      socket.once("secureConnect", () => resolve(new ImapSession(socket)));
      socket.once("error", reject);
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error("Timeout połączenia IMAP."));
      });
    });
  }

  expect(expected: string) {
    return this.read(undefined, expected);
  }

  async command(command: string, expected: string) {
    const tag = `A${String(++this.tagCounter).padStart(4, "0")}`;
    this.socket.write(`${tag} ${command}\r\n`);
    return this.read(tag, expected);
  }

  close() {
    this.socket.end();
  }

  private read(tag: string | undefined, expected: string): Promise<ImapResponse> {
    const response = parseImapResponse(this.buffer, tag, expected);
    if (response) {
      this.buffer = response.rest;
      return Promise.resolve(response);
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ tag, resolve, reject });
    });
  }

  private flush() {
    for (let index = 0; index < this.waiters.length; index += 1) {
      const waiter = this.waiters[index];
      const response = parseImapResponse(this.buffer, waiter.tag, "OK");
      if (!response) continue;
      this.buffer = response.rest;
      this.waiters.splice(index, 1);
      waiter.resolve(response);
      index -= 1;
    }
  }
}

type ImapResponse = {
  lines: string[];
  rest: string;
};

function parseImapResponse(buffer: string, tag: string | undefined, expected: string): ImapResponse | null {
  const lines = buffer.split(/\r?\n/);
  if (!buffer.endsWith("\n")) lines.pop();
  if (!lines.length) return null;
  const terminalIndex = lines.findIndex((line) =>
    tag ? line.startsWith(`${tag} ${expected}`) : line.startsWith(expected),
  );
  if (terminalIndex === -1) return null;
  const consumedText = `${lines.slice(0, terminalIndex + 1).join("\r\n")}\r\n`;
  return { lines: lines.slice(0, terminalIndex + 1), rest: buffer.slice(consumedText.length) };
}

function parseUids(lines: string[]) {
  const searchLine = lines.find((line) => line.startsWith("* SEARCH")) || "";
  return searchLine
    .replace("* SEARCH", "")
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter(Boolean);
}

function parseFetchedMessages(raw: string): ParsedEmail[] {
  const messages: ParsedEmail[] = [];
  const literalPattern = /\{(\d+)\}\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = literalPattern.exec(raw))) {
    const start = match.index + match[0].length;
    const length = Number(match[1]);
    const content = raw.slice(start, start + length);
    if (content) messages.push(parseEmail(content));
    literalPattern.lastIndex = start + length;
  }
  return messages;
}

function parseEmail(raw: string): ParsedEmail {
  const [rawHeaders = "", ...bodyParts] = raw.split(/\r?\n\r?\n/);
  const unfolded = rawHeaders.replace(/\r?\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    headers[line.slice(0, separator).toLowerCase()] = line.slice(separator + 1).trim();
  }
  return { headers, body: bodyParts.join("\n\n") };
}

function isBounce(email: ParsedEmail) {
  const from = String(email.headers.from || "").toLowerCase();
  const subject = String(email.headers.subject || "").toLowerCase();
  return /mailer-daemon|postmaster|mail delivery subsystem/.test(from) ||
    /undeliver|delivery status notification|failure|returned mail|niedostarcz/.test(subject);
}

function isAutoReply(headers: Record<string, string>) {
  const autoSubmitted = String(headers["auto-submitted"] || "").toLowerCase();
  const precedence = String(headers.precedence || "").toLowerCase();
  const subject = String(headers.subject || "").toLowerCase();
  return (autoSubmitted && autoSubmitted !== "no") ||
    ["bulk", "junk", "list"].includes(precedence) ||
    /(out of office|automatic reply|autoresponder|poza biurem|automatyczna odpowied)/i.test(subject);
}

function normalizeMessageId(value: string) {
  const match = value.match(/<[^>]+>/);
  return (match ? match[0] : value).trim().toLowerCase();
}

function quote(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function imapDate(date: Date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date.getDate()}-${months[date.getMonth()]}-${date.getFullYear()}`;
}
