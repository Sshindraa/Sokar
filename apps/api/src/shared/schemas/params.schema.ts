import { z } from 'zod';

/** Validation UUID pour les paramètres de route /:id */
export const IdParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

export type IdParam = z.infer<typeof IdParamSchema>;

/** Validation ID de Restaurant (peut être un Clerk Org ID org_... ou un ID de test) */
export const RestaurantIdParamSchema = z.object({
  id: z.string().min(1, 'Restaurant ID cannot be empty'),
});

export type RestaurantIdParam = z.infer<typeof RestaurantIdParamSchema>;

