/**
 * Gmail API sender using raw HTTPS + OAuth2.
 * No extra packages needed — uses only Node.js built-ins.
 *
 * Env vars required (add to .env.production):
 *   GMAIL_OAUTH_CLIENT_ID     — from ~/.config/gws/client_secret.json on Mac
 *   GMAIL_OAUTH_CLIENT_SECRET — from ~/.config/gws/client_secret.json on Mac
 *   GMAIL_REFRESH_TOKEN        — from one-time device code auth (run: node scripts/gmail-auth.js)
 *
 * One-time setup on the server:
 *   GMAIL_OAUTH_CLIENT_ID=... GMAIL_OAUTH_CLIENT_SECRET=... node scripts/gmail-auth.js
 */

// ─── Config ─────────────────────────────────────────────────────────────────

const CLIENT_ID = process.env.GMAIL_OAUTH_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GMAIL_OAUTH_CLIENT_SECRET ?? "";
const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN ?? "";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send?uploadType=media";
const TOKEN_FILE = "/opt/enrich-cms/data/gmail-token.json";

// ─── Token storage ──────────────────────────────────────────────────────────

interface TokenData {
  access_token: string;
  refresh_token?: string;
  expiry_date: number; // Unix ms
}

function loadTokens(): TokenData | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    if (!fs.existsSync(TOKEN_FILE)) return null;
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")) as TokenData;
  } catch {
    return null;
  }
}

function saveTokens(tokens: TokenData): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens));
}

// ─── OAuth2 token management ───────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const tokens = loadTokens();

  if (tokens && tokens.expiry_date > Date.now() + 60000) {
    return tokens.access_token;
  }

  // Refresh the token
  if (!REFRESH_TOKEN) {
    throw new Error(
      "GMAIL_REFRESH_TOKEN not set. Run: GMAIL_OAUTH_CLIENT_ID=... GMAIL_OAUTH_CLIENT_SECRET=... node scripts/gmail-auth.js"
    );
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  const newTokens: TokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? REFRESH_TOKEN,
    expiry_date: Date.now() + data.expires_in * 1000,
  };

  saveTokens(newTokens);
  return newTokens.access_token;
}

// ─── Email sending ──────────────────────────────────────────────────────────

function base64url_encode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeMimeEmail(
  from: string,
  to: string,
  subject: string,
  htmlBody: string,
  textBody: string
): string {
  const boundary = "boundary_" + Math.random().toString(36).slice(2);
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary=${boundary}`,
    "",
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    "",
    base64url_encode(textBody),
    "",
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    "",
    base64url_encode(htmlBody),
    "",
    `--${boundary}--`,
  ];
  return lines.join("\r\n");
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  provider: "gmail" | "console";
}

/**
 * Send an email via Gmail API.
 * Falls back to console logging if OAuth credentials are not configured.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  from?: string;
}): Promise<SendEmailResult> {
  const {
    to,
    subject,
    htmlBody,
    textBody,
    from = "EnrichCo CMS <noreply@enrichco.us>",
  } = opts;

  // Console fallback
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log(`[Gmail] Would send to ${to} — subject: ${subject}`);
    return { ok: true, provider: "console" };
  }

  try {
    const accessToken = await getAccessToken();
    const raw = makeMimeEmail(from, to, subject, htmlBody, textBody);
    const encoded = base64url_encode(raw);

    const res = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encoded }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Gmail] API error: ${err}`);
      return { ok: false, error: `Gmail API error: ${err}`, provider: "gmail" };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, messageId: data.id, provider: "gmail" };
  } catch (err) {
    console.error(`[Gmail] Exception:`, err);
    return { ok: false, error: String(err), provider: "gmail" };
  }
}

// ─── Device code flow (one-time setup) ─────────────────────────────────────

export async function runDeviceCodeFlow(): Promise<void> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET must be set");
    process.exit(1);
  }

  const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

  // Get device code
  const codeRes = await fetch("https://oauth2.googleapis.com/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES.join(" ") }),
  });

  if (!codeRes.ok) throw new Error(`Device code request failed: ${codeRes.status}`);

  const codeData = (await codeRes.json()) as {
    device_code: string;
    user_code: string;
    verification_url: string;
    interval: string;
  };

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Gmail Authorization — ONE-TIME SETUP                     ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  1. Open: ${codeData.verification_url}\n`);
  console.log(`  2. Enter code: >>> ${codeData.user_code} <<<\n`);
  console.log("  Waiting for authorization...\n");

  const pollInterval = parseInt(codeData.interval) * 1000;

  while (true) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: codeData.device_code,
        grant_type: "http://oauth.net/grant_type/device/1.0",
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error === "authorization_pending") {
      process.stdout.write(".");
      continue;
    }

    if (tokenData.error) {
      throw new Error(
        `Token error: ${tokenData.error} — ${tokenData.error_description}`
      );
    }

    const tokens: TokenData = {
      access_token: tokenData.access_token!,
      refresh_token: tokenData.refresh_token,
      expiry_date: Date.now() + 3600000,
    };
    saveTokens(tokens);

    console.log("\n\n✅ Gmail authorized! Token saved.\n");
    console.log("Add to /opt/enrich-cms/.env.production:\n");
    console.log(`GMAIL_OAUTH_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GMAIL_OAUTH_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GMAIL_REFRESH_TOKEN=${tokenData.refresh_token}\n`);
    return;
  }
}
