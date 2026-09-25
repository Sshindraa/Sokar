import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildSttKeyterms } from '../../src/modules/voice/stream/stt-keyterms';
import { buildDeepgramKeyterms } from '../../src/modules/voice/stream/stt-deepgram-keyterms';

const output = join(__dirname, '.data', 'nb-a3-keyterms.json');

function buildProfile(restaurant: {
  name: string;
  formattedAddress?: string | null;
  neighborhoods?: string[];
  city?: string | null;
  cuisineType?: string[];
  menuTerms?: string[];
}): { current: string[]; generated: string[] } {
  return {
    current: buildSttKeyterms(restaurant.name),
    generated: buildDeepgramKeyterms({
      restaurantName: restaurant.name,
      address: restaurant.formattedAddress,
      neighborhoods: restaurant.neighborhoods,
      city: restaurant.city,
      cuisineTypes: restaurant.cuisineType,
      menuTerms: restaurant.menuTerms,
    }),
  };
}

function profileFromEnvironment(): { current: string[]; generated: string[] } {
  const name = process.env.BENCH_A3_RESTAURANT_NAME?.trim();
  if (!name) throw new Error('BENCH_A3_RESTAURANT_NAME manquant; aucun profil exporté');

  return buildProfile({
    name,
    formattedAddress: process.env.BENCH_A3_PUBLIC_ADDRESS?.trim() || null,
    neighborhoods: (process.env.BENCH_A3_NEIGHBORHOOD ?? '')
      .split('|')
      .map((neighborhood) => neighborhood.trim())
      .filter(Boolean),
    city: process.env.BENCH_A3_CITY?.trim() || null,
    cuisineType: (process.env.BENCH_A3_CUISINES ?? '')
      .split('|')
      .map((cuisine) => cuisine.trim())
      .filter(Boolean),
    menuTerms: (process.env.BENCH_A3_MENU_TERMS ?? '')
      .split('|')
      .map((term) => term.trim())
      .filter(Boolean),
  });
}

async function main(): Promise<void> {
  if (process.env.BENCH_A3_PROFILE_SOURCE === 'env') {
    const payload = profileFromEnvironment();
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(
      `Profils de keyterms enregistrés dans ${output} (${payload.generated.length} générés).\n`,
    );
    return;
  }

  const restaurantId = process.env.BENCH_RESTAURANT_ID?.trim();
  if (!restaurantId) throw new Error('BENCH_RESTAURANT_ID manquant; aucun profil chargé');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL manquant; aucun profil chargé');
  const databaseHost = new URL(databaseUrl).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(databaseHost)) {
    throw new Error(
      'Le profil banc doit être chargé depuis la base locale, aucune lecture distante',
    );
  }

  const db = new PrismaClient();
  try {
    const restaurant = await db.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        name: true,
        formattedAddress: true,
        city: true,
        cuisineType: true,
      },
    });
    if (!restaurant) {
      throw new Error('Restaurant absent de la base locale; aucun appel banc ne sera lancé');
    }

    const payload = buildProfile(restaurant);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(
      `Profils de keyterms enregistrés dans ${output} (${payload.generated.length} générés).\n`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Erreur de chargement du profil banc';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
