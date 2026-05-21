import { FastifyInstance }    from 'fastify';
import { telnyxWebhookGuard } from './telnyx.guard';
import { ReservationService } from '../reservations/reservation.service';
import { RestaurantService }  from '../restaurants/restaurant.service';
import { CustomerService }    from '../customers/customer.service';
import { buildSystemPrompt }  from './prompts';
import { detectOutcome }      from './outcome';
import { DEFAULT_CARTESIA_VOICE_ID, CARTESIA_MODEL, LLM_MODELS, LLM_VIP_TURN_THRESHOLD } from '@sokar/config';
import { CallSessionManager } from './stream/manager';
import { connectDeepgramFlux } from './stream/deepgram-bridge';

/** Flag pour activer le pipeline Flux media stream (au lieu de ai_config) */
const FLUX_ENABLED = process.env.FLUX_ENABLED === 'true';

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

        // ─── Pipeline Flux (media stream) — FLUX_ENABLED = true ───
        if (FLUX_ENABLED) {
          const mgr = CallSessionManager.getInstance();
          mgr.create({
            callControlId: payload.call_control_id,
            callSessionId: payload.call_leg_id,
            from:          payload.from,
            to:            payload.to,
            restaurantId:  ctx.id,
            systemPrompt:  systemPrompt,
            isVip:         customer?.isVip ?? false,
            telnyxWs:      null as any,
          });

          app.log.info({ callId: payload.call_control_id }, 'Flux pipeline — answering with media stream');

          // Pre-warm Deepgram : initier la connexion en parallèle de la réponse
          // Gain : ~50-80ms de TLS + WS handshake absorbés
          connectDeepgramFlux(mgr.get(payload.call_control_id)!)
            .then(() => app.log.info({ callId: payload.call_control_id }, 'Deepgram pre-warmed'))
            .catch((err: Error) => app.log.error({ err: err.message }, 'Deepgram pre-warm failed'));

          // Répondre avec media streaming via l'API Telnyx
          const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
          const wsUrl = publicUrl.replace(/^http/, 'wss') + `/voice/stream/${payload.call_control_id}`;

          // Fire-and-forget : on répond d'abord au webhook, puis on appelle Telnyx
          reply.send({ result: 'ok' });

          fetch(`https://api.telnyx.com/v2/calls/${payload.call_control_id}/actions/answer`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
            },
            body: JSON.stringify({
              stream_url: wsUrl,
              stream_track: 'inbound_track',
              stream_bidirectional_mode: 'rtp',
              stream_bidirectional_codec: 'L16',
            }),
          }).then(async (res) => {
            if (!res.ok) app.log.error({ status: res.status, body: await res.text() }, 'Telnyx answer failed');
            else app.log.info({ callId: payload.call_control_id }, 'Media stream started');
          }).catch((err) => {
            app.log.error({ err: err.message }, 'Telnyx answer error');
          });

          return; // réponse déjà envoyée
        }

        // ─── Pipeline AI config (legacy) — FLUX_ENABLED = false ───
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
              provider:         'cartesia',
              voice_id:         ctx.personality?.voiceIdCa ?? DEFAULT_CARTESIA_VOICE_ID,
              model:            CARTESIA_MODEL,
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
        ttsProvider: tts_provider ?? 'cartesia-sonic3.5',
        carrier:     'telnyx',
      },
    });
    return reply.send({ received: true });
  });
}
