import type { Worker } from 'bullmq';
import { logger } from '../../logger/pino';

/**
 * Registre des workers vivants du process.
 *
 * Chaque worker appelle `setupWorkerListeners`, qui l'enregistre ici. Le point
 * d'entrée `src/worker.ts` s'en sert pour fermer proprement tous les workers au
 * SIGTERM : sans cette liste, un redéploiement laisserait des jobs en cours
 * sans `close()`, donc sans attente de fin de traitement.
 */
const workers = new Set<Worker>();

export function registerWorker(worker: Worker): void {
  workers.add(worker);
}

export function registeredWorkers(): Worker[] {
  return [...workers];
}

/** Ferme tous les workers enregistrés. Ne throw jamais : on est en shutdown. */
export async function closeRegisteredWorkers(): Promise<number> {
  const all = registeredWorkers();
  await Promise.all(
    all.map((worker) =>
      worker.close().catch((err) => {
        logger.warn({ err, queue: worker.name }, '[workers] close failed during shutdown');
      }),
    ),
  );
  workers.clear();
  return all.length;
}
