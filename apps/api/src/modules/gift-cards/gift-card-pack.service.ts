import type { PrismaClient, GiftCardPack } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { type CreateGiftCardPackInput, type UpdateGiftCardPackInput } from './gift-card.types.js';

export class GiftCardPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GiftCardPackError';
  }
}

export class GiftCardPackService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(restaurantId: string): Promise<GiftCardPack[]> {
    return this.prisma.giftCardPack.findMany({
      where: { restaurantId },
      orderBy: { amount: 'asc' },
    });
  }

  async create(input: CreateGiftCardPackInput): Promise<GiftCardPack> {
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new GiftCardPackError('Le montant du pack doit être supérieur à 0');
    }
    if (input.minPartySize && input.maxPartySize && input.minPartySize > input.maxPartySize) {
      throw new GiftCardPackError('Le nombre de convives minimum ne peut pas dépasser le maximum');
    }

    return this.prisma.giftCardPack.create({
      data: {
        restaurantId: input.restaurantId,
        name: input.name,
        description: input.description ?? null,
        amount,
        minPartySize: input.minPartySize ?? 1,
        maxPartySize: input.maxPartySize ?? 2,
      },
    });
  }

  async update(
    packId: string,
    restaurantId: string,
    input: UpdateGiftCardPackInput,
  ): Promise<GiftCardPack> {
    const existing = await this.prisma.giftCardPack.findFirst({
      where: { id: packId, restaurantId },
    });
    if (!existing) {
      throw new GiftCardPackError('Pack cadeau introuvable');
    }

    if (input.amount !== undefined) {
      const amount = new Prisma.Decimal(input.amount);
      if (amount.lessThanOrEqualTo(0)) {
        throw new GiftCardPackError('Le montant du pack doit être supérieur à 0');
      }
    }
    if (input.minPartySize !== undefined && input.maxPartySize !== undefined) {
      if (input.minPartySize > input.maxPartySize) {
        throw new GiftCardPackError(
          'Le nombre de convives minimum ne peut pas dépasser le maximum',
        );
      }
    }

    return this.prisma.giftCardPack.update({
      where: { id: packId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.amount !== undefined && { amount: new Prisma.Decimal(input.amount) }),
        ...(input.minPartySize !== undefined && { minPartySize: input.minPartySize }),
        ...(input.maxPartySize !== undefined && { maxPartySize: input.maxPartySize }),
      },
    });
  }

  async toggle(packId: string, restaurantId: string): Promise<GiftCardPack> {
    const existing = await this.prisma.giftCardPack.findFirst({
      where: { id: packId, restaurantId },
    });
    if (!existing) {
      throw new GiftCardPackError('Pack cadeau introuvable');
    }

    return this.prisma.giftCardPack.update({
      where: { id: packId },
      data: { isActive: !existing.isActive },
    });
  }
}
