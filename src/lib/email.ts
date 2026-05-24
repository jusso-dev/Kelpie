type EmailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

export async function sendEmail(message: EmailMessage): Promise<void> {
  const from = process.env.EMAIL_FROM ?? "kelpie@example.com";
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.info("[email:dev]", { from, ...message });
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(message.to) ? message.to : [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[email] resend failed", res.status, body);
  }
}
