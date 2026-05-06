export interface CallEvent {
  id:            string;
  phoneNumberId: string;
  endedReason?:  'transfer' | 'error' | 'customer-ended-call' | 'assistant-ended-call' | string;
  transcript?:   string;
  startedAt?:    string;
  endedAt?:      string;
}
