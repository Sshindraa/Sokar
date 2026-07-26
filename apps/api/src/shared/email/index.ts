import { Resend } from 'resend';

// Resend HTTP API (port 443) — bypass SMTP block on Frankfurt VPS.
// DigitalOcean Frankfurt filtre les ports SMTP sortants (465/587/2525).
// L'API HTTP de Resend utilise le port 443 (HTTPS) qui passe partout.
//
// Init lazy : on ne crée le client Resend qu'au premier envoi. Si
// RESEND_API_KEY est vide (ex: staging sans config email), le module
// se charge sans crasher — l'erreur ne surgit qu'à l'appel sendEmail(),
// comme avec l'ancien nodemailer. Sans ça, `new Resend(undefined)` throw
// au module load et crash l'API entière en boucle (PM2 restart loop).
let resendClient: Resend | null = null;
function getResend(): Resend {
  if (!resendClient) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error('RESEND_API_KEY is not set — cannot send email');
    }
    resendClient = new Resend(key);
  }
  return resendClient;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const { error } = await getResend().emails.send({
    from: process.env.EMAIL_FROM ?? 'noreply@sokar.fr',
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  if (error) {
    throw new Error(`Resend API error: ${error.message}`);
  }
}
