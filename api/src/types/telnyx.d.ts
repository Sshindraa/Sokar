declare module 'telnyx' {
  export function createTelnyx(apiKey: string): TelnyxClient;

  interface TelnyxClient {
    messages: {
      create(params: { from: string; to: string; text: string }): Promise<any>;
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
