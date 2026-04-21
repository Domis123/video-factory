/**
 * Centralized retry helper for LLM API calls.
 *
 * Retries transient failures (429/502/503/504/529, Anthropic overloaded_error,
 * network errors) with exponential backoff + full jitter. All non-transient
 * errors (auth, validation, 4xx other than 429) throw immediately.
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxTotalMs?: number;
  label?: string;
}

const RETRY_STATUS = [429, 502, 503, 504, 529];
const RETRY_NETWORK_CODES = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'];
const RETRY_MESSAGE_SUBSTRINGS = [
  'overloaded',
  'rate limit',
  'timeout',
  'socket hang up',
  'econnreset',
];

export async function withLLMRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 4;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;
  const maxDelayMs = opts?.maxDelayMs ?? 8000;
  const maxTotalMs = opts?.maxTotalMs ?? 120000;
  const label = opts?.label ?? 'llm';

  const start = Date.now();
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        console.log(`[retry-llm] ${label} succeeded on attempt ${attempt}`);
      }
      return result;
    } catch (err) {
      lastErr = err;

      if (err == null || !isRetryable(err)) {
        throw err;
      }

      if (attempt >= maxAttempts) {
        console.error(
          `[retry-llm] ${label} exhausted ${attempt} attempts, giving up. Last error: ${messageOf(err)}`
        );
        throw err;
      }

      const rawDelay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const actualDelay = Math.floor(Math.random() * rawDelay);

      const elapsed = Date.now() - start;
      if (elapsed + actualDelay > maxTotalMs) {
        console.warn(
          `[retry-llm] ${label} budget exhausted after ${elapsed}ms (${attempt} attempts, max ${maxTotalMs}ms). Last error: ${messageOf(err)}`
        );
        throw err;
      }

      const marker = statusOrCodeOf(err);
      console.warn(
        `[retry-llm] ${label} attempt ${attempt}/${maxAttempts} failed (${marker}: ${messageOf(err)}), sleeping ${actualDelay}ms`
      );

      await sleep(actualDelay);
    }
  }

  // Unreachable: either we returned from the try, or threw from the catch.
  throw lastErr;
}

function isRetryable(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;

  const status =
    typeof e.status === 'number'
      ? e.status
      : typeof e.statusCode === 'number'
      ? e.statusCode
      : null;
  if (status !== null && RETRY_STATUS.includes(status)) return true;

  if (e.name === 'APIError' && status !== null && RETRY_STATUS.includes(status)) {
    return true;
  }

  const body = e.error as Record<string, unknown> | undefined;
  if (body && typeof body.type === 'string' && body.type === 'overloaded_error') {
    return true;
  }

  if (typeof e.code === 'string' && RETRY_NETWORK_CODES.includes(e.code)) {
    return true;
  }

  const msg = messageOf(err).toLowerCase();
  if (RETRY_MESSAGE_SUBSTRINGS.some((s) => msg.includes(s))) return true;

  return false;
}

function messageOf(err: unknown): string {
  if (err == null) return 'unknown';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function statusOrCodeOf(err: unknown): string {
  if (err == null || typeof err !== 'object') return 'unknown';
  const e = err as Record<string, unknown>;
  if (typeof e.status === 'number') return String(e.status);
  if (typeof e.statusCode === 'number') return String(e.statusCode);
  if (typeof e.code === 'string') return e.code;
  const body = e.error as Record<string, unknown> | undefined;
  if (body && typeof body.type === 'string') return body.type;
  return 'no-status';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
