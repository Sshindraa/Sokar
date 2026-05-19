/**
 * Types pour les webhooks et payloads Vapi
 * https://docs.vapi.ai/webhooks
 */

export interface VapiWebhookPayload {
  message: {
    type: VapiMessageType;
    call: VapiCall;
    artifact?: VapiArtifact;
    analysis?: VapiAnalysis;
    summary?: string;
    startedAt?: string;
    endedAt?: string;
    cost?: number;
    status?: string;
  };
}

export type VapiMessageType =
  | 'assistant-request'
  | 'function-call'
  | 'status-update'
  | 'end-of-call-report'
  | 'conversation-update'
  | 'model-output'
  | 'transcript';

export interface VapiCall {
  id: string;
  orgId: string;
  createdAt: string;
  updatedAt: string;
  status: 'queued' | 'ringing' | 'in-progress' | 'forwarding' | 'ended';
  endedReason?: string;
  assistantId?: string;
  customer?: {
    number?: string;
    name?: string;
    numberE164CheckEnabled?: boolean;
  };
  phoneNumberId?: string;
  phoneNumber?: {
    id: string;
    orgId: string;
    number: string;
    createdAt: string;
    updatedAt: string;
    name?: string;
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    stripeSubscriptionItemId?: string;
    inboundBondingId?: string;
    outboundBondingId?: string;
    serverUrl?: string;
    serverUrlSecret?: string;
  };
  assistant?: VapiAssistant;
}

export interface VapiAssistant {
  id: string;
  orgId: string;
  name?: string;
  voice?: unknown;
  model?: unknown;
  firstMessage?: string;
  firstMessageMode?: 'assistant-speaks-first' | 'assistant-waits-for-user';
  silenceTimeoutSeconds?: number;
  maxDurationSeconds?: number;
  backgroundSound?: 'off' | 'office' | 'default';
  backchannelingEnabled?: boolean;
  modelOutputInMessagesEnabled?: boolean;
  recordingEnabled?: boolean;
  startSpeakingPlan?: unknown;
  stopSpeakingPlan?: unknown;
  server?: {
    url?: string;
    secret?: string;
    timeoutSeconds?: number;
  };
  functions?: VapiFunction[];
}

export interface VapiFunction {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  async?: boolean;
}

export interface VapiArtifact {
  messages?: Array<{
    role: 'user' | 'system' | 'assistant' | 'tool';
    message: string;
    time: number;
    secondsFromStart: number;
    endTime?: number;
    duration?: number;
    source?: 'transcriber' | 'assistant' | 'api' | 'system';
  }>;
  transcript?: string;
  recordingUrl?: string;
  stereoRecordingUrl?: string;
}

export interface VapiAnalysis {
  summary?: string;
  successEvaluation?: 'true' | 'false' | 'unknown';
  transcript?: string;
}

export interface VapiFunctionCallPayload {
  message: {
    type: 'function-call';
    call: VapiCall;
    functionCall: {
      name: string;
      parameters: Record<string, unknown>;
    };
  };
}

export interface VapiFunctionResult {
  results: Array<{
    name: string;
    result: string;
  }>;
}

export interface VapiEndOfCallReport {
  message: {
    type: 'end-of-call-report';
    call: VapiCall;
    analysis: VapiAnalysis;
    artifact: VapiArtifact;
    startedAt: string;
    endedAt: string;
    cost: number;
    summary: string;
    transcript: string;
    recordingUrl?: string;
    stereoRecordingUrl?: string;
  };
}

export interface VapiAssistantRequestPayload {
  message: {
    type: 'assistant-request';
    call: VapiCall;
  };
}

export interface VapiAssistantResponse {
  assistant: Partial<VapiAssistant>;
  error?: string;
}
