/**
 * Waiting list — schémas Zod partagés entre les routes publiques (Connect)
 * et admin (floor-plan).
 */

import { z } from 'zod';

export const WaitingListJoinInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:mm'),
  partySize: z.coerce.number().int().min(1),
  customer: z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().max(100).optional(),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'phone must be E.164 (e.g. +33612345678)'),
    email: z.union([z.string().email(), z.literal(''), z.undefined()]).optional(),
  }),
  preferredSectionId: z.string().uuid().optional(),
  source: z.string().max(40).default('web'),
});
export type WaitingListJoinInput = z.infer<typeof WaitingListJoinInputSchema>;

export const CancelWaitingListTokenSchema = z.object({
  token: z.string().min(1, 'token is required'),
});
export type CancelWaitingListToken = z.infer<typeof CancelWaitingListTokenSchema>;

export const WaitingListAdminQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
  status: z.enum(['PENDING', 'PROMOTED', 'CANCELLED', 'EXPIRED']).optional(),
});
export type WaitingListAdminQuery = z.infer<typeof WaitingListAdminQuerySchema>;
