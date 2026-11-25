import type { ErrorCode, ProviderKind, ProviderStatus } from '../../shared/protocol';
import { ProviderError, type ProviderBase, type ProviderErrorKind } from './types';

/**
 * Ordered fallback over interchangeable providers, with per-provider health tracking.
 *
 * Free tiers are small and rate limited, so a single provider cannot be trusted to
 * answer every request of a live call. The chain tries providers in order and moves
 * on immediately when one is unconfigured, cooling down, over its per-minute budget,
 * or fails. Health state lives here so providers themselves stay stateless.
 */

const MINUTE_MS = 60_000;

const RATE_LIMIT_DEFAULT_COOLDOWN_MS = 20_000;
const RATE_LIMIT_MAX_COOLDOWN_MS = 10 * MINUTE_MS;
const FAILURE_BASE_COOLDOWN_MS = 5_000;
const FAILURE_MAX_COOLDOWN_MS = MINUTE_MS;
/** Consecutive `bad_request` answers before we assume the provider itself is misconfigured. */
const BAD_REQUEST_STRIKES = 3;
/**
 * A provider that is still working on a request when a provider started after it has
 * already answered is "slow". Twice in a row and it is rested, so that the following
 * utterances do not each wait out the hedge delay for it.
 */
const SLOW_STRIKES = 2;
const SLOW_BASE_COOLDOWN_MS = 30_000;
const SLOW_MAX_COOLDOWN_MS = 2 * MINUTE_MS;

export interface Attempt {
  providerId: string;
  outcome: 'ok' | ProviderErrorKind;
  ms: number;
  message?: string;
}

/** No provider of this kind has an API key (or all of them reject the request's language). */
export class NoProviderError extends Error {
  readonly code: ErrorCode = 'unconfigured';
  constructor(
    readonly kind: ProviderKind,
    message: string,
  ) {
    super(message);
    this.name = 'NoProviderError';
  }
}

/** Every usable provider was tried and failed. */
export class ChainExhaustedError extends Error {
  readonly code: ErrorCode;
  constructor(
    readonly kind: ProviderKind,
    readonly attempts: Attempt[],
  ) {
    const summary = attempts.map((a) => `${a.providerId}: ${a.message ?? a.outcome}`).join(' | ');
    super(`All ${kind.toUpperCase()} providers failed — ${summary}`);
    this.name = 'ChainExhaustedError';
    const outcomes = attempts.map((a) => a.outcome);
    this.code = outcomes.every((o) => o === 'rate_limit')
      ? 'rate_limited'
      : outcomes.every((o) => o === 'timeout')
        ? 'timeout'
        : 'provider_failed';
  }
}

export class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortedError';
  }
}

interface Health {
  cooldownUntil: number;
  /** Position in the order of events (see `FallbackChain.tick`) at which the current rest was imposed. */
  penalizedAt: number;
  consecutiveFailures: number;
  /** Position in the order of events at which the latest failure was recorded. */
  lastFailureAt: number;
  /** Why the provider is resting, when that matters for whether to try it anyway. */
  restingBecause: ProviderErrorKind | 'slow' | undefined;
  badRequestStrikes: number;
  slowStrikes: number;
  /** Position in the order of events at which the latest slow strike was recorded. */
  lastSlowAt: number;
  /** How often the provider has been rested for slowness without proving itself in between. */
  slowRests: number;
  /** Set when the provider rejected our credentials; cleared when keys change. */
  authRejected: boolean;
  lastError: string | undefined;
  /** Start times of requests in the last minute, for the client-side RPM budget. */
  recent: number[];
}

function freshHealth(): Health {
  return {
    cooldownUntil: 0,
    penalizedAt: 0,
    consecutiveFailures: 0,
    lastFailureAt: 0,
    restingBecause: undefined,
    badRequestStrikes: 0,
    slowStrikes: 0,
    lastSlowAt: 0,
    slowRests: 0,
    authRejected: false,
    lastError: undefined,
    recent: [],
  };
}

export interface ChainOptions {
  now?: () => number;
  /** Called whenever a provider's visible state changes. */
  onStatusChange?: () => void;
}

export interface PlanOptions<P> {
  /** Restrict the run to providers that can handle this request (e.g. language support). */
  filter?: (provider: P) => boolean;
  /** Per-request preference: lower ranks are tried first, ties keep the configured order. */
  rank?: (provider: P) => number;
}

export interface RunOptions<P> extends PlanOptions<P> {
  signal: AbortSignal;
  /**
   * Hedging: when a provider has not answered after this many ms, start the next one in
   * parallel and take whichever succeeds first. Trades a little quota for a bounded delay,
   * which matters more than anything else in a live conversation. A function gives each
   * provider its own patience (one that does two jobs in a single call deserves more).
   */
  hedgeAfterMs?: number | ((provider: P) => number);
  /**
   * A provider that is resting is normally still tried when nothing else is left, because
   * cooldowns are estimates. With `impatient` that is not done for a provider resting after
   * a timeout: the caller prefers an immediate failure to waiting out another deadline
   * (speech that arrives many seconds late is worse than none; the caption is on screen).
   */
  impatient?: boolean;
}

export interface RunResult<T, P> {
  value: T;
  provider: P;
  attempts: Attempt[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Plan<P> {
  /** Tried in this order, hedged against each other. */
  order: P[];
  /** Resting providers, soonest to recover first: tried one at a time once `order` has failed. */
  lastResort: P[];
}

export class FallbackChain<P extends ProviderBase> {
  private readonly health = new Map<string, Health>();
  /**
   * Counts starts of requests and penalties, in the order they happen. Whether a request
   * was already under way when a provider was penalised decides what its own outcome may
   * change, and a clock cannot tell two events of the same millisecond apart.
   */
  private tick = 0;
  private readonly now: () => number;
  private readonly onStatusChange: () => void;

  constructor(
    readonly kind: ProviderKind,
    readonly providers: readonly P[],
    options: ChainOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.onStatusChange = options.onStatusChange ?? (() => undefined);
    for (const provider of providers) this.health.set(provider.id, freshHealth());
  }

  private healthOf(provider: P): Health {
    const health = this.health.get(provider.id);
    if (!health) throw new Error(`unknown provider ${provider.id}`);
    return health;
  }

  private overBudget(provider: P, health: Health, now: number): boolean {
    if (!provider.requestsPerMinute) return false;
    health.recent = health.recent.filter((t) => now - t < MINUTE_MS);
    return health.recent.length >= provider.requestsPerMinute;
  }

  private resting(provider: P, now: number): boolean {
    const health = this.healthOf(provider);
    return health.cooldownUntil > now || this.overBudget(provider, health, now);
  }

  /**
   * Decide which providers to try, in which order.
   * @throws NoProviderError when nothing is configured for this request.
   */
  private plan(options: PlanOptions<P>): Plan<P> {
    const now = this.now();
    const usable: P[] = [];
    const resting: P[] = [];
    for (const provider of this.providers) {
      if (!provider.isConfigured()) continue;
      if (options.filter && !options.filter(provider)) continue;
      if (this.healthOf(provider).authRejected) continue;
      if (this.resting(provider, now)) resting.push(provider);
      else usable.push(provider);
    }
    resting.sort((a, b) => this.healthOf(a).cooldownUntil - this.healthOf(b).cooldownUntil);

    if (usable.length > 0) {
      const rank = options.rank;
      // Array.prototype.sort is stable, so equal ranks keep the configured order.
      const order = rank ? usable.slice().sort((a, b) => rank(a) - rank(b)) : usable;
      return { order, lastResort: resting };
    }
    if (resting.length > 0) return { order: [], lastResort: resting };

    const anyConfigured = this.providers.some((p) => p.isConfigured());
    throw new NoProviderError(
      this.kind,
      anyConfigured
        ? `No ${this.kind.toUpperCase()} provider is currently usable (credentials rejected or language unsupported).`
        : `No ${this.kind.toUpperCase()} provider is configured. Add a free API key in Settings.`,
    );
  }

  /**
   * A request is likely soon: let the providers that would be tried first open their
   * connections. A hint only; nothing here can fail a call.
   */
  prepare(options: PlanOptions<P> = {}, count = 1): void {
    let plan: Plan<P>;
    try {
      plan = this.plan(options);
    } catch {
      return;
    }
    for (const provider of [...plan.order, ...plan.lastResort].slice(0, count)) {
      try {
        provider.prepare?.();
      } catch {
        // Best effort by contract.
      }
    }
  }

  /**
   * Run `operation` against providers in order until one succeeds.
   *
   * @throws NoProviderError      nothing is configured for this request
   * @throws ChainExhaustedError  every usable provider failed
   * @throws AbortedError         `options.signal` fired
   */
  run<T>(
    operation: (provider: P, signal: AbortSignal) => Promise<T>,
    options: RunOptions<P>,
  ): Promise<RunResult<T, P>> {
    if (options.signal.aborted) return Promise.reject(new AbortedError());
    let plan: Plan<P>;
    try {
      plan = this.plan(options);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const hedgeDelay = (provider: P): number | undefined =>
      typeof options.hedgeAfterMs === 'function' ? options.hedgeAfterMs(provider) : options.hedgeAfterMs;

    return new Promise<RunResult<T, P>>((resolve, reject) => {
      const attempts: Attempt[] = [];
      /** Requests in flight. */
      const running = new Map<AbortController, { provider: P; startedAt: number; startedTick: number }>();
      const timers = new Set<ReturnType<typeof setTimeout>>();
      const order = plan.order.slice();
      const lastResort = plan.lastResort.slice();
      let settled = false;
      let launched = 0;
      let lastResortTried = false;

      const settle = (complete: () => void) => {
        if (settled) return;
        settled = true;
        for (const timer of timers) clearTimeout(timer);
        for (const controller of running.keys()) controller.abort();
        options.signal.removeEventListener('abort', onAbort);
        complete();
      };
      const onAbort = () => settle(() => reject(new AbortedError()));
      options.signal.addEventListener('abort', onAbort, { once: true });

      /**
       * The next provider to start. One that began to rest while this run was under way
       * (another request used up its budget, or was told to back off) is no longer a
       * candidate for hedging; it joins the last resorts.
       */
      const nextCandidate = (): P | undefined => {
        const now = this.now();
        for (;;) {
          const candidate = order.shift();
          if (!candidate) return undefined;
          if (launched === 0 || !this.resting(candidate, now)) return candidate;
          lastResort.push(candidate);
        }
      };

      /**
       * When nothing else is left, one resting provider is tried anyway: cooldowns are
       * estimates, not guarantees. Only one, so a request never works its way through a row
       * of providers that have all asked to be left alone.
       */
      const nextLastResort = (): P | undefined => {
        if (lastResortTried) return undefined;
        for (;;) {
          const candidate = lastResort.shift();
          if (!candidate) return undefined;
          const why = this.healthOf(candidate).restingBecause;
          if (options.impatient && (why === 'timeout' || why === 'slow')) {
            attempts.push({
              providerId: candidate.id,
              outcome: 'timeout',
              ms: 0,
              message: 'not answering; it will be tried again shortly',
            });
            continue;
          }
          return candidate;
        }
      };

      const giveUp = () => settle(() => reject(new ChainExhaustedError(this.kind, attempts)));

      const start = (provider: P, hedged: boolean): void => {
        launched += 1;
        const health = this.healthOf(provider);
        const startedAt = this.now();
        const startedTick = ++this.tick;
        // Only providers with a per-minute budget need their request times remembered;
        // recording them for the others would grow without bound over a long call.
        if (provider.requestsPerMinute) {
          health.recent = health.recent.filter((t) => startedAt - t < MINUTE_MS);
          health.recent.push(startedAt);
        }

        const own = new AbortController();
        running.set(own, { provider, startedAt, startedTick });
        const timeout = AbortSignal.timeout(provider.timeoutMs);
        const signal = AbortSignal.any([own.signal, timeout]);

        let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
        const delay = hedged ? hedgeDelay(provider) : undefined;
        if (delay !== undefined && order.length > 0) {
          hedgeTimer = setTimeout(() => {
            if (hedgeTimer) timers.delete(hedgeTimer);
            launch();
          }, delay);
          timers.add(hedgeTimer);
        }
        const clearHedge = () => {
          if (!hedgeTimer) return;
          clearTimeout(hedgeTimer);
          timers.delete(hedgeTimer);
        };

        Promise.resolve()
          .then(() => operation(provider, signal))
          .then(
            (value) => {
              running.delete(own);
              clearHedge();
              if (settled) return;
              attempts.push({ providerId: provider.id, outcome: 'ok', ms: this.now() - startedAt });
              this.recordSuccess(health, startedTick);
              this.noteSlowLosers(running, startedAt, hedgeDelay);
              settle(() => resolve({ value, provider, attempts }));
            },
            (error: unknown) => {
              running.delete(own);
              clearHedge();
              // Lost a hedged race or the caller aborted: not this provider's fault.
              if (settled) return;
              const providerError = this.normalize(provider, error, timeout.aborted);
              attempts.push({
                providerId: provider.id,
                outcome: providerError.kind,
                ms: this.now() - startedAt,
                message: providerError.message,
              });
              this.recordFailure(health, providerError, startedTick);
              if (running.size === 0) {
                // Nothing else is running: move on at once, or give up.
                launch();
                return;
              }
              // Another request is still in flight. If it has already been running for longer
              // than its hedge delay it has proven slow, so start the next provider now;
              // otherwise give it the rest of its grace period. Waiting for a slow provider to
              // time out before trying a healthy one would stall the call.
              if (timers.size === 0 && order.length > 0) {
                let wait = Number.POSITIVE_INFINITY;
                for (const other of running.values()) {
                  const grace = hedgeDelay(other.provider);
                  if (grace !== undefined) wait = Math.min(wait, grace - (this.now() - other.startedAt));
                }
                if (wait <= 0) {
                  launch();
                } else if (Number.isFinite(wait)) {
                  const timer = setTimeout(() => {
                    timers.delete(timer);
                    launch();
                  }, wait);
                  timers.add(timer);
                }
              }
            },
          );
      };

      /** Start the next provider. When none is left and nothing is running, the run is over. */
      const launch = (): void => {
        if (settled) return;
        const candidate = nextCandidate();
        if (candidate) return start(candidate, true);
        if (running.size > 0) return;
        const resort = nextLastResort();
        if (!resort) return giveUp();
        lastResortTried = true;
        start(resort, false);
      };

      launch();
    });
  }

  /**
   * A provider started later has answered. Every earlier one that is still busy although
   * its hedge delay has passed gets a strike: it cost this request the whole delay.
   */
  private noteSlowLosers(
    running: ReadonlyMap<AbortController, { provider: P; startedAt: number; startedTick: number }>,
    winnerStartedAt: number,
    hedgeDelay: (provider: P) => number | undefined,
  ): void {
    const now = this.now();
    for (const { provider, startedAt, startedTick } of running.values()) {
      const delay = hedgeDelay(provider);
      if (delay === undefined || startedAt >= winnerStartedAt || now - startedAt < delay) continue;
      this.recordSlow(this.healthOf(provider), now, startedTick);
    }
  }

  private normalize(provider: P, error: unknown, timedOut: boolean): ProviderError {
    if (timedOut) {
      return new ProviderError(provider.id, 'timeout', `no answer within ${provider.timeoutMs} ms`, {
        cause: error,
      });
    }
    if (error instanceof ProviderError) return error;
    return new ProviderError(provider.id, 'unavailable', describeError(error), { cause: error });
  }

  /** Rest a provider until `until`. A rest that is already longer stays as it is. */
  private rest(health: Health, until: number, because: Health['restingBecause']): void {
    health.cooldownUntil = Math.max(health.cooldownUntil, until);
    health.penalizedAt = ++this.tick;
    health.restingBecause = because;
  }

  private recordSuccess(health: Health, startedTick: number): void {
    health.slowStrikes = 0;
    health.slowRests = 0;
    // A request that was already under way when the provider told another one to back off
    // proves nothing about that limit: the rest stands.
    if (health.penalizedAt > startedTick) return;
    const wasUnhealthy =
      health.consecutiveFailures > 0 || health.cooldownUntil > 0 || health.lastError !== undefined;
    health.consecutiveFailures = 0;
    health.badRequestStrikes = 0;
    health.cooldownUntil = 0;
    health.restingBecause = undefined;
    health.lastError = undefined;
    if (wasUnhealthy) this.onStatusChange();
  }

  private recordFailure(health: Health, error: ProviderError, startedTick: number): void {
    const now = this.now();
    if (error.kind === 'aborted') return;
    // Several requests can be in flight when a provider goes down. They all fail, but it is
    // one incident: only the first may lengthen the backoff or count as a strike.
    const sameIncident = startedTick < health.lastFailureAt;
    health.lastFailureAt = ++this.tick;
    health.lastError = error.message;
    switch (error.kind) {
      case 'auth':
        health.authRejected = true;
        break;
      case 'rate_limit': {
        const wait = error.retryAfterMs ?? RATE_LIMIT_DEFAULT_COOLDOWN_MS;
        this.rest(health, now + Math.min(RATE_LIMIT_MAX_COOLDOWN_MS, Math.max(1_000, wait)), error.kind);
        break;
      }
      case 'bad_request':
        // Usually a property of this one request (odd audio, filtered text). Only when it keeps
        // happening do we assume a wrong model id or endpoint and rest the provider.
        if (!sameIncident) health.badRequestStrikes += 1;
        if (health.badRequestStrikes >= BAD_REQUEST_STRIKES) {
          health.badRequestStrikes = 0;
          this.rest(health, now + FAILURE_MAX_COOLDOWN_MS, error.kind);
        }
        break;
      case 'timeout':
      case 'unavailable':
      case 'bad_response': {
        if (!sameIncident || health.consecutiveFailures === 0) health.consecutiveFailures += 1;
        const backoff = FAILURE_BASE_COOLDOWN_MS * 2 ** (health.consecutiveFailures - 1);
        this.rest(health, now + Math.min(FAILURE_MAX_COOLDOWN_MS, backoff), error.kind);
        break;
      }
    }
    this.onStatusChange();
  }

  private recordSlow(health: Health, now: number, startedTick: number): void {
    // Two requests that overlap (both directions talking, a long sentence and its tail) meet
    // the same slow moment: like parallel failures, that is one strike, not two.
    if (startedTick < health.lastSlowAt) return;
    health.lastSlowAt = ++this.tick;
    health.slowStrikes += 1;
    if (health.slowStrikes < SLOW_STRIKES) return;
    // Each further rest is longer: a provider that stays slow is tried less and less often
    // until it wins a race again. It always takes two fresh strikes, so one long request
    // after a rest does not send the better provider away again.
    health.slowStrikes = 0;
    const pause = Math.min(SLOW_MAX_COOLDOWN_MS, SLOW_BASE_COOLDOWN_MS * 2 ** health.slowRests);
    health.slowRests += 1;
    health.lastError = 'answers more slowly than the fallback';
    this.rest(health, now + pause, 'slow');
    this.onStatusChange();
  }

  /** Forget "credentials rejected" and cooldowns, e.g. after the user saved new keys. */
  resetHealth(): void {
    for (const [id, health] of this.health) this.health.set(id, { ...freshHealth(), recent: health.recent });
    this.onStatusChange();
  }

  /** True when at least one provider has what it needs to be tried. */
  hasConfigured(): boolean {
    return this.providers.some((provider) => provider.isConfigured());
  }

  status(): ProviderStatus[] {
    const now = this.now();
    return this.providers.map((provider, order) => {
      const health = this.healthOf(provider);
      const base = {
        id: provider.id,
        kind: this.kind,
        label: provider.label,
        order,
        requiresKey: provider.requiresKey,
      };
      if (!provider.isConfigured()) {
        // Something is there but incomplete (a key without its region): say what, where the
        // interface shows it, instead of asking for a key the user has already entered.
        const reason = provider.unconfiguredReason?.();
        if (reason) return { ...base, state: 'disabled' as const, detail: reason };
        return { ...base, state: 'unconfigured' as const, detail: 'API key not set' };
      }
      if (health.authRejected) {
        return { ...base, state: 'disabled' as const, detail: health.lastError ?? 'API key rejected' };
      }
      if (health.cooldownUntil > now) {
        return {
          ...base,
          state: 'cooldown' as const,
          detail: health.lastError,
          cooldownUntil: health.cooldownUntil,
        };
      }
      return { ...base, state: 'ready' as const, detail: health.lastError };
    });
  }
}
