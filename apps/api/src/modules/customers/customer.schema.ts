import { z } from 'zod';

export const CreateCustomerSchema = z.object({
  restaurantId:    z.string(),
  phone:           z.string().regex(/^\+?[0-9]{7,15}$/),
  name:            z.string().min(1).max(100).optional(),
  notes:           z.string().max(500).optional(),
  specialOccasion: z.string().max(200).optional(),
  isVip:           z.boolean().default(false),
});

export const UpdateCustomerSchema = CreateCustomerSchema.partial().omit({ restaurantId: true, phone: true });

export const ToggleVipSchema = z.object({
  isVip: z.boolean(),
});

export const CustomerParamsSchema = z.object({
  id: z.string().uuid(),
});

export const CustomerQuerySchema = z.object({
  phone:  z.string().regex(/^\+?[0-9]{7,15}$/).optional(),
  limit:  z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
export type CustomerQuery = z.infer<typeof CustomerQuerySchema>;
