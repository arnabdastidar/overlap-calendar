import { env } from "cloudflare:workers";

type EmailEnv = {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
};

const emailEnv = env as unknown as EmailEnv;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}) {
  if (!emailEnv.RESEND_API_KEY || !emailEnv.EMAIL_FROM) {
    throw new Error("Email delivery is not configured on this deployment yet.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${emailEnv.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({
      from: emailEnv.EMAIL_FROM,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  });
  if (!response.ok) {
    console.error("Email provider rejected the request", response.status);
    throw new Error("The email could not be sent. The deployment owner should check the sender configuration.");
  }
}

export async function sendVerificationEmail(input: {
  email: string;
  code: string;
  groupName?: string | null;
  idempotencyKey: string;
}) {
  const groupCopy = input.groupName ? ` for ${escapeHtml(input.groupName)}` : "";
  await sendEmail({
    to: input.email,
    subject: `${input.code} is your Overlap verification code`,
    text: `Your Overlap verification code${input.groupName ? ` for ${input.groupName}` : ""} is ${input.code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;color:#17231b"><p style="font-size:12px;letter-spacing:.12em;color:#647168">OVERLAP</p><h1 style="font-family:Georgia,serif;font-weight:500">Verify your email${groupCopy}</h1><p style="color:#647168">Enter this code to continue. It expires in 10 minutes.</p><div style="font-size:32px;letter-spacing:.2em;font-weight:700;padding:20px 0">${input.code}</div><p style="font-size:12px;color:#89918b">If you did not request this code, you can ignore this email.</p></div>`,
    idempotencyKey: input.idempotencyKey,
  });
  return {};
}

export function sendCalendarReminderEmail(input: {
  email: string;
  participantName: string;
  creatorName: string;
  groupName: string;
  groupUrl: string;
  idempotencyKey: string;
}) {
  const safeParticipant = escapeHtml(input.participantName);
  const safeCreator = escapeHtml(input.creatorName);
  const safeGroup = escapeHtml(input.groupName);
  const safeUrl = escapeHtml(input.groupUrl);
  return sendEmail({
    to: input.email,
    subject: `Connect your calendar to ${input.groupName} on Overlap`,
    text: `${input.creatorName} is reminding you to connect your calendar to ${input.groupName} on Overlap. Open ${input.groupUrl}, enter the shared group password, verify this email address, and connect Google Calendar or Microsoft Outlook. Overlap reads only busy time blocks.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;color:#17231b"><p style="font-size:12px;letter-spacing:.12em;color:#647168">OVERLAP</p><h1 style="font-family:Georgia,serif;font-weight:500">Connect your calendar</h1><p>Hi ${safeParticipant},</p><p style="color:#647168;line-height:1.6">${safeCreator} is reminding you to join <strong>${safeGroup}</strong> and connect Google Calendar or Microsoft Outlook.</p><a href="${safeUrl}" style="display:inline-block;margin:12px 0 20px;padding:12px 18px;border-radius:8px;background:#1e5c3f;color:#fff;text-decoration:none;font-weight:700">Open the overlap</a><p style="font-size:13px;color:#647168;line-height:1.6">Use the shared group password and verify this email address when you join. Overlap reads only busy time blocks; event titles and details stay private.</p></div>`,
    idempotencyKey: input.idempotencyKey,
  });
}
