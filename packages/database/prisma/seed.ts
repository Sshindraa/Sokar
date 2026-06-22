import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const DEMO_SLUG = 'chez-sokar-demo';
const DEMO_PHONE = '+33102030405';
const DEMO_MCP_KEY = 'sk_sokar_agent_' + 'a'.repeat(40);

const openingHours: Prisma.JsonValue = {
  tue: { open: '12:00', close: '22:00' },
  wed: { open: '12:00', close: '22:00' },
  thu: { open: '12:00', close: '22:00' },
  fri: { open: '12:00', close: '23:00' },
  sat: { open: '12:00', close: '23:00' },
};

const onboardingTasks: Prisma.JsonValue = {
  restaurant: { status: 'completed', completedAt: new Date().toISOString() },
  hours: { status: 'completed', completedAt: new Date().toISOString() },
  knowledge: { status: 'completed', completedAt: new Date().toISOString() },
  calendar: { status: 'skipped', skippedAt: new Date().toISOString() },
  phone: { status: 'completed', completedAt: new Date().toISOString() },
};

async function main() {
  console.log('Seeding demo restaurant...');

  const restaurant = await prisma.restaurant.upsert({
    where: { slug: DEMO_SLUG },
    update: {
      name: 'Chez Sokar',
      plan: 'STARTER',
      managerPhone: '+33601020304',
      managerEmail: 'demo@sokar.com',
      phoneNumber: DEMO_PHONE,
      phoneE164: DEMO_PHONE,
      openingHours,
      carrier: 'telnyx',
      cuisineType: ['Bistrot', 'Française'],
      priceRange: 2,
      ambiance: ['Convivial', 'Branché'],
      noiseLevel: 'ANIME',
      dietary: ['Végétarien', 'Sans gluten'],
      formattedAddress: '12 Rue de la République, 69001 Lyon',
      timezone: 'Europe/Paris',
      onboardingTasks,
      onboardingDone: true,
      onboardingCompletedAt: new Date(),
      onboardingActivatedAt: new Date(),
      agenticOptIn: true,
      openaiReserveEnabled: true,
    },
    create: {
      slug: DEMO_SLUG,
      name: 'Chez Sokar',
      plan: 'STARTER',
      managerPhone: '+33601020304',
      managerEmail: 'demo@sokar.com',
      phoneNumber: DEMO_PHONE,
      phoneE164: DEMO_PHONE,
      openingHours,
      carrier: 'telnyx',
      cuisineType: ['Bistrot', 'Française'],
      priceRange: 2,
      ambiance: ['Convivial', 'Branché'],
      noiseLevel: 'ANIME',
      dietary: ['Végétarien', 'Sans gluten'],
      formattedAddress: '12 Rue de la République, 69001 Lyon',
      timezone: 'Europe/Paris',
      onboardingTasks,
      onboardingDone: true,
      onboardingCompletedAt: new Date(),
      onboardingActivatedAt: new Date(),
      agenticOptIn: true,
      openaiReserveEnabled: true,
    },
  });

  await prisma.agentPersonality.upsert({
    where: { restaurantId: restaurant.id },
    update: {
      profileType: 'BISTROT_BRASSERIE',
      speakingRate: 1.05,
      pitchShift: 1.0,
      fillerStyle: 'WARM',
      microphoneThreshold: -42,
      targetLatencyMs: 140,
      systemPromptExtra:
        "Tu es Callyx, l'assistant vocal de Chez Sokar. Tu es chaleureux, direct, et tu parles comme un habitué du quartier. " +
        'Tu prends les réservations pour le midi et le soir. Les grands groupes (8+) sont transférés au gérant. ' +
        "Tu confirmes toujours la date, l'heure et le nombre de personnes avant de créer la réservation.",
    },
    create: {
      restaurantId: restaurant.id,
      profileType: 'BISTROT_BRASSERIE',
      speakingRate: 1.05,
      pitchShift: 1.0,
      fillerStyle: 'WARM',
      microphoneThreshold: -42,
      targetLatencyMs: 140,
      systemPromptExtra:
        "Tu es Callyx, l'assistant vocal de Chez Sokar. Tu es chaleureux, direct, et tu parles comme un habitué du quartier. " +
        'Tu prends les réservations pour le midi et le soir. Les grands groupes (8+) sont transférés au gérant. ' +
        "Tu confirmes toujours la date, l'heure et le nombre de personnes avant de créer la réservation.",
    },
  });

  await prisma.restaurantExposureSettings.upsert({
    where: { restaurantId: restaurant.id },
    update: {
      mcpEnabled: true,
      openaiReserveEnabled: true,
      exposedCreneaux: [
        { day: 'tue', start: '12:00', end: '14:00' },
        { day: 'tue', start: '19:00', end: '22:00' },
        { day: 'wed', start: '12:00', end: '14:00' },
        { day: 'wed', start: '19:00', end: '22:00' },
        { day: 'thu', start: '12:00', end: '14:00' },
        { day: 'thu', start: '19:00', end: '22:00' },
        { day: 'fri', start: '12:00', end: '14:00' },
        { day: 'fri', start: '19:00', end: '23:00' },
        { day: 'sat', start: '12:00', end: '14:00' },
        { day: 'sat', start: '19:00', end: '23:00' },
      ] as Prisma.JsonValue,
      maxPartySize: 12,
      minLeadTimeMinutes: 30,
      quoteTtlSeconds: 300,
      holdTtlSeconds: 420,
      capacitySpecials: {
        default: { tables: 10, seats: 40 },
        '2026-12-31': { tables: 8, seats: 32, reason: 'Réveillon' },
      } as Prisma.JsonValue,
    },
    create: {
      restaurantId: restaurant.id,
      mcpEnabled: true,
      openaiReserveEnabled: true,
      exposedCreneaux: [
        { day: 'tue', start: '12:00', end: '14:00' },
        { day: 'tue', start: '19:00', end: '22:00' },
        { day: 'wed', start: '12:00', end: '14:00' },
        { day: 'wed', start: '19:00', end: '22:00' },
        { day: 'thu', start: '12:00', end: '14:00' },
        { day: 'thu', start: '19:00', end: '22:00' },
        { day: 'fri', start: '12:00', end: '14:00' },
        { day: 'fri', start: '19:00', end: '23:00' },
        { day: 'sat', start: '12:00', end: '14:00' },
        { day: 'sat', start: '19:00', end: '23:00' },
      ] as Prisma.JsonValue,
      maxPartySize: 12,
      minLeadTimeMinutes: 30,
      quoteTtlSeconds: 300,
      holdTtlSeconds: 420,
      capacitySpecials: {
        default: { tables: 10, seats: 40 },
        '2026-12-31': { tables: 8, seats: 32, reason: 'Réveillon' },
      } as Prisma.JsonValue,
    },
  });

  await prisma.agentClient.upsert({
    where: {
      keyHash: createHash('sha256').update(DEMO_MCP_KEY).digest('hex'),
    },
    update: {
      restaurantId: restaurant.id,
      name: 'Sokar demo MCP client',
      scopes: ['mcp:read', 'mcp:reserve', 'mcp:cancel'],
      allowedOrigins: ['https://claude.ai', 'https://cursor.sh'],
      revokedAt: null,
    },
    create: {
      restaurantId: restaurant.id,
      name: 'Sokar demo MCP client',
      keyPrefix: DEMO_MCP_KEY.slice(0, 'sk_sokar_agent_'.length + 8),
      keyHash: createHash('sha256').update(DEMO_MCP_KEY).digest('hex'),
      scopes: ['mcp:read', 'mcp:reserve', 'mcp:cancel'],
      allowedOrigins: ['https://claude.ai', 'https://cursor.sh'],
    },
  });

  // Customer de test (non-VIP)
  await prisma.customer.upsert({
    where: { restaurantId_phone: { restaurantId: restaurant.id, phone: '+33611223344' } },
    update: { name: 'Alice Test', isVip: false },
    create: {
      restaurantId: restaurant.id,
      phone: '+33611223344',
      name: 'Alice Test',
      isVip: false,
    },
  });

  // Customer VIP de test
  await prisma.customer.upsert({
    where: { restaurantId_phone: { restaurantId: restaurant.id, phone: '+33655667788' } },
    update: { name: 'Bob VIP', isVip: true, visitCount: 12, loyaltyScore: 9.5 },
    create: {
      restaurantId: restaurant.id,
      phone: '+33655667788',
      name: 'Bob VIP',
      isVip: true,
      visitCount: 12,
      loyaltyScore: 9.5,
    },
  });

  console.log(`Demo restaurant seeded: ${restaurant.id} (${DEMO_SLUG})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
