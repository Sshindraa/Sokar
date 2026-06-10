import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function seed() {
  console.log('Seeding test data...');

  // 1. Créer un restaurant test (upsert)
  const restId = '00000000-0000-0000-0000-000000000001';
  await db.latencyTrace.deleteMany({ where: { call: { restaurantId: restId } } });
  await db.reservation.deleteMany({ where: { restaurantId: restId } });
  await db.call.deleteMany({ where: { restaurantId: restId } });
  await db.customer.deleteMany({ where: { restaurantId: restId } });

  const restaurant = await db.restaurant.upsert({
    where: { id: restId },
    create: {
      id: restId,
      name: 'Le Petit Bistrot Parisien',
      plan: 'PRO',
      managerPhone: '+33611223344',
      managerEmail: 'gerant@petitbistrot.fr',
      phoneNumber: '+33451221528',
      openingHours: {
        mon: { open: '12:00', close: '14:30' },
        tue: { open: '12:00', close: '14:30' },
        wed: { open: '12:00', close: '14:30' },
        thu: { open: '12:00', close: '14:30' },
        fri: { open: '12:00', close: '15:00' },
        sat: { open: '19:00', close: '23:00' },
        sun: null,
      },
    },
    update: {
      name: 'Le Petit Bistrot Parisien',
      plan: 'PRO',
      managerPhone: '+33611223344',
      managerEmail: 'gerant@petitbistrot.fr',
      phoneNumber: '+33451221528',
      openingHours: {
        mon: { open: '12:00', close: '14:30' },
        tue: { open: '12:00', close: '14:30' },
        wed: { open: '12:00', close: '14:30' },
        thu: { open: '12:00', close: '14:30' },
        fri: { open: '12:00', close: '15:00' },
        sat: { open: '19:00', close: '23:00' },
        sun: null,
      },
    },
  });
  console.log(`  Restaurant: ${restaurant.name} (tel: ${restaurant.phoneNumber})`);

  // 2. Créer des clients
  const customers = await Promise.all([
    db.customer.create({
      data: {
        restaurantId: restaurant.id,
        phone: '+33612345678',
        name: 'Jean Dupont',
        visitCount: 12,
        isVip: true,
        notes: 'Client fidèle, préfère la table près de la fenêtre',
        loyaltyScore: 85,
      },
    }),
    db.customer.create({
      data: {
        restaurantId: restaurant.id,
        phone: '+33623456789',
        name: 'Marie Martin',
        visitCount: 5,
        isVip: false,
        notes: 'Allergique aux fruits de mer',
        loyaltyScore: 35,
      },
    }),
    db.customer.create({
      data: {
        restaurantId: restaurant.id,
        phone: '+33634567890',
        name: 'Pierre Durand',
        visitCount: 1,
        isVip: false,
        notes: '',
        loyaltyScore: 5,
      },
    }),
  ]);
  console.log(`  ${customers.length} clients créés`);

  // 3. Créer des calls
  const now = new Date();
  const calls = await Promise.all([
    db.call.create({
      data: {
        restaurantId: restaurant.id,
        callSid: 'CA-test-001',
        durationSec: 187,
        transcript: 'Bonjour, je voudrais réserver pour deux personnes ce soir à 20h.',
        intent: 'RESERVATION',
        outcome: 'RESERVED',
        sttProvider: 'deepgram',
        llmProvider: 'deepseek-v4-flash',
        ttsProvider: 'cartesia',
        carrier: 'vapi',
        createdAt: new Date(now.getTime() - 2 * 3600000),
      },
    }),
    db.call.create({
      data: {
        restaurantId: restaurant.id,
        callSid: 'CA-test-002',
        durationSec: 95,
        transcript: 'Bonjour, est-ce que vous avez une table pour 4 personnes demain midi ?',
        intent: 'RESERVATION',
        outcome: 'RESERVED',
        sttProvider: 'deepgram',
        llmProvider: 'deepseek-v4-flash',
        ttsProvider: 'cartesia',
        carrier: 'vapi',
        createdAt: new Date(now.getTime() - 5 * 3600000),
      },
    }),
    db.call.create({
      data: {
        restaurantId: restaurant.id,
        callSid: 'CA-test-003',
        durationSec: 45,
        transcript: 'Bonjour, quels sont vos horaires d\'ouverture ce week-end ?',
        intent: 'OTHER',
        outcome: 'INFO',
        sttProvider: 'deepgram',
        llmProvider: 'deepseek-v4-flash',
        ttsProvider: 'cartesia',
        carrier: 'vapi',
        createdAt: new Date(now.getTime() - 24 * 3600000),
      },
    }),
    db.call.create({
      data: {
        restaurantId: restaurant.id,
        callSid: 'CA-test-004',
        durationSec: 32,
        transcript: 'Appel trop court — probable erreur de numéro.',
        intent: 'OTHER',
        outcome: 'NO_ACTION',
        carrier: 'vapi',
        createdAt: new Date(now.getTime() - 48 * 3600000),
      },
    }),
  ]);
  console.log(`  ${calls.length} calls créés`);

  // 4. Créer des réservations
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(20, 0, 0, 0);

  await Promise.all([
    db.reservation.create({
      data: {
        restaurantId: restaurant.id,
        callId: calls[0].id,
        reservedAt: tomorrow,
        partySize: 2,
        customerName: 'Jean Dupont',
        customerPhone: '+33612345678',
        status: 'CONFIRMED',
        estimatedRevenue: 70, // 2 pers * 35€
      },
    }),
    db.reservation.create({
      data: {
        restaurantId: restaurant.id,
        callId: calls[1].id,
        reservedAt: new Date(tomorrow.getTime() + 12 * 3600000),
        partySize: 4,
        customerName: 'Marie Martin',
        customerPhone: '+33623456789',
        status: 'CONFIRMED',
        estimatedRevenue: 140,
      },
    }),
    db.reservation.create({
      data: {
        restaurantId: restaurant.id,
        reservedAt: new Date(now.getTime() - 7 * 86400000),
        partySize: 3,
        customerName: 'Sophie Bernard',
        customerPhone: '+33645678901',
        status: 'SEATED',
        estimatedRevenue: 105,
        confirmedRevenue: 120,
      },
    }),
    db.reservation.create({
      data: {
        restaurantId: restaurant.id,
        reservedAt: new Date(now.getTime() - 14 * 86400000),
        partySize: 5,
        customerName: 'Lucas Petit',
        customerPhone: '+33656789012',
        status: 'SEATED',
        estimatedRevenue: 175,
        confirmedRevenue: 210,
      },
    }),
  ]);
  console.log(`  4 réservations créées`);

  console.log('\n✅ Seed terminé !');
  console.log(`   Dashboard: http://localhost:3001/dashboard`);
  console.log(`   API health: http://localhost:4000/health`);
  console.log(`   Dashboard stats: curl http://localhost:4000/dashboard/stats?restaurantId=${restaurant.id}`);
}

seed()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
