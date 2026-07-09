import { CapacityAwareAvailabilityService } from '../floor-plan/availability-capacity-aware.service';
import { GiftCardService } from './gift-card.service';
import { GiftCardSlot } from './gift-card.types.js';
import type { PrismaClient } from '@prisma/client';
import { HOURS_TO_MINUTES } from '../../shared/constants/time.js';

export class GiftCardSlotsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GiftCardSlotsError';
  }
}

export class GiftCardSlotsService {
  private readonly availability: CapacityAwareAvailabilityService;
  private readonly giftCardService: GiftCardService;

  constructor(private readonly prisma: PrismaClient) {
    this.availability = new CapacityAwareAvailabilityService(prisma);
    this.giftCardService = new GiftCardService(prisma);
  }

  async suggestSlots(args: {
    giftCardCode: string;
    partySize?: number;
    preferredDate?: Date;
    preferredTime?: string;
  }): Promise<GiftCardSlot[]> {
    const validation = await this.giftCardService.validateCode(args.giftCardCode);
    if (!validation.valid) {
      throw new GiftCardSlotsError(`Carte cadeau invalide : ${validation.reason}`);
    }

    const giftCard = await this.giftCardService.findByCodeOrShortCodeWithPack(args.giftCardCode);
    if (!giftCard) {
      throw new GiftCardSlotsError('Carte cadeau introuvable');
    }

    const partySize =
      args.partySize ?? giftCard.preferredPartySize ?? giftCard.pack?.maxPartySize ?? 2;

    const preferredDate = args.preferredDate ?? giftCard.preferredDate ?? undefined;
    const preferredTime = args.preferredTime ?? giftCard.preferredTime ?? undefined;

    const slots: GiftCardSlot[] = [];

    if (preferredDate) {
      const dateStr = preferredDate.toISOString().slice(0, 10);
      const daySlots = await this.availability.getAvailability({
        restaurantId: giftCard.restaurantId,
        date: dateStr,
        partySize,
      });
      const available = daySlots.slots.filter((s) => s.available);
      this.addMatchingSlots(available, dateStr, preferredTime, slots, 3);
    }

    if (slots.length < 3) {
      const start = preferredDate ? new Date(preferredDate) : new Date();
      for (let offset = 0; offset < 14 && slots.length < 3; offset++) {
        const date = new Date(start);
        date.setDate(date.getDate() + offset);
        const dateStr = date.toISOString().slice(0, 10);

        const daySlots = await this.availability.getAvailability({
          restaurantId: giftCard.restaurantId,
          date: dateStr,
          partySize,
        });

        const available = daySlots.slots.filter((s) => s.available);
        this.addMatchingSlots(available, dateStr, preferredTime, slots, 3 - slots.length);
      }
    }

    return slots.slice(0, 3);
  }

  private addMatchingSlots(
    available: Array<{ time: string; available: boolean }>,
    dateStr: string,
    preferredTime: string | undefined,
    slots: GiftCardSlot[],
    maxSlots: number,
  ): void {
    if (!preferredTime) {
      for (const slot of available.slice(0, maxSlots)) {
        slots.push({ date: dateStr, time: slot.time });
      }
      return;
    }

    const preferredHour = Number(preferredTime.split(':')[0]);
    const preferredMinute = Number(preferredTime.split(':')[1] ?? 0);
    const preferredMinutes = preferredHour * HOURS_TO_MINUTES + preferredMinute;

    const sorted = available
      .map((s) => {
        const [h, m] = s.time.split(':').map(Number);
        const minutes = h * HOURS_TO_MINUTES + m;
        return { ...s, diff: Math.abs(minutes - preferredMinutes) };
      })
      .sort((a, b) => a.diff - b.diff);

    for (const slot of sorted.slice(0, maxSlots)) {
      slots.push({ date: dateStr, time: slot.time });
    }
  }
}
