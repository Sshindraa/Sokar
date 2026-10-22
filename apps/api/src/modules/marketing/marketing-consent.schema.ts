import { z } from 'zod';

/**
 * Optional block of the public booking requests. Additive: a client that does not send it keeps
 * working, and a missing or false value never records anything. `version` is checked by the
 * service, not here, so an outdated page cannot make a booking fail.
 */
export const BookingMarketingConsentSchema = z.object({
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
  version: z.string().trim().min(1).max(80),
});
