import { FastifyInstance }    from 'fastify';
import { telnyxWebhookGuard } from './telnyx.guard';
import { ReservationService } from '../reservations/reservation.service';
import { RestaurantService }  from '../restaurants/restaurant.service';
import { CustomerService }    from '../customers/customer.service';
import { buildSystemPrompt }  from './prompts';
import { detectOutcome }      from './outcome';
import { DEFAULT_VOICE_ID, LLM_MODELS, LLM_VIP_TURN_THRESHOLD } from '@sokar/config';

interface TelnyxCallPayload {
  data: {
    event_type: string;
    payload: {
      call_control_id: string;
      call_leg_id:     string;
      from:            string;
      to:              string;
      direction:       string;
    };
  };
}

function selectLlmModel(isVip: boolean, turnCount: number): string {
  if (isVip || turnCount > LLM_VIP_TURN_THRESHOLD) return LLM_MODELS.PRO;
  return LLM_MODELS.FLASH;
}

export async function telnyxVoiceRoutes(app: FastifyInstance) {

  app.post('/voice/telnyx', { preHandler: telnyxWebhookGuard }, async (req, reply) => {
    const body      = req.body as TelnyxCallPayload;
    const eventType = body.data.event_type;
    const payload   = body.data.payload;

    switch (eventType) {

      case 'call.initiated': {
        const ctx  = await RestaurantService.loadContext(payload.to);
        const safe = await RestaurantService.checkMarginHealth(ctx.id);

        if (!safe) {
          app.log.warn({ restaurantId: ctx.id }, 'Circuit breaker triggered');
          return reply.send({ result: 'ok' });
        }

        const customer = payload.from
          ? await CustomerService.lookupOrCreate(ctx.id, payload.from)
          : null;

        if (customer?.isVip && process.env.VIP_PUSH_ENABLED === 'true') {
          await app.queues.smsManager.add('vip-alert', {
            restaurantId: ctx.id,
            message: `⭐ VIP en ligne${customer.name ? ' : ' + customer.name : ''} — appel entrant`,
          });
        }

        const customerExtra = customer
          ? CustomerService.buildVipPromptExtra(customer)
          : '';

        const systemPrompt = buildSystemPrompt({ ...ctx, customerExtra });

        return reply.send({
          call_control_id: payload.call_control_id,
          ai_config: {
            stt: {
              provider:         'deepgram',
              model:            process.env.DEEPGRAM_MODEL ?? 'nova-3',
              language:         'fr',
              endpointing:      300,
              utterance_end_ms: 1000,
            },
            llm: {
              provider: 'openrouter',
              model:    selectLlmModel(customer?.isVip ?? false, 0),
              messages: [{ role: 'system', content: systemPrompt }],
            },
            tts: {
              provider:         'elevenlabs',
              voice_id:         ctx.personality?.voiceIdEl ?? DEFAULT_VOICE_ID,
              chunk_on:         ['.', '!', '?'],
              min_chunk_length: 4,
            },
            first_utterance: `Bonjour, ${ctx.name}, cet appel peut être enregistré à des fins de qualité de service. En quoi puis-je vous aider ?`,
          },
        });
      }

      case 'call.hangup': {
        const callRecord = await app.db.call.findUnique({
          where:   { callSid: payload.call_leg_id },
          include: { reservation: true },
        });

        if (callRecord?.reservation && payload.from) {
          const ctx = await RestaurantService.loadContext(payload.to);
          await CustomerService.incrementVisit(ctx.id, payload.from);
        }

        return reply.send({ result: 'ok' });
      }

      default:
        return reply.send({ result: 'ignored' });
    }
  });

  app.post('/voice/telnyx/function-call', { preHandler: telnyxWebhookGuard }, async (req, reply) => {
    const { function_call, call_control_id, to } = req.body as any;
    const ctx = await RestaurantService.loadContext(to);

    switch (function_call.name) {

      case 'createReservation': {
        const { date, time, partySize, customerName, customerPhone } = function_call.parameters;
        const reservation = await ReservationService.create({
          restaurantId:  ctx.id,
          callId:        call_control_id,
          reservedAt:    new Date(`${date}T${time}`),
          partySize,
          customerName,
          customerPhone,
        });
        return reply.send({
          result: `Réservation confirmée pour ${customerName}, le ${date} à ${time}, pour ${partySize} personnes. Numéro : ${reservation.id.slice(0, 8).toUpperCase()}.`,
        });
      }

      case 'checkAvailability': {
        const { date, time, partySize } = function_call.parameters;
        const available = RestaurantService.isOpen(ctx, date, time);
        return reply.send({
          result: available
            ? `Oui, nous avons de la disponibilité le ${date} à ${time} pour ${partySize} personnes.`
            : `Désolé, nous sommes fermés à ce créneau.`,
        });
      }

      case 'getOpeningHours': {
        const { formatOpeningHours } = await import('./prompts');
        return reply.send({ result: formatOpeningHours(ctx.openingHours) });
      }

      case 'handoffToManager':
        await app.queues.smsManager.add('manager-alert', {
          restaurantId: ctx.id,
          message:      '📞 Un client demande à vous parler — appel en cours',
        });
        return reply.send({ result: 'Je vous transfère immédiatement.', phoneNumber: ctx.managerPhone });

      default:
        return reply.status(400).send({ error: `Unknown function: ${function_call.name}` });
    }
  });

  app.post('/voice/telnyx/end', { preHandler: telnyxWebhookGuard }, async (req, reply) => {
    const {
      call_leg_id, transcript, ended_reason,
      started_at, ended_at,
      stt_provider, llm_provider, tts_provider,
    } = req.body as any;

    await app.db.call.update({
      where: { callSid: call_leg_id },
      data: {
        durationSec: Math.round(
          ended_at && started_at
            ? (new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000
            : 0
        ),
        transcript:  transcript ?? null,
        outcome:     detectOutcome({ transcript, endedReason: ended_reason }),
        sttProvider: stt_provider ?? 'deepgram-nova3',
        llmProvider: llm_provider ?? LLM_MODELS.FLASH,
        ttsProvider: tts_provider ?? 'elevenlabs',
        carrier:     'telnyx',
      },
    });
    return reply.send({ received: true });
  });
}
