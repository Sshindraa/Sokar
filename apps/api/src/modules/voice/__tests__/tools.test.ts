/**
 * Tests for the OpenAI-style function-calling tool definitions exposed
 * to the LLM (createReservation, handoffToManager).
 *
 * Why this matters: the LLM uses these JSON schemas to decide when to
 * call a tool. A regression here silently breaks the agent's ability to
 * reserve a table or hand off to a human — and the failure mode is
 * "AI doesn't act when it should", not a thrown error.
 *
 * Scopes:
 *  1. Shape: type=function, function.name, function.description, parameters
 *  2. createReservation: required fields, time regex, partySize bounds
 *  3. handoffToManager: no parameters required
 *  4. Output is decoupled from restaurantId (same shape regardless of input)
 *  5. Tool names are stable strings (regression guard — LLM is trained on them)
 */

import { describe, it, expect } from 'vitest';
import { getRestaurantTools } from '../tools';

const TIME_PATTERN = '^([0-1]\\d|2[0-3]):[0-5]\\d$';

describe('getRestaurantTools', () => {
  const tools = getRestaurantTools('rest-123');
  const byName = (name: string) => tools.find((t) => t.function.name === name);

  it('returns exactly 8 tools including reportDelay', () => {
    expect(tools).toHaveLength(8);
    const names = tools.map((t) => t.function.name).sort();
    expect(names).toEqual([
      'cancelReservation',
      'checkAvailability',
      'createReservation',
      'handoffToManager',
      'purchaseGiftCard',
      'recommendGiftCardAmount',
      'reportDelay',
      'takeMessage',
    ]);
  });

  it('every entry has type=function (OpenAI function-calling envelope)', () => {
    for (const t of tools) expect(t.type).toBe('function');
  });

  it('every entry has a non-empty function.description (LLM uses this to decide when to call)', () => {
    for (const t of tools) {
      expect(typeof t.function.description).toBe('string');
      expect(t.function.description.length).toBeGreaterThan(20);
    }
  });

  it('returns the same tools regardless of restaurantId (today)', () => {
    // Future: tools may be personalised per restaurant. Today they aren't.
    // Pin the behaviour so a future change is intentional.
    expect(getRestaurantTools('rest-A')).toEqual(getRestaurantTools('rest-B'));
    expect(getRestaurantTools('rest-A')).toEqual(tools);
  });
});

describe('reportDelay tool', () => {
  const tool = getRestaurantTools('rest-1').find((t) => t.function.name === 'reportDelay')!;
  const params = tool.function.parameters as unknown as {
    properties: Record<string, { minimum?: number; maximum?: number; pattern?: string }>;
    required: string[];
  };

  it('requires a precise booking identity and a bounded delay', () => {
    expect(new Set(params.required)).toEqual(
      new Set(['customerName', 'date', 'time', 'delayMinutes']),
    );
    expect(params.properties.time.pattern).toBe(TIME_PATTERN);
    expect(params.properties.delayMinutes).toMatchObject({ minimum: 5, maximum: 180 });
  });
});

describe('createReservation tool', () => {
  const tool = getRestaurantTools('rest-1').find((t) => t.function.name === 'createReservation')!;
  const params = tool.function.parameters as {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };

  it('declares type=object on parameters', () => {
    expect(params.type).toBe('object');
  });

  it('requires date, time, partySize, customerName (not customerPhone)', () => {
    expect(new Set(params.required)).toEqual(
      new Set(['date', 'time', 'partySize', 'customerName']),
    );
  });

  it('customerPhone is optional (caller may not provide it)', () => {
    expect(params.required).not.toContain('customerPhone');
    expect(params.properties.customerPhone).toBeDefined();
  });

  it('date is a string in date format (YYYY-MM-DD)', () => {
    expect(params.properties.date).toEqual({
      type: 'string',
      format: 'date',
      description: expect.stringContaining('YYYY-MM-DD'),
    });
  });

  it('time matches the HH:MM regex used by the server-side validator', () => {
    expect(params.properties.time).toEqual({
      type: 'string',
      pattern: TIME_PATTERN,
      description: expect.stringContaining('HH:MM'),
    });
  });

  it('partySize is an integer between 1 and 7 (>=8 triggers handoff)', () => {
    expect(params.properties.partySize).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 7,
      description: expect.stringContaining('handoffToManager'),
    });
  });

  it('customerName is a required string', () => {
    expect(params.properties.customerName).toEqual({
      type: 'string',
      description: expect.stringMatching(/nom/i),
    });
  });

  it('description explicitly warns to call only after collecting date/time/party/name', () => {
    // The LLM is lazy and tends to call tools early. The description is our guardrail.
    const desc = tool.function.description.toLowerCase();
    expect(desc).toContain('réservation');
    expect(desc).toMatch(/après avoir confirmé|après confirmation|une fois confirmé/);
  });
});

describe('checkAvailability tool', () => {
  const tool = getRestaurantTools('rest-1').find((t) => t.function.name === 'checkAvailability')!;
  const params = tool.function.parameters as {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };

  it('requires date and partySize', () => {
    expect(new Set(params.required)).toEqual(new Set(['date', 'partySize']));
  });

  it('date is a string in date format', () => {
    expect(params.properties.date).toEqual({
      type: 'string',
      format: 'date',
      description: expect.stringContaining('YYYY-MM-DD'),
    });
  });

  it('partySize is an integer between 1 and 7', () => {
    expect(params.properties.partySize).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 7,
      description: expect.stringContaining('personnes'),
    });
  });

  it('accepte l’heure demandée sans la rendre obligatoire', () => {
    expect(params.properties.time).toEqual({
      type: 'string',
      pattern: TIME_PATTERN,
      description: expect.stringContaining('optionnel'),
    });
    expect(params.required).not.toContain('time');
  });

  it('description mentions checking availability without booking', () => {
    const desc = tool.function.description.toLowerCase();
    expect(desc).toMatch(/disponib|cr[ée]neau|available/);
    expect(desc).toContain('même tour');
  });
});

describe('cancelReservation tool', () => {
  const tool = getRestaurantTools('rest-1').find((t) => t.function.name === 'cancelReservation')!;
  const params = tool.function.parameters as {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };

  it('requires customerName and date', () => {
    expect(new Set(params.required)).toEqual(new Set(['customerName', 'date']));
  });

  it('customerName is a string', () => {
    expect(params.properties.customerName).toEqual({
      type: 'string',
      description: expect.stringMatching(/nom/i),
    });
  });

  it('date is a string in date format', () => {
    expect(params.properties.date).toEqual({
      type: 'string',
      format: 'date',
      description: expect.stringContaining('YYYY-MM-DD'),
    });
  });

  it('description mentions cancellation and identifying the reservation', () => {
    const desc = tool.function.description.toLowerCase();
    expect(desc).toMatch(/annul/);
    expect(desc).toMatch(/nom.*date|identifier/);
  });
});

describe('takeMessage tool', () => {
  const tool = getRestaurantTools('rest-1').find((t) => t.function.name === 'takeMessage')!;
  const params = tool.function.parameters as {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };

  it('requires customerName and message', () => {
    expect(new Set(params.required)).toEqual(new Set(['customerName', 'message']));
  });

  it('callbackPhone is optional', () => {
    expect(params.required).not.toContain('callbackPhone');
    expect(params.properties.callbackPhone).toBeDefined();
  });

  it('message is a string', () => {
    expect(params.properties.message).toEqual({
      type: 'string',
      description: expect.stringContaining('gérant'),
    });
  });

  it('description mentions recording a message for the manager', () => {
    const desc = tool.function.description.toLowerCase();
    expect(desc).toMatch(/message|transmet/);
    expect(desc).toMatch(/g[ée]rant/);
  });
});

describe('handoffToManager tool', () => {
  const tool = getRestaurantTools('rest-1').find((t) => t.function.name === 'handoffToManager')!;
  const params = tool.function.parameters as {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };

  it('requires no parameters', () => {
    expect(params.required).toEqual([]);
    expect(Object.keys(params.properties)).toHaveLength(0);
  });

  it('description enumerates the 4 handoff triggers (>=8, complex, unhappy, misunderstanding)', () => {
    const desc = tool.function.description.toLowerCase();
    expect(desc).toMatch(/g[éé]rant|manager/);
    expect(desc).toMatch(/8|≥/); // group size
    expect(desc).toMatch(/complex|difficile/);
    expect(desc).toMatch(/m[ée]content|incompréhensif/);
  });
});

describe('tool name stability (regression guard)', () => {
  // The LLM was trained / prompted with these exact names. Renaming a tool
  // silently breaks the integration — guard against accidental renames.
  it.each([
    'createReservation',
    'checkAvailability',
    'cancelReservation',
    'reportDelay',
    'takeMessage',
    'handoffToManager',
    'purchaseGiftCard',
    'recommendGiftCardAmount',
  ])('keeps the name "%s"', (name) => {
    expect(getRestaurantTools('r').some((t) => t.function.name === name)).toBe(true);
  });
});

describe('purchaseGiftCard tool', () => {
  const tool = getRestaurantTools('rest-1').find((t) => t.function.name === 'purchaseGiftCard')!;
  const params = tool.function.parameters as {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };

  it('requires amount, senderName, senderPhone, recipientName', () => {
    expect(new Set(params.required)).toEqual(
      new Set(['amount', 'senderName', 'senderPhone', 'recipientName']),
    );
  });

  it('amount is a positive integer', () => {
    expect(params.properties.amount).toEqual({
      type: 'number',
      minimum: 1,
      multipleOf: 1,
      description: expect.stringContaining('Montant'),
    });
  });

  it('description mentions SMS and never dictating the code', () => {
    const desc = tool.function.description.toLowerCase();
    expect(desc).toMatch(/sms/);
    expect(desc).toMatch(/ne jamais|jamais dicter/);
  });
});

describe('recommendGiftCardAmount tool', () => {
  const tool = getRestaurantTools('rest-1').find(
    (t) => t.function.name === 'recommendGiftCardAmount',
  )!;
  const params = tool.function.parameters as {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };

  it('requires occasion and partySize', () => {
    expect(new Set(params.required)).toEqual(new Set(['occasion', 'partySize']));
  });

  it('description mentions advising an amount', () => {
    const desc = tool.function.description.toLowerCase();
    expect(desc).toMatch(/sugg[ée]r|conseil|montant/);
  });
});
