import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST!,
  port:   Number(process.env.SMTP_PORT ?? 465),
  secure: true,
  auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
});

export interface SendEmailOptions {
  to: string; subject: string; html: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  await transporter.sendMail({
    from:    process.env.EMAIL_FROM ?? 'noreply@sokar.fr',
    to:      opts.to,
    subject: opts.subject,
    html:    opts.html,
  });
}
