import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createGroq } from "@ai-sdk/groq"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"

/**
 * Multi-provider, multi-key AI router.
 *
 * Providers: Google AI Studio (Gemini), Groq, OpenRouter, NVIDIA NIM.
 * Each provider supports up to 3 keys via env vars:
 *   GEMINI_API_KEY_1..3, GROQ_API_KEY_1..3,
 *   OPENROUTER_API_KEY_1..3, NVIDIA_API_KEY_1..3
 * (unnumbered variants like GEMINI_API_KEY also work)
 *
 * For a given task the router builds an ordered list of (model, key)
 * candidates and the caller walks through them: when a call fails with a
 * rate-limit / quota / auth error, it moves to the next candidate.
 */

export type TaskType = "vision" | "text" | "reasoning"

type ProviderName = "gemini" | "groq" | "openrouter" | "nvidia"

// Model preference per provider per task. Edit here (or override with env
// vars AI_MODEL_<PROVIDER>_<TASK>, e.g. AI_MODEL_GEMINI_VISION) when
// providers release new free models.
const DEFAULT_MODELS: Record<ProviderName, Partial<Record<TaskType, string>>> =
  {
    gemini: {
      vision: "gemini-3.5-flash",
      text: "gemini-3.1-flash-lite",
      reasoning: "gemini-3.5-flash",
    },
    groq: {
      // Groq no longer serves a vision model (llama-4-scout was retired), so
      // it is text/reasoning only — see TASK_PROVIDER_ORDER.vision below.
      text: "llama-3.3-70b-versatile",
      reasoning: "qwen/qwen3.6-27b",
    },
    openrouter: {
      vision: "google/gemini-2.5-flash",
      text: "meta-llama/llama-3.3-70b-instruct:free",
      reasoning: "qwen/qwen3-coder:free",
    },
    nvidia: {
      vision: "meta/llama-3.2-90b-vision-instruct",
      text: "meta/llama-3.3-70b-instruct",
      reasoning: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
    },
  }

// Provider priority per task: vision favors Gemini (best OCR), text favors
// Groq (fastest), reasoning favors Qwen-class models.
const TASK_PROVIDER_ORDER: Record<TaskType, ProviderName[]> = {
  vision: ["gemini", "openrouter", "nvidia"],
  text: ["groq", "gemini", "openrouter", "nvidia"],
  reasoning: ["groq", "nvidia", "openrouter", "gemini"],
}

const ENV_PREFIX: Record<ProviderName, string> = {
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  nvidia: "NVIDIA_API_KEY",
}

// Free-tier quota is per key, so we pool many keys per provider and rotate on
// 429s. Bump this if you add more numbered keys than the current ceiling.
const MAX_KEYS_PER_PROVIDER = 15

function keysFor(provider: ProviderName): string[] {
  const prefix = ENV_PREFIX[provider]
  const keys: string[] = []
  const base = process.env[prefix]
  if (base) keys.push(base)
  for (let i = 1; i <= MAX_KEYS_PER_PROVIDER; i++) {
    const k = process.env[`${prefix}_${i}`]
    if (k && !keys.includes(k)) keys.push(k)
  }
  return keys
}

function modelIdFor(provider: ProviderName, task: TaskType): string | null {
  const override =
    process.env[`AI_MODEL_${provider.toUpperCase()}_${task.toUpperCase()}`]
  return override ?? DEFAULT_MODELS[provider][task] ?? null
}

function buildModel(
  provider: ProviderName,
  modelId: string,
  apiKey: string,
): LanguageModel {
  switch (provider) {
    case "gemini":
      return createGoogleGenerativeAI({ apiKey })(modelId)
    case "groq":
      return createGroq({ apiKey })(modelId)
    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
      })(modelId)
    case "nvidia":
      return createOpenAICompatible({
        name: "nvidia",
        baseURL: "https://integrate.api.nvidia.com/v1",
        apiKey,
      })(modelId)
  }
}

export interface ModelCandidate {
  provider: ProviderName
  modelId: string
  keyIndex: number
  model: LanguageModel
}

export function getCandidates(task: TaskType): ModelCandidate[] {
  const candidates: ModelCandidate[] = []
  for (const provider of TASK_PROVIDER_ORDER[task]) {
    const modelId = modelIdFor(provider, task)
    if (!modelId) continue
    const keys = keysFor(provider)
    keys.forEach((apiKey, keyIndex) => {
      candidates.push({
        provider,
        modelId,
        keyIndex,
        model: buildModel(provider, modelId, apiKey),
      })
    })
  }
  return candidates
}

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err)
  const status =
    typeof err === "object" && err !== null && "statusCode" in err
      ? (err as { statusCode?: number }).statusCode
      : undefined
  if (status && [401, 402, 403, 408, 429, 500, 502, 503, 529].includes(status))
    return true
  return (
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("quota") ||
    msg.includes("credit") ||
    msg.includes("overloaded") ||
    msg.includes("unauthorized") ||
    msg.includes("api key") ||
    msg.includes("resource_exhausted") ||
    msg.includes("429")
  )
}

// Per-attempt timeout. A 40-row handwritten trip card legitimately takes a
// vision model 40-90s, and extraction runs inside after() where nobody is
// waiting on the response — so this is only here to cut off a genuinely hung
// provider. The old 25s value was shorter than the work itself, which is why
// large multi-trip cards failed while single printed receipts succeeded.
const ATTEMPT_TIMEOUT_MS = 90_000
// Total budget: stay under the scan route's maxDuration so we can still record
// a real error on the scan_job instead of being killed mid-write.
const TOTAL_BUDGET_MS = 240_000

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`AI provider timed out after ${ms / 1000}s`)),
          ms,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Run `fn` against candidates for the task, rotating providers/keys on
 * quota / rate-limit / auth errors AND per-attempt timeouts.
 * Throws the last error if all fail or the total budget is exhausted.
 */
export async function withModelRotation<T>(
  task: TaskType,
  fn: (model: LanguageModel, info: ModelCandidate) => Promise<T>,
): Promise<T> {
  const candidates = getCandidates(task)
  if (candidates.length === 0) {
    throw new Error(
      "No AI API keys configured. Add at least one of GEMINI_API_KEY_1, GROQ_API_KEY_1, OPENROUTER_API_KEY_1 or NVIDIA_API_KEY_1 in project environment variables.",
    )
  }
  const started = Date.now()
  let lastError: unknown
  // Candidates are ordered provider-major (every Gemini key, then every
  // OpenRouter key, ...). A timeout means that MODEL is too slow for this
  // workload, not that this key is exhausted — so retrying its dozen sibling
  // keys just burns the budget and the later providers are never reached.
  // Quota/auth failures are per-key, so those still rotate key by key.
  const exhaustedProviders = new Set<ProviderName>()
  for (const candidate of candidates) {
    if (exhaustedProviders.has(candidate.provider)) continue
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started)
    if (remaining < 10_000) break // not enough time for a meaningful attempt
    try {
      return await withTimeout(
        fn(candidate.model, candidate),
        Math.min(ATTEMPT_TIMEOUT_MS, remaining),
      )
    } catch (err) {
      lastError = err
      const timedOut = err instanceof Error && err.message.includes("timed out")
      if (!timedOut && !isRetryableError(err)) throw err
      if (timedOut) exhaustedProviders.add(candidate.provider)
      console.log(
        `[ai-router] ${candidate.provider}/${candidate.modelId} key#${candidate.keyIndex + 1} failed, rotating${timedOut ? ` past all ${candidate.provider} keys (timeout)` : ""}:`,
        err instanceof Error ? err.message.slice(0, 200) : err,
      )
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All AI providers/keys failed")
}
