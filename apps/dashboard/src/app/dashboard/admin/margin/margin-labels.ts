/** Libellés lisibles du suivi des coûts : l'opérateur ne lit ni clé technique ni identifiant. */

const CATEGORY_LABELS: Record<string, string> = {
  TELEPHONY_SECONDS: 'Téléphonie',
  STT_SECONDS: 'Transcription',
  TTS_CHARACTERS: 'Voix de synthèse',
  LLM_INPUT_TOKENS: 'IA (texte lu)',
  LLM_OUTPUT_TOKENS: 'IA (texte écrit)',
  SMS_SEGMENTS: 'SMS',
  EMAIL_MESSAGES: 'E-mails',
  WHATSAPP_MESSAGES: 'WhatsApp',
};

export function usageDimensionLabel(category: string, provider: string): string {
  return `${CATEGORY_LABELS[category] ?? 'Autre usage'} · ${provider}`;
}

export function adjustmentScopeLabel(
  scopeKey: string,
  restaurantName: string | null | undefined,
): string {
  if (scopeKey === 'global') return 'Tous les établissements';
  return restaurantName ?? 'Établissement';
}

export function adjustmentStatusText(status: 'OPEN' | 'APPROVED' | 'REJECTED'): string {
  if (status === 'OPEN') return 'À valider';
  if (status === 'APPROVED') return 'Approuvée';
  return 'Rejetée';
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string): boolean {
  return MONTH_PATTERN.test(value);
}
