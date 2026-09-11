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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import type { NewApiCatalogModel, NewApiConnectionOptions, NewApiMode } from './adapter.js';
import type { ProviderHints } from './types.js';
export { DEFAULT_CONTEXT_WINDOW, DEFAULT_MODEL_EXCLUDE_PATTERNS, DEFAULT_PROVIDER_HINTS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, matchModelsDev, modelNameFromId, NewApiAdapter, normalizeBaseUrl, PKG, } from './adapter.js';
export { serializeRequest } from './serialize.js';
export { serializeResponsesRequest } from './serialize.js';
export type { NewApiAdapterOptions, NewApiCatalogModel, NewApiConnectionOptions, NewApiMode, OfficialAdapterDelegate, } from './adapter.js';
export type * from './types.js';
export declare const name = "llm-newapi";
export declare const inject: string[];
/** Placeholder gateway base used when neither config nor environment names one. */
export declare const DEFAULT_BASE_URL = "https://newapi.example.com/v1";
/** Default DeepSeek official API base for official-direct groups (no `/v1`). */
export declare const DEFAULT_OFFICIAL_BASE_URL = "https://api.deepseek.com";
/** One gateway group. */
export interface GroupConfig {
    /** Unique id; used to derive the provider route and credential ref. */
    id: string;
    /** Human-readable name for selectors. */
    name?: string;
    /**
     * Wire protocol: `chat` (default) serves `POST {baseURL}/chat/completions`;
     * `responses` serves the OpenAI Responses API (`POST {baseURL}/responses`,
     * for agents / multi-step output / tool calling).
     */
    apiType?: 'chat' | 'responses';
    /**
     * Wire mode: `newapi` (default) relays through the gateway;
     * `official-direct` delegates to the official DeepSeek adapter — requests
     * go to {@link officialBaseURL} with the key stored under
     * {@link officialApiKeyRef}, with full reasoning-block, `reasoning_effort`,
     * and tool-call support straight from the official wire format.
     */
    mode?: NewApiMode;
    /**
     * DeepSeek official API base used in official-direct mode; default
     * `https://api.deepseek.com` (no `/v1` requirement).
     */
    officialBaseURL?: string;
    /**
     * Credential reference for the official API key in official-direct mode;
     * defaults to the group's derived `deepseek_official_<id>` ref. Must match
     * `/^[A-Za-z_][A-Za-z0-9_]*$/` (no hyphens).
     */
    officialApiKeyRef?: string;
    /** Gateway base including the `/v1` prefix; may be a blank draft before the URL is typed (placeholder then). */
    baseURL?: string;
    /** Advisory models catalog. */
    models?: NewApiCatalogModel[];
    /** Model exclusion patterns (replaces defaults). */
    modelExcludePatterns?: string[];
    /** Positive context capacity used when the selected model has no exact value (default 128,000). */
    defaultContextWindow?: number;
    /** Default per-request output cap; omission sends no cap. */
    maxTokens?: number;
    /** Maximum gateway idle time while one stream read is outstanding (default five minutes). */
    streamIdleTimeoutMs?: number;
    /** Forward proxy for the models.dev catalog download. */
    proxy?: ProxyConfig;
    /** Match-shaping hints for the models.dev params lookup. */
    providerHints?: ProviderHints;
    /** Provider-owned model-request retry policy. */
    retryPolicy?: RetryPolicyConfig;
}
/** Plugin config, doubling as the `llm-newapi` settings-section shape. */
export interface Config {
    /** Group list. When absent, legacy flat fields are used as a single group. */
    groups?: GroupConfig[];
    mode?: NewApiMode;
    officialBaseURL?: string;
    officialApiKeyRef?: string;
    baseURL?: string;
    models?: NewApiCatalogModel[];
    modelExcludePatterns?: string[];
    defaultContextWindow?: number;
    maxTokens?: number;
    streamIdleTimeoutMs?: number;
    proxy?: ProxyConfig;
    providerHints?: ProviderHints;
    retryPolicy?: RetryPolicyConfig;
}
/** Forward-proxy settings for the models.dev catalog download. */
export interface ProxyConfig {
    enabled?: boolean;
    url?: string;
}
/** Default forward proxy: the conventional Clash port on loopback. */
export declare const DEFAULT_PROXY_URL = "http://127.0.0.1:7890";
export declare const Config: z<Config>;
export type ResolvedNewApiOptions = NewApiConnectionOptions;
/**
 * Resolve one group's raw config into validated connection facts.
 * @param group - the raw group config.
 * @param environment - launch environment layers, or `undefined` outside CLI.
 * @returns validated connection facts for this group.
 */
export declare function resolveGroupOptions(group: GroupConfig, environment?: ReturnType<typeof launchEnvironmentOf>): NewApiConnectionOptions;
/**
 * Legacy single-group resolver: returns the first group's connection facts.
 * @param config - raw plugin config or resolved settings snapshot.
 * @param environment - launch environment layers.
 * @returns validated connection facts for the first group.
 */
export declare function resolveAdapterOptions(config: Config, environment?: ReturnType<typeof launchEnvironmentOf>): NewApiConnectionOptions;
export declare function apply(ctx: Context, config: Config): void;
