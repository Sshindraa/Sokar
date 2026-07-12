import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SokarAgentClient } from '../sokar-client.js';

describe('SokarAgentClient', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function makeResponse(body: unknown, status = 200) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);
  }

  it('getTools fetches tools with default openai format', async () => {
    const client = new SokarAgentClient({
      baseUrl: 'https://api-staging.sokar.tech',
      apiKey: 'x',
    });

    fetchMock.mockReturnValueOnce(makeResponse({ tools: [{ name: 'search_restaurants' }] }));

    const tools = await client.getTools();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-staging.sokar.tech/v1/agents/tools?format=openai',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(tools).toEqual([{ name: 'search_restaurants' }]);
  });

  it('executeTool posts tool and returns result', async () => {
    const client = new SokarAgentClient({
      baseUrl: 'https://api-staging.sokar.tech',
      apiKey: 'x',
    });

    fetchMock.mockReturnValueOnce(makeResponse({ result: { available: true } }));

    const result = await client.executeTool('check_availability', {
      restaurantId: 'rest-1',
      partySize: 2,
      slotStart: '2026-07-14T19:00:00+02:00',
      slotEnd: '2026-07-14T21:00:00+02:00',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-staging.sokar.tech/v1/agents',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          tool: 'check_availability',
          arguments: {
            restaurantId: 'rest-1',
            partySize: 2,
            slotStart: '2026-07-14T19:00:00+02:00',
            slotEnd: '2026-07-14T21:00:00+02:00',
          },
        }),
      }),
    );
    expect(result).toEqual({ available: true });
  });

  it('executeTool throws on error response', async () => {
    const client = new SokarAgentClient({
      baseUrl: 'https://api-staging.sokar.tech',
      apiKey: 'x',
    });

    fetchMock.mockReturnValueOnce(makeResponse({ error: 'not found', code: 'NOT_FOUND' }, 404));

    await expect(
      client.executeTool('get_restaurant_details', { restaurantId: 'missing' }),
    ).rejects.toThrow('SokarAgentClient');
  });
});
