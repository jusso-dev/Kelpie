import { EmailClient } from "@azure/communication-email";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { Resend } from "resend";

type EmailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

export type EmailProvider = "console" | "resend" | "ses" | "azure";

export function resolveEmailProvider(
  env: Record<string, string | undefined> = process.env,
): EmailProvider {
  const configured = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (
    configured === "console" ||
    configured === "resend" ||
    configured === "ses" ||
    configured === "azure"
  ) {
    return configured;
  }
  // Preserve the original zero-config Resend behaviour for existing installs.
  return env.RESEND_API_KEY ? "resend" : "console";
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const provider = resolveEmailProvider();
  const from = process.env.EMAIL_FROM ?? "kelpie@example.com";
  const to = Array.isArray(message.to) ? message.to : [message.to];

  try {
    if (provider === "console") {
      console.info("[email:console]", { from, ...message });
      return;
    }

    if (provider === "resend") {
      const apiKey = requireEnv("RESEND_API_KEY");
      const result = await new Resend(apiKey).emails.send({
        from,
        to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      if (result.error) throw new Error(result.error.message);
      return;
    }

    if (provider === "ses") {
      const client = new SESv2Client({
        region: requireEnv("AWS_REGION"),
      });
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: to },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: message.text, Charset: "UTF-8" },
                ...(message.html
                  ? { Html: { Data: message.html, Charset: "UTF-8" } }
                  : {}),
              },
            },
          },
        }),
      );
      return;
    }

    const connectionString =
      process.env.AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING ??
      process.env.COMMUNICATION_SERVICES_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error(
        "AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING is required",
      );
    }
    const senderAddress =
      process.env.AZURE_COMMUNICATION_EMAIL_SENDER ?? from;
    const poller = await new EmailClient(connectionString).beginSend({
      senderAddress,
      content: {
        subject: message.subject,
        plainText: message.text,
        ...(message.html ? { html: message.html } : {}),
      },
      recipients: {
        to: to.map((address) => ({ address })),
      },
    });
    const result = await poller.pollUntilDone();
    if (result.status !== "Succeeded") {
      throw new Error(result.error?.message ?? `Azure email ${result.status}`);
    }
  } catch (error) {
    // User-management and incident workflows should not roll back after their
    // database mutation merely because the notification provider is down.
    console.error(`[email:${provider}] delivery failed`, error);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
