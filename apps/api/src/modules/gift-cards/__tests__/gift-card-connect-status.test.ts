import { describe, expect, it } from 'vitest';
import { describeConnectedAccount } from '../gift-card-connect-status';

const base = { charges_enabled: false, payouts_enabled: false, details_submitted: false };
describe('Connect restaurant status', () => {
  it('does not ask users to resubmit a due document already under verification', () => {
    const document = 'individual.verification.document';
    expect(
      describeConnectedAccount({
        ...base,
        details_submitted: true,
        requirements: {
          currently_due: [document],
          past_due: [document],
          pending_verification: [document],
        },
      }),
    ).toMatchObject({ onboardingState: 'verification_pending', actionItems: [] });
    expect(
      describeConnectedAccount({
        ...base,
        details_submitted: true,
        requirements: {
          currently_due: [document, 'external_account'],
          pending_verification: [document],
        },
      }),
    ).toMatchObject({
      onboardingState: 'action_required',
      actionItems: ['Compléter les coordonnées bancaires'],
    });
  });
  it('keeps a new account with initial past-due fields in the configuration step', () => {
    expect(
      describeConnectedAccount({
        ...base,
        requirements: {
          disabled_reason: 'requirements.past_due',
          currently_due: ['external_account'],
          past_due: ['external_account'],
        },
      }).onboardingState,
    ).toBe('configuration_required');
    expect(
      describeConnectedAccount({
        ...base,
        details_submitted: true,
        requirements: { disabled_reason: 'requirements.past_due', past_due: ['external_account'] },
      }).onboardingState,
    ).toBe('action_required');
  });
  it('asks for configuration before submission, with useful banking instructions', () => {
    expect(
      describeConnectedAccount({
        ...base,
        requirements: {
          currently_due: ['external_account', 'tos_acceptance.date', 'tos_acceptance.ip'],
        },
      }),
    ).toMatchObject({
      onboardingState: 'configuration_required',
      actionItems: ['Compléter les coordonnées bancaires', 'Accepter les conditions Stripe'],
    });
  });
  it('waits only when Stripe actually reports a pending verification', () => {
    expect(
      describeConnectedAccount({
        ...base,
        details_submitted: true,
        requirements: { pending_verification: ['individual.verification.document'] },
      }).onboardingState,
    ).toBe('verification_pending');
    expect(describeConnectedAccount({ ...base, details_submitted: true }).onboardingState).toBe(
      'action_required',
    );
  });
  it('prioritizes corrections over pending verification and strips raw error data and person IDs', () => {
    const result = describeConnectedAccount({
      ...base,
      details_submitted: true,
      requirements: {
        errors: [{ requirement: 'person_private.verification.document' }],
        pending_verification: ['company.tax_id'],
        current_deadline: 1791000000,
      },
    });
    expect(result.onboardingState).toBe('action_required');
    expect(result.actionItems).toEqual(['Fournir ou corriger les justificatifs demandés']);
    expect(result.deadline).toBe(new Date(1791000000000).toISOString());
    expect(JSON.stringify(result)).not.toContain('person_private');
  });
  it('keeps required actions visible even if payments and payouts are already enabled', () => {
    expect(
      describeConnectedAccount({
        ...base,
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: ['company.tax_id'] },
      }).onboardingState,
    ).toBe('action_required');
  });
  it('does not present a rejected account as a normal configuration or a pending review', () => {
    expect(
      describeConnectedAccount({ ...base, requirements: { disabled_reason: 'rejected.other' } }),
    ).toMatchObject({ onboardingState: 'action_required' });
    expect(
      describeConnectedAccount({ ...base, requirements: { disabled_reason: 'under_review' } }),
    ).toMatchObject({ onboardingState: 'verification_pending' });
  });
  it('requires both payment and payout authorization for the ready state', () => {
    expect(
      describeConnectedAccount({ ...base, details_submitted: true, charges_enabled: true })
        .onboardingState,
    ).toBe('action_required');
    expect(
      describeConnectedAccount({
        ...base,
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true,
      }),
    ).toEqual({ onboardingState: 'ready', actionItems: [], deadline: null });
  });
});
