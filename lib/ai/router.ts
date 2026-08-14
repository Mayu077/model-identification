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

// Model preference per provider per task, best first. Edit here (or override
// with env vars AI_MODEL_<PROVIDER>_<TASK>, comma-separated, e.g.
// AI_MODEL_GEMINI_VISION) when providers release new free models.
//
// Several models are listed per provider because "this model is currently
// experiencing high demand" is a routine answer from the free Gemini tier —
// measured at roughly one call in three. That is a property of the MODEL, not
// of the key, so the useful next move is a sibling model on the same provider,
// not the same model on another key.
const DEFAULT_MODELS: Record<ProviderName, Partial<Record<TaskType, string[]>>> =
  {
    gemini: {
      // Prioritize gemini-3.7-flash, with fallbacks for high demand / rate limits.
      vision: ["gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash"],
      text: ["gemini-3.7-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash"],
      reasoning: ["gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"],
    },
    groq: {
      // Groq no longer serves a vision model (llama-4-scout was retired), so
      // it is text/reasoning only — see TASK_PROVIDER_ORDER.vision below.
      text: ["llama-3.3-70b-versatile"],
      reasoning: ["qwen/qwen3.6-27b"],
    },
    openrouter: {
      vision: ["google/gemini-2.5-flash"],
      text: ["meta-llama/llama-3.3-70b-instruct:free"],
      reasoning: ["qwen/qwen3-coder:free"],
    },
    nvidia: {
      vision: ["meta/llama-3.2-90b-vision-instruct"],
      text: ["meta/llama-3.3-70b-instruct"],
      reasoning: ["nvidia/llama-3.3-nemotron-super-49b-v1.5"],
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

function modelIdsFor(provider: ProviderName, task: TaskType): string[] {
  const override =
    process.env[`AI_MODEL_${provider.toUpperCase()}_${task.toUpperCase()}`]
  if (override) {
    return override
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  }
  return DEFAULT_MODELS[provider][task] ?? []
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
    const keys = keysFor(provider)
    // Model-major within a provider: every key for the best model, then every
    // key for the next one. Key rotation answers "this key is out of quota";
    // model rotation answers "this model is busy or gone".
    for (const modelId of modelIdsFor(provider, task)) {
      keys.forEach((apiKey, keyIndex) => {
        candidates.push({
          provider,
          modelId,
          keyIndex,
          model: buildModel(provider, modelId, apiKey),
        })
      })
    }
  }
  return candidates
}

/**
 * Thrown by a caller that got a well-formed but useless answer — for trip cards,
 * a model that replied with zero rows. It is not an API error, so nothing in the
 * SDK would retry it, but the right move is exactly the same as for an overload:
 * try a different model.
 */
export class RotateToNextModel extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RotateToNextModel"
  }
}

function statusOf(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "statusCode" in err
    ? (err as { statusCode?: number }).statusCode
    : undefined
}

/** A failure that belongs to this KEY — the next key for the same model may work. */
function isKeyLevelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err)
  const status = statusOf(err)
  if (status && [401, 402, 403, 429].includes(status)) return true
  return (
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("quota") ||
    msg.includes("credit") ||
    msg.includes("unauthorized") ||
    msg.includes("api key") ||
    msg.includes("resource_exhausted") ||
    msg.includes("429")
  )
}

/**
 * A failure that belongs to this MODEL — retrying its other keys is a waste, so
 * the remaining keys are skipped and the next model is tried instead.
 *
 * "This model is currently experiencing high demand" is the common one on the
 * free Gemini tier, and it arrives fast (7-10s), so rotating on it is cheap.
 * A 404 belongs here too: a model id that has been retired or is closed to new
 * users will 404 on every key we own.
 */
function isModelLevelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err)
  const status = statusOf(err)
  if (err instanceof RotateToNextModel) return true
  if (status && [400, 404, 408, 500, 502, 503, 529].includes(status)) return true
  return (
    msg.includes("timed out") ||
    msg.includes("high demand") ||
    msg.includes("overloaded") ||
    msg.includes("try again later") ||
    msg.includes("is not found") ||
    msg.includes("no longer available") ||
    msg.includes("not supported")
  )
}

// Per-attempt timeout. With Gemini's thinking budget set to zero (see
// lib/ai/extract.ts) a 17-row handwritten card comes back in 10-12s and a full
// 45-row card in well under a minute, so 60s is generous for the work while
// still leaving room inside the total budget for several rotations. The old 90s
// value allowed only two attempts, and the first one it spent was usually on a
// model that was merely busy.
const ATTEMPT_TIMEOUT_MS = 60_000
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
  let attempts = 0
  // Candidates are ordered model-major within each provider. A model-level
  // failure (busy, retired, hung, or answering with nothing) skips that model's
  // remaining keys, because retrying a dozen sibling keys against a model that
  // is not going to answer burns the budget and the better fallbacks are never
  // reached. Quota and auth failures are per-key, so those rotate key by key.
  const exhaustedModels = new Set<string>()
  for (const candidate of candidates) {
    const modelKey = `${candidate.provider}/${candidate.modelId}`
    if (exhaustedModels.has(modelKey)) continue
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started)
    if (remaining < 10_000) {
      console.log(`[ai-router] budget spent after ${attempts} attempt(s), giving up`)
      break
    }
    attempts += 1
    try {
      const value = await withTimeout(
        fn(candidate.model, candidate),
        Math.min(ATTEMPT_TIMEOUT_MS, remaining),
      )
      if (attempts > 1) {
        console.log(`[ai-router] succeeded on ${modelKey} key#${candidate.keyIndex + 1} (attempt ${attempts})`)
      }
      return value
    } catch (err) {
      lastError = err
      const modelLevel = isModelLevelError(err)
      // Anything we cannot classify is a real bug (a schema mismatch, a coding
      // error) and must surface rather than being retried against every key.
      if (!modelLevel && !isKeyLevelError(err)) throw err
      if (modelLevel) exhaustedModels.add(modelKey)
      console.log(
        `[ai-router] ${modelKey} key#${candidate.keyIndex + 1} failed, rotating to next ${modelLevel ? "model" : "key"}:`,
        err instanceof Error ? err.message.slice(0, 200) : err,
      )
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All AI providers/keys failed")
}
