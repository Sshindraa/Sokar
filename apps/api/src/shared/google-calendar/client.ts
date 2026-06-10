import { createHmac, timingSafeEqual } from 'crypto';
import { logger } from '../logger/pino';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';

const MOCK_CALENDAR_ID = 'mock-calendar-id-123';
const STATE_MAX_AGE_MS = 15 * 60 * 1000;

export interface CalendarEventDetails {
  start: Date;
  end: Date;
  summary: string;
  description: string;
}

export class GoogleCalendarClient {
  static isConfigured(): boolean {
    return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
  }

  private static stateSecret(): string {
    return GOOGLE_CLIENT_SECRET || process.env.CLERK_SECRET_KEY || 'dev-google-calendar-state';
  }

  private static signStatePayload(payload: string): string {
    return createHmac('sha256', this.stateSecret()).update(payload).digest('base64url');
  }

  static createSignedState(restaurantId: string): string {
    const payload = Buffer.from(
      JSON.stringify({ restaurantId, ts: Date.now() }),
    ).toString('base64url');
    return `${payload}.${this.signStatePayload(payload)}`;
  }

  static resolveSignedState(state: string): string {
    const [payload, signature] = state.split('.');
    if (!payload || !signature) {
      throw new Error('Invalid OAuth state');
    }

    const expected = this.signStatePayload(payload);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      throw new Error('Invalid OAuth state signature');
    }

    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      restaurantId?: string;
      ts?: number;
    };
    if (!parsed.restaurantId || !parsed.ts || Date.now() - parsed.ts > STATE_MAX_AGE_MS) {
      throw new Error('Expired OAuth state');
    }

    return parsed.restaurantId;
  }

  static getAuthUrl(restaurantId: string): string {
    const state = this.createSignedState(restaurantId);

    if (!this.isConfigured()) {
      // Mock authorization flow redirection
      const mockRedirect = `${GOOGLE_REDIRECT_URI || 'http://localhost:4000/integrations/google-calendar/callback'}?code=mock_code_for_${restaurantId}&state=${state}`;
      logger.info({ restaurantId }, '[GoogleCalendar] Using mock Auth URL redirection');
      return mockRedirect;
    }

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.append('client_id', GOOGLE_CLIENT_ID);
    url.searchParams.append('redirect_uri', GOOGLE_REDIRECT_URI);
    url.searchParams.append('response_type', 'code');
    url.searchParams.append('scope', 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly');
    url.searchParams.append('access_type', 'offline');
    url.searchParams.append('prompt', 'consent');
    url.searchParams.append('state', state);

    return url.toString();
  }

  static async exchangeCodeForTokens(code: string): Promise<{ refreshToken: string; googleCalendarId: string }> {
    if (!this.isConfigured() || code.startsWith('mock_')) {
      logger.info('[GoogleCalendar] Mock code exchange for tokens');
      return {
        refreshToken: 'mock_refresh_token_xyz',
        googleCalendarId: MOCK_CALENDAR_ID,
      };
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
        code,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ errText }, '[GoogleCalendar] Failed to exchange code for tokens');
      throw new Error(`Google OAuth error: ${response.status} - ${errText}`);
    }

    const tokens = await response.json() as any;
    return {
      refreshToken: tokens.refresh_token || '',
      googleCalendarId: 'primary',
    };
  }

  private static async getAccessToken(refreshToken: string): Promise<string> {
    if (refreshToken.startsWith('mock_')) {
      return 'mock_access_token_xyz';
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ errText }, '[GoogleCalendar] Failed to refresh access token');
      throw new Error(`Google Refresh Token error: ${response.status} - ${errText}`);
    }

    const data = await response.json() as any;
    return data.access_token;
  }

  static async checkAvailability(
    refreshToken: string,
    calendarId: string,
    start: Date,
    end: Date
  ): Promise<boolean> {
    logger.info({ calendarId, start, end }, '[GoogleCalendar] Checking availability');
    
    if (refreshToken.startsWith('mock_')) {
      // Mock checking: check if start minute is exactly 45 (for manual mock testing conflict)
      if (start.getMinutes() === 45) {
        logger.warn('[GoogleCalendar] Mock conflict detected (minutes === 45)');
        return false;
      }
      return true;
    }

    const accessToken = await this.getAccessToken(refreshToken);

    const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: calendarId }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ errText }, '[GoogleCalendar] Failed to query freeBusy');
      throw new Error(`Google freebusy error: ${response.status} - ${errText}`);
    }

    const data = await response.json() as any;
    const busyEvents = data.calendars?.[calendarId]?.busy || [];
    
    return busyEvents.length === 0;
  }

  static async createEvent(
    refreshToken: string,
    calendarId: string,
    details: CalendarEventDetails
  ): Promise<string> {
    logger.info({ calendarId, summary: details.summary }, '[GoogleCalendar] Creating event');

    if (refreshToken.startsWith('mock_')) {
      const mockEventId = `mock_event_${Math.random().toString(36).substr(2, 9)}`;
      logger.info({ mockEventId }, '[GoogleCalendar] Mock event created successfully');
      return mockEventId;
    }

    const accessToken = await this.getAccessToken(refreshToken);

    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        summary: details.summary,
        description: details.description,
        start: {
          dateTime: details.start.toISOString(),
        },
        end: {
          dateTime: details.end.toISOString(),
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ errText }, '[GoogleCalendar] Failed to create event');
      throw new Error(`Google createEvent error: ${response.status} - ${errText}`);
    }

    const data = await response.json() as any;
    return data.id;
  }

  static async updateEvent(
    refreshToken: string,
    calendarId: string,
    eventId: string,
    details: CalendarEventDetails
  ): Promise<void> {
    logger.info({ calendarId, eventId, summary: details.summary }, '[GoogleCalendar] Updating event');

    if (refreshToken.startsWith('mock_') || eventId.startsWith('mock_')) {
      logger.info('[GoogleCalendar] Mock event updated successfully');
      return;
    }

    const accessToken = await this.getAccessToken(refreshToken);

    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        summary: details.summary,
        description: details.description,
        start: {
          dateTime: details.start.toISOString(),
        },
        end: {
          dateTime: details.end.toISOString(),
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ errText }, '[GoogleCalendar] Failed to update event');
      throw new Error(`Google updateEvent error: ${response.status} - ${errText}`);
    }
  }

  static async deleteEvent(
    refreshToken: string,
    calendarId: string,
    eventId: string
  ): Promise<void> {
    logger.info({ calendarId, eventId }, '[GoogleCalendar] Deleting event');

    if (refreshToken.startsWith('mock_') || eventId.startsWith('mock_')) {
      logger.info('[GoogleCalendar] Mock event deleted successfully');
      return;
    }

    const accessToken = await this.getAccessToken(refreshToken);

    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      const errText = await response.text();
      logger.error({ errText }, '[GoogleCalendar] Failed to delete event');
      throw new Error(`Google deleteEvent error: ${response.status} - ${errText}`);
    }
  }
}
