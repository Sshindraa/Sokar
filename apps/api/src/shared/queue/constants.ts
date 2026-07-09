/**
 * Constantes de concurrence workers et configuration BullMQ.
 */

export const EXPIRE_HOLD_WORKER_CONCURRENCY = 4;
export const EXPIRE_QUOTE_WORKER_CONCURRENCY = 4;
export const CONFIRMATION_SMS_WORKER_CONCURRENCY = 3;
export const CALL_RECOVERY_WORKER_CONCURRENCY = 3;
export const AGENTIC_QUEUE_REMOVE_ON_COMPLETE = 1000;
