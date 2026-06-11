import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { db } from '../../db/client';
import { sendEmail } from '../../email';
import { setupWorkerListeners } from './helper';

export interface ReengagementJobData {
  restaurantId: string;
  // type détermine le template : "stalled" (J+3 sans avancée) | "inactive" (J+7 après complétion sans appel test)
  type: 'stalled' | 'inactive';
}

const MS_DAY = 24 * 60 * 60 * 1000;

function buildStalledEmail(restaurantName: string, completedCount: number) {
  const remaining = 5 - completedCount;
  return {
    subject: `🍽️ Sokar — Encore ${remaining} étape${remaining > 1 ? 's' : ''} pour activer ${restaurantName}`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
        <h1 style="font-size:22px;margin:0 0 12px">${restaurantName}, votre assistant est presque prêt</h1>
        <p style="margin:0 0 12px;line-height:1.5">
          Vous avez déjà validé ${completedCount} étape${completedCount > 1 ? 's' : ''} sur 5.
          Encore quelques minutes et Sokar pourra répondre à vos clients à votre place.
        </p>
        <p style="margin:0 0 16px;line-height:1.5">
          Le plus utile maintenant : connecter votre agenda ou tester votre numéro.
        </p>
        <a href="${process.env.DASHBOARD_URL ?? 'https://app.sokar.tech'}/onboarding"
           style="display:inline-block;background:#0f172a;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">
          Reprendre la configuration →
        </a>
        <p style="margin-top:24px;color:#64748b;font-size:13px">
          Une question ? Répondez à cet email, on est là.
        </p>
      </div>
    `,
  };
}

function buildInactiveEmail(restaurantName: string) {
  return {
    subject: `🎙️ Testez votre assistant vocal ${restaurantName} en 1 appel`,
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
        <h1 style="font-size:22px;margin:0 0 12px">Tout est prêt, il ne reste qu'à entendre</h1>
        <p style="margin:0 0 12px;line-height:1.5">
          La configuration de <strong>${restaurantName}</strong> est complète.
          Votre assistant peut déjà prendre des appels, mais on ne l'a pas encore activé ensemble.
        </p>
        <p style="margin:0 0 16px;line-height:1.5">
          Cliquez ci-dessous, on vous appelle dans la minute et vous entendez votre propre assistant.
        </p>
        <a href="${process.env.DASHBOARD_URL ?? 'https://app.sokar.tech'}/onboarding/phone"
           style="display:inline-block;background:#0f172a;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">
          Lancer un appel test →
        </a>
        <p style="margin-top:24px;color:#64748b;font-size:13px">
          Aucun engagement. Si vous n'êtes pas convaincu, répondez à cet email.
        </p>
      </div>
    `,
  };
}

export const reengagementWorker = new Worker(
  'onboarding',
  async (job) => {
    const data = job.data as ReengagementJobData;
    const restaurant = await db.restaurant.findUnique({
      where: { id: data.restaurantId },
    });
    if (!restaurant) {
      // Restaurant supprimé → on drop le job silencieusement
      return;
    }

    // Garde-fou : on ne re-engueule pas un user qui a déjà fait l'étape en question
    if (data.type === 'stalled' && restaurant.onboardingDone) return;
    if (data.type === 'inactive' && restaurant.firstCallAt) return;
    if (data.type === 'inactive' && !restaurant.onboardingDone) return;

    // Garde-fou : si lastSeen récent, le user est revenu de lui-même, on annule
    if (
      restaurant.onboardingLastSeenAt &&
      Date.now() - new Date(restaurant.onboardingLastSeenAt).getTime() < MS_DAY
    ) {
      return;
    }

    const email =
      data.type === 'stalled'
        ? buildStalledEmail(restaurant.name, await getCompletedCount(restaurant.id))
        : buildInactiveEmail(restaurant.name);

    await sendEmail({
      to: restaurant.managerEmail,
      subject: email.subject,
      html: email.html,
    });
  },
  { connection: redisQueue },
);

setupWorkerListeners(reengagementWorker);

async function getCompletedCount(restaurantId: string): Promise<number> {
  const r = await db.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    include: { personality: true },
  });
  // On compte rapidement sans passer par computeOnboardingState (perf acceptable ici)
  let count = 0;
  if (r.name && r.name !== 'Mon Restaurant' && r.managerPhone && r.managerEmail) count++;
  if (r.openingHours && typeof r.openingHours === 'object' && Object.keys(r.openingHours as any).length > 0) count++;
  if (r.personality) count++;
  if (r.googleRefreshToken) count++;
  if (r.phoneNumber && !r.phoneNumber.startsWith('+000')) count++;
  return count;
}
