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

/** File qui se comporte comme BullMQ : un jobId déjà présent est ignoré. */
function dedupingQueue() {
  const jobs = new Map<string, unknown>();
  return {
    jobs,
    add: async (_name: string, data: unknown, opts?: { jobId?: string }) => {
      if (opts?.jobId && !jobs.has(opts.jobId)) jobs.set(opts.jobId, data);
      return {} as never;
    },
  };
}

describe('alerte « numéro Sokar à attribuer »', () => {
  it('met en file l’alerte quand la salle est terminée sans numéro', async () => {
    const queue = dedupingQueue();
    const queued = await enqueuePhoneAssignmentAlert(queue, {
      restaurantId: 'resto-1',
      phoneNumber: PLACEHOLDER,
      tasks: ROOM_DONE,
    });
    expect(queued).toBe(true);
    expect([...queue.jobs.entries()]).toEqual([
      ['resto-1', { restaurantId: 'resto-1', floorCompletedAt: '2026-10-12T08:30:00.000Z' }],
    ]);
  });

  it('ne fait rien tant que la salle n’est pas terminée', async () => {
    const queue = dedupingQueue();
    const queued = await enqueuePhoneAssignmentAlert(queue, {
      restaurantId: 'resto-1',
      phoneNumber: PLACEHOLDER,
      tasks: tasks({ restaurant: '2026-10-12T08:00:00.000Z', hours: '2026-10-12T08:05:00.000Z' }),
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
    });
    expect(queue.jobs.size).toBe(1);
    expect(queue.jobs.get('resto-1')).toEqual({
      restaurantId: 'resto-1',
      floorCompletedAt: '2026-10-12T08:30:00.000Z',
    });
  });

  it('date la fin de la salle à la dernière des trois tâches', () => {
    expect(socleCompletedAt(ROOM_DONE)).toBe('2026-10-12T08:30:00.000Z');
    expect(socleCompletedAt(tasks({ restaurant: '2026-10-12T08:00:00.000Z' }))).toBeNull();
  });
});
