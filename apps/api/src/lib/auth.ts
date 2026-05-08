import crypto from 'node:crypto';
import { betterAuth }    from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db }            from '../shared/db/client';

const secret  = process.env.BETTER_AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const baseURL = process.env.BETTER_AUTH_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
  || 'http://localhost:3000';

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  secret,
  baseURL,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: process.env.NODE_ENV === 'production',
  },
});
