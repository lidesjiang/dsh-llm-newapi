/**
 * Register {@link NewApiAdapter} provider routes for every configured group,
 * with connection facts resolved per request instead of frozen at load: the
 * plugin layers its `cordis.yml` entry config under the optional `llm-newapi`
 * user-settings section (`ctx.settings`) and resolves the API key through the
 * optional credential seam (`ctx.credentials`), so a changed base URL,
 * catalog, or key reaches the very next request without restarting anything,
 * while an in-flight stream keeps the facts it started with. The plugin also
 * serves model discovery for the `llm-newapi` settings namespace by
 * interrogating each group's `GET {baseURL}/models`. Multiple groups each
 * own a separate provider route (`newapi-<id>`) and credential reference.
 * @module dsh-llm-newapi
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  assertUsableApiKey,
  LlmError,
  resolveRetryPolicy,
  RetryPolicySchema,
} from '@deepseek-ai/dsh-llm'
import type { LlmConfigurableProvider, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
// Type-only: pulls the cordis Context augmentation declaring ctx.settings
// (SettingsProvider), which the removed installSettingsSection import used
// to load transitively (0.1.2 migration).
import type {} from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MODEL_EXCLUDE_PATTERNS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  NewApiAdapter,
  normalizeBaseUrl,
  PKG,
} from './adapter.ts'
import type { NewApiCatalogModel, NewApiConnectionOptions } from './adapter.ts'
import type { ModelsDevParamsRequest, ProviderHints } from './types.ts'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'

export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MODEL_EXCLUDE_PATTERNS,
  DEFAULT_PROVIDER_HINTS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  matchModelsDev,
  modelNameFromId,
  NewApiAdapter,
  normalizeBaseUrl,
  PKG,
} from './adapter.ts'
export { serializeRequest } from './serialize.ts'
export { serializeResponsesRequest } from './serialize.ts'
export type { NewApiAdapterOptions, NewApiCatalogModel, NewApiConnectionOptions } from './adapter.ts'
export type * from './types.ts'

export const name = 'llm-newapi'
export const inject = ['llm']

const NS = 'llm-newapi'

/** Environment variable naming a gateway endpoint, honored only from trusted layers. */
const BASE_URL_ENV = 'NEWAPI_BASE_URL'
/** Placeholder gateway base used when neither config nor environment names one. */
export const DEFAULT_BASE_URL = 'https://newapi.example.com/v1'

// ─── Group helpers ─────────────────────────────────────────────────────────

/**
 * Provider route id for a group. The group literally named `newapi` keeps the
 * legacy route so existing `agent-default-model.provider: newapi` keeps
 * working; other groups are namespaced under `newapi-<id>`.
 */
function groupRoute(id: string): string {
  return id === 'newapi' ? 'newapi' : `newapi-${id}`
}

/**
 * Credential reference for a group's API key. The credentials seam requires a
 * strict identifier charset (`/^[A-Za-z_][A-Za-z0-9_]*$/` — no hyphens), so
 * the ref cannot reuse the route's hyphenated `newapi-<id>` form; the
 * underscore-separated `newapi_<id>` is the same group under a ref-safe name.
 */
function groupCredRef(id: string) {
  const safe = id.replace(/[^A-Za-z0-9_]/g, '_')
  return credentialRef(id === 'newapi' ? 'newapi' : `newapi_${safe}`)
}

/**
 * The settings path to one group's profile, for directory consumers that walk
 * it (e.g. tokenledger): `['groups', <index>]` when the section stores a
 * groups array, `[]` for the legacy flat section whose root IS the profile.
 * @param raw - the raw section value (or composition entry).
 * @param providerRoute - the provider route for the group (e.g. `newapi` or `newapi-<id>`).
 * @returns the path from the section root to the group's profile object.
 */
function settingsPathOf(raw: Config, providerRoute: string): string[] {
  if (Array.isArray(raw.groups) && raw.groups.length > 0) {
    const index = raw.groups.findIndex(candidate => groupRoute(candidate.id) === providerRoute)
    return index >= 0 ? ['groups', String(index)] : []
  }
  return []
}

// ─── Config shapes ─────────────────────────────────────────────────────────

/** One gateway group. */
export interface GroupConfig {
  /** Unique id; used to derive the provider route and credential ref. */
  id: string
  /** Human-readable name for selectors. */
  name?: string
  /**
   * Wire protocol: `chat` (default) serves `POST {baseURL}/chat/completions`;
   * `responses` serves the OpenAI Responses API (`POST {baseURL}/responses`,
   * for agents / multi-step output / tool calling).
   */
  apiType?: 'chat' | 'responses'
  /** Gateway base including the `/v1` prefix. */
  baseURL: string
  /** Advisory models catalog. */
  models?: NewApiCatalogModel[]
  /** Model exclusion patterns (replaces defaults). */
  modelExcludePatterns?: string[]
  /** Positive context capacity used when the selected model has no exact value (default 128,000). */
  defaultContextWindow?: number
  /** Default per-request output cap; omission sends no cap. */
  maxTokens?: number
  /** Maximum gateway idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs?: number
  /** Forward proxy for the models.dev catalog download. */
  proxy?: ProxyConfig
  /** Match-shaping hints for the models.dev params lookup. */
  providerHints?: ProviderHints
  /** Provider-owned model-request retry policy. */
  retryPolicy?: RetryPolicyConfig
}

/** Plugin config, doubling as the `llm-newapi` settings-section shape. */
export interface Config {
  /** Group list. When absent, legacy flat fields are used as a single group. */
  groups?: GroupConfig[]
  // Legacy flat fields, accepted when `groups` is absent:
  baseURL?: string
  models?: NewApiCatalogModel[]
  modelExcludePatterns?: string[]
  defaultContextWindow?: number
  maxTokens?: number
  streamIdleTimeoutMs?: number
  proxy?: ProxyConfig
  providerHints?: ProviderHints
  retryPolicy?: RetryPolicyConfig
}

/** Forward-proxy settings for the models.dev catalog download. */
export interface ProxyConfig {
  enabled?: boolean
  url?: string
}

const catalogModel: z<NewApiCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  reasoningEfforts: z.array(z.string()),
  defaultReasoningEffort: z.string(),
  vision: z.boolean(),
})

/** Default forward proxy: the conventional Clash port on loopback. */
export const DEFAULT_PROXY_URL = 'http://127.0.0.1:7890'

const proxySchema: z<ProxyConfig> = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(DEFAULT_PROXY_URL),
})

const groupSchema: z<GroupConfig> = z.object({
  id: z.string().required(),
  name: z.string(),
  apiType: z.union(['chat', 'responses']),
  // Optional: the UI may save a group before the user typed a base URL, and
  // resolveGroupOptions falls back to the DEFAULT_BASE_URL placeholder then.
  baseURL: z.string(),
  models: z.array(catalogModel).default([]),
  modelExcludePatterns: z.array(z.string()).default([...DEFAULT_MODEL_EXCLUDE_PATTERNS]),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  proxy: proxySchema.default({ enabled: false, url: DEFAULT_PROXY_URL }),
  providerHints: z.object({
    defaults: z.object({}),
    models: z.object({}),
  }),
  retryPolicy: RetryPolicySchema,
})

export const Config: z<Config> = z.object({
  groups: z.array(groupSchema).default([]),
  // Legacy flat fields: accepted when groups is absent.
  baseURL: z.string(),
  models: z.array(catalogModel).default([]),
  modelExcludePatterns: z.array(z.string()).default([...DEFAULT_MODEL_EXCLUDE_PATTERNS]),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  proxy: proxySchema.default({ enabled: false, url: DEFAULT_PROXY_URL }),
  providerHints: z.object({
    defaults: z.object({}),
    models: z.object({}),
  }),
  retryPolicy: RetryPolicySchema,
})

export type ResolvedNewApiOptions = NewApiConnectionOptions

// ─── Model resolution ──────────────────────────────────────────────────────

/** Resolve, validate, and detach the advisory model catalog. */
function resolveModels(models: readonly NewApiCatalogModel[] | undefined): NewApiCatalogModel[] {
  const seen = new Set<string>()
  return (models ?? []).map((model) => {
    if (model.id.length === 0) throw new Error(`${PKG}: catalog model ids must be non-empty`)
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`${PKG}: catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow !== undefined
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" contextWindow must be a positive integer`,
      )
    }
    if (model.maxTokens !== undefined
      && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" maxTokens must be a positive integer`,
      )
    }
    if (seen.has(model.id)) throw new Error(`${PKG}: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    for (const effort of model.reasoningEfforts ?? []) {
      if (effort.length === 0) throw new Error(`${PKG}: catalog model "${model.id}" has an empty reasoning effort`)
    }
    if (model.defaultReasoningEffort !== undefined
      && !(model.reasoningEfforts ?? []).includes(model.defaultReasoningEffort)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" default reasoning effort "${model.defaultReasoningEffort}" is not among its reasoning efforts`,
      )
    }
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      ...model.reasoningEfforts === undefined || model.reasoningEfforts.length === 0 ? {} : { reasoningEfforts: model.reasoningEfforts },
      ...model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: model.defaultReasoningEffort },
      ...model.vision === true ? { vision: true } : {},
    }
  })
}

// ─── Group resolution ──────────────────────────────────────────────────────

/** Derive the group list from the resolved config, with legacy fallback. */
function expandGroups(config: Config, environment?: ReturnType<typeof launchEnvironmentOf>): GroupConfig[] {
  // An explicit non-empty groups array is authoritative. (The schema defaults
  // groups to [], so "empty array" here is indistinguishable from absent.)
  if (config.groups !== undefined && config.groups.length > 0) return config.groups
  // Legacy flat fields: synthesize one group.
  const named = config.baseURL !== undefined && config.baseURL.trim().length > 0
    ? config.baseURL
    : environment?.get(BASE_URL_ENV)?.value
  return [{
    id: 'newapi',
    name: 'NewAPI',
    baseURL: named !== undefined && named.trim().length > 0 ? named : DEFAULT_BASE_URL,
    ...config.models === undefined ? {} : { models: config.models },
    ...config.modelExcludePatterns === undefined ? {} : { modelExcludePatterns: config.modelExcludePatterns },
    ...config.defaultContextWindow === undefined ? {} : { defaultContextWindow: config.defaultContextWindow },
    ...config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens },
    ...config.streamIdleTimeoutMs === undefined ? {} : { streamIdleTimeoutMs: config.streamIdleTimeoutMs },
    ...config.proxy === undefined ? {} : { proxy: config.proxy },
    ...config.providerHints === undefined ? {} : { providerHints: config.providerHints },
    ...config.retryPolicy === undefined ? {} : { retryPolicy: config.retryPolicy },
  }]
}

/** Validate a proxy URL (only when enabled). */
function validateProxyUrl(proxyUrlRaw: string, pkg: string): void {
  try { new URL(proxyUrlRaw) } catch {
    throw new Error(`${pkg}: proxy.url must be an absolute URL (got: ${proxyUrlRaw})`)
  }
  if (!/^https?:$/.test(new URL(proxyUrlRaw).protocol)) {
    throw new Error(`${pkg}: proxy.url must be an http(s) URL (got: ${proxyUrlRaw})`)
  }
}

/**
 * Resolve one group's raw config into validated connection facts.
 * @param group - the raw group config.
 * @param environment - launch environment layers, or `undefined` outside CLI.
 * @returns validated connection facts for this group.
 */
export function resolveGroupOptions(
  group: GroupConfig,
  environment?: ReturnType<typeof launchEnvironmentOf>,
): NewApiConnectionOptions {
  const route = groupRoute(group.id)
  const rawBase = group.baseURL.trim().length > 0 ? group.baseURL : DEFAULT_BASE_URL
  const modelExcludePatterns = group.modelExcludePatterns ?? [...DEFAULT_MODEL_EXCLUDE_PATTERNS]
  for (const pattern of modelExcludePatterns) {
    if (pattern.length === 0) throw new Error(`${PKG}: modelExcludePatterns entries must be non-empty`)
  }
  if (group.defaultContextWindow !== undefined
    && (!Number.isInteger(group.defaultContextWindow) || group.defaultContextWindow <= 0)) {
    throw new Error(`${PKG}: defaultContextWindow must be a positive integer`)
  }
  if (group.maxTokens !== undefined
    && (!Number.isSafeInteger(group.maxTokens) || group.maxTokens <= 0)) {
    throw new Error(`${PKG}: maxTokens must be a positive safe integer`)
  }
  const streamIdleTimeoutMs = group.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `${PKG}: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  const defaultContextWindow = group.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
  const proxyEnabled = group.proxy?.enabled === true
  const proxyUrlRaw = group.proxy?.url ?? DEFAULT_PROXY_URL
  if (proxyEnabled) validateProxyUrl(proxyUrlRaw, PKG)
  return {
    provider: route,
    displayName: group.name ?? group.id,
    apiType: group.apiType === 'responses' ? 'responses' : 'chat',
    baseURL: normalizeBaseUrl(rawBase),
    apiKeyRef: groupCredRef(group.id),
    models: resolveModels(group.models),
    modelExcludePatterns,
    defaultContextWindow,
    streamIdleTimeoutMs,
    ...proxyEnabled ? { proxyUrl: proxyUrlRaw } : {},
    providerHints: {
      defaults: { ...group.providerHints?.defaults },
      models: { ...group.providerHints?.models },
    },
    retryPolicy: resolveRetryPolicy(group.retryPolicy, `${PKG}: retryPolicy`),
    ...group.maxTokens === undefined ? {} : { maxTokens: group.maxTokens },
  }
}

/**
 * Legacy single-group resolver: returns the first group's connection facts.
 * @param config - raw plugin config or resolved settings snapshot.
 * @param environment - launch environment layers.
 * @returns validated connection facts for the first group.
 */
export function resolveAdapterOptions(config: Config, environment?: ReturnType<typeof launchEnvironmentOf>): NewApiConnectionOptions {
  const groups = expandGroups(config, environment)
  const first = groups[0]
  if (first === undefined) throw new Error(`${PKG}: at least one gateway group is required`)
  return resolveGroupOptions(first, environment)
}

// ─── Plugin apply ──────────────────────────────────────────────────────────

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  // Cached group resolutions: route → options.
  let lastConfig: Config | undefined
  let lastGroups: NewApiConnectionOptions[] | undefined
  let lastDefaultProvider: string | undefined

  /** Re-derive groups from the current config. */
  function resolveGroups(): NewApiConnectionOptions[] {
    const raw = current()
    if (raw === lastConfig && lastGroups !== undefined) return lastGroups
    try {
      const groups = expandGroups(raw, launchEnvironmentOf(ctx))
      const resolved = groups.map(g => resolveGroupOptions(g, launchEnvironmentOf(ctx)))
      lastConfig = raw
      lastGroups = resolved
      const first = resolved[0]
      lastDefaultProvider = first === undefined ? 'newapi' : first.provider
      return resolved
    } catch (error) {
      if (lastGroups === undefined) throw error
      lastConfig = raw
      ctx.logger.error(`${PKG}: keeping the last good configuration after an invalid settings section`)
      ctx.logger.error(error)
      return lastGroups
    }
  }

  /** Resolve connection facts for one provider route. */
  const options = (provider: string): NewApiConnectionOptions => {
    const groups = resolveGroups()
    const hit = groups.find(g => g.provider === provider)
    if (hit !== undefined) return hit
    // Fallback for backward compat: first group.
    const fallback = groups[0]
    if (fallback === undefined) {
      throw new Error(`${PKG}: no gateway group is configured; add one on the NewAPI settings page`)
    }
    return fallback
  }

  /** Default provider route (first group). */
  const defaultProvider = (): string => {
    resolveGroups()
    return lastDefaultProvider ?? 'newapi'
  }

  const resolveApiKey = async (connection: NewApiConnectionOptions): Promise<string> => {
    const ref = connection.apiKeyRef
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, PKG, ref)
    }
    throw new LlmError(
      `${PKG}: no API key for provider route "${connection.provider}"; configure it on the NewAPI`
        + ` settings page in dsh web (credentials reference "${ref}")`,
      'MISSING_CREDENTIAL',
    )
  }

  // Official-vendor index for the models.dev params panel: model id → the
  // provider route that serves it officially, read from every OTHER route.
  let indexCache: { routes: string; byModel: Map<string, string> } | undefined
  const officialProviderOf = async (modelId: string): Promise<string | undefined> => {
    const routes = ctx.llm.listProviders().map(provider => provider.id).sort().join(',')
    if (indexCache === undefined || indexCache.routes !== routes) {
      const byModel = new Map<string, string>()
      for (const provider of ctx.llm.listProviders()) {
        // Skip our own routes — they are relays, not catalogs.
        const groups = resolveGroups()
        if (groups.some(g => g.provider === provider.id)) continue
        try {
          for (const model of await ctx.llm.listModels(provider.id)) {
            byModel.set(model.id, provider.id)
          }
        } catch {
          // An unlistable route contributes nothing; other routes still can.
        }
      }
      indexCache = { routes, byModel }
    }
    return indexCache.byModel.get(modelId)
  }

  const adapter = new NewApiAdapter({
    options,
    defaultProvider,
    resolveApiKey,
    officialProviderOf,
    // Resolve image bytes from the attachment store lazily: the service may
    // mount after this plugin, so read it per request. Absent service (or a
    // vision row with no resolver) keeps the text-only wire.
    resolveImage: (ref, signal) => {
      const store = ctx.get('attachments') as { readImage: (r: ImageAttachmentRef, s?: AbortSignal) => Promise<StoredImageAttachment> } | undefined
      if (store?.readImage === undefined) {
        throw new LlmError('The NewAPI chat-completions adapter has no image resolver available.', 'UNSUPPORTED_CONTENT')
      }
      return store.readImage(ref, signal)
    },
  })

  // ─── Configurable provider directory ──────────────────────────────────────

  // Register the initial (non-empty) group set; later replaces stay atomic.
  // An empty initial registration is illegal, but expandGroups always yields
  // at least the legacy fallback group at mount.
  const initial = resolveGroups()
  const entriesInitial: LlmConfigurableProvider[] = initial.map(g => ({
    provider: g.provider,
    displayName: g.displayName,
    settingsNs: NS,
    settingsPath: settingsPathOf(current(), g.provider),
    declared: true,
  }))
  const directory = ctx.llm.registerConfigurableProviders(entriesInitial)
  const registration = ctx.llm.registerAdapter(initial.map(g => g.provider), adapter)

  function syncProviders(): void {
    const groups = resolveGroups()
    const entries: LlmConfigurableProvider[] = groups.map(g => ({
      provider: g.provider,
      displayName: g.displayName,
      settingsNs: NS,
      settingsPath: settingsPathOf(current(), g.provider),
      declared: true,
    }))
    // An empty array is legal for replace, unlike an empty initial
    // registration: clearing all groups is a valid live state.
    directory.replace(entries)
    registration.replace(groups.map(g => g.provider))
  }

  // Model discovery: interrogate the gateway's /models with the draft endpoint.
  ctx.llm.registerModelDiscovery(NS, (request, signal) => adapter.discoverModels(request, signal))

  // RPC channel for models-dev-params.
  ctx.inject(['connection'], (cctx) => {
    const connection = cctx.get('connection') as HostConnectionHandle
    cctx.effect(() => connection.rpc.handle(
      '/llm-newapi',
      (endpoint: string, payload: unknown, signal: AbortSignal) => {
        if (endpoint !== 'models-dev-params') {
          return Promise.resolve({
            ok: false as const,
            error: { code: 'internal' as const, message: `llm-newapi: unknown endpoint ${endpoint}`, details: {} },
          })
        }
        const request = payload as ModelsDevParamsRequest
        return adapter.fetchModelsDevParams(request, signal)
          .then(value => ({ ok: true as const, value }))
          .catch((error: unknown) => ({
            ok: false as const,
            error: {
              code: 'internal' as const,
              message: error instanceof Error ? error.message : String(error),
              details: {},
            },
          }))
      },
    ), 'llm-newapi: models-dev RPC channel')
  })

  // Initial sync + settings section.
  syncProviders()

  // The settings section installs once the settings service mounts: the
  // section lives on the user-settings seam (SettingsProvider.installSection,
  // 0.1.2) instead of the removed installSettingsSection helper. The owner
  // context is this plugin's own ctx — separate lifecycle from the settings
  // service context.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      validate: (value) => {
        const groups = expandGroups(value, launchEnvironmentOf(ctx))
        for (const g of groups) resolveGroupOptions(g, launchEnvironmentOf(ctx))
      },
      setSource: (source) => {
        current = source
      },
      onChange: syncProviders,
    })
  })
}