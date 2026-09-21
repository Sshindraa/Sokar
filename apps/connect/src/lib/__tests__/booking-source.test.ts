import { describe, expect, it } from 'vitest';
import { normalizeBookingSource } from '@/lib/booking-source';

describe('normalizeBookingSource', () => {
  it('uses web when no source is provided', () => {
    expect(normalizeBookingSource()).toBe('web');
  });

  it('maps legacy page values to API sources', () => {
    expect(normalizeBookingSource('widget')).toBe('web');
    expect(normalizeBookingSource('restaurant')).toBe('restaurant_website');
  });

  it('preserves canonical sources and rejects unknown values', () => {
    expect(normalizeBookingSource('chatgpt')).toBe('chatgpt');
    expect(normalizeBookingSource('  QR_CODE ')).toBe('qr_code');
    expect(normalizeBookingSource('invalid-source')).toBe('web');
  });
});
