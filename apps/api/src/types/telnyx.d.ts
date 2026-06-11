declare module 'telnyx' {
  export function createTelnyx(apiKey: string): TelnyxClient;

  interface TelnyxClient {
    messages: {
      create(params: { from: string; to: string; text: string }): Promise<any>;
    };
    calls: {
      create(params: {
        to: string;
        from: string;
        connection_id?: string;
        webhook_url?: string;
        webhook_url_method?: string;
        answering_machine_detection?: 'disabled' | 'detect' | 'detect_beep' | 'always' | 'greeting_end';
        client_state?: string;
        command_timeout_secs?: number;
        timeout?: number;
      }): Promise<any>;
      retrieve(id: string): Promise<any>;
    };
    webhooks: {
      constructEvent(
        payload: string,
        signature: Uint8Array,
        timestamp: string | undefined,
        publicKey: Uint8Array,
        tolerance?: number,
      ): any;
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
    ): any;
  };
  export default Webhooks;
}
