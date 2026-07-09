/**
 * Tests unitaires pour le composant PartySizePicker.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PartySizePicker } from '@/components/booking/party-size-picker';

describe('PartySizePicker', () => {
  it('renders a select with the correct label', () => {
    render(<PartySizePicker value={2} onChange={() => {}} />);
    expect(screen.getByLabelText(/nombre de personnes/i)).toBeInTheDocument();
  });

  it('renders options from 1 to 12', () => {
    render(<PartySizePicker value={2} onChange={() => {}} />);
    const select = screen.getByLabelText(/nombre de personnes/i) as HTMLSelectElement;
    expect(select.options).toHaveLength(12);
    expect(select.options[0].value).toBe('1');
    expect(select.options[11].value).toBe('12');
  });

  it('uses singular "personne" for 1 and plural for others', () => {
    render(<PartySizePicker value={1} onChange={() => {}} />);
    const select = screen.getByLabelText(/nombre de personnes/i) as HTMLSelectElement;
    expect(select.options[0].textContent).toBe('1 personne');
    expect(select.options[1].textContent).toBe('2 personnes');
  });

  it('shows the selected value', () => {
    render(<PartySizePicker value={4} onChange={() => {}} />);
    const select = screen.getByLabelText(/nombre de personnes/i) as HTMLSelectElement;
    expect(select.value).toBe('4');
  });

  it('calls onChange with the numeric value when selecting a new option', () => {
    const onChange = vi.fn();
    render(<PartySizePicker value={2} onChange={onChange} />);
    const select = screen.getByLabelText(/nombre de personnes/i);
    fireEvent.change(select, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith(5);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('calls onChange with 1 when selecting the first option', () => {
    const onChange = vi.fn();
    render(<PartySizePicker value={5} onChange={onChange} />);
    const select = screen.getByLabelText(/nombre de personnes/i);
    fireEvent.change(select, { target: { value: '1' } });
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('calls onChange with 12 when selecting the last option', () => {
    const onChange = vi.fn();
    render(<PartySizePicker value={5} onChange={onChange} />);
    const select = screen.getByLabelText(/nombre de personnes/i);
    fireEvent.change(select, { target: { value: '12' } });
    expect(onChange).toHaveBeenCalledWith(12);
  });
});
