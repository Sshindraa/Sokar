import { FastifyInstance }    from 'fastify';
import { telnyxWebhookGuard } from './telnyx.guard';
import { ReservationService } from '../reservations/reservation.service';
import { RestaurantService }  from '../restaurants/restaurant.service';
import { CustomerService }    from '../customers/customer.service';
import { buildSystemPrompt }  from './prompts';
import { detectOutcome }      from './outcome';
import { LLM_MODEL } from '@sokar/config';
import { CallSessionManager } from './stream/manager';
import { connectDeepgramFlux } from './stream/deepgram-bridge';

interface TelnyxCallPayload {
  data: {
    event_type: string;
    payload: {
      call_control_id: string;
      call_leg_id:     string;
      from:            string;
      to:              string;
      direction:       string;
      duration_sec?:   number;
      start_time?:     string;
      end_time?:       string;
    };
  };
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

        // Créer un enregistrement Call minimal dès l'init
        await app.db.call.create({
          data: {
            callSid: payload.call_leg_id,
            restaurantId: ctx.id,
            carrier: 'telnyx',
          },
        }).catch((err: Error) => {
          if ((err as any)?.code !== 'P2002') {
            app.log.error({ err: err.message }, 'Failed to create call record at init');
          }
        });

        // ─── Media Stream Pipeline ───
        const mgr = CallSessionManager.getInstance();
        mgr.create({
          callControlId: payload.call_control_id,
          callSessionId: payload.call_leg_id,
          callLegId:     payload.call_leg_id,
          from:          payload.from,
          to:            payload.to,
          restaurantId:  ctx.id,
          systemPrompt:  systemPrompt,
          isVip:         customer?.isVip ?? false,
          telnyxWs:      null as any,
        });

        app.log.info({ callId: payload.call_control_id }, 'Media stream pipeline — answering');

        // Pre-warm Deepgram
        connectDeepgramFlux(mgr.get(payload.call_control_id)!)
          .then(() => app.log.info({ callId: payload.call_control_id }, 'Deepgram pre-warmed'))
          .catch((err: Error) => app.log.error({ err: err.message }, 'Deepgram pre-warm failed'));

        // Answer with media streaming
        const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
        const wsUrl = publicUrl.replace(/^https?/, 'wss') + `/voice/stream/${payload.call_control_id}`;

        reply.send({ result: 'ok' });

        // Retry avec backoff : 3 tentatives (1s, 3s, 7s)
        const answerTelnyx = async (attempt = 1): Promise<void> => {
          try {
            const res = await fetch(`https://api.telnyx.com/v2/calls/${payload.call_control_id}/actions/answer`, {
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
            });
            if (res.ok) {
              app.log.info({ callId: payload.call_control_id }, 'Media stream started');
              return;
            }
            const body = await res.text();
            if (attempt < 3) {
              const delay = [1000, 3000, 7000][attempt - 1];
              app.log.warn({ status: res.status, attempt }, `Telnyx answer failed, retrying in ${delay}ms`);
              await new Promise(r => setTimeout(r, delay));
              return answerTelnyx(attempt + 1);
            }
            app.log.error({ status: res.status, body }, 'Telnyx answer failed after 3 attempts');
          } catch (err: any) {
            if (attempt < 3) {
              const delay = [1000, 3000, 7000][attempt - 1];
              app.log.warn({ err: err.message, attempt }, `Telnyx answer error, retrying in ${delay}ms`);
              await new Promise(r => setTimeout(r, delay));
              return answerTelnyx(attempt + 1);
            }
            app.log.error({ err: err.message }, 'Telnyx answer error after 3 attempts');
          }
        };
        answerTelnyx();

        return; // réponse déjà envoyée
      }

      case 'call.hangup': {
        const durationSec = payload.duration_sec
          ? Math.round(payload.duration_sec)
          : null;

        if (durationSec !== null) {
          await app.db.call.update({
            where: { callSid: payload.call_leg_id },
            data: { durationSec },
          }).catch(() => {});
        }

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

  app.post('/voice/telnyx/end', { preHandler: telnyxWebhookGuard }, async (req, reply) => {
    const {
      call_leg_id, transcript, ended_reason,
      started_at, ended_at,
      stt_provider, llm_provider, tts_provider,
    } = req.body as any;

    await app.db.call.upsert({
      where: { callSid: call_leg_id },
      update: {
        durationSec: Math.round(
          ended_at && started_at
            ? (new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000
            : 0
        ),
        transcript:  transcript ?? null,
        outcome:     detectOutcome({ transcript, endedReason: ended_reason }),
        sttProvider: stt_provider ?? 'deepgram-nova3',
        llmProvider: llm_provider ?? LLM_MODEL,
        ttsProvider: tts_provider ?? 'cartesia-sonic3.5',
        carrier:     'telnyx',
      },
      create: {
        callSid: call_leg_id,
        restaurantId: req.restaurantId ?? '',
        durationSec: Math.round(
          ended_at && started_at
            ? (new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000
            : 0
        ),
        transcript:  transcript ?? null,
        outcome:     detectOutcome({ transcript, endedReason: ended_reason }),
        sttProvider: stt_provider ?? 'deepgram-nova3',
        llmProvider: llm_provider ?? LLM_MODEL,
        ttsProvider: tts_provider ?? 'cartesia-sonic3.5',
        carrier:     'telnyx',
      },
    });
    return reply.send({ received: true });
  });
}
