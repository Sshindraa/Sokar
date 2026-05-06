import { betterAuth }    from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db }            from '../shared/db/client';

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  secret:   process.env.BETTER_AUTH_SECRET!,
  baseURL:  process.env.BETTER_AUTH_URL!,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: process.env.NODE_ENV === 'production',
  },
});
