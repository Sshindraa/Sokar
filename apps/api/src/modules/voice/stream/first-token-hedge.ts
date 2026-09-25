export interface FirstTokenHedgeOptions {
  delayMs: number;
  timeoutMs: number;
  startBackupImmediately?: boolean;
  signal?: AbortSignal;
  onWinner?: (provider: string) => void;
  onFailure?: (provider: string, error: unknown, statusCode?: number) => void;
  onTimeout?: () => void;
}

export interface FirstTokenHedgeResult<TProvider extends string = string> {
  response: Response;
  provider: TProvider;
}

function sseHasTextToken(buffer: string): boolean {
  for (const line of buffer.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: unknown } }>;
      };
      const content = parsed.choices?.[0]?.delta?.content;
      if (typeof content === 'string' && content.length > 0) return true;
    } catch {
      // Le champ SSE est incomplet jusqu'à la fin de sa ligne.
    }
  }
  return false;
}

function replayResponse(
  response: Response,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buffered: Uint8Array[],
): Response {
  let index = 0;
  let sourceEnded = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < buffered.length) {
        controller.enqueue(buffered[index++]);
        return;
      }
      if (sourceEnded) return;
      try {
        const next = await reader.read();
        if (next.done) {
          sourceEnded = true;
          reader.releaseLock();
          controller.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      sourceEnded = true;
      await reader.cancel(reason).catch(() => undefined);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function cancelResponseBody(response: Response): void {
  response.body?.cancel().then(
    () => undefined,
    () => undefined,
  );
}

async function waitForFirstToken(response: Response): Promise<Response> {
  if (!response.ok || !response.body) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const buffered: Uint8Array[] = [];
  let sseBuffer = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        reader.releaseLock();
        throw new Error('LLM stream ended before the first text token');
      }
      buffered.push(next.value);
      sseBuffer += decoder.decode(next.value, { stream: true });
      if (sseHasTextToken(sseBuffer)) return replayResponse(response, reader, buffered);
      const lines = sseBuffer.split(/\r?\n/u);
      sseBuffer = lines.pop() ?? '';
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  }
}

/** Lance le secours après le délai et choisit la première réponse avec un delta texte. */
export function raceFirstTokenResponses<TProvider extends string>(
  primaryProvider: TProvider,
  primary: (signal: AbortSignal) => Promise<Response>,
  backupProvider: TProvider,
  backup: (signal: AbortSignal) => Promise<Response>,
  options: FirstTokenHedgeOptions,
): Promise<FirstTokenHedgeResult<TProvider>> {
  return new Promise((resolve, reject) => {
    const controllers = [new AbortController(), new AbortController()];
    let settled = false;
    let backupStarted = false;
    let active = 0;
    let primaryFailed = false;
    let backupFailed = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    const timers: { timeout?: ReturnType<typeof setTimeout> } = {};

    const abortAll = (reason?: unknown) => {
      for (const controller of controllers) controller.abort(reason);
    };
    const cleanup = () => {
      if (hedgeTimer) clearTimeout(hedgeTimer);
      if (timers.timeout) clearTimeout(timers.timeout);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const failIfExhausted = () => {
      if (settled || !primaryFailed || !backupFailed) return;
      settled = true;
      cleanup();
      reject(new Error('Both voice LLM providers failed before the first text token'));
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      abortAll(options.signal?.reason);
      reject(new DOMException('Voice LLM request aborted', 'AbortError'));
    };
    const win = (provider: TProvider, response: Response) => {
      if (settled) {
        cancelResponseBody(response);
        return;
      }
      settled = true;
      cleanup();
      options.onWinner?.(provider);
      for (let index = 0; index < controllers.length; index++) {
        if ((index === 0 ? primaryProvider : backupProvider) !== provider) {
          controllers[index].abort('hedge lost');
        }
      }
      resolve({ response, provider });
    };
    const start = (index: 0 | 1) => {
      if (settled || (index === 1 && backupStarted)) return;
      if (index === 1) backupStarted = true;
      active++;
      const provider = index === 0 ? primaryProvider : backupProvider;
      const request = index === 0 ? primary : backup;
      const signal = options.signal
        ? AbortSignal.any([controllers[index].signal, options.signal])
        : controllers[index].signal;
      request(signal)
        .then(waitForFirstToken)
        .then((response) => {
          if (!response.ok) {
            cancelResponseBody(response);
            const error = new Error(`${provider} LLM HTTP ${response.status}`) as Error & {
              statusCode?: number;
            };
            error.statusCode = response.status;
            throw error;
          }
          if (!response.body) throw new Error(`${provider} LLM response body is empty`);
          active--;
          win(provider, response);
        })
        .catch((error: unknown) => {
          active = Math.max(0, active - 1);
          if (settled) return;
          const statusCode =
            typeof error === 'object' && error !== null && 'statusCode' in error
              ? Number(error.statusCode)
              : undefined;
          options.onFailure?.(
            provider,
            error,
            Number.isFinite(statusCode) ? statusCode : undefined,
          );
          if (index === 0) {
            primaryFailed = true;
            if (!backupStarted) start(1);
          } else {
            backupFailed = true;
          }
          if (options.signal?.aborted) {
            onAbort();
            return;
          }
          if (active === 0) failIfExhausted();
        });
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.startBackupImmediately) {
      start(1);
    } else {
      start(0);
      hedgeTimer = setTimeout(() => start(1), Math.max(0, options.delayMs));
    }
    timers.timeout = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        cleanup();
        options.onTimeout?.();
        abortAll('hedge timeout');
        reject(new Error('Voice LLM first-token hedge timed out'));
      },
      Math.max(1, options.timeoutMs),
    );
  });
}
