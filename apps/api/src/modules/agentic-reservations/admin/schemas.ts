import { z } from 'zod';

export const OptInSchema = z
  .object({
    mcp: z.boolean(),
    openaiReserve: z.boolean(),
  })
  .refine((v) => !v.openaiReserve || v.mcp, {
    message: 'openaiReserve requiert mcp activé (pré-requis feed)',
  });

export type OptInInput = z.infer<typeof OptInSchema>;

export const ExposedCreneauSchema = z.object({
  /** 0 = dimanche, 6 = samedi */
  day: z.number().int().min(0).max(6),
  /** HH:mm */
  from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** HH:mm */
  to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export const ExposureSettingsSchema = z
  .object({
    maxPartySize: z.number().int().min(1).max(50).optional(),
    minLeadTimeMinutes: z
      .number()
      .int()
      .min(0)
      .max(24 * 60)
      .optional(),
    requireManualValidation: z.boolean().optional(),
    quoteTtlSeconds: z.number().int().min(30).max(3600).optional(),
    holdTtlSeconds: z.number().int().min(60).max(3600).optional(),
    noShowPolicy: z.enum(['warning', 'fee', 'block']).optional(),
    notificationChannels: z
      .array(z.enum(['sms', 'email']))
      .min(1)
      .optional(),
    exposedCreneaux: z.array(ExposedCreneauSchema).max(50).optional(),
    capacitySpecials: z
      .object({
        terrasse: z.number().int().min(0).max(50).optional(),
        pmr: z.number().int().min(0).max(50).optional(),
        chien: z.boolean().optional(),
        poussette: z.boolean().optional(),
      })
      .partial()
      .optional(),
  })
  .refine(
    (v) => {
      if (v.holdTtlSeconds !== undefined && v.quoteTtlSeconds !== undefined) {
        return v.holdTtlSeconds > v.quoteTtlSeconds;
      }
      return true;
    },
    { message: 'holdTtlSeconds doit être strictement supérieur à quoteTtlSeconds' },
  );

export type ExposureSettingsInput = z.infer<typeof ExposureSettingsSchema>;

export const AgentClientScopeSchema = z.enum(['mcp:read', 'mcp:reserve', 'mcp:cancel']);

export const AgentClientCreateSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(AgentClientScopeSchema).min(1).max(3),
  allowedOrigins: z
    .array(
      z
        .string()
        .trim()
        .regex(/^https?:\/\/[^/\s]+$/i, 'Origin attendu, ex: https://claude.ai'),
    )
    .max(10)
    .default([]),
});

export type AgentClientCreateInput = z.infer<typeof AgentClientCreateSchema>;
