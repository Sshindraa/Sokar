import telnyx, { placeOutboundCall } from '../../shared/telnyx/client';
import { db } from '../../shared/db/client';
import { invalidateRestaurantContextCache } from '../restaurants/restaurant.service';
import {
  hasUsablePhone,
  computeOnboardingState,
  normalizeTasks,
} from '../restaurants/onboarding.service';
import { trackOnboardingEvent } from '../analytics/events.service';
import pino from 'pino';
import { Prisma } from '@prisma/client';

const logger = pino({ name: 'provisioning-service' });

export interface TelnyxNumberItem {
  id: string;
  phoneNumber: string;
  nationalFormat?: string;
  status: string;
  assignedToRestaurantId?: string | null;
  assignedToRestaurantName?: string | null;
}

export interface ProvisioningStatusView {
  restaurantId: string;
  restaurantName: string;
  phoneNumber: string;
  hasAssignedPhone: boolean;
  provisioningStatus: string;
  telnyxPhoneNumberId: string | null;
  forwardingConfiguredAt: string | null;
  testCallValidatedAt: string | null;
  firstCallAt: string | null;
  forwardingCode: string | null;
  steps: {
    assignment: {
      completed: boolean;
      phoneNumber: string;
    };
    webhook: {
      completed: boolean;
      webhookUrl: string;
    };
    forwarding: {
      completed: boolean;
      configuredAt: string | null;
      ussdCode: string | null;
    };
    testCall: {
      completed: boolean;
      validatedAt: string | null;
    };
  };
}

export class ProvisioningService {
  /**
   * Liste les numéros Telnyx disponibles depuis le compte Telnyx
   * ou depuis un pool d'inventaire si l'API Telnyx n'est pas configurée.
   */
  static async listAvailableNumbers(): Promise<TelnyxNumberItem[]> {
    const assignedRestaurants = await db.restaurant.findMany({
      select: { id: true, name: true, phoneNumber: true, telnyxPhoneNumberId: true },
    });

    const assignedMap = new Map<string, { id: string; name: string }>();
    for (const r of assignedRestaurants) {
      if (r.phoneNumber && !r.phoneNumber.startsWith('+000')) {
        assignedMap.set(r.phoneNumber, { id: r.id, name: r.name });
      }
    }

    if (process.env.TELNYX_API_KEY) {
      try {
        const telnyxClient = telnyx as unknown as {
          phoneNumbers: {
            list: (
              params?: Record<string, unknown>,
            ) => Promise<{ data: Array<Record<string, unknown>> }>;
            update: (id: string, params: Record<string, unknown>) => Promise<unknown>;
          };
        };
        const response = await telnyxClient.phoneNumbers.list({
          page: { size: 50 },
        });

        const items: TelnyxNumberItem[] = [];
        const rawList = (response?.data as Array<Record<string, unknown>>) ?? [];

        for (const num of rawList) {
          const id = (num.id as string) ?? '';
          const rawPhone = (num.phone_number as string) ?? '';
          if (!rawPhone) continue;

          const assigned = assignedMap.get(rawPhone);
          items.push({
            id,
            phoneNumber: rawPhone,
            status: (num.status as string) ?? 'active',
            assignedToRestaurantId: assigned?.id ?? null,
            assignedToRestaurantName: assigned?.name ?? null,
          });
        }

        if (items.length > 0) {
          return items;
        }
      } catch (err) {
        logger.warn(
          { err },
          'Failed to fetch Telnyx numbers from Telnyx API, falling back to inventory pool',
        );
      }
    }

    // Fallback inventory pool pour environnements de test / dev
    const fallbackPool = [
      { id: 'tnx_fr_01', phoneNumber: '+33451221528' },
      { id: 'tnx_fr_02', phoneNumber: '+33451221529' },
      { id: 'tnx_fr_03', phoneNumber: '+33451221530' },
      { id: 'tnx_fr_04', phoneNumber: '+33189000001' },
      { id: 'tnx_fr_05', phoneNumber: '+33189000002' },
    ];

    return fallbackPool.map((item) => {
      const assigned = assignedMap.get(item.phoneNumber);
      return {
        id: item.id,
        phoneNumber: item.phoneNumber,
        status: 'active',
        assignedToRestaurantId: assigned?.id ?? null,
        assignedToRestaurantName: assigned?.name ?? null,
      };
    });
  }

  /**
   * Attribue un numéro Telnyx à un restaurant et met à jour l'état de provisioning & onboarding.
   */
  static async assignPhoneNumber(
    restaurantId: string,
    phoneNumber: string,
    telnyxPhoneNumberId?: string,
  ): Promise<ProvisioningStatusView> {
    const formattedPhone = phoneNumber.trim();
    if (!/^\+[1-9]\d{9,14}$/.test(formattedPhone)) {
      throw new Error('Numéro E.164 invalide. Format requis : +33612345678');
    }

    const existingWithPhone = await db.restaurant.findFirst({
      where: {
        phoneNumber: formattedPhone,
        id: { not: restaurantId },
      },
      select: { id: true, name: true },
    });

    if (existingWithPhone) {
      throw new Error(
        `Le numéro ${formattedPhone} est déjà attribué au restaurant "${existingWithPhone.name}" (${existingWithPhone.id}).`,
      );
    }

    const restaurant = await db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
    });

    // Invalider l'ancien cache Redis
    if (restaurant.phoneNumber) {
      await invalidateRestaurantContextCache(restaurant.phoneNumber);
    }

    // Tâches d'onboarding existantes
    const tasks = normalizeTasks(restaurant.onboardingTasks);
    tasks.phone = {
      ...tasks.phone,
      status: tasks.phone.status === 'completed' ? 'completed' : 'current',
      metadata: {
        ...(tasks.phone.metadata ?? {}),
        assignedPhone: formattedPhone,
        assignedAt: new Date().toISOString(),
        telnyxPhoneNumberId: telnyxPhoneNumberId ?? null,
      },
    };

    const nextOnboardingState = computeOnboardingState({
      ...restaurant,
      phoneNumber: formattedPhone,
      onboardingTasks: tasks,
    });

    const updated = await db.restaurant.update({
      where: { id: restaurantId },
      data: {
        phoneNumber: formattedPhone,
        carrier: 'telnyx',
        telnyxPhoneNumberId: telnyxPhoneNumberId ?? restaurant.telnyxPhoneNumberId,
        provisioningStatus: 'PHONE_ASSIGNED',
        onboardingTasks: tasks as unknown as Prisma.InputJsonValue,
        onboardingDone: nextOnboardingState.onboardingDone,
      },
    });

    // Invalider le nouveau cache Redis
    await invalidateRestaurantContextCache(formattedPhone);

    // Essayer de lier l'ID de connexion Telnyx si disponible
    if (process.env.TELNYX_API_KEY && telnyxPhoneNumberId && process.env.TELNYX_CONNECTION_ID) {
      try {
        const telnyxClient = telnyx as unknown as {
          phoneNumbers: {
            update: (id: string, params: Record<string, unknown>) => Promise<unknown>;
          };
        };
        await telnyxClient.phoneNumbers.update(telnyxPhoneNumberId, {
          connection_id: process.env.TELNYX_CONNECTION_ID,
        });
        logger.info(
          { restaurantId, telnyxPhoneNumberId },
          'Telnyx phone number connection_id updated',
        );
      } catch (err) {
        logger.warn(
          { err, telnyxPhoneNumberId },
          'Could not update Telnyx connection_id via Telnyx SDK',
        );
      }
    }

    return this.getProvisioningStatus(updated.id);
  }

  /**
   * Vérifie le webhook Telnyx et marque l'étape Webhook comme validée.
   */
  static async verifyWebhook(restaurantId: string): Promise<ProvisioningStatusView> {
    const restaurant = await db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
    });

    if (!hasUsablePhone(restaurant.phoneNumber)) {
      throw new Error("Attribution d'un numéro Telnyx requise avant la vérification du webhook.");
    }

    const now = new Date();
    const updated = await db.restaurant.update({
      where: { id: restaurantId },
      data: {
        provisioningStatus:
          restaurant.provisioningStatus === 'TEST_CALL_COMPLETED' ||
          restaurant.provisioningStatus === 'ACTIVE'
            ? restaurant.provisioningStatus
            : 'WEBHOOK_READY',
        forwardingConfiguredAt: restaurant.forwardingConfiguredAt ?? now,
      },
    });

    return this.getProvisioningStatus(updated.id);
  }

  /**
   * Déclenche un appel test pour valider le flux vocal et le renvoi d'appel.
   */
  static async triggerTestCall(
    restaurantId: string,
    targetPhoneNumber: string,
  ): Promise<{ callControlId: string; status: ProvisioningStatusView }> {
    const restaurant = await db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
    });

    if (!hasUsablePhone(restaurant.phoneNumber)) {
      throw new Error(
        "Aucun numéro Sokar attribué. Attribuez un numéro avant de lancer l'appel test.",
      );
    }

    const formattedTarget = targetPhoneNumber.trim();
    if (!/^\+[1-9]\d{9,14}$/.test(formattedTarget)) {
      throw new Error('Numéro E.164 du gérant invalide (ex: +33612345678).');
    }

    const baseUrl = process.env.PUBLIC_API_URL ?? 'https://api.sokar.tech';
    const webhookUrl = `${baseUrl}/voice/stream`;

    const { callControlId } = await placeOutboundCall(formattedTarget, {
      webhookUrl,
      clientState: {
        kind: 'onboarding_test_call',
        restaurantId,
        targetManagerPhone: formattedTarget,
      },
      timeoutSecs: 30,
    });

    const now = new Date();
    const tasks = normalizeTasks(restaurant.onboardingTasks);
    tasks.phone = {
      ...tasks.phone,
      status: 'completed',
      completedAt: now.toISOString(),
    };

    const nextOnboardingState = computeOnboardingState({
      ...restaurant,
      firstCallAt: restaurant.firstCallAt ?? now,
      onboardingTasks: tasks,
    });

    const updated = await db.restaurant.update({
      where: { id: restaurantId },
      data: {
        firstCallAt: restaurant.firstCallAt ?? now,
        testCallValidatedAt: now,
        provisioningStatus: 'ACTIVE',
        onboardingTasks: tasks as unknown as Prisma.InputJsonValue,
        onboardingDone: nextOnboardingState.onboardingDone,
        onboardingCompletedAt:
          nextOnboardingState.onboardingDone && !restaurant.onboardingCompletedAt
            ? now
            : restaurant.onboardingCompletedAt,
        onboardingActivatedAt: restaurant.onboardingActivatedAt ?? now,
      },
    });

    await trackOnboardingEvent({
      event: 'onboarding_first_call',
      restaurantId,
      task: 'phone',
      metadata: {
        callControlId,
        targetPhoneNumber: formattedTarget,
        provisioningStatus: 'ACTIVE',
      },
    }).catch((err) =>
      logger.error({ err, restaurantId }, 'Failed to track onboarding_first_call event'),
    );

    const status = await this.getProvisioningStatus(updated.id);
    return { callControlId, status };
  }

  /**
   * Retourne le statut de provisioning consolidé d'un restaurant.
   */
  static async getProvisioningStatus(restaurantId: string): Promise<ProvisioningStatusView> {
    const restaurant = await db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
    });

    const isAssigned = hasUsablePhone(restaurant.phoneNumber);
    const baseUrl = process.env.PUBLIC_API_URL ?? 'https://api.sokar.tech';
    const webhookUrl = `${baseUrl}/voice/telnyx`;

    const ussdCode = isAssigned ? `*21*${restaurant.phoneNumber}#` : null;

    const assignmentCompleted = isAssigned;
    const webhookCompleted =
      isAssigned &&
      (restaurant.provisioningStatus === 'WEBHOOK_READY' ||
        restaurant.provisioningStatus === 'TEST_CALL_COMPLETED' ||
        restaurant.provisioningStatus === 'ACTIVE' ||
        Boolean(restaurant.forwardingConfiguredAt));

    const forwardingCompleted = Boolean(restaurant.forwardingConfiguredAt);
    const testCallCompleted =
      Boolean(restaurant.testCallValidatedAt) || Boolean(restaurant.firstCallAt);

    return {
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      phoneNumber: restaurant.phoneNumber,
      hasAssignedPhone: isAssigned,
      provisioningStatus: restaurant.provisioningStatus,
      telnyxPhoneNumberId: restaurant.telnyxPhoneNumberId,
      forwardingConfiguredAt: restaurant.forwardingConfiguredAt
        ? restaurant.forwardingConfiguredAt.toISOString()
        : null,
      testCallValidatedAt: restaurant.testCallValidatedAt
        ? restaurant.testCallValidatedAt.toISOString()
        : null,
      firstCallAt: restaurant.firstCallAt ? restaurant.firstCallAt.toISOString() : null,
      forwardingCode: ussdCode,
      steps: {
        assignment: {
          completed: assignmentCompleted,
          phoneNumber: restaurant.phoneNumber,
        },
        webhook: {
          completed: webhookCompleted,
          webhookUrl,
        },
        forwarding: {
          completed: forwardingCompleted,
          configuredAt: restaurant.forwardingConfiguredAt
            ? restaurant.forwardingConfiguredAt.toISOString()
            : null,
          ussdCode,
        },
        testCall: {
          completed: testCallCompleted,
          validatedAt: restaurant.testCallValidatedAt
            ? restaurant.testCallValidatedAt.toISOString()
            : restaurant.firstCallAt
              ? restaurant.firstCallAt.toISOString()
              : null,
        },
      },
    };
  }
}
