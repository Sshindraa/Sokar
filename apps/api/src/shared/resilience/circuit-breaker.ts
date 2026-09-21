/**
 * Circuit breaker minimal (R1-2).
 *
 * Objectif : arrêter d'appeler un fournisseur qui vient d'échouer plusieurs fois
 * d'affilée, pour ne pas payer sa latence sur chaque requête. Trois états :
 *
 *  - `closed`    : l'appel passe ; `failureThreshold` échecs consécutifs ouvrent ;
 *  - `open`      : l'appel échoue immédiatement (`CircuitOpenError`) pendant
 *                  `cooldownMs` ;
 *  - `half-open` : un seul essai est autorisé pour sonder le retour du
 *                  fournisseur ; succès → `closed`, échec → `open` de nouveau.
 *
 * `now()` est injectable pour que les tests n'attendent pas réellement.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitOpenError extends Error {
  constructor(
    readonly name: string,
    readonly openedForMs: number,
  ) {
    super(`Circuit « ${name} » ouvert : appel refusé sans attendre le fournisseur`);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerOptions {
  readonly name: string;
  /** Échecs consécutifs avant ouverture. Défaut : 3. */
  readonly failureThreshold?: number;
  /** Durée d'ouverture avant un essai de sonde. Défaut : 30 s. */
  readonly cooldownMs?: number;
  readonly now?: () => number;
  readonly onStateChange?: (state: CircuitState, name: string) => void;
}

export class CircuitBreaker {
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly onStateChange?: (state: CircuitState, name: string) => void;

  private failures = 0;
  private openedAt: number | null = null;
  private halfOpenInFlight = false;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.cooldownMs = Math.max(0, options.cooldownMs ?? 30_000);
    this.now = options.now ?? (() => Date.now());
    this.onStateChange = options.onStateChange;
  }

  get state(): CircuitState {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.cooldownMs ? 'half-open' : 'open';
  }

  /** Nombre d'échecs consécutifs observés depuis la dernière fermeture. */
  get consecutiveFailures(): number {
    return this.failures;
  }

  reset(): void {
    this.failures = 0;
    this.openedAt = null;
    this.halfOpenInFlight = false;
    this.onStateChange?.('closed', this.name);
  }

  recordSuccess(): void {
    const wasOpen = this.openedAt !== null;
    this.failures = 0;
    this.openedAt = null;
    this.halfOpenInFlight = false;
    if (wasOpen) this.onStateChange?.('closed', this.name);
  }

  recordFailure(): void {
    this.halfOpenInFlight = false;
    this.failures += 1;

    if (this.openedAt !== null) {
      // Échec en half-open : on repart pour un cycle complet de cooldown.
      this.openedAt = this.now();
      this.onStateChange?.('open', this.name);
      return;
    }
    if (this.failures >= this.failureThreshold) {
      this.openedAt = this.now();
      this.onStateChange?.('open', this.name);
    }
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === 'open') {
      throw new CircuitOpenError(this.name, this.cooldownMs);
    }
    if (state === 'half-open') {
      if (this.halfOpenInFlight) {
        throw new CircuitOpenError(this.name, this.cooldownMs);
      }
      this.halfOpenInFlight = true;
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
}
