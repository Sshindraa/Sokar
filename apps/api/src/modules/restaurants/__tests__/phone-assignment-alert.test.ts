import { describe, expect, it } from 'vitest';
import { normalizeTasks, type OnboardingTasksMap } from '../onboarding.service';
import { enqueuePhoneAssignmentAlert, socleCompletedAt } from '../phone-assignment-alert';

const PLACEHOLDER = '+000chez-test';

function tasks(completed: Record<string, string>): OnboardingTasksMap {
  return normalizeTasks(
    Object.fromEntries(
      Object.entries(completed).map(([key, completedAt]) => [
        key,
        { status: 'completed', completedAt },
      ]),
    ),
  );
}

const ROOM_DONE = tasks({
  restaurant: '2026-10-12T08:00:00.000Z',
  hours: '2026-10-12T08:05:00.000Z',
  floor: '2026-10-12T08:30:00.000Z',
});

const RECIPIENT = 'ops@sokar.test';

/** File qui se comporte comme BullMQ : un jobId déjà présent, quel que soit son état, est ignoré. */
function dedupingQueue() {
  const jobs = new Map<string, { data: unknown; state: 'waiting' | 'completed' | 'failed' }>();
  const queue = {
    jobs,
    add: async (_name: string, data: unknown, opts?: { jobId?: string }) => {
      const id = opts?.jobId as string;
      if (!jobs.has(id)) jobs.set(id, { data, state: 'waiting' });
      return {
        isFailed: async () => jobs.get(id)?.state === 'failed',
        remove: async () => {
          jobs.delete(id);
        },
      } as never;
    },
  };
  return queue;
}

describe('alerte « numéro Sokar à attribuer »', () => {
  it('met en file l’alerte quand la salle est terminée sans numéro', async () => {
    const queue = dedupingQueue();
    const queued = await enqueuePhoneAssignmentAlert(queue, {
      restaurantId: 'resto-1',
      phoneNumber: PLACEHOLDER,
      tasks: ROOM_DONE,
      recipient: RECIPIENT,
    });
    expect(queued).toBe(true);
    expect([...queue.jobs.entries()]).toEqual([
      [
        'resto-1',
        {
          data: { restaurantId: 'resto-1', floorCompletedAt: '2026-10-12T08:30:00.000Z' },
          state: 'waiting',
        },
      ],
    ]);
  });

  it('ne fait rien tant que la salle n’est pas terminée', async () => {
    const queue = dedupingQueue();
    const queued = await enqueuePhoneAssignmentAlert(queue, {
      restaurantId: 'resto-1',
      phoneNumber: PLACEHOLDER,
      tasks: tasks({ restaurant: '2026-10-12T08:00:00.000Z', hours: '2026-10-12T08:05:00.000Z' }),
      recipient: RECIPIENT,
    });
    expect(queued).toBe(false);
    expect(queue.jobs.size).toBe(0);
  });

  it('ne fait rien quand un numéro est attribué', async () => {
    const queue = dedupingQueue();
    const queued = await enqueuePhoneAssignmentAlert(queue, {
      restaurantId: 'resto-1',
      phoneNumber: '+33123456789',
      tasks: ROOM_DONE,
      recipient: RECIPIENT,
    });
    expect(queued).toBe(false);
    expect(queue.jobs.size).toBe(0);
  });

  it('garde une seule alerte quand la salle est refaite', async () => {
    const queue = dedupingQueue();
    await enqueuePhoneAssignmentAlert(queue, {
      restaurantId: 'resto-1',
      phoneNumber: PLACEHOLDER,
      tasks: ROOM_DONE,
      recipient: RECIPIENT,
    });
    const redone = tasks({
      restaurant: '2026-10-12T08:00:00.000Z',
      hours: '2026-10-12T08:05:00.000Z',
      floor: '2026-10-13T10:00:00.000Z',
    });
    await enqueuePhoneAssignmentAlert(queue, {
      restaurantId: 'resto-1',
      phoneNumber: PLACEHOLDER,
      tasks: redone,
      recipient: RECIPIENT,
    });
    expect(queue.jobs.size).toBe(1);
    expect(queue.jobs.get('resto-1')?.data).toEqual({
      restaurantId: 'resto-1',
      floorCompletedAt: '2026-10-12T08:30:00.000Z',
    });
  });

  it('ne met rien en file sans destinataire : le job terminé sans envoi bloquerait l’alerte', async () => {
    const queue = dedupingQueue();
    const base = { restaurantId: 'resto-1', phoneNumber: PLACEHOLDER, tasks: ROOM_DONE };
    expect(await enqueuePhoneAssignmentAlert(queue, { ...base, recipient: '' })).toBe(false);
    expect(await enqueuePhoneAssignmentAlert(queue, { ...base, recipient: '  ' })).toBe(false);
    expect(await enqueuePhoneAssignmentAlert(queue, { ...base, recipient: undefined })).toBe(false);
    expect(queue.jobs.size).toBe(0);
    // La variable posée, la prochaine visite du restaurant met l'alerte en file.
    expect(await enqueuePhoneAssignmentAlert(queue, { ...base, recipient: RECIPIENT })).toBe(true);
    expect(queue.jobs.size).toBe(1);
  });

  it('remet en file une alerte échouée au lieu de la laisser bloquer le jobId', async () => {
    const queue = dedupingQueue();
    const args = {
      restaurantId: 'resto-1',
      phoneNumber: PLACEHOLDER,
      tasks: ROOM_DONE,
      recipient: RECIPIENT,
    };
    await enqueuePhoneAssignmentAlert(queue, args);
    queue.jobs.get('resto-1')!.state = 'failed';
    await enqueuePhoneAssignmentAlert(queue, args);
    expect(queue.jobs.size).toBe(1);
    expect(queue.jobs.get('resto-1')!.state).toBe('waiting');
  });

  it('laisse une alerte déjà envoyée en place : pas de seconde alerte', async () => {
    const queue = dedupingQueue();
    const args = {
      restaurantId: 'resto-1',
      phoneNumber: PLACEHOLDER,
      tasks: ROOM_DONE,
      recipient: RECIPIENT,
    };
    await enqueuePhoneAssignmentAlert(queue, args);
    queue.jobs.get('resto-1')!.state = 'completed';
    await enqueuePhoneAssignmentAlert(queue, args);
    expect(queue.jobs.size).toBe(1);
    expect(queue.jobs.get('resto-1')!.state).toBe('completed');
  });

  it('date la fin de la salle à la dernière des trois tâches', () => {
    expect(socleCompletedAt(ROOM_DONE)).toBe('2026-10-12T08:30:00.000Z');
    expect(socleCompletedAt(tasks({ restaurant: '2026-10-12T08:00:00.000Z' }))).toBeNull();
  });
});
