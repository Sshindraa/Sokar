import { FastifyInstance } from 'fastify';
import { telnyxWebhookGuard } from './telnyx.guard';
import { RestaurantService } from '../restaurants/restaurant.service';
import { CustomerService } from '../customers/customer.service';
import { buildSystemPrompt } from './prompts';
import { detectOutcome } from './outcome';
import { CallSessionManager } from './stream/manager';
import { LLM_MODEL } from '@sokar/config';
import { buildSmsJobId, buildTelnyxWebhookJobId } from '../../shared/queue/job-options';

interface TelnyxCallPayload {
  data: {
    event_type: string;
    payload: {
      call_control_id: string;
      call_leg_id: string;
      from: string;
      to: string;
      direction: string;
      duration_sec?: number;
      start_time?: string;
      end_time?: string;
    };
  };
}

export async function telnyxVoiceRoutes(app: FastifyInstance) {
  app.post('/voice/telnyx', { preHandler: telnyxWebhookGuard }, async (req, reply) => {
    const body = req.body as TelnyxCallPayload;
    const eventType = body.data.event_type;
    const payload = body.data.payload;

    switch (eventType) {
      case 'call.initiated': {
        let ctx: any;
        try {
          ctx = await RestaurantService.loadContext(payload.to);
        } catch (err: any) {
          app.log.error(
            { err: err.message, to: payload.to },
            'Restaurant not found for phone number',
          );
          return reply.send({ result: 'ok' });
        }
        const safe = await RestaurantService.checkMarginHealth(ctx.id);

        if (!safe) {
          app.log.warn({ restaurantId: ctx.id }, 'Circuit breaker triggered');
          return reply.send({ result: 'ok' });
        }

        const customer = payload.from
          ? await CustomerService.lookupOrCreate(ctx.id, payload.from)
          : null;

        if (customer?.isVip && process.env.VIP_PUSH_ENABLED === 'true') {
          await app.queues.smsManager.add(
            'vip-alert',
            {
              restaurantId: ctx.id,
              message: `⭐ VIP en ligne${customer.name ? ' : ' + customer.name : ''} — appel entrant`,
              idempotencyKey: buildSmsJobId('vip-alert', ctx.id, payload.call_leg_id),
            },
            { jobId: buildSmsJobId('vip-alert', ctx.id, payload.call_leg_id) },
          );
        }

        const customerExtra = customer ? CustomerService.buildVipPromptExtra(customer) : '';

        const systemPrompt = buildSystemPrompt({ ...ctx, customerExtra });

        // Créer un enregistrement Call minimal dès l'init
        await app.db.call
          .create({
            data: {
              callSid: payload.call_leg_id,
              restaurantId: ctx.id,
              carrier: 'telnyx',
            },
          })
          .catch((err: Error) => {
            if ((err as any)?.code !== 'P2002') {
              app.log.error({ err: err.message }, 'Failed to create call record at init');
            }
          });

        // Pre-créer la session vocale pour que le WebSocket start event la trouve
        // (sinon le handler log "No session found for start event" et reste silencieux).
        // La session est en mode IDLE ici — le WebSocket start event y attachera le
        // telnyxWs et déclenchera la première salutation.
        CallSessionManager.getInstance().create({
          callControlId: payload.call_control_id,
          callSessionId: payload.call_leg_id,
          from: payload.from,
          to: payload.to,
          restaurantId: ctx.id,
          systemPrompt,
          isVip: customer?.isVip ?? false,
          telnyxWs: null as any, // Sera attaché dans le WebSocket start event
          callLegId: payload.call_leg_id,
          codec: 'PCMA',
        });
        app.log.info(
          { callId: payload.call_control_id },
          'Voice session pre-created in call.initiated',
        );

        app.log.info({ callId: payload.call_control_id }, 'Answering call with media stream');

        // Answer with media streaming
        const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
        const wsUrl =
          publicUrl.replace(/^https?/, 'wss') + `/voice/stream/${payload.call_control_id}`;

        reply.send({ result: 'ok' });

        const idempotencyKey = buildTelnyxWebhookJobId('answer', payload.call_control_id);
        await app.queues.telnyxWebhooks.add(
          'answer-call',
          {
            callControlId: payload.call_control_id,
            callLegId: payload.call_leg_id,
            streamUrl: wsUrl,
            codec: 'PCMA',
            idempotencyKey,
          },
          { jobId: idempotencyKey },
        );
        app.log.info({ callId: payload.call_control_id }, 'Telnyx answer job enqueued');

        return; // réponse déjà envoyée
      }

      case 'call.hangup': {
        const durationSec = payload.duration_sec ? Math.round(payload.duration_sec) : null;

        if (durationSec !== null) {
          await app.db.call
            .update({
              where: { callSid: payload.call_leg_id },
              data: { durationSec },
            })
            .catch(() => {});
        }

        const callRecord = await app.db.call.findUnique({
          where: { callSid: payload.call_leg_id },
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
      call_leg_id,
      transcript,
      ended_reason,
      started_at,
      ended_at,
      stt_provider,
      llm_provider,
      tts_provider,
    } = req.body as any;

    await app.db.call.upsert({
      where: { callSid: call_leg_id },
      update: {
        durationSec: Math.round(
          ended_at && started_at
            ? (new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000
            : 0,
        ),
        transcript: transcript ?? null,
        outcome: detectOutcome({ transcript, endedReason: ended_reason }),
        sttProvider: stt_provider ?? 'deepgram-nova3',
        llmProvider: llm_provider ?? LLM_MODEL,
        ttsProvider: tts_provider ?? 'cartesia-sonic3.5',
        carrier: 'telnyx',
      },
      create: {
        callSid: call_leg_id,
        restaurantId: req.restaurantId ?? '',
        durationSec: Math.round(
          ended_at && started_at
            ? (new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000
            : 0,
        ),
        transcript: transcript ?? null,
        outcome: detectOutcome({ transcript, endedReason: ended_reason }),
        sttProvider: stt_provider ?? 'deepgram-nova3',
        llmProvider: llm_provider ?? LLM_MODEL,
        ttsProvider: tts_provider ?? 'cartesia-sonic3.5',
        carrier: 'telnyx',
      },
    });
    return reply.send({ received: true });
  });
}
