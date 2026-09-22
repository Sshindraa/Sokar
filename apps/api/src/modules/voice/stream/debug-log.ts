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
  try {
    const logPath =
      process.env.DEBUG_LOG_PATH || path.join(process.cwd(), 'scratch', 'call_debug.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, logMsg);
  } catch (e) {
    logger.error({ err: e }, 'Failed to write debug log');
  }
}
