/**
 * Utilitaire de debug logging pour le stream voice.
 *
 * Extrait de handler.ts pour permettre le partage entre les modules
 * tts-handler, llm-handler et handler principal.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../shared/logger/pino';
import { redactPii } from './pii-redact';

export function writeDebugLog(msg: string, err?: unknown) {
  const timestamp = new Date().toISOString();
  const errStr =
    err instanceof Error
      ? ` | ERROR: ${redactPii(err.message)}\n${redactPii(err.stack ?? '')}`
      : err
        ? ` | ERROR: ${redactPii(String(err))}`
        : '';
  const logMsg = `[${timestamp}] ${redactPii(msg)}${errStr}\n`;
  const logPath =
    process.env.DEBUG_LOG_PATH || path.join(process.cwd(), 'scratch', 'call_debug.log');
  fs.promises
    .mkdir(path.dirname(logPath), { recursive: true })
    .then(() => fs.promises.appendFile(logPath, logMsg))
    .catch((err) => logger.error({ err }, 'Failed to write debug log'));
}
