import { z } from 'zod';

export const CreateCustomerSchema = z.object({
  restaurantId:    z.string().uuid(),
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

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
