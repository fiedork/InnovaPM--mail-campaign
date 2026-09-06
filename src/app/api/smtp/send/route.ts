import { connect } from "node:tls";

import {
  InternalEnvelopeError,
  verifyInternalEnvelope,
} from "@/lib/internal-envelope";

export const runtime = "nodejs";

type SmtpPayload = {
  messageId: string;
  to: string;
  from: string;
  rawMime: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

export async function POST(request: Request) {
  try {
    const payload = verifyInternalEnvelope<SmtpPayload>(await request.json());
    assertPayload(payload);
    await sendViaSmtps(payload, smtpConfig());
    return Response.json({
      ok: true,
      data: { messageId: payload.messageId, transport: "hostinger-smtp" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nieznany błąd SMTP.";
    const status = error instanceof InternalEnvelopeError ? 401 : 502;
    return Response.json({ ok: false, error: message }, { status });
  }
}

export function GET() {
  try {
    smtpConfig();
    return Response.json({
      ok: true,
      configured: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMTP nie jest skonfigurowane.";
    return Response.json({ ok: true, configured: false, error: message });
  }
}

function smtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST || "smtp.hostinger.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const from = process.env.SMTP_FROM_EMAIL || process.env.CAMPAIGN_OWNER_EMAIL || "";
  if (!host || !port || !user || !pass || !from) {
    throw new Error("Brak konfiguracji SMTP: SMTP_USER, SMTP_PASS i SMTP_FROM_EMAIL są wymagane.");
  }
  return { host, port, user, pass, from };
}

function assertPayload(payload: SmtpPayload) {
  if (!payload || typeof payload !== "object") throw new Error("Pusty payload SMTP.");
  if (!payload.messageId || !payload.to || !payload.from || !payload.rawMime) {
    throw new Error("Payload SMTP musi zawierać messageId, to, from i rawMime.");
  }
  if (!isEmail(payload.to) || !isEmail(payload.from)) {
    throw new Error("Niepoprawny adres e-mail w payload SMTP.");
  }
}

async function sendViaSmtps(payload: SmtpPayload, config: SmtpConfig) {
  const session = await SmtpSession.connect(config.host, config.port);
  try {
    await session.expect(220);
    await session.command(`EHLO ${smtpDomain(config.from)}`, 250);
    await session.command(
      `AUTH PLAIN ${Buffer.from(`\u0000${config.user}\u0000${config.pass}`, "utf8").toString("base64")}`,
      235,
    );
    await session.command(`MAIL FROM:<${config.from}>`, 250);
    await session.command(`RCPT TO:<${payload.to}>`, [250, 251]);
    await session.command("DATA", 354);
    await session.data(payload.rawMime);
    await session.command("QUIT", 221);
  } finally {
    session.close();
  }
}

class SmtpSession {
  private buffer = "";
  private waiters: Array<{
    resolve: (value: SmtpResponse) => void;
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

  static connect(host: string, port: number): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const socket = connect({
        host,
        port,
        servername: host,
        timeout: 15000,
      });
      socket.once("secureConnect", () => resolve(new SmtpSession(socket)));
      socket.once("error", reject);
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error("Timeout połączenia SMTP."));
      });
    });
  }

  async expect(expected: number | number[]) {
    const response = await this.read();
    assertSmtpCode(response, expected);
    return response;
  }

  async command(command: string, expected: number | number[]) {
    this.socket.write(`${command}\r\n`);
    return this.expect(expected);
  }

  async data(rawMime: string) {
    this.socket.write(`${dotStuff(rawMime)}\r\n.\r\n`);
    return this.expect(250);
  }

  close() {
    this.socket.end();
  }

  private read(): Promise<SmtpResponse> {
    const response = parseResponse(this.buffer);
    if (response) {
      this.buffer = response.rest;
      return Promise.resolve(response);
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private flush() {
    while (this.waiters.length) {
      const response = parseResponse(this.buffer);
      if (!response) return;
      this.buffer = response.rest;
      const waiter = this.waiters.shift();
      waiter?.resolve(response);
    }
  }
}

type SmtpResponse = {
  code: number;
  lines: string[];
  rest: string;
};

function parseResponse(buffer: string): SmtpResponse | null {
  const lines = buffer.split(/\r?\n/);
  if (!buffer.endsWith("\n")) lines.pop();
  if (!lines.length) return null;

  const responseLines: string[] = [];
  let consumed = 0;
  let code = 0;
  for (const line of lines) {
    consumed += line.length + (buffer.includes("\r\n") ? 2 : 1);
    const match = line.match(/^(\d{3})([\s-])(.*)$/);
    if (!match) continue;
    code = Number(match[1]);
    responseLines.push(line);
    if (match[2] === " ") {
      return {
        code,
        lines: responseLines,
        rest: buffer.slice(consumed),
      };
    }
  }
  return null;
}

function assertSmtpCode(response: SmtpResponse, expected: number | number[]) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.code)) {
    throw new Error(`SMTP zwrócił ${response.code}: ${response.lines.join(" ")}`);
  }
}

function dotStuff(rawMime: string) {
  return rawMime
    .replace(/\r?\n/g, "\r\n")
    .replace(/^\./gm, "..");
}

function smtpDomain(from: string) {
  return from.split("@")[1] || "innova.pm";
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
