import { FastifyInstance } from 'fastify';
import { telnyxWebhookGuard, webhookEventLabel } from './telnyx.guard';
import { telnyxWebhookEventsTotal } from '../../shared/observability/metrics';
import { RestaurantService } from '../restaurants/restaurant.service';
import { CustomerService } from '../customers/customer.service';
import { buildSystemPrompt, type OpeningHours } from './prompts';
import { detectOutcome, hadReservationIntent } from './outcome';
import { CallSessionManager } from './stream/manager';
import { VOICE_LLM_MODEL_DEFAULT } from '@sokar/config';
import {
  buildSmsJobId,
  buildTelnyxWebhookJobId,
  sanitizeJobId,
} from '../../shared/queue/job-options';
import { isVoicePipelineEnabled } from '../../shared/configcat';
import { telnyxFetch } from '../../shared/telnyx/http-agent';
import { MS_TO_SECONDS } from '../../shared/constants/time.js';

function buildRecoveryJobId(callLegId: string): string {
  return sanitizeJobId(`recovery_${callLegId}`);
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
      recording_id?: string;
      recording_urls?: { mp3?: string; wav?: string };
      started_at?: string;
      ended_at?: string;
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
  // Comptage des webhooks traités / en erreur (alerte « webhook Telnyx en
  // erreur » du worker system-health). Les 403 du guard sont déjà comptées
  // en result='rejected' — on les exclut ici pour ne pas double-compter.
  app.addHook('onResponse', (req, reply, done) => {
    try {
      if (reply.statusCode !== 403) {
        telnyxWebhookEventsTotal.inc({
          event: webhookEventLabel(req.url),
          result: reply.statusCode >= 500 ? 'error' : 'processed',
        });
      }
    } catch {
      // La métrique ne doit jamais casser le webhook.
    }
    done();
  });

  app.post('/voice/telnyx', { preHandler: telnyxWebhookGuard }, async (req, reply) => {
    const body = req.body as TelnyxCallPayload;
    const eventType = body.data.event_type;
    const payload = body.data.payload;

    switch (eventType) {
      case 'call.recording.saved': {
        const recordingId = payload.recording_id;
        const downloadUrl = payload.recording_urls?.mp3;
        if (
          process.env.CALL_RECORDING_ENABLED !== 'true' ||
          !recordingId ||
          !downloadUrl ||
          !payload.call_leg_id
        ) {
          app.log.warn(
            { callLegId: payload.call_leg_id, recordingId },
            'Recording webhook ignored: feature disabled or incomplete payload',
          );
          return reply.send({ result: 'ignored' });
        }

        const jobId = buildTelnyxWebhookJobId('store-recording', recordingId);
        await app.queues.telnyxWebhooks.add(
          'store-recording',
          {
            callLegId: payload.call_leg_id,
            recordingId,
            downloadUrl,
            startedAt: payload.started_at,
            endedAt: payload.ended_at,
          },
          { jobId },
        );
        return reply.send({ result: 'ok' });
      }

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

        // ── Parallélisation des 3 lectures indépendantes (ctx.id only) ──
        // Avant : checkMarginHealth → isVoicePipelineEnabled → lookupOrCreate
        //         (3 awaits séquentiels = ~50-150ms cumulés)
        // Après : Promise.all des 3 en parallèle = max(3) au lieu de sum(3)
        const [safe, voiceEnabled, customer] = await Promise.all([
          RestaurantService.checkMarginHealth(ctx.id),
          isVoicePipelineEnabled(ctx.id),
          payload.from
            ? CustomerService.lookupOrCreate(ctx.id, payload.from)
            : Promise.resolve(null),
        ]);

        if (!safe) {
          app.log.warn({ restaurantId: ctx.id }, 'Circuit breaker triggered');
          return reply.send({ result: 'ok' });
        }

        // Kill switch — drop the call before any expensive work (DB write,
        // session create, queue enqueue). Telnyx will fall back to voicemail
        // / configured fallback flow.
        if (!voiceEnabled) {
          app.log.warn(
            { restaurantId: ctx.id, callId: payload.call_control_id },
            'Voice pipeline killed by feature flag — dropping call',
          );
          return reply.send({ result: 'ok' });
        }

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
        // P2002 (duplicate unique key) est attendu en cas de retransmission webhook
        // Telnyx ou race avec call.hangup — on le swallow en warn.
        // Toute autre erreur Prisma (FK violation, timeout, connexion) est
        // re-thrown pour ne pas continuer avec un état DB incohérent.
        try {
          await app.db.call.create({
            data: {
              callSid: payload.call_leg_id,
              restaurantId: ctx.id,
              carrier: 'telnyx',
            },
          });
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (code === 'P2002') {
            app.log.warn(
              { callSid: payload.call_leg_id, restaurantId: ctx.id },
              'Duplicate call record at init (webhook retry or race) — continuing',
            );
            // Continue: la session sera tout de même créée et l'appel répondu
            // (le webhook est un retry, le call existe déjà en DB).
          } else {
            app.log.error(
              { err: err instanceof Error ? err.message : String(err), code },
              'Failed to create call record at init — rethrowing',
            );
            throw err;
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
          restaurantName: ctx.name,
          timezone: ctx.timezone,
          giftCardMinimumAmount: ctx.giftCardMinimumAmount ?? undefined,
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

        // ── Answer direct (sans queue BullMQ) ──
        // Avant : enqueue BullMQ → worker pickup → Telnyx API = 50-150ms de queue
        // Après : Telnyx API direct via telnyxFetch (keep-alive) = 28-54ms
        // Fallback : si l'answer direct échoue, on enqueue un job retry sur la queue
        // pour préserver la fiabilité (8 retries avec backoff exponentiel).
        const idempotencyKey = buildTelnyxWebhookJobId('answer', payload.call_control_id);
        const apiKey = process.env.TELNYX_API_KEY;
        if (apiKey) {
          telnyxFetch(`/v2/calls/${payload.call_control_id}/actions/answer`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({
              stream_url: wsUrl,
              stream_track: 'inbound_track',
              stream_bidirectional_mode: 'rtp',
              stream_bidirectional_codec: 'PCMA',
            }),
          })
            .then(async (res) => {
              if (res.ok) {
                app.log.info({ callId: payload.call_control_id }, 'Telnyx call answered (direct)');
              } else {
                const body = await res.text();
                app.log.warn(
                  { callId: payload.call_control_id, status: res.status, body: body.slice(0, 200) },
                  'Direct answer failed — falling back to queue retry',
                );
                // Fallback : enqueue le job pour retry automatique
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
              }
            })
            .catch((err) => {
              app.log.error(
                { err: err instanceof Error ? err.message : String(err), callId: payload.call_control_id },
                'Direct answer threw — falling back to queue retry',
              );
              // Fallback : enqueue le job pour retry automatique
              app.queues.telnyxWebhooks
                .add(
                  'answer-call',
                  {
                    callControlId: payload.call_control_id,
                    callLegId: payload.call_leg_id,
                    streamUrl: wsUrl,
                    codec: 'PCMA',
                    idempotencyKey,
                  },
                  { jobId: idempotencyKey },
                )
                .catch((enqueueErr) =>
                  app.log.error(
                    { err: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr) },
                    'Failed to enqueue answer-call fallback',
                  ),
                );
            });
        } else {
          app.log.error('TELNYX_API_KEY not configured — cannot answer call');
        }

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

        // Telnyx peut omettre ou retarder `call.recording.saved`. Un appel de
        // test déjà marqué PENDING est donc réconcilié depuis son API après la
        // fin d'appel, avec retry queue et sans élargir l'allowlist.
        if (
          process.env.CALL_RECORDING_ENABLED === 'true' &&
          callRecord?.recordingStatus === 'PENDING'
        ) {
          try {
            const jobId = buildTelnyxWebhookJobId('recover-recording', payload.call_leg_id);
            await app.queues.telnyxWebhooks.add(
              'recover-recording',
              { callLegId: payload.call_leg_id },
              {
                jobId,
                delay: 30_000,
                attempts: 5,
                backoff: { type: 'exponential', delay: 30_000 },
              },
            );
          } catch (err: unknown) {
            app.log.warn(
              {
                err: err instanceof Error ? err.message : String(err),
                callLegId: payload.call_leg_id,
              },
              'failed to enqueue recording recovery',
            );
          }
        }

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
      to,
    } = req.body as TelnyxCallEndPayload;

    const outcome = detectOutcome({ transcript, endedReason: ended_reason });

    // Résoudre le restaurantId : le guard ne peuple pas req.restaurantId.
    // On tente (1) l'attribut posé par un authMiddleware éventuel, puis
    // (2) un lookup via le numéro Telnyx `to`. Si aucun n'est disponible,
    // on refuse avec 400 plutôt que d'écrire un Call orphelin (restaurantId='').
    let restaurantId: string | undefined = (req as { restaurantId?: string }).restaurantId;
    if (!restaurantId && to) {
      try {
        const ctx = await RestaurantService.loadContext(to);
        restaurantId = ctx.id;
      } catch (err: unknown) {
        app.log.warn(
          { err: err instanceof Error ? err.message : String(err), to },
          '/voice/telnyx/end: failed to resolve restaurantId from `to`',
        );
      }
    }
    if (!restaurantId) {
      app.log.error(
        { call_leg_id, hasTo: Boolean(to) },
        '/voice/telnyx/end: cannot resolve restaurantId — refusing',
      );
      return reply.status(400).send({ error: 'restaurantId is required' });
    }

    const callRow = await app.db.call.upsert({
      where: { callSid: call_leg_id },
      update: {
        durationSec: Math.round(
          ended_at && started_at
            ? (new Date(ended_at).getTime() - new Date(started_at).getTime()) / MS_TO_SECONDS
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
        restaurantId,
        durationSec: Math.round(
          ended_at && started_at
            ? (new Date(ended_at).getTime() - new Date(started_at).getTime()) / MS_TO_SECONDS
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
        // restaurantId est garanti non-vide ici (vérifié plus haut).
        // On charge le ctx via to s'il est disponible, sinon via loadContext(to).
        const ctx = to
          ? await RestaurantService.loadContext(to).catch(() => ({
              id: restaurantId!,
              name: '',
              slug: null as string | null,
              phoneNumber: null,
            }))
          : { id: restaurantId!, name: '', slug: null as string | null, phoneNumber: null };
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
            restaurantSlug: ctx.slug ?? null,
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
