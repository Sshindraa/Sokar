/**
 * Tests unitaires pour le composant CustomerForm.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomerForm } from '@/components/booking/customer-form';

function renderForm(overrides: Partial<Record<string, unknown>> = {}) {
  const handlers = {
    setFirstName: vi.fn(),
    setPhone: vi.fn(),
    setEmail: vi.fn(),
    setSpecialRequests: vi.fn(),
    setHoneypot: vi.fn(),
  };
  const props = {
    firstName: '',
    setFirstName: handlers.setFirstName,
    phone: '',
    setPhone: handlers.setPhone,
    email: '',
    setEmail: handlers.setEmail,
    specialRequests: '',
    setSpecialRequests: handlers.setSpecialRequests,
    honeypot: '',
    setHoneypot: handlers.setHoneypot,
    ...overrides,
  };
  return { ...render(<CustomerForm {...props} />), handlers, props };
}

describe('CustomerForm', () => {
  it('renders firstName, phone, email, and specialRequests fields', () => {
    renderForm();
    expect(screen.getByLabelText(/prénom/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/téléphone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/demandes spéciales/i)).toBeInTheDocument();
  });

  it('marks firstName and phone as required', () => {
    renderForm();
    expect(screen.getByLabelText(/prénom/i)).toBeRequired();
    expect(screen.getByLabelText(/téléphone/i)).toBeRequired();
  });

  it('does not mark email as required (optional)', () => {
    renderForm();
    // Email label includes "(optionnel, pour confirmation)"
    const emailInput = screen.getByLabelText(/email/i);
    expect(emailInput).not.toBeRequired();
  });

  it('calls setFirstName when typing in the firstName field', () => {
    const { handlers } = renderForm();
    fireEvent.change(screen.getByLabelText(/prénom/i), { target: { value: 'Marie' } });
    expect(handlers.setFirstName).toHaveBeenCalledWith('Marie');
  });

  it('calls setPhone when typing in the phone field', () => {
    const { handlers } = renderForm();
    fireEvent.change(screen.getByLabelText(/téléphone/i), { target: { value: '+33612345678' } });
    expect(handlers.setPhone).toHaveBeenCalledWith('+33612345678');
  });

  it('calls setEmail when typing in the email field', () => {
    const { handlers } = renderForm();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'marie@test.com' } });
    expect(handlers.setEmail).toHaveBeenCalledWith('marie@test.com');
  });

  it('calls setSpecialRequests when typing in the textarea', () => {
    const { handlers } = renderForm();
    fireEvent.change(screen.getByLabelText(/demandes spéciales/i), {
      target: { value: 'Table près de la fenêtre' },
    });
    expect(handlers.setSpecialRequests).toHaveBeenCalledWith('Table près de la fenêtre');
  });

  it('displays the phone hint about international format', () => {
    renderForm();
    expect(screen.getByText(/format international/i)).toBeInTheDocument();
  });

  it('renders the honeypot field hidden from users', () => {
    renderForm();
    const honeypot = screen.getByLabelText(/website/i);
    expect(honeypot).toBeInTheDocument();
    // The honeypot is inside a div with class "hidden" and aria-hidden
    expect(honeypot.closest('div')).toHaveClass('hidden');
    expect(honeypot.closest('div')).toHaveAttribute('aria-hidden', 'true');
  });

  it('honeypot field has tabIndex -1 to prevent keyboard focus', () => {
    renderForm();
    const honeypot = screen.getByLabelText(/website/i);
    expect(honeypot).toHaveAttribute('tabindex', '-1');
  });

  it('calls setHoneypot when the honeypot field changes', () => {
    const { handlers } = renderForm();
    fireEvent.change(screen.getByLabelText(/website/i), { target: { value: 'spam' } });
    expect(handlers.setHoneypot).toHaveBeenCalledWith('spam');
  });

  it('displays the current firstName value', () => {
    renderForm({ firstName: 'Jean' });
    expect((screen.getByLabelText(/prénom/i) as HTMLInputElement).value).toBe('Jean');
  });

  it('displays the current phone value', () => {
    renderForm({ phone: '+33612345678' });
    expect((screen.getByLabelText(/téléphone/i) as HTMLInputElement).value).toBe('+33612345678');
  });

  it('displays the current email value', () => {
    renderForm({ email: 'test@test.com' });
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe('test@test.com');
  });

  it('phone field has type="tel"', () => {
    renderForm();
    expect(screen.getByLabelText(/téléphone/i)).toHaveAttribute('type', 'tel');
  });

  it('email field has type="email"', () => {
    renderForm();
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('type', 'email');
  });
});
