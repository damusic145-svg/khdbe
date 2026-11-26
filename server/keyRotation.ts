import { AsyncLocalStorage } from 'node:async_hooks';
import { GoogleGenAI } from '@google/genai';
import { store } from './db.ts';
import type { ApiKeyRecord } from './types.ts';

interface KeyCandidate {
  id: string; // 'env:gemini' | 'env:groq' | db key id
  apiKey: string;
  label: string;
  isEnv: boolean;
}

export interface RetryWaitInfo {
  provider: 'gemini' | 'groq';
  waitMs: number;
  attempt: number;
  maxAttempts: number;
  reason: string;
}

type RetryWaitObserver = (info: RetryWaitInfo) => void;

const retryObserverStorage = new AsyncLocalStorage<RetryWaitObserver>();

export function withRetryObserver<T>(observer: RetryWaitObserver, fn: () => Promise<T>): Promise<T> {
  return retryObserverStorage.run(observer, fn);
}

const envStats = {
  gemini: { usageCount: 0, errorCount: 0, lastError: null as string | null, cooldownUntil: null as number | null },
  groq: { usageCount: 0, errorCount: 0, lastError: null as string | null, cooldownUntil: null as number | null },
};

const roundRobinCursor: Record<'gemini' | 'groq', number> = {
  gemini: 0,
  groq: 0,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isKeyReady(record: ApiKeyRecord, now: number): boolean {
  if (!record.isEnabled) return false;
  if (record.status === 'invalid' || record.status === 'disabled') return false;
  if (record.status === 'rate_limited' && record.cooldownUntil && record.cooldownUntil > now) {
    return false;
  }
  return true;
}

function parseRetryAfterMs(message: string): number | null {
  // Match patterns like: "Please retry in 24.5s", "retryDelay":"24s", "Retry-After: 15"
  const secPatterns = [
    /retry\s+in\s+([0-9]+(?:\.[0-9]+)?)\s*s/i,
    /"retryDelay"\s*:\s*"([0-9]+(?:\.[0-9]+)?)s"/i,
    /retry-after[:\s]+([0-9]+(?:\.[0-9]+)?)/i,
  ];
  for (const re of secPatterns) {
    const m = message.match(re);
    if (m && m[1]) {
      const sec = Number(m[1]);
      if (Number.isFinite(sec) && sec > 0) {
        return Math.ceil(sec * 1000);
      }
    }
  }
  const msMatch = message.match(/retry\s+in\s+([0-9]+(?:\.[0-9]+)?)\s*ms/i);
  if (msMatch && msMatch[1]) {
    const ms = Number(msMatch[1]);
    if (Number.isFinite(ms) && ms > 0) return Math.ceil(ms);
  }
  return null;
}

export function isRateLimitError(err: unknown): boolean {
  return classifyApiError(err).kind === 'rate_limit';
}

function classifyApiError(err: unknown): {
  kind: 'rate_limit' | 'invalid' | 'transient';
  isHardQuotaZero: boolean;
  retryAfterMs: number | null;
  message: string;
} {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : 0;

  if (
    status === 429 ||
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('quota') ||
    lower.includes('resource_exhausted') ||
    lower.includes('too many requests')
  ) {
    const isHardQuotaZero =
      lower.includes('limit: 0') ||
      lower.includes('quota_limit_value":"0"') ||
      lower.includes('billing') ||
      (lower.includes('perday') && !lower.includes('perminute'));
    return {
      kind: 'rate_limit',
      isHardQuotaZero,
      retryAfterMs: parseRetryAfterMs(msg),
      message: msg,
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('unauthorized') ||
    lower.includes('permission_denied') ||
    lower.includes('incorrect api key')
  ) {
    return { kind: 'invalid', isHardQuotaZero: false, retryAfterMs: null, message: msg };
  }

  return { kind: 'transient', isHardQuotaZero: false, retryAfterMs: null, message: msg };
}

export function formatApiErrorMessage(provider: 'gemini' | 'groq', err: unknown): string {
  const classified = classifyApiError(err);
  const label = provider === 'gemini' ? 'Gemini AI' : 'Groq Whisper';
  if (classified.kind === 'rate_limit') {
    if (classified.isHardQuotaZero) {
      return `${label} quota exhausted (HTTP 429). Check your billing/quota in Settings > Secrets, or add another active rotation key in the ${label} Key Manager.`;
    }
    const retryHint = classified.retryAfterMs
      ? ` Provider requested ~${Math.ceil(classified.retryAfterMs / 1000)}s cooldown.`
      : '';
    return `${label} rate limit reached (HTTP 429) across available keys after automatic retries.${retryHint} Wait a few seconds and retry, or add extra rotation keys in the ${label} Key Manager.`;
  }
  if (classified.kind === 'invalid') {
    return `${label} API key rejected (${classified.message.slice(0, 140)}). Please verify your key in Settings > Secrets or the Key Manager.`;
  }
  return classified.message;
}

function getAllConfiguredCount(provider: 'gemini' | 'groq'): number {
  const envKey = provider === 'gemini' ? process.env.GEMINI_API_KEY?.trim() : process.env.GROQ_API_KEY?.trim();
  const dbKeys = store.listApiKeys(provider).filter((k) => k.isEnabled && k.status !== 'invalid' && k.status !== 'disabled');
  return (envKey ? 1 : 0) + dbKeys.length;
}

function getEarliestCooldownUntil(provider: 'gemini' | 'groq', now: number): number | null {
  const times: number[] = [];
  const envKey = provider === 'gemini' ? process.env.GEMINI_API_KEY?.trim() : process.env.GROQ_API_KEY?.trim();
  const envCooldown = envStats[provider].cooldownUntil;
  if (envKey && envCooldown && envCooldown > now) {
    times.push(envCooldown);
  }
  const dbKeys = store.listApiKeys(provider).filter((k) => k.isEnabled && k.status === 'rate_limited' && k.cooldownUntil && k.cooldownUntil > now);
  for (const k of dbKeys) {
    if (k.cooldownUntil) times.push(k.cooldownUntil);
  }
  return times.length > 0 ? Math.min(...times) : null;
}

function getCandidates(provider: 'gemini' | 'groq'): KeyCandidate[] {
  const now = Date.now();
  const candidates: KeyCandidate[] = [];

  const envKey = provider === 'gemini' ? process.env.GEMINI_API_KEY?.trim() : process.env.GROQ_API_KEY?.trim();
  const envCooldown = envStats[provider].cooldownUntil;
  if (envKey && (!envCooldown || envCooldown <= now)) {
    candidates.push({
      id: `env:${provider}`,
      apiKey: envKey,
      label: `System Environment (${provider.toUpperCase()})`,
      isEnv: true,
    });
  }

  const dbKeys = store.listApiKeys(provider).filter((k) => isKeyReady(k, now));
  if (dbKeys.length > 0) {
    const start = roundRobinCursor[provider] % dbKeys.length;
    const rotated = [...dbKeys.slice(start), ...dbKeys.slice(0, start)];
    roundRobinCursor[provider] = (start + 1) % dbKeys.length;

    for (const k of rotated) {
      const raw = store.getRawDecryptedKey(k.id);
      if (raw) {
        candidates.push({
          id: k.id,
          apiKey: raw,
          label: k.label,
          isEnv: false,
        });
      }
    }
  }

  return candidates;
}

export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function getRecommendedPacingMs(provider: 'gemini' | 'groq'): number {
  const count = getAllConfiguredCount(provider);
  if (count >= 3) return 250;
  if (count === 2) return 550;
  return 1100;
}

export async function executeWithGeminiRotation<T>(
  task: (ai: GoogleGenAI, keyLabel: string) => Promise<T>
): Promise<T> {
  const maxRetries = Math.max(1, Math.min(6, store.getSettings().autoRetryCount || 3));
  const maxRounds = maxRetries + 1;
  const observer = retryObserverStorage.getStore();

  let lastError: unknown = null;

  for (let round = 0; round < maxRounds; round++) {
    const now = Date.now();
    const candidates = getCandidates('gemini');
    const configuredCount = getAllConfiguredCount('gemini');

    if (candidates.length === 0) {
      if (configuredCount === 0) {
        throw new Error(
          'No active Gemini API key is configured. Set GEMINI_API_KEY in Settings > Secrets or add a key in Gemini Keys.'
        );
      }

      const earliestCooldown = getEarliestCooldownUntil('gemini', now);
      if (earliestCooldown && round < maxRounds - 1) {
        const waitMs = Math.min(45_000, Math.max(2_000, earliestCooldown - now + 250));
        observer?.({
          provider: 'gemini',
          waitMs,
          attempt: round + 2,
          maxAttempts: maxRounds,
          reason: 'All Gemini keys in rate-limit cooldown',
        });
        await sleep(waitMs);
        continue;
      }

      throw new Error(
        'All Gemini API keys are currently in rate-limit cooldown (HTTP 429). Please wait a moment and retry, or add another key in Gemini Keys.'
      );
    }

    let roundWaitMs = 0;
    let sawHardQuotaZero = true;

    for (let idx = 0; idx < candidates.length; idx++) {
      const candidate = candidates[idx];
      const hasMoreInRound = idx < candidates.length - 1;
      const ai = createGeminiClient(candidate.apiKey);

      try {
        const result = await task(ai, candidate.label);
        if (candidate.isEnv) {
          envStats.gemini.usageCount += 1;
          envStats.gemini.lastError = null;
          envStats.gemini.cooldownUntil = null;
        } else {
          store.recordKeyUsage(candidate.id);
        }
        return result;
      } catch (err) {
        lastError = err;
        const classified = classifyApiError(err);

        if (classified.kind === 'rate_limit') {
          if (!classified.isHardQuotaZero) {
            sawHardQuotaZero = false;
          }
          const jitter = Math.floor(Math.random() * 750);
          const backoffMs = Math.min(40_000, 4_000 * Math.pow(2, round) + jitter);
          const waitForThis = classified.retryAfterMs
            ? Math.min(45_000, Math.max(2_000, classified.retryAfterMs))
            : backoffMs;

          // If multiple keys exist, bench this key for longer so traffic shifts to healthy keys;
          // if single key, only cooldown for the retry backoff window so user isn't locked out for 60s.
          const cooldownDuration = configuredCount > 1 ? Math.max(45_000, waitForThis) : waitForThis;
          const cooldownUntil = Date.now() + cooldownDuration;

          if (candidate.isEnv) {
            envStats.gemini.errorCount += 1;
            envStats.gemini.lastError = classified.message;
            envStats.gemini.cooldownUntil = cooldownUntil;
          } else {
            store.recordKeyError(candidate.id, 'rate_limited', classified.message, cooldownUntil);
          }

          roundWaitMs = roundWaitMs === 0 ? waitForThis : Math.min(roundWaitMs, waitForThis);

          if (hasMoreInRound) {
            continue;
          }
          break;
        }

        sawHardQuotaZero = false;

        if (classified.kind === 'invalid') {
          if (candidate.isEnv) {
            envStats.gemini.errorCount += 1;
            envStats.gemini.lastError = classified.message;
          } else {
            store.recordKeyError(candidate.id, 'invalid', classified.message, null);
          }
          continue;
        }

        // Transient error: retry once after short backoff on same candidate, then rotate/next round
        await sleep(800);
        try {
          const retryResult = await task(ai, candidate.label);
          if (candidate.isEnv) {
            envStats.gemini.usageCount += 1;
            envStats.gemini.lastError = null;
          } else {
            store.recordKeyUsage(candidate.id);
          }
          return retryResult;
        } catch (retryErr) {
          lastError = retryErr;
          const retryClass = classifyApiError(retryErr);
          if (retryClass.kind === 'rate_limit') {
            const backoffMs = Math.min(40_000, 4_000 * Math.pow(2, round));
            roundWaitMs = roundWaitMs === 0 ? backoffMs : Math.min(roundWaitMs, backoffMs);
          } else {
            roundWaitMs = Math.max(roundWaitMs, 1_500);
          }
          continue;
        }
      }
    }

    if (sawHardQuotaZero && lastError && classifyApiError(lastError).kind === 'rate_limit') {
      break;
    }

    if (round < maxRounds - 1 && roundWaitMs > 0) {
      observer?.({
        provider: 'gemini',
        waitMs: roundWaitMs,
        attempt: round + 2,
        maxAttempts: maxRounds,
        reason: 'Rate limit (HTTP 429) — backing off before retry',
      });
      await sleep(roundWaitMs);
    } else {
      break;
    }
  }

  throw new Error(formatApiErrorMessage('gemini', lastError ?? 'Gemini request failed'));
}

export async function executeWithGroqRotation<T>(
  task: (groqApiKey: string, keyLabel: string) => Promise<T>
): Promise<T> {
  const maxRetries = Math.max(1, Math.min(5, store.getSettings().autoRetryCount || 3));
  const maxRounds = maxRetries + 1;
  const observer = retryObserverStorage.getStore();

  let lastError: unknown = null;

  for (let round = 0; round < maxRounds; round++) {
    const now = Date.now();
    const candidates = getCandidates('groq');
    const configuredCount = getAllConfiguredCount('groq');

    if (candidates.length === 0) {
      if (configuredCount === 0) {
        throw new Error('NO_GROQ_KEY_AVAILABLE');
      }
      const earliestCooldown = getEarliestCooldownUntil('groq', now);
      if (earliestCooldown && round < maxRounds - 1) {
        const waitMs = Math.min(35_000, Math.max(2_000, earliestCooldown - now + 250));
        observer?.({
          provider: 'groq',
          waitMs,
          attempt: round + 2,
          maxAttempts: maxRounds,
          reason: 'All Groq keys in rate-limit cooldown',
        });
        await sleep(waitMs);
        continue;
      }
      throw new Error(
        'All Groq Whisper API keys are currently in rate-limit cooldown (HTTP 429).'
      );
    }

    let roundWaitMs = 0;

    for (let idx = 0; idx < candidates.length; idx++) {
      const candidate = candidates[idx];
      const hasMoreInRound = idx < candidates.length - 1;

      try {
        const result = await task(candidate.apiKey, candidate.label);
        if (candidate.isEnv) {
          envStats.groq.usageCount += 1;
          envStats.groq.lastError = null;
          envStats.groq.cooldownUntil = null;
        } else {
          store.recordKeyUsage(candidate.id);
        }
        return result;
      } catch (err) {
        lastError = err;
        const classified = classifyApiError(err);

        if (classified.kind === 'rate_limit') {
          const jitter = Math.floor(Math.random() * 500);
          const backoffMs = Math.min(30_000, 3_500 * Math.pow(2, round) + jitter);
          const waitForThis = classified.retryAfterMs
            ? Math.min(35_000, Math.max(2_000, classified.retryAfterMs))
            : backoffMs;
          const cooldownDuration = configuredCount > 1 ? Math.max(45_000, waitForThis) : waitForThis;
          const cooldownUntil = Date.now() + cooldownDuration;

          if (candidate.isEnv) {
            envStats.groq.errorCount += 1;
            envStats.groq.lastError = classified.message;
            envStats.groq.cooldownUntil = cooldownUntil;
          } else {
            store.recordKeyError(candidate.id, 'rate_limited', classified.message, cooldownUntil);
          }

          roundWaitMs = roundWaitMs === 0 ? waitForThis : Math.min(roundWaitMs, waitForThis);

          if (hasMoreInRound) continue;
          break;
        }

        if (classified.kind === 'invalid') {
          if (candidate.isEnv) {
            envStats.groq.errorCount += 1;
            envStats.groq.lastError = classified.message;
          } else {
            store.recordKeyError(candidate.id, 'invalid', classified.message, null);
          }
          continue;
        }

        await sleep(700);
        try {
          const retryResult = await task(candidate.apiKey, candidate.label);
          if (candidate.isEnv) {
            envStats.groq.usageCount += 1;
          } else {
            store.recordKeyUsage(candidate.id);
          }
          return retryResult;
        } catch (retryErr) {
          lastError = retryErr;
          roundWaitMs = Math.max(roundWaitMs, 1_500);
          continue;
        }
      }
    }

    if (round < maxRounds - 1 && roundWaitMs > 0) {
      observer?.({
        provider: 'groq',
        waitMs: roundWaitMs,
        attempt: round + 2,
        maxAttempts: maxRounds,
        reason: 'Groq rate limit (HTTP 429) — backing off before retry',
      });
      await sleep(roundWaitMs);
    } else {
      break;
    }
  }

  throw new Error(formatApiErrorMessage('groq', lastError ?? 'Groq request failed'));
}

export async function testStoredApiKey(keyId: string): Promise<{ ok: boolean; status: ApiKeyRecord['status']; message: string }> {
  const keys = store.listApiKeys();
  const found = keys.find((k) => k.id === keyId);
  if (!found) {
    return { ok: false, status: 'invalid', message: 'Key record not found.' };
  }
  const rawKey = store.getRawDecryptedKey(keyId);
  if (!rawKey) {
    store.recordKeyError(keyId, 'invalid', 'Could not decrypt stored key.', null);
    return { ok: false, status: 'invalid', message: 'Could not decrypt stored key.' };
  }

  if (found.provider === 'gemini') {
    try {
      const ai = createGeminiClient(rawKey);
      await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: 'Reply with OK',
      });
      store.updateApiKey(keyId, { status: 'active' });
      store.recordKeyUsage(keyId);
      return { ok: true, status: 'active', message: 'Gemini API key verified and active.' };
    } catch (err) {
      const classified = classifyApiError(err);
      if (classified.kind === 'rate_limit') {
        const waitMs = Math.min(60_000, classified.retryAfterMs ?? 20_000);
        store.recordKeyError(keyId, 'rate_limited', classified.message, Date.now() + waitMs);
        return {
          ok: false,
          status: 'rate_limited',
          message: `Key reached rate limit (HTTP 429); placed in ${Math.ceil(waitMs / 1000)}s cooldown.`,
        };
      }
      store.recordKeyError(keyId, 'invalid', classified.message, null);
      return { ok: false, status: 'invalid', message: classified.message };
    }
  } else {
    try {
      const resp = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      if (resp.ok) {
        store.updateApiKey(keyId, { status: 'active' });
        store.recordKeyUsage(keyId);
        return { ok: true, status: 'active', message: 'Groq API key verified with Whisper access.' };
      }
      const errText = await resp.text();
      if (resp.status === 429) {
        store.recordKeyError(keyId, 'rate_limited', errText || 'HTTP 429', Date.now() + 20_000);
        return { ok: false, status: 'rate_limited', message: 'Groq key rate limited (HTTP 429); placed in 20s cooldown.' };
      }
      store.recordKeyError(keyId, 'invalid', errText || `HTTP ${resp.status}`, null);
      return { ok: false, status: 'invalid', message: `Groq rejected key (HTTP ${resp.status}).` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 'active', message: `Network check failed: ${msg}` };
    }
  }
}

export function getProviderPoolStatus() {
  const geminiEnvConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const groqEnvConfigured = Boolean(process.env.GROQ_API_KEY?.trim());
  const allKeys = store.listApiKeys();
  const now = Date.now();

  const geminiPool = allKeys.filter((k) => k.provider === 'gemini');
  const groqPool = allKeys.filter((k) => k.provider === 'groq');

  const geminiEnvReady =
    geminiEnvConfigured && (!envStats.gemini.cooldownUntil || envStats.gemini.cooldownUntil <= now);
  const groqEnvReady =
    groqEnvConfigured && (!envStats.groq.cooldownUntil || envStats.groq.cooldownUntil <= now);

  return {
    gemini: {
      envConfigured: geminiEnvConfigured,
      envUsageCount: envStats.gemini.usageCount,
      envErrorCount: envStats.gemini.errorCount,
      totalPoolKeys: geminiPool.length,
      activePoolKeys: geminiPool.filter((k) => isKeyReady(k, now)).length,
      hasAnyReady: geminiEnvReady || geminiPool.some((k) => isKeyReady(k, now)),
    },
    groq: {
      envConfigured: groqEnvConfigured,
      envUsageCount: envStats.groq.usageCount,
      envErrorCount: envStats.groq.errorCount,
      totalPoolKeys: groqPool.length,
      activePoolKeys: groqPool.filter((k) => isKeyReady(k, now)).length,
      hasAnyReady: groqEnvReady || groqPool.some((k) => isKeyReady(k, now)),
    },
  };
}
