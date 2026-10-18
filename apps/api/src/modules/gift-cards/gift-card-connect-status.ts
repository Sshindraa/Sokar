type AccountStatus = {
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements?: {
    currently_due?: string[] | null;
    past_due?: string[] | null;
    pending_verification?: string[] | null;
    disabled_reason?: string | null;
    current_deadline?: number | null;
    errors?: { requirement: string }[] | null;
  } | null;
};

function requirementLabel(field: string) {
  if (field.includes('verification.document'))
    return 'Fournir ou corriger les justificatifs demandés';
  if (field === 'external_account' || field.includes('bank_account'))
    return 'Compléter les coordonnées bancaires';
  if (field.startsWith('tos_acceptance.')) return 'Accepter les conditions Stripe';
  if (field.startsWith('individual.') || field.startsWith('person_'))
    return 'Compléter les informations du représentant ou des bénéficiaires';
  if (field.startsWith('company.') || field.startsWith('business_profile.'))
    return 'Compléter les informations de l’établissement';
  return 'Consulter et compléter les informations demandées par Stripe';
}

/** Return useful labels, never person IDs, raw provider errors or submitted personal data. */
export function describeConnectedAccount(account: AccountStatus) {
  const requirements = account.requirements;
  const pendingFields = new Set(requirements?.pending_verification ?? []);
  const due = [
    ...(requirements?.currently_due ?? []).filter((field) => !pendingFields.has(field)),
    ...(requirements?.past_due ?? []).filter((field) => !pendingFields.has(field)),
    ...(requirements?.errors ?? []).map((error) => error.requirement),
  ];
  const reason = requirements?.disabled_reason;
  const pending =
    Boolean(requirements?.pending_verification?.length) ||
    reason === 'requirements.pending_verification' ||
    reason === 'under_review';
  const blocked = Boolean(
    reason &&
    reason !== 'requirements.pending_verification' &&
    reason !== 'under_review' &&
    reason !== 'requirements.past_due',
  );
  let onboardingState:
    | 'configuration_required'
    | 'verification_pending'
    | 'action_required'
    | 'ready';
  if (blocked || requirements?.errors?.length) onboardingState = 'action_required';
  else if (due.length)
    onboardingState = account.details_submitted ? 'action_required' : 'configuration_required';
  else if (pending) onboardingState = 'verification_pending';
  else if (account.charges_enabled && account.payouts_enabled) onboardingState = 'ready';
  else onboardingState = account.details_submitted ? 'action_required' : 'configuration_required';
  const actionItems: string[] = [...new Set(due.map(requirementLabel))];
  if (onboardingState === 'action_required' && !actionItems.length)
    actionItems.push(
      'Ouvrir la configuration pour consulter le blocage ; contacter Stripe s’il persiste',
    );
  if (onboardingState === 'configuration_required' && !actionItems.length)
    actionItems.push('Renseigner les informations de votre établissement et votre compte bancaire');
  return {
    onboardingState,
    actionItems,
    deadline:
      due.length && requirements?.current_deadline
        ? new Date(requirements.current_deadline * 1000).toISOString()
        : null,
  };
}
