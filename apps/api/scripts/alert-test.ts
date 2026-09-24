import { dispatchAlert } from '../src/shared/observability/alert-dispatcher';

async function main(): Promise<void> {
  const recipient = process.env.ALERT_EMAIL_TO?.split(',')[0]?.trim();
  if (!recipient) {
    throw new Error('ALERT_EMAIL_TO must contain a recipient for the test email');
  }

  // Restrict this manual command to one email recipient and no other channels.
  process.env.ALERT_EMAIL_TO = recipient;
  process.env.ALERT_WEBHOOK_URL = '';
  process.env.ALERT_SMS_TO = '';

  const results = await dispatchAlert({
    kind: 'manual_alert_test',
    severity: 'warning',
    summary: 'Test manuel des alertes Sokar',
    detail: 'Email de test demandé via ops:alert-test.',
    sms: false,
  });
  const emailResult = results.find((result) => result.channel === 'email');
  if (!emailResult?.ok) {
    throw new Error(emailResult?.error ?? 'No alert email was sent');
  }

  process.stdout.write('Email de test envoyé.\n');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'erreur inconnue';
  process.stderr.write('Échec du test d’alerte : ' + message + '\n');
  process.exitCode = 1;
});
