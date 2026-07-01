declare module 'telnyx' {
  interface TelnyxMessageResult {
    data?: { id: string; [key: string]: unknown };
  }

  interface TelnyxCallResult {
    data?: { call_control_id: string; [key: string]: unknown };
    call_control_id?: string;
  }

  interface TelnyxWebhookEvent {
    data: {
      event_type: string;
      payload: Record<string, unknown>;
    };
  }

  export function createTelnyx(apiKey: string): TelnyxClient;

  export interface TelnyxClient {
    messages: {
      create(params: { from: string; to: string; text: string }): Promise<TelnyxMessageResult>;
    };
    calls: {
      create(params: {
        to: string;
        from: string;
        connection_id?: string;
        webhook_url?: string;
        webhook_url_method?: string;
        answering_machine_detection?:
          | 'disabled'
          | 'detect'
          | 'detect_beep'
          | 'always'
          | 'greeting_end';
        client_state?: string;
        command_timeout_secs?: number;
        timeout?: number;
      }): Promise<TelnyxCallResult>;
      retrieve(id: string): Promise<TelnyxCallResult>;
    };
    balance: {
      retrieve(): Promise<unknown>;
    };
    webhooks: {
      constructEvent(
        payload: string,
        signature: Uint8Array,
        timestamp: string | undefined,
        publicKey: Uint8Array,
        tolerance?: number,
      ): TelnyxWebhookEvent;
    };
  }
}

declare module 'telnyx/dist/Webhooks.js' {
  const Webhooks: {
    DEFAULT_TOLERANCE: number;
    constructEvent(
      payload: string,
      signatureHeader: string,
      timestampHeader: string,
      publicKey: string,
      tolerance?: number,
    ): TelnyxWebhookEvent;
  };
  export default Webhooks;
}
