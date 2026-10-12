import type { Queue } from 'bullmq';
import { sanitizeJobId } from '../../shared/queue/job-options';
import { hasUsablePhone, type OnboardingTask, type OnboardingTasksMap } from './onboarding.service';

/**
 * L'attribution du numéro Sokar est manuelle (`POST /admin/provisioning/:id/assign-phone`) et le
 * canal Téléphone est obligatoire : un restaurant qui a terminé sa salle sans numéro reste bloqué
 * hors de son espace. L'équipe est prévenue par e-mail (worker `phone-assignment-alert`).
 */
export const PHONE_ASSIGNMENT_NEEDED_JOB = 'phone-assignment-needed';

export interface PhoneAssignmentNeededJobData {
  restaurantId: string;
  /** Fin de la salle : la plus récente des complétions restaurant / hours / floor (ISO). */
  floorCompletedAt: string;
}

const SOCLE_TASKS: OnboardingTask[] = ['restaurant', 'hours', 'floor'];

/** Date de fin de la salle, ou `null` tant que l'une des trois tâches n'est pas terminée. */
export function socleCompletedAt(tasks: OnboardingTasksMap): string | null {
  if (!SOCLE_TASKS.every((key) => tasks[key].status === 'completed')) return null;
  const dates = SOCLE_TASKS.map((key) => tasks[key].completedAt)
    .filter((value): value is string => typeof value === 'string')
    .sort();
  return dates.at(-1) ?? new Date().toISOString();
}

/**
 * Met en file l'alerte si la salle est terminée et qu'aucun numéro n'est attribué. Appelé à chaque
 * écriture de l'état d'onboarding : le jobId (id du restaurant) et la conservation des jobs
 * terminés font que BullMQ ignore les ajouts suivants, même si la salle est refaite. Un restaurant
 * déjà bloqué avant la mise en place de l'alerte est signalé à sa prochaine visite.
 *
 * BullMQ ignore un `add` dont le jobId existe déjà, quel que soit l'état de ce job. Deux cas ne
 * doivent donc pas occuper la place :
 * - pas de destinataire (`SOKAR_OPS_ALERT_EMAIL` vide) : rien n'est mis en file, sinon le job
 *   « terminé sans envoi » empêcherait l'alerte une fois la variable posée ;
 * - job échoué (envoi impossible après toutes les tentatives) : il est retiré puis remis en file,
 *   sinon l'alerte ne partirait jamais pour ce restaurant.
 */
export async function enqueuePhoneAssignmentAlert(
  queue: Pick<Queue, 'add'>,
  args: {
    restaurantId: string;
    phoneNumber: string | null | undefined;
    tasks: OnboardingTasksMap;
    recipient: string | null | undefined;
  },
): Promise<boolean> {
  if (hasUsablePhone(args.phoneNumber)) return false;
  if (!args.recipient?.trim()) return false;
  const floorCompletedAt = socleCompletedAt(args.tasks);
  if (!floorCompletedAt) return false;
  const data: PhoneAssignmentNeededJobData = { restaurantId: args.restaurantId, floorCompletedAt };
  const options = { jobId: sanitizeJobId(args.restaurantId) };
  const job = await queue.add(PHONE_ASSIGNMENT_NEEDED_JOB, data, options);
  if (await job.isFailed()) {
    await job.remove();
    await queue.add(PHONE_ASSIGNMENT_NEEDED_JOB, data, options);
  }
  return true;
}
