const createTelnyx: (key: string) => import('telnyx').TelnyxClient = require('telnyx');

type TelnyxClient = import('telnyx').TelnyxClient;

let _telnyx: TelnyxClient | null = null;

function getTelnyx(): TelnyxClient {
  if (!_telnyx) {
    if (!process.env.TELNYX_API_KEY) {
      throw new Error('TELNYX_API_KEY is required');
    }
    _telnyx = createTelnyx(process.env.TELNYX_API_KEY);
  }
  return _telnyx;
}

const telnyx = new Proxy({} as TelnyxClient, {
  get(_, prop: string | symbol) {
    return (getTelnyx() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export default telnyx;

export async function sendSms(to: string, text: string): Promise<void> {
  const t = getTelnyx();
  await t.messages.create({
    from: process.env.TELNYX_FROM_NUMBER!,
    to,
    text,
  });
}

export interface OutboundCallOptions {
  webhookUrl: string;
  clientState?: Record<string, unknown>;
  connectionId?: string;
  timeoutSecs?: number;
}

export interface OutboundCallResult {
  callControlId: string;
}

export async function placeOutboundCall(
  to: string,
  options: OutboundCallOptions,
): Promise<OutboundCallResult> {
  const t = getTelnyx();
  const from = process.env.TELNYX_FROM_NUMBER;
  if (!from) {
    throw new Error('TELNYX_FROM_NUMBER is required for outbound calls');
  }

  const response = await t.calls.create({
    to,
    from,
    connection_id: options.connectionId,
    webhook_url: options.webhookUrl,
    webhook_url_method: 'POST',
    client_state: options.clientState
      ? Buffer.from(JSON.stringify(options.clientState)).toString('base64')
      : undefined,
    timeout: options.timeoutSecs ?? 30,
  });

  const callControlId = response?.data?.call_control_id ?? response?.call_control_id;
  if (!callControlId) {
    throw new Error('Telnyx outbound call: missing call_control_id in response');
  }
  return { callControlId };
}
