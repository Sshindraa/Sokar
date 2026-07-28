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
      description: 'Bistrot français à Lyon, convivial et branché.',
      city: 'Lyon',
      country: 'FR',
      postalCode: '69001',
      publishedAt: new Date(),
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
      description: 'Bistrot français à Lyon, convivial et branché.',
      city: 'Lyon',
      country: 'FR',
      postalCode: '69001',
      publishedAt: new Date(),
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
      // Sokar Connect
      connectPublished: true,
      connectPublishedAt: new Date(),
      connectAgentic: false,
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
      // Sokar Connect
      connectPublished: true,
      connectPublishedAt: new Date(),
      connectAgentic: false,
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

  // ─── Sokar Connect — Seed restos supplémentaires (Lyon + Paris) ────
  // Pour tester les pages locales (/restaurants/lyon, /restaurants/paris)
  // qui requièrent ≥5 restos par ville.
  // connectPublished=true, connectAgentic=false.
  // SKIP en production : NODE_ENV=production → ne pas polluer l'index.
  // (cf. spec connect-v1.1 §11.1)
  if (process.env.NODE_ENV !== 'production') {
    const LYON_RESTOS = [
      {
        slug: 'chez-sokar-bouchon-lyon',
        name: 'Chez Sokar — Bouchon Lyonnais',
        cuisine: ['Bistrot', 'Lyonnaise'],
        description: 'Bouchon lyonnais traditionnel dans le Vieux Lyon.',
        address: '5 Rue du Bœuf, 69005 Lyon',
        city: 'Lyon',
        phone: '+334****0505',
        lat: 45.7638,
        lng: 4.8272,
      },
      {
        slug: 'chez-sokar-italien-lyon',
        name: 'Chez Sokar — Trattoria Italienne',
        cuisine: ['Italien', 'Pizza', 'Pâtes'],
        description: "Trattoria italienne authentique dans le quartier de la Presqu'île.",
        address: '22 Rue Mercière, 69002 Lyon',
        city: 'Lyon',
        phone: '+334****0606',
        lat: 45.764,
        lng: 4.833,
      },
      {
        slug: 'chez-sokar-sushi-lyon',
        name: 'Chez Sokar — Sushi Bar',
        cuisine: ['Japonais', 'Sushi', 'Poisson'],
        description: 'Bar à sushi moderne avec produits frais, situé à Confluence.',
        address: '112 Cours Charlemagne, 69002 Lyon',
        city: 'Lyon',
        phone: '+334****0707',
        lat: 45.7307,
        lng: 4.8183,
      },
      {
        slug: 'chez-sokar-terrasse-lyon',
        name: 'Chez Sokar — Terrasse Croix-Rousse',
        cuisine: ['Française', 'Méditerranéenne'],
        description: 'Restaurant avec grande terrasse ombragée sur les pentes de la Croix-Rousse.',
        address: '5 Montée de la Grande Côte, 69001 Lyon',
        city: 'Lyon',
        phone: '+334****0808',
        lat: 45.7715,
        lng: 4.8279,
      },
    ];

    const PARIS_RESTOS = [
      {
        slug: 'chez-sokar-bistrot-paris',
        name: 'Chez Sokar — Bistrot Montmartre',
        cuisine: ['Bistrot', 'Française'],
        description: 'Bistrot de quartier au pied de la butte Montmartre.',
        address: '18 Rue des Abbesses, 75018 Paris',
        city: 'Paris',
        phone: '+331****0909',
        lat: 48.8842,
        lng: 2.3396,
      },
      {
        slug: 'chez-sokar-neo-paris',
        name: 'Chez Sokar — Néo-Bistrot Marais',
        cuisine: ['Néo-bistrot', 'Française', 'Moderne'],
        description: 'Cuisine moderne de saison dans le Marais, cave nature pointue.',
        address: '34 Rue du Temple, 75004 Paris',
        city: 'Paris',
        phone: '+331****1010',
        lat: 48.8606,
        lng: 2.3522,
      },
      {
        slug: 'chez-sokar-ramen-paris',
        name: 'Chez Sokar — Ramen Izakaya',
        cuisine: ['Japonais', 'Ramen', 'Izakaya'],
        description: 'Izakaya et ramen maison dans le 2e arrondissement.',
        address: '12 Rue Sainte-Anne, 75002 Paris',
        city: 'Paris',
        phone: '+331****1111',
        lat: 48.8656,
        lng: 2.3362,
      },
      {
        slug: 'chez-sokar-tapas-paris',
        name: 'Chez Sokar — Tapas Bar Bastille',
        cuisine: ['Espagnol', 'Tapas', 'Bar à vins'],
        description: 'Tapas et petits producteurs ibériques près de la Bastille.',
        address: '27 Rue de la Roquette, 75011 Paris',
        city: 'Paris',
        phone: '+331****1212',
        lat: 48.8531,
        lng: 2.3781,
      },
      {
        slug: 'chez-sokar-veggie-paris',
        name: 'Chez Sokar — Végétarien Canal Saint-Martin',
        cuisine: ['Végétarien', 'Bio', 'Moderne'],
        description: 'Table végétarienne 100% bio le long du Canal Saint-Martin.',
        address: '40 Rue de Lancry, 75010 Paris',
        city: 'Paris',
        phone: '+331****1313',
        lat: 48.8705,
        lng: 2.3631,
      },
    ];

    const CONNECT_RESTOS = [...LYON_RESTOS, ...PARIS_RESTOS];

    const seedOpeningHours = {
      tue: { open: '12:00', close: '14:30' },
      wed: { open: '12:00', close: '14:30' },
      thu: { open: '12:00', close: '14:30' },
      fri: { open: '12:00', close: '14:30' },
      sat: { open: '12:00', close: '23:00' },
    } as Prisma.JsonValue;

    for (const r of CONNECT_RESTOS) {
      const resto = await prisma.restaurant.upsert({
        where: { slug: r.slug },
        update: {
          name: r.name,
          description: r.description,
          formattedAddress: r.address,
          city: r.city,
          country: 'FR',
          postalCode: r.address.match(/\b\d{5}\b/)?.[0] ?? '69002',
          phoneNumber: r.phone,
          phoneE164: r.phone,
          cuisineType: r.cuisine,
          priceRange: 2,
          ambiance: ['Convivial'],
          noiseLevel: 'ANIME',
          openingHours: seedOpeningHours,
          timezone: 'Europe/Paris',
          agenticOptIn: true,
          publishedAt: new Date(),
          managerPhone: r.phone,
          managerEmail: 'connect-demo@sokar.com',
        },
        create: {
          slug: r.slug,
          name: r.name,
          description: r.description,
          formattedAddress: r.address,
          city: r.city,
          country: 'FR',
          postalCode: r.address.match(/\b\d{5}\b/)?.[0] ?? '69002',
          phoneNumber: r.phone,
          phoneE164: r.phone,
          cuisineType: r.cuisine,
          priceRange: 2,
          ambiance: ['Convivial'],
          noiseLevel: 'ANIME',
          openingHours: seedOpeningHours,
          timezone: 'Europe/Paris',
          agenticOptIn: true,
          publishedAt: new Date(),
          managerPhone: r.phone,
          managerEmail: 'connect-demo@sokar.com',
        },
      });

      await prisma.restaurantExposureSettings.upsert({
        where: { restaurantId: resto.id },
        update: {
          connectPublished: true,
          connectAgentic: false,
          connectPublishedAt: new Date(),
          maxPartySize: 12,
          minLeadTimeMinutes: 30,
          exposedCreneaux: [
            { day: 'tue', start: '12:00', end: '14:00' },
            { day: 'wed', start: '12:00', end: '14:00' },
            { day: 'thu', start: '12:00', end: '14:00' },
            { day: 'fri', start: '12:00', end: '14:00' },
            { day: 'sat', start: '12:00', end: '23:00' },
          ] as Prisma.JsonValue,
        },
        create: {
          restaurantId: resto.id,
          connectPublished: true,
          connectAgentic: false,
          connectPublishedAt: new Date(),
          maxPartySize: 12,
          minLeadTimeMinutes: 30,
          exposedCreneaux: [
            { day: 'tue', start: '12:00', end: '14:00' },
            { day: 'wed', start: '12:00', end: '14:00' },
            { day: 'thu', start: '12:00', end: '14:00' },
            { day: 'fri', start: '12:00', end: '14:00' },
            { day: 'sat', start: '12:00', end: '23:00' },
          ] as Prisma.JsonValue,
        },
      });

      console.info(`Sokar Connect seed: ${resto.slug} (${r.city}, connectPublished=true)`);
    }

    // ─── Pilote P1 — 9 restaurants réalistes (villes variées) ──────────
    // Noms réalistes français, pas de préfixe "Chez Sokar".
    // connectPublished=true, connectAgentic=false, connectDescription rempli.
    // Couvre 9 villes différentes pour valider les pages locales.
    const PILOT_RESTOS = [
      {
        slug: 'le-bistrot-parisien',
        name: 'Le Bistrot Parisien',
        cuisine: ['Bistrot', 'Française'],
        description: 'Bistrot de quartier au pied de Montmartre, cuisine de saison et terrasse ensoleillée.',
        connectDescription: 'Bistrot français convivial à Paris, terrasse et cuisine de saison.',
        address: '18 Rue des Abbesses, 75018 Paris',
        city: 'Paris',
        postalCode: '75018',
        phone: '+33142516500',
        lat: 48.8842,
        lng: 2.3396,
        coverImageUrl: 'https://images.unsplash.com/photo-1559339352-1e3c8e0e0b7e?w=1200',
      },
      {
        slug: 'la-table-de-nantes',
        name: 'La Table de Nantes',
        cuisine: ['Méditerranéen', 'Française'],
        description: 'Table méditerranéenne au cœur de Nantes, produits frais et vins de Loire.',
        connectDescription: 'Cuisine méditerranéenne et vins de Loire au centre de Nantes.',
        address: '12 Rue du Coudray, 44000 Nantes',
        city: 'Nantes',
        postalCode: '44000',
        phone: '+33240739800',
        lat: 47.2184,
        lng: -1.5547,
        coverImageUrl: 'https://images.unsplash.com/photo-1517248135467-3c0c8e7e0b7e?w=1200',
      },
      {
        slug: 'chez-marcel',
        name: 'Chez Marcel',
        cuisine: ['Bistrot', 'Lyonnaise'],
        description: 'Bistrot lyonnais traditionnel dans le Vieux Lyon, quenelles et bouchons maison.',
        connectDescription: 'Bistrot lyonnais authentique, spécialités régionales dans le Vieux Lyon.',
        address: '5 Rue du Bœuf, 69005 Lyon',
        city: 'Lyon',
        postalCode: '69005',
        phone: '+33478427100',
        lat: 45.7638,
        lng: 4.8272,
        coverImageUrl: 'https://images.unsplash.com/photo-1559339352-1e3c8e0e0b7e?w=1200',
      },
      {
        slug: 'olive-et-thym',
        name: 'Olive & Thym',
        cuisine: ['Méditerranéen', 'Provençal'],
        description: 'Cuisine provençale colorée au Vieux-Port de Marseille, huile d’olive et herbes du soleil.',
        connectDescription: 'Table provençale au Vieux-Port de Marseille, produits du terroir.',
        address: '34 Quai du Port, 13002 Marseille',
        city: 'Marseille',
        postalCode: '13002',
        phone: '+33491902300',
        lat: 43.2951,
        lng: 5.3741,
        coverImageUrl: 'https://images.unsplash.com/photo-1517248135467-3c0c8e7e0b7e?w=1200',
      },
      {
        slug: 'le-comptoir-lyonnais',
        name: 'Le Comptoir Lyonnais',
        cuisine: ['Brasserie', 'Lyonnaise'],
        description: 'Brasserie lyonnaise à Bordeaux, charcuterie maison et crus du Beaujolais.',
        connectDescription: 'Brasserie lyonnaise au centre de Bordeaux, charcuterie et vins du Beaujolais.',
        address: '8 Rue des Bahutiers, 33000 Bordeaux',
        city: 'Bordeaux',
        postalCode: '33000',
        phone: '+33556481200',
        lat: 44.8386,
        lng: -0.5703,
        coverImageUrl: 'https://images.unsplash.com/photo-1559339352-1e3c8e0e0b7e?w=1200',
      },
      {
        slug: 'la-mere-brazier',
        name: 'La Mère Brazier',
        cuisine: ['Française', 'Gastronomique'],
        description: 'Table gastronomique étoilée à Lille, grande cuisine française et carte des vins exceptionnelle.',
        connectDescription: 'Restaurant gastronomique à Lille, cuisine française raffinée et cave d’exception.',
        address: '15 Rue de la Monnaie, 59000 Lille',
        city: 'Lille',
        postalCode: '59000',
        phone: '+33203041500',
        lat: 50.6372,
        lng: 3.0653,
        coverImageUrl: 'https://images.unsplash.com/photo-1517248135467-3c0c8e7e0b7e?w=1200',
      },
      {
        slug: 'bistrot-du-marche',
        name: 'Bistrot du Marché',
        cuisine: ['Bistrot', 'Française'],
        description: 'Bistrot de marché à Toulouse, produits frais du jour et ambiance chaleureuse.',
        connectDescription: 'Bistrot de marché toulousain, produits frais et ambiance conviviale.',
        address: '22 Place Victor Hugo, 31000 Toulouse',
        city: 'Toulouse',
        postalCode: '31000',
        phone: '+33561223400',
        lat: 43.6088,
        lng: 1.4484,
        coverImageUrl: 'https://images.unsplash.com/photo-1559339352-1e3c8e0e0b7e?w=1200',
      },
      {
        slug: 'le-petit-bouchon',
        name: 'Le Petit Bouchon',
        cuisine: ['Bistrot', 'Française'],
        description: 'Petit bouchon alsacien à Strasbourg, choucroute et tarte flambée dans un cadre authentique.',
        connectDescription: 'Bistrot alsacien à Strasbourg, spécialités régionales et ambiance conviviale.',
        address: '10 Rue des Tonneliers, 67000 Strasbourg',
        city: 'Strasbourg',
        postalCode: '67000',
        phone: '+33388356700',
        lat: 48.5839,
        lng: 7.7455,
        coverImageUrl: 'https://images.unsplash.com/photo-1517248135467-3c0c8e7e0b7e?w=1200',
      },
      {
        slug: 'aux-vieux-arceaux',
        name: 'Aux Vieux Arceaux',
        cuisine: ['Provençal', 'Méditerranéen'],
        description: 'Cuisine provençale de caractère à Nice, face au port, légumes du marché et poissons frais.',
        connectDescription: 'Table provençale au port de Nice, poissons frais et légumes du marché.',
        address: '5 Quai des Fabrons, 06300 Nice',
        city: 'Nice',
        postalCode: '06300',
        phone: '+33493980100',
        lat: 43.6956,
        lng: 7.2683,
        coverImageUrl: 'https://images.unsplash.com/photo-1559339352-1e3c8e0e0b7e?w=1200',
      },
    ];

    // Horaires réalistes : mar-dim, midi + soir, fermé lundi.
    // Le schéma Zod (restaurant.routes.ts) n'accepte qu'une seule plage {open, close}
    // par jour (ou null) — on couvre donc la journée entière midi+soir.
    const pilotOpeningHours = {
      tue: { open: '12:00', close: '23:00' },
      wed: { open: '12:00', close: '23:00' },
      thu: { open: '12:00', close: '23:00' },
      fri: { open: '12:00', close: '23:00' },
      sat: { open: '12:00', close: '23:00' },
      sun: { open: '12:00', close: '22:00' },
    } as Prisma.JsonValue;

    const pilotExposedCreneaux = [
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
      { day: 'sun', start: '12:00', end: '14:00' },
      { day: 'sun', start: '19:00', end: '22:00' },
    ] as Prisma.JsonValue;

    for (const r of PILOT_RESTOS) {
      const resto = await prisma.restaurant.upsert({
        where: { slug: r.slug },
        update: {
          name: r.name,
          description: r.description,
          formattedAddress: r.address,
          city: r.city,
          country: 'FR',
          postalCode: r.postalCode,
          phoneNumber: r.phone,
          phoneE164: r.phone,
          cuisineType: r.cuisine,
          priceRange: 2,
          ambiance: ['Convivial'],
          noiseLevel: 'ANIME',
          openingHours: pilotOpeningHours,
          timezone: 'Europe/Paris',
          agenticOptIn: true,
          publishedAt: new Date(),
          coverImageUrl: r.coverImageUrl,
          lat: r.lat,
          lng: r.lng,
          managerPhone: r.phone,
          managerEmail: 'pilot@sokar.com',
        },
        create: {
          slug: r.slug,
          name: r.name,
          description: r.description,
          formattedAddress: r.address,
          city: r.city,
          country: 'FR',
          postalCode: r.postalCode,
          phoneNumber: r.phone,
          phoneE164: r.phone,
          cuisineType: r.cuisine,
          priceRange: 2,
          ambiance: ['Convivial'],
          noiseLevel: 'ANIME',
          openingHours: pilotOpeningHours,
          timezone: 'Europe/Paris',
          agenticOptIn: true,
          publishedAt: new Date(),
          coverImageUrl: r.coverImageUrl,
          lat: r.lat,
          lng: r.lng,
          managerPhone: r.phone,
          managerEmail: 'pilot@sokar.com',
        },
      });

      await prisma.restaurantExposureSettings.upsert({
        where: { restaurantId: resto.id },
        update: {
          connectPublished: true,
          connectAgentic: false,
          connectPublishedAt: new Date(),
          connectDescription: r.connectDescription,
          maxPartySize: 12,
          minLeadTimeMinutes: 30,
          exposedCreneaux: pilotExposedCreneaux,
        },
        create: {
          restaurantId: resto.id,
          connectPublished: true,
          connectAgentic: false,
          connectPublishedAt: new Date(),
          connectDescription: r.connectDescription,
          maxPartySize: 12,
          minLeadTimeMinutes: 30,
          exposedCreneaux: pilotExposedCreneaux,
        },
      });

      console.info(`Pilot P1 seed: ${resto.slug} (${r.city}, connectPublished=true)`);
    }

    console.info('Sokar Connect seed complete — 5 Lyon + 5 Paris + 9 pilot P1');
  } else {
    console.info('Sokar Connect seed skipped (NODE_ENV=production)');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
