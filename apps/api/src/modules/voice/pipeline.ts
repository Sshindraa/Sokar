import { FastifyInstance }    from 'fastify';
import { vapiWebhookGuard }   from '../../shared/security/webhook.guard';
import { ReservationService } from '../reservations/reservation.service';
import { RestaurantService }  from '../restaurants/restaurant.service';
import { buildSystemPrompt, formatOpeningHours } from './prompts';
import { getRestaurantTools } from './tools';
import { detectOutcome }      from './outcome';
import { DEFAULT_VOICE_ID }   from '@callyx/config';

interface VapiIncomingPayload {
  call: { id: string; phoneNumberId: string };
}
interface VapiFunctionCallPayload {
  functionCall: { name: string; parameters: Record<string, any> };
  call:         { id: string; phoneNumberId: string };
}
interface VapiEndPayload {
  call: {
    id: string; endedReason?: string; transcript?: string;
    startedAt?: string; endedAt?: string;
  };
}

export async function voiceRoutes(app: FastifyInstance) {

  app.post('/voice/incoming', { preHandler: vapiWebhookGuard }, async (req, reply) => {
    const body = req.body as VapiIncomingPayload;
    const ctx  = await RestaurantService.loadContext(body.call.phoneNumberId);

    const safe = await RestaurantService.checkMarginHealth(ctx.id);
    if (!safe) {
      return reply
        .type('text/xml')
        .send(`<Response><Play>https://cdn.callyx.fr/assets/technical-issue.mp3</Play><Hangup/></Response>`);
    }

    return reply.send({
      assistant: {
        firstMessage: `Bonjour, ${ctx.name}, cet appel peut être enregistré à des fins de qualité de service. En quoi puis-je vous aider ?`,
        model: {
          messages: [{ role: 'system', content: buildSystemPrompt(ctx) }],
        },
        voice: {
          provider: 'elevenlabs',
          voiceId:  ctx.personality?.voiceIdEl ?? DEFAULT_VOICE_ID,
        },
        tools: getRestaurantTools(ctx.id),
      },
    });
  });

  app.post('/voice/function-call', { preHandler: vapiWebhookGuard }, async (req, reply) => {
    const { functionCall, call } = req.body as VapiFunctionCallPayload;
    const ctx = await RestaurantService.loadContext(call.phoneNumberId);

    switch (functionCall.name) {

      case 'createReservation': {
        const { date, time, partySize, customerName, customerPhone } = functionCall.parameters;
        const reservation = await ReservationService.create({
          restaurantId:  ctx.id,
          callId:        call.id,
          reservedAt:    new Date(`${date}T${time}`),
          partySize,
          customerName,
          customerPhone,
        });
        return reply.send({
          result: `Réservation confirmée pour ${customerName}, le ${date} à ${time}, pour ${partySize} personnes. Numéro de réservation : ${reservation.id.slice(0, 8).toUpperCase()}.`,
        });
      }

      case 'checkAvailability': {
        const { date, time, partySize } = functionCall.parameters;
        const available = RestaurantService.isOpen(ctx, date, time);
        return reply.send({
          result: available
            ? `Oui, nous avons de la disponibilité le ${date} à ${time} pour ${partySize} personnes.`
            : `Désolé, nous sommes fermés ce créneau. ${formatOpeningHours(ctx.openingHours)}`,
        });
      }

      case 'getOpeningHours':
        return reply.send({ result: formatOpeningHours(ctx.openingHours) });

      case 'handoffToManager':
        app.log.info({ restaurantId: ctx.id, callId: call.id }, 'Handoff to manager');
        await app.queues.smsManager.add('manager-alert', {
          restaurantId: ctx.id,
          message:      '📞 Un client demande à vous parler — appel en cours',
        });
        return reply.send({ result: 'Je vous transfère immédiatement.', phoneNumber: ctx.managerPhone });

      default:
        return reply.status(400).send({ error: `Unknown function: ${functionCall.name}` });
    }
  });

  app.post('/voice/end', { preHandler: vapiWebhookGuard }, async (req, reply) => {
    const { call } = req.body as VapiEndPayload;
    await app.db.call.update({
      where: { callSid: call.id },
      data: {
        durationSec: Math.round(
          call.endedAt && call.startedAt
            ? (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000
            : 0
        ),
        transcript: call.transcript ?? null,
        outcome:    detectOutcome(call),
      },
    });
    return reply.send({ received: true });
  });
}
