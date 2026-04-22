/**
 * OTP email sender via SendGrid.
 * Falls back to console logging if SENDGRID_API_KEY is not set.
 */

const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.OTP_FROM_EMAIL ?? "noreply@enrichco.us";
const FROM_NAME = process.env.OTP_FROM_NAME ?? "EnrichCo";

interface SendOtpResult {
  ok: boolean;
  provider: "sendgrid" | "console";
  messageId?: string;
  code?: string; // only populated in console mode
  error?: string; // populated on failure
}

/**
 * Send a password reset link to the user's email address.
 */
export async function sendResetEmail(
  email: string,
  token: string,
  resetUrl: string
): Promise<{ ok: boolean; provider: "sendgrid" | "console"; messageId?: string }> {
  const subject = "Reset your EnrichCo CMS password";
  const htmlBody = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Reset Password</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;"><tr><td align="center">
<table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<tr><td style="background:#18181b;padding:32px 40px;text-align:center;">
<p style="margin:0;color:#ffffff;font-size:20px;font-weight:600;letter-spacing:-0.3px;">EnrichCo</p>
<p style="margin:6px 0 0;color:#a1a1aa;font-size:13px;">Salon CMS</p>
</td></tr>
<tr><td style="padding:40px 40px 32px;text-align:center;">
<p style="margin:0 0 8px;color:#18181b;font-size:18px;font-weight:600;">Reset your password</p>
<p style="margin:0 0 32px;color:#71717a;font-size:14px;line-height:1.5;">Click the button below to set a new password for your EnrichCo CMS account.</p>
<a href="${resetUrl}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;">Reset Password</a>
<p style="margin:24px 0 0;color:#a1a1aa;font-size:12px;line-height:1.6;">This link expires in <strong>30 minutes</strong>.<br/>If you didn't request a password reset, you can safely ignore this email.</p>
</td></tr>
<tr><td style="background:#fafafa;padding:20px 40px;border-top:1px solid #f4f4f5;text-align:center;">
<p style="margin:0;color:#a1a1aa;font-size:12px;">© ${new Date().getFullYear()} EnrichCo</p>
</td></tr></table></td></tr></table></body></html>`;
  const textBody = `Reset your EnrichCo CMS password:\n\n${resetUrl}\n\nThis link expires in 30 minutes. If you did not request this, ignore this email.`;

  if (!SENDGRID_KEY) {
    console.log(`[Reset] Would send to ${email} — link: ${resetUrl}`);
    return { ok: true, provider: "console" };
  }

  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${SENDGRID_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: FROM_EMAIL, name: FROM_NAME },
        reply_to: { email: FROM_EMAIL },
        subject,
        content: [{ type: "text/plain", value: textBody }, { type: "text/html", value: htmlBody }],
      }),
    });
    if (!res.ok) return { ok: false, provider: "sendgrid" };
    return { ok: true, provider: "sendgrid", messageId: res.headers.get("x-message-id") ?? undefined };
  } catch (err) {
    console.error(`[Reset] SendGrid exception:`, err);
    return { ok: false, provider: "sendgrid" };
  }
}

/**
 * Send a 6-digit OTP code to the user's email address.
 * Returns which provider was used and the message ID (SendGrid) or the code (console).
 */
export async function sendOtpEmail(
  email: string,
  code: string
): Promise<SendOtpResult> {
  const subject = "Your EnrichCo CMS verification code";
  const htmlBody = buildOtpEmailHtml(code);
  const textBody = `Your EnrichCo CMS verification code is: ${code}\n\nThis code expires in 5 minutes. If you did not request this, ignore this email.`;

  if (!SENDGRID_KEY) {
    console.log(`[OTP] Would send to ${email} — code: ${code}`);
    return { ok: true, provider: "console", code };
  }

  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: FROM_EMAIL, name: FROM_NAME },
        reply_to: { email: FROM_EMAIL },
        subject,
        content: [
          { type: "text/plain", value: textBody },
          { type: "text/html", value: htmlBody },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[OTP] SendGrid error ${res.status}: ${text}`);
      return { ok: false, provider: "sendgrid" };
    }

    const messageId =
      res.headers.get("x-message-id") ?? res.headers.get("etag") ?? "unknown";

    return { ok: true, provider: "sendgrid", messageId };
  } catch (err) {
    console.error(`[OTP] SendGrid exception:`, err);
    return { ok: false, provider: "sendgrid" };
  }
}

/** Build a clean HTML email body for the OTP code. */
function buildOtpEmailHtml(code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Verification Code</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#18181b;padding:32px 40px;text-align:center;">
              <p style="margin:0;color:#ffffff;font-size:20px;font-weight:600;letter-spacing:-0.3px;">EnrichCo</p>
              <p style="margin:6px 0 0;color:#a1a1aa;font-size:13px;">Salon CMS</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;text-align:center;">
              <p style="margin:0 0 8px;color:#18181b;font-size:18px;font-weight:600;">Your verification code</p>
              <p style="margin:0 0 32px;color:#71717a;font-size:14px;line-height:1.5;">
                Enter the code below to complete your login.<br/>This code expires in <strong>5 minutes</strong>.
              </p>
              <!-- Code box -->
              <div style="display:inline-block;background:#f4f4f5;border:2px solid #e4e4e7;border-radius:10px;padding:20px 32px;">
                <p style="margin:0;font-size:36px;font-weight:700;letter-spacing:10px;color:#18181b;font-family:monospace;">${code}</p>
              </div>
              <p style="margin:24px 0 0;color:#a1a1aa;font-size:12px;line-height:1.6;">
                If you didn't request this, you can safely ignore this email.<br/>
                This code was requested during a CMS login.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;padding:20px 40px;border-top:1px solid #f4f4f5;text-align:center;">
              <p style="margin:0;color:#a1a1aa;font-size:12px;">
                © ${new Date().getFullYear()} EnrichCo · This is an automated message
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
