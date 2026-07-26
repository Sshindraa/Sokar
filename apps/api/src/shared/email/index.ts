import { Resend } from 'resend';

// Resend HTTP API (port 443) — bypass SMTP block on Frankfurt VPS.
// DigitalOcean Frankfurt filtre les ports SMTP sortants (465/587/2525).
// L'API HTTP de Resend utilise le port 443 (HTTPS) qui passe partout.
const resend = new Resend(process.env.RESEND_API_KEY!);

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM ?? 'noreply@sokar.fr',
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  if (error) {
    throw new Error(`Resend API error: ${error.message}`);
  }
}
