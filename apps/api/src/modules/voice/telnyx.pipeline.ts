import { FastifyInstance } from 'fastify';
import { telnyxWebhookGuard } from './telnyx.guard';
import { RestaurantService } from '../restaurants/restaurant.service';
import { CustomerService } from '../customers/customer.service';
import { buildSystemPrompt, type OpeningHours } from './prompts';
import { detectOutcome, hadReservationIntent } from './outcome';
import { CallSessionManager } from './stream/manager';
import { VOICE_LLM_MODEL_DEFAULT } from '@sokar/config';
import { buildSmsJobId, buildTelnyxWebhookJobId } from '../../shared/queue/job-options';
import { isVoicePipelineEnabled } from '../../shared/configcat';

function buildRecoveryJobId(callLegId: string): string {
  return `recovery:${callLegId}`;
}

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

interface TelnyxCallEndPayload {
  call_leg_id: string;
  transcript?: string;
  ended_reason?: string;
  started_at?: string;
  ended_at?: string;
  stt_provider?: string;
  llm_provider?: string;
  tts_provider?: string;
  from?: string;
  to?: string;
}

export async function telnyxVoiceRoutes(app: FastifyInstance) {
  app.post('/voice/telnyx', { preHandler: telnyxWebhookGuard }, async (req, reply) => {
    const body = req.body as TelnyxCallPayload;
    const eventType = body.data.event_type;
    const payload = body.data.payload;

    switch (eventType) {
      case 'call.initiated': {
        let ctx: Awaited<ReturnType<typeof RestaurantService.loadContext>>;
        try {
          ctx = await RestaurantService.loadContext(payload.to);
        } catch (err: unknown) {
          app.log.error(
            { err: err instanceof Error ? err.message : String(err), to: payload.to },
            'Restaurant not found for phone number',
          );
          return reply.send({ result: 'ok' });
        }
        const safe = await RestaurantService.checkMarginHealth(ctx.id);

        if (!safe) {
          app.log.warn({ restaurantId: ctx.id }, 'Circuit breaker triggered');
          return reply.send({ result: 'ok' });
        }

        // Kill switch — drop the call before any expensive work (DB write,
        // session create, queue enqueue). Telnyx will fall back to voicemail
        // / configured fallback flow.
        if (!(await isVoicePipelineEnabled(ctx.id))) {
          app.log.warn(
            { restaurantId: ctx.id, callId: payload.call_control_id },
            'Voice pipeline killed by feature flag — dropping call',
          );
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
        const customerGreeting = customer ? CustomerService.buildReturningGreeting(customer) : '';

        const systemPrompt = buildSystemPrompt({
          ...ctx,
          openingHours: ctx.openingHours as OpeningHours,
          customerExtra,
          customerGreeting,
          giftCardMinimumAmount: ctx.giftCardMinimumAmount,
        });

        // Créer un enregistrement Call minimal dès l'init
        try {
          await app.db.call.create({
            data: {
              callSid: payload.call_leg_id,
              restaurantId: ctx.id,
              carrier: 'telnyx',
            },
          });
        } catch (err: unknown) {
          if ((err as { code?: string })?.code !== 'P2002') {
            app.log.error(
              { err: err instanceof Error ? err.message : String(err) },
              'Failed to create call record at init',
            );
          }
        }

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
          telnyxWs: null as unknown as import('ws').WebSocket, // Sera attaché dans le WebSocket start event
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
          try {
            await app.db.call.update({
              where: { callSid: payload.call_leg_id },
              data: { durationSec },
            });
          } catch {
            // Swallow — call record may not exist (e.g. pipeline killed early).
          }
        }

        const callRecord = await app.db.call.findUnique({
          where: { callSid: payload.call_leg_id },
          include: { reservation: true },
        });

        if (callRecord?.reservation && payload.from) {
          const ctx = await RestaurantService.loadContext(payload.to);
          await CustomerService.incrementVisit(ctx.id, payload.from);
        }

        // Record call activity on every hangup (with or without reservation)
        // so we have lastCallAt + partySizeTypical for the next call's greeting.
        if (payload.from) {
          try {
            const ctx = await RestaurantService.loadContext(payload.to);
            const partySize = callRecord?.reservation?.partySize ?? null;
            await CustomerService.recordCallActivity(ctx.id, payload.from, partySize);
          } catch (err: unknown) {
            app.log.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'failed to record call activity',
            );
          }
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
      from,
    } = req.body as TelnyxCallEndPayload;

    const outcome = detectOutcome({ transcript, endedReason: ended_reason });

    const callRow = await app.db.call.upsert({
      where: { callSid: call_leg_id },
      update: {
        durationSec: Math.round(
          ended_at && started_at
            ? (new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000
            : 0,
        ),
        transcript: transcript ?? null,
        outcome,
        sttProvider: stt_provider ?? 'deepgram-nova3',
        llmProvider: llm_provider ?? process.env.VOICE_LLM_MODEL ?? VOICE_LLM_MODEL_DEFAULT,
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
        outcome,
        sttProvider: stt_provider ?? 'deepgram-nova3',
        llmProvider: llm_provider ?? process.env.VOICE_LLM_MODEL ?? VOICE_LLM_MODEL_DEFAULT,
        ttsProvider: tts_provider ?? 'cartesia-sonic3.5',
        carrier: 'telnyx',
      },
    });

    // ─── Revenue Engine: recovery dispatch ──────────────────────────────
    // If the call ended without a reservation but the transcript shows clear
    // reservation intent, enqueue a follow-up SMS so the caller's booking
    // attempt is recovered. Idempotent on call_leg_id.
    const shouldRecover =
      outcome !== 'RESERVED' &&
      outcome !== 'INFO' &&
      hadReservationIntent({ transcript, endedReason: ended_reason });

    if (shouldRecover && callRow.id && from) {
      try {
        const ctx = await RestaurantService.loadContext(
          (req.body as TelnyxCallEndPayload)?.to ?? '',
        );
        const customer = await app.db.customer.findFirst({
          where: { restaurantId: ctx.id, phone: from },
          select: { name: true },
        });
        const reason: 'no_action_with_intent' | 'handoff_dropped' | 'transport_error' =
          outcome === 'HANDOFF'
            ? 'handoff_dropped'
            : outcome === 'ERROR'
              ? 'transport_error'
              : 'no_action_with_intent';

        const jobId = buildRecoveryJobId(call_leg_id);
        await app.queues.callRecovery.add(
          'send-recovery-sms',
          {
            callId: callRow.id,
            restaurantId: ctx.id,
            customerPhone: from,
            customerName: customer?.name ?? null,
            restaurantName: ctx.name,
            restaurantPhone: ctx.phoneNumber ?? null,
            reason,
          },
          { jobId },
        );
      } catch (err: unknown) {
        app.log.warn(
          { err: err instanceof Error ? err.message : String(err), callId: call_leg_id },
          'failed to enqueue recovery SMS',
        );
      }
    }

    return reply.send({ received: true });
  });
}
