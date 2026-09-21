/**
 * Operations CLI for the BullMQ dead-letter queue.
 *
 * Usage (from apps/api, with its .env):
 *   pnpm --filter @sokar/api ops:dead-letter list
 *   pnpm --filter @sokar/api ops:dead-letter list --queue sms-client --limit 50
 *   pnpm --filter @sokar/api ops:dead-letter stats
 *   pnpm --filter @sokar/api ops:dead-letter show <deadLetterJobId>
 *   pnpm --filter @sokar/api ops:dead-letter replay <deadLetterJobId> --confirm
 *   pnpm --filter @sokar/api ops:dead-letter discard <deadLetterJobId> --reason "duplicate" --confirm
 *
 * Read commands are safe. `replay` and `discard` mutate Redis and therefore
 * require an explicit `--confirm`. Runbook: docs/runbooks/dead-letter.md.
 */

import { queues } from '../src/shared/queue/queues.js';
import { redisCache, redisQueue, redisSession } from '../src/shared/redis/client.js';
import {
  createDeadLetterDeps,
  discardDeadLetterJob,
  getDeadLetterStats,
  listDeadLetterJobs,
  replayDeadLetterJob,
  summarizeDeadLetterJob,
  type DeadLetterJobSummary,
} from '../src/shared/queue/dead-letter.service.js';

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

interface ParsedArgs {
  readonly command?: string;
  readonly positionals: string[];
  readonly queue?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly reason?: string;
  readonly json: boolean;
  readonly confirm: boolean;
  readonly help: boolean;
}

function usage(): void {
  log(`Dead-letter queue operations

Usage: pnpm --filter @sokar/api ops:dead-letter <command> [options]

Commands:
  list                     List dead-letter entries (newest first).
  stats                    Count entries per origin queue.
  show <jobId>             Show one entry with its redacted payload preview.
  replay <jobId>           Re-enqueue on the origin queue, then remove the entry.
  discard <jobId>          Remove the entry after triage.

Options:
  --queue <name>           Filter list/stats to one origin queue.
  --limit <n>              Max entries returned by list (default 20, max 500).
  --offset <n>             Skip the first n entries of a list.
  --reason <text>          Required for discard.
  --confirm                Required for replay and discard.
  --json                   Machine-readable output.
  --help, -h               Show this help.`);
}

function parseArgs(raw: string[]): ParsedArgs {
  const positionals: string[] = [];
  let queue: string | undefined;
  let limit: number | undefined;
  let offset: number | undefined;
  let reason: string | undefined;
  let json = false;
  let confirm = false;
  let help = false;

  for (let index = 0; index < raw.length; index++) {
    const arg = raw[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--confirm') {
      confirm = true;
      continue;
    }
    if (arg === '--queue' || arg === '--limit' || arg === '--offset' || arg === '--reason') {
      const value = raw[++index];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === '--queue') queue = value;
      else if (arg === '--reason') reason = value;
      else {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`${arg} must be a non-negative integer`);
        }
        if (arg === '--limit') limit = parsed;
        else offset = parsed;
      }
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    positionals.push(arg);
  }

  return {
    command: positionals[0],
    positionals: positionals.slice(1),
    queue,
    limit,
    offset,
    reason,
    json,
    confirm,
    help,
  };
}

function describe(summary: DeadLetterJobSummary): string {
  const flags = summary.replayable ? 'replayable' : 'NOT-REPLAYABLE';
  const reason = summary.failedReason.replaceAll('\n', ' ').slice(0, 120);
  return [
    `${summary.deadLetterJobId}`,
    `${summary.failedAt ?? 'unknown-date'}`,
    `${summary.originalQueue}`,
    `${summary.originalJobName}`,
    `attempts=${summary.attemptsMade}`,
    flags,
    `reason="${reason}"`,
  ].join('  ');
}

function requireJobId(args: ParsedArgs, command: string): string {
  const jobId = args.positionals[0];
  if (!jobId) throw new Error(`${command} requires a dead-letter job id`);
  return jobId;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return 0;
  }
  if (!args.command) {
    usage();
    return 1;
  }

  const deps = createDeadLetterDeps();

  switch (args.command) {
    case 'list': {
      const entries = await listDeadLetterJobs(deps, {
        ...(args.queue ? { queue: args.queue } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.offset !== undefined ? { offset: args.offset } : {}),
      });
      if (args.json) {
        log(JSON.stringify(entries, null, 2));
        break;
      }
      if (entries.length === 0) {
        log('Aucun job en dead-letter.');
        break;
      }
      log(`${entries.length} job(s) en dead-letter (du plus récent au plus ancien) :`);
      for (const entry of entries) log(`  ${describe(entry)}`);
      break;
    }

    case 'stats': {
      const stats = await getDeadLetterStats(deps);
      if (args.json) {
        log(JSON.stringify(stats, null, 2));
        break;
      }
      log(`Total : ${stats.total} job(s)`);
      if (stats.scanned < stats.total) {
        log(`Répartition calculée sur les ${stats.scanned} entrées les plus récentes.`);
      }
      if (stats.oldestFailedAt)
        log(`Plus ancien échec (fenêtre scannée) : ${stats.oldestFailedAt}`);
      for (const [queue, count] of Object.entries(stats.byOriginalQueue).sort(
        (left, right) => right[1] - left[1],
      )) {
        log(`  ${queue}: ${count}`);
      }
      break;
    }

    case 'show': {
      const jobId = requireJobId(args, 'show');
      const job = await deps.deadLetterQueue.getJob(jobId);
      if (!job) {
        log(`Job introuvable : ${jobId}`);
        return 1;
      }
      const summary = summarizeDeadLetterJob(job);
      if (args.json) {
        log(JSON.stringify(summary, null, 2));
        break;
      }
      log(`dead-letter job : ${summary.deadLetterJobId}`);
      log(`file d'origine  : ${summary.originalQueue}`);
      log(
        `job d'origine   : ${summary.originalJobName} (${summary.originalJobId ?? 'id inconnu'})`,
      );
      log(`tentatives      : ${summary.attemptsMade}`);
      log(`échec           : ${summary.failedAt ?? 'date inconnue'}`);
      log(`rejouable       : ${summary.replayable ? 'oui' : 'non'}`);
      log(`raison          : ${summary.failedReason}`);
      log(`payload (masqué): ${JSON.stringify(summary.dataPreview, null, 2)}`);
      break;
    }

    case 'replay': {
      const jobId = requireJobId(args, 'replay');
      if (!args.confirm) {
        log(`DRY-RUN : le job ${jobId} serait remis dans sa file d'origine puis retiré.`);
        log('Relancer avec --confirm pour appliquer.');
        break;
      }
      const result = await replayDeadLetterJob(deps, jobId);
      if (args.json) {
        log(JSON.stringify(result, null, 2));
      } else if (result.status === 'replayed') {
        log(
          `Job rejoué : ${result.deadLetterJobId} → ${result.queue} (${result.jobName}, nouveau job ${result.replayedJobId ?? 'id inconnu'}).`,
        );
      } else if (result.status === 'unknown_queue') {
        log(`File inconnue « ${result.queue} » : rejeu refusé.`);
      } else if (result.status === 'not_replayable') {
        log(`Rejeu refusé : ${result.reason}`);
      } else {
        log(`Job introuvable : ${jobId}`);
      }
      return result.status === 'replayed' ? 0 : 1;
    }

    case 'discard': {
      const jobId = requireJobId(args, 'discard');
      if (!args.reason) {
        log('discard requiert --reason "<motif>" (tracé dans les logs).');
        return 1;
      }
      if (!args.confirm) {
        log(`DRY-RUN : le job ${jobId} serait supprimé (motif : ${args.reason}).`);
        log('Relancer avec --confirm pour appliquer.');
        break;
      }
      const result = await discardDeadLetterJob(deps, jobId, args.reason);
      if (args.json) {
        log(JSON.stringify(result, null, 2));
      } else if (result.status === 'discarded') {
        log(`Job supprimé : ${result.deadLetterJobId} (motif : ${result.reason}).`);
      } else if (result.status === 'invalid_argument') {
        log(result.message);
      } else {
        log(`Job introuvable : ${jobId}`);
      }
      return result.status === 'discarded' ? 0 : 1;
    }

    default:
      log(`Commande inconnue : ${args.command}`);
      usage();
      return 1;
  }

  return 0;
}

async function shutdown(): Promise<void> {
  await Promise.all(Object.values(queues).map((queue) => queue.close().catch(() => undefined)));
  // `redis/client.ts` opens three connections (session, cache, queue). All of
  // them must be closed or the process never returns to the shell.
  await Promise.all(
    [redisSession, redisCache, redisQueue].map((client) => client.quit().catch(() => undefined)),
  );
}

main()
  .then(async (exitCode) => {
    await shutdown();
    process.exitCode = exitCode;
  })
  .catch(async (error) => {
    console.error('[FAILED]', error instanceof Error ? error.message : String(error));
    await shutdown();
    process.exitCode = 1;
  });
