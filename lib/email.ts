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

export async function sendVerificationEmail(input: {
  email: string;
  code: string;
  groupName?: string | null;
  idempotencyKey: string;
}) {
  if (!emailEnv.RESEND_API_KEY || !emailEnv.EMAIL_FROM) {
    throw new Error("Email verification is not configured on this deployment yet.");
  }

  const groupCopy = input.groupName ? ` for ${escapeHtml(input.groupName)}` : "";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${emailEnv.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({
      from: emailEnv.EMAIL_FROM,
      to: [input.email],
      subject: `${input.code} is your Overlap verification code`,
      text: `Your Overlap verification code${input.groupName ? ` for ${input.groupName}` : ""} is ${input.code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;color:#17231b"><p style="font-size:12px;letter-spacing:.12em;color:#647168">OVERLAP</p><h1 style="font-family:Georgia,serif;font-weight:500">Verify your email${groupCopy}</h1><p style="color:#647168">Enter this code to continue. It expires in 10 minutes.</p><div style="font-size:32px;letter-spacing:.2em;font-weight:700;padding:20px 0">${input.code}</div><p style="font-size:12px;color:#89918b">If you did not request this code, you can ignore this email.</p></div>`,
    }),
  });
  if (!response.ok) {
    console.error("Verification email provider rejected the request", response.status);
    throw new Error("The verification email could not be sent. The deployment owner should check the sender configuration.");
  }
  return {};
}
