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
 */
export async function enqueuePhoneAssignmentAlert(
  queue: Pick<Queue, 'add'>,
  args: { restaurantId: string; phoneNumber: string | null | undefined; tasks: OnboardingTasksMap },
): Promise<boolean> {
  if (hasUsablePhone(args.phoneNumber)) return false;
  const floorCompletedAt = socleCompletedAt(args.tasks);
  if (!floorCompletedAt) return false;
  const data: PhoneAssignmentNeededJobData = { restaurantId: args.restaurantId, floorCompletedAt };
  await queue.add(PHONE_ASSIGNMENT_NEEDED_JOB, data, {
    jobId: sanitizeJobId(args.restaurantId),
  });
  return true;
}
