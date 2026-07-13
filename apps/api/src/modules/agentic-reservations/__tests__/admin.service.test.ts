/**
 * Tests unitaires du service admin agentic-reservations.
 * Utilise un mock Prisma pour isoler la logique métier.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AgenticAdminService, OptInGuardError } from '../admin/admin.service';
import { AuditLogService } from '../core/audit-log.service';
import { PolicyValidationError } from '../core/policies.service';

function makeFakes() {
  const restaurants = new Map<string, Record<string, unknown>>();
  const settings = new Map<string, Record<string, unknown>>();
  const audits: Record<string, unknown>[] = [];
  const reservations: Record<string, unknown>[] = [];

  const prisma = {
    $transaction: async (fn: unknown) =>
      (fn as unknown as (tx: PrismaClient) => Promise<unknown>)(prisma as unknown as PrismaClient),
    restaurant: {
      findUniqueOrThrow: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, unknown>;
      }) => {
        const r = restaurants.get(where.id);
        if (!r) throw new Error('not found');
        if (select) {
          return Object.fromEntries(Object.keys(select).map((k) => [k, r[k]]));
        }
        return r;
      },
      findUnique: async ({
        where,
        select,
      }: {
        where: { id: string };
        select?: Record<string, unknown>;
      }) => {
        const r = restaurants.get(where.id);
        if (!r) return null;
        if (select) {
          return Object.fromEntries(Object.keys(select).map((k) => [k, r[k]]));
        }
        return r;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = restaurants.get(where.id);
        if (!r) throw new Error('not found');
        Object.assign(r, data);
        return r;
      },
    },
    restaurantExposureSettings: {
      findUnique: async ({ where }: { where: { restaurantId: string } }) =>
        settings.get(where.restaurantId) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { restaurantId: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = settings.get(where.restaurantId);
        const merged = { ...(existing ?? create ?? {}), ...(update ?? {}) };
        settings.set(where.restaurantId, merged);
        return merged;
      },
    },
    reservation: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        return reservations.filter((r: Record<string, unknown>) => {
          if (String(r.restaurantId) !== String(where.restaurantId)) return false;
          const partySize = where.partySize as Record<string, unknown> | undefined;
          if (partySize?.gt !== undefined && Number(r.partySize) <= Number(partySize.gt))
            return false;
          const reservedAt = where.reservedAt as Record<string, unknown> | undefined;
          const gte = reservedAt?.gte;
          const rReservedAt = r.reservedAt;
          if (
            gte !== undefined &&
            (!rReservedAt ||
              !(rReservedAt instanceof Date) ||
              rReservedAt.getTime() < (gte instanceof Date ? gte.getTime() : Number(gte)))
          ) {
            return false;
          }
          const state = where.state as Record<string, unknown> | undefined;
          const stateIn = state?.in;
          if (Array.isArray(stateIn) && !stateIn.includes(r.state)) return false;
          return true;
        }).length;
      },
    },
    reservationAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
  } as unknown as PrismaClient;

  const audit = new AuditLogService(prisma);
  const service = new AgenticAdminService(prisma, audit);

  return { restaurants, settings, audits, reservations, prisma, service };
}

describe('agentic admin service', () => {
  let fakes: ReturnType<typeof makeFakes>;
  beforeEach(() => {
    fakes = makeFakes();
  });

  describe('getOptIn', () => {
    it('retourne les flags par défaut', async () => {
      fakes.restaurants.set('r-1', {
        id: 'r-1',
        agenticOptIn: false,
        openaiReserveEnabled: false,
        policyVersion: '2026-06-20',
      });
      const status = await fakes.service.getOptIn('r-1');
      expect(status).toEqual({
        mcp: false,
        openaiReserve: false,
        policyVersion: '2026-06-20',
      });
    });
  });

  describe('setOptIn', () => {
    beforeEach(() => {
      fakes.restaurants.set('r-1', {
        id: 'r-1',
        agenticOptIn: false,
        openaiReserveEnabled: false,
        lat: 45.75,
        lng: 4.85,
        websiteUrl: 'https://example.com',
        formattedAddress: '1 rue de la Paix, Lyon',
        phoneE164: '+336****0000',
      });
    });

    it('active MCP seul, OpenAI Reserve reste false', async () => {
      await fakes.service.setOptIn({
        restaurantId: 'r-1',
        input: { mcp: true, openaiReserve: false },
        actor: 'user:test',
      });
      const r = fakes.restaurants.get('r-1')!;
      expect(r.agenticOptIn).toBe(true);
      expect(r.openaiReserveEnabled).toBe(false);
      expect(fakes.audits).toHaveLength(1);
      expect(fakes.audits[0].event).toBe('opt_in_changed');
    });

    it('active MCP + OpenAI Reserve (avec tous les champs requis)', async () => {
      await fakes.service.setOptIn({
        restaurantId: 'r-1',
        input: { mcp: true, openaiReserve: true },
        actor: 'user:test',
      });
      const r = fakes.restaurants.get('r-1')!;
      expect(r.agenticOptIn).toBe(true);
      expect(r.openaiReserveEnabled).toBe(true);
    });

    it('refuse openaiReserve=true si lat manquant', async () => {
      fakes.restaurants.get('r-1')!.lat = null;
      await expect(
        fakes.service.setOptIn({
          restaurantId: 'r-1',
          input: { mcp: true, openaiReserve: true },
          actor: 'user:test',
        }),
      ).rejects.toThrow(OptInGuardError);
    });

    it('refuse openaiReserve=true si websiteUrl manquant', async () => {
      fakes.restaurants.get('r-1')!.websiteUrl = null;
      await expect(
        fakes.service.setOptIn({
          restaurantId: 'r-1',
          input: { mcp: true, openaiReserve: true },
          actor: 'user:test',
        }),
      ).rejects.toThrow(OptInGuardError);
    });

    it('refuse openaiReserve=true si formattedAddress manquant', async () => {
      fakes.restaurants.get('r-1')!.formattedAddress = null;
      await expect(
        fakes.service.setOptIn({
          restaurantId: 'r-1',
          input: { mcp: true, openaiReserve: true },
          actor: 'user:test',
        }),
      ).rejects.toThrow(/formattedAddress/);
    });

    it('refuse openaiReserve=true si phoneE164 manquant', async () => {
      fakes.restaurants.get('r-1')!.phoneE164 = null;
      await expect(
        fakes.service.setOptIn({
          restaurantId: 'r-1',
          input: { mcp: true, openaiReserve: true },
          actor: 'user:test',
        }),
      ).rejects.toThrow(/phoneE164/);
    });

    it('désactiver MCP force OpenAI Reserve à false', async () => {
      fakes.restaurants.get('r-1')!.agenticOptIn = true;
      fakes.restaurants.get('r-1')!.openaiReserveEnabled = true;
      await fakes.service.setOptIn({
        restaurantId: 'r-1',
        input: { mcp: false, openaiReserve: false },
        actor: 'user:test',
      });
      const r = fakes.restaurants.get('r-1')!;
      expect(r.agenticOptIn).toBe(false);
      expect(r.openaiReserveEnabled).toBe(false);
    });

    it("pas d'audit si rien ne change", async () => {
      await fakes.service.setOptIn({
        restaurantId: 'r-1',
        input: { mcp: false, openaiReserve: false },
        actor: 'user:test',
      });
      expect(fakes.audits).toHaveLength(0);
    });

    it('audit contient before/after', async () => {
      await fakes.service.setOptIn({
        restaurantId: 'r-1',
        input: { mcp: true, openaiReserve: false },
        actor: 'user:test',
      });
      const audit = fakes.audits[0];
      const metadata = audit.metadata as Record<string, unknown>;
      expect((metadata.before as Record<string, unknown>).mcp).toBe(false);
      expect((metadata.after as Record<string, unknown>).mcp).toBe(true);
    });
  });

  describe('getExposureSettings', () => {
    it('retourne les défauts si pas de settings en DB', async () => {
      const s = await fakes.service.getExposureSettings('r-1');
      expect(s.maxPartySize).toBe(12);
      expect(s.quoteTtlSeconds).toBe(300);
      expect(s.holdTtlSeconds).toBe(420);
    });

    it('retourne les settings existants', async () => {
      fakes.settings.set('r-1', {
        restaurantId: 'r-1',
        maxPartySize: 8,
        minLeadTimeMinutes: 60,
        requireManualValidation: true,
        quoteTtlSeconds: 240,
        holdTtlSeconds: 360,
        noShowPolicy: 'fee',
        notificationChannels: ['email'],
        exposedCreneaux: [{ day: 5, from: '19:00', to: '22:00' }],
        capacitySpecials: { terrasse: 2 },
      });
      const s = await fakes.service.getExposureSettings('r-1');
      expect(s.maxPartySize).toBe(8);
      expect(s.noShowPolicy).toBe('fee');
      expect(s.exposedCreneaux).toEqual([{ day: 5, from: '19:00', to: '22:00' }]);
    });
  });

  describe('setExposureSettings', () => {
    beforeEach(() => {
      fakes.restaurants.set('r-1', { id: 'r-1' });
    });

    it('crée les settings si pas existants', async () => {
      await fakes.service.setExposureSettings({
        restaurantId: 'r-1',
        input: { maxPartySize: 8 },
        actor: 'user:test',
      });
      const s = fakes.settings.get('r-1')!;
      expect(s.maxPartySize).toBe(8);
    });

    it('met à jour les settings existants', async () => {
      fakes.settings.set('r-1', {
        restaurantId: 'r-1',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms', 'email'],
        exposedCreneaux: [],
        capacitySpecials: {},
      });
      await fakes.service.setExposureSettings({
        restaurantId: 'r-1',
        input: { maxPartySize: 6 },
        actor: 'user:test',
      });
      expect(fakes.settings.get('r-1')!.maxPartySize).toBe(6);
    });

    it('refuse maxPartySize trop bas (<1)', async () => {
      await expect(
        fakes.service.setExposureSettings({
          restaurantId: 'r-1',
          input: { maxPartySize: 0 },
          actor: 'user:test',
        }),
      ).rejects.toThrow(PolicyValidationError);
    });

    it('refuse holdTtlSeconds <= quoteTtlSeconds', async () => {
      await expect(
        fakes.service.setExposureSettings({
          restaurantId: 'r-1',
          input: { quoteTtlSeconds: 300, holdTtlSeconds: 300 },
          actor: 'user:test',
        }),
      ).rejects.toThrow(PolicyValidationError);
    });

    it('refuse un patch holdTtlSeconds incohérent avec le quoteTtlSeconds existant', async () => {
      fakes.settings.set('r-1', {
        restaurantId: 'r-1',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms', 'email'],
        exposedCreneaux: [],
        capacitySpecials: {},
      });

      await expect(
        fakes.service.setExposureSettings({
          restaurantId: 'r-1',
          input: { holdTtlSeconds: 240 },
          actor: 'user:test',
        }),
      ).rejects.toThrow(PolicyValidationError);
    });

    it('refuse un patch quoteTtlSeconds incohérent avec le holdTtlSeconds existant', async () => {
      fakes.settings.set('r-1', {
        restaurantId: 'r-1',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms', 'email'],
        exposedCreneaux: [],
        capacitySpecials: {},
      });

      await expect(
        fakes.service.setExposureSettings({
          restaurantId: 'r-1',
          input: { quoteTtlSeconds: 600 },
          actor: 'user:test',
        }),
      ).rejects.toThrow(PolicyValidationError);
    });

    it('refuse de réduire maxPartySize si résas futures dépassent', async () => {
      fakes.reservations.push({
        id: 'res-1',
        restaurantId: 'r-1',
        partySize: 10,
        reservedAt: new Date(Date.now() + 86_400_000),
        state: 'CONFIRMED',
      });
      try {
        await fakes.service.setExposureSettings({
          restaurantId: 'r-1',
          input: { maxPartySize: 6 },
          actor: 'user:test',
        });
        expect.fail('aurait dû jeter');
      } catch (err) {
        expect((err as { code: string }).code).toBe('FUTURE_RESERVATIONS_EXCEED_MAX');
      }
    });

    it('autorise de réduire maxPartySize si seule une résa passée dépasse', async () => {
      fakes.reservations.push({
        id: 'res-past',
        restaurantId: 'r-1',
        partySize: 10,
        reservedAt: new Date(Date.now() - 86_400_000),
        state: 'CONFIRMED',
      });

      await fakes.service.setExposureSettings({
        restaurantId: 'r-1',
        input: { maxPartySize: 6 },
        actor: 'user:test',
      });

      expect(fakes.settings.get('r-1')!.maxPartySize).toBe(6);
    });

    it('audit contient before/after', async () => {
      fakes.settings.set('r-1', {
        restaurantId: 'r-1',
        maxPartySize: 12,
        minLeadTimeMinutes: 30,
        requireManualValidation: false,
        quoteTtlSeconds: 300,
        holdTtlSeconds: 420,
        noShowPolicy: 'warning',
        notificationChannels: ['sms', 'email'],
        exposedCreneaux: [],
        capacitySpecials: {},
      });
      await fakes.service.setExposureSettings({
        restaurantId: 'r-1',
        input: { maxPartySize: 8 },
        actor: 'user:test',
      });
      const audit = fakes.audits.find((a) => a.event === 'exposure_settings_changed')!;
      const metadata = audit.metadata as Record<string, unknown>;
      expect((metadata.before as Record<string, unknown>).maxPartySize).toBe(12);
      expect((metadata.after as Record<string, unknown>).maxPartySize).toBe(8);
    });
  });
});
