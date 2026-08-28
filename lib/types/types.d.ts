/**
 * NewAPI (OpenAI-compatible gateway) chat-completions wire format. Types only.
 *
 * NewAPI 聚合任意上游模型并统一暴露 OpenAI 协议；本文件即该协议的请求/
 * 响应/流增量形状，不含 DeepSeek 专属字段（thinking / reasoning_effort）。
 *
 * @module dsh-llm-newapi/types
 */
/** Request body for `POST {baseURL}/chat/completions`. */
export interface WireRequest {
    model: string;
    messages: WireMessage[];
    stream: true;
    stream_options: {
        include_usage: true;
    };
    tools?: WireTool[];
    temperature?: number;
    max_tokens?: number;
    /**
     * Stop sequences (OpenAI `stop`): generation halts as soon as the model
     * produces any one of these strings. Mapped from `GenerateOptions.stop`.
     */
    stop?: string[];
}
/** System-role message: a single string of instructions. */
export interface WireSystemMessage {
    role: 'system';
    content: string;
}
/** One content part of a multimodal user message. */
export interface WireContentPart {
    type: 'text' | 'image_url';
    /** `type: 'text'` carries the text. */
    text?: string;
    /** `type: 'image_url'` carries the data URL. */
    image_url?: {
        url: string;
    };
}
/** User-role message: a single string, or OpenAI content parts when images ride. */
export interface WireUserMessage {
    role: 'user';
    content: string | WireContentPart[];
}
/** Tool-role message: the result of one tool call, keyed by its call id. */
export interface WireToolMessage {
    role: 'tool';
    tool_call_id: string;
    content: string;
}
/** One entry of the request `messages` array, discriminated on `role`. */
export type WireMessage = WireSystemMessage | WireUserMessage | WireAssistantMessage | WireToolMessage;
/**
 * Assistant-role history message. The harness always replays a string
 * `content` — `""` on tool-call-only and reasoning-only turns — because some
 * gateways reject null outright and the live API rejects null-content/
 * no-tool_calls assistant messages with a 400.
 */
export interface WireAssistantMessage {
    role: 'assistant';
    content: string;
    /**
     * CoT passback for DeepSeek-family upstreams routed through the gateway:
     * REQUIRED on assistant turns that carried tool calls, ignored elsewhere
     * (omitted there to save tokens). Other OpenAI-compatible upstreams ignore
     * the unknown field.
     */
    reasoning_content?: string;
    tool_calls?: WireToolCall[];
}
/** A completed tool call replayed on an assistant history message; `arguments` is the raw JSON string. */
export interface WireToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}
/** One entry of the request `tools` array; `parameters` is a JSON Schema object. */
export interface WireTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}
/** One parsed SSE `data:` payload (a chat.completion.chunk). */
export interface WireChunk {
    choices?: WireChoice[];
    /** Arrives attached to the finish chunk and/or as a trailing usage-only chunk. */
    usage?: WireUsage | null;
}
/** One streamed choice (requests always ask for a single one); `finish_reason` is non-null only on its terminal chunk. */
export interface WireChoice {
    delta?: WireDelta;
    finish_reason?: string | null;
}
/** The incremental content of one streamed choice; any subset of fields may be present per chunk. */
export interface WireDelta {
    role?: string;
    /** Visible text. Null/empty on reasoning/tool-call chunks. */
    content?: string | null;
    /**
     * Thinking CoT, transparently passed through by the gateway for
     * reasoning-capable upstreams (DeepSeek R1 family, etc.). The FIRST chunk
     * may carry an empty string (must not open a reasoning block); absent
     * entirely when the upstream model does not reason.
     */
    reasoning_content?: string | null;
    tool_calls?: WireToolCallDelta[];
}
/** A streamed fragment of one tool call; fragments sharing an `index` concatenate into one call. */
export interface WireToolCallDelta {
    /** Disambiguates parallel tool calls; stable across a call's deltas. */
    index: number;
    /**
     * Present on the first delta of each call only. Non-conforming gateways
     * repeat it as an EMPTY string on continuation deltas (instead of
     * omitting the field); the translator only accepts non-empty values so
     * the real id from the first delta survives (issue #1).
     */
    id?: string;
    type?: 'function';
    function?: {
        /**
         * Present on the first delta of each call only. Non-conforming gateways
         * repeat it as an EMPTY string on continuation deltas; only non-empty
         * values are accepted so the tool name survives (issue #1).
         */
        name?: string;
        /** Argument JSON fragment (concatenate across deltas). */
        arguments?: string;
    };
}
/**
 * Wire token accounting. `prompt_tokens` INCLUDES cache hits; `mapUsage`
 * subtracts them to keep the harness convention of disjoint counts.
 * `prompt_tokens_details.cached_tokens` is the OpenAI-compat spelling of the
 * hit count (the gateway normalizes upstream variants onto it).
 */
export interface WireUsage {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    prompt_tokens_details?: {
        cached_tokens?: number;
    };
    completion_tokens_details?: {
        reasoning_tokens?: number;
    };
}
/** Non-2xx error body (OpenAI-compatible shape, passed through by the gateway). */
export interface WireError {
    error?: {
        message?: string;
        type?: string;
        code?: string;
    };
}
/** `GET {baseURL}/models` response (OpenAI models.list shape, native NewAPI). */
export interface WireModelList {
    object?: 'list';
    data?: WireModelEntry[];
}
/** One advertised model entry; gateways disclose an id and nothing else. */
export interface WireModelEntry {
    id: string;
    /** Human-readable name when the gateway supplies one. */
    name?: string;
    /** OpenAI `owned_by` field when present. */
    owned_by?: string;
}
/** Request body for `POST {baseURL}/responses`. */
export interface ResponsesRequest {
    model: string;
    input: ResponsesInputItem[];
    stream: true;
    stream_options: {
        include_usage: true;
    };
    tools?: ResponsesTool[];
    instructions?: string;
    temperature?: number;
    /** Output cap; `max_tokens` is a chat-completions spelling. */
    max_output_tokens?: number;
    /** Reasoning control; `reasoning_effort` is a chat-completions spelling. */
    reasoning?: {
        effort: string;
    };
}
/** One `input` entry: a role message, a replayed tool call, or its result. */
export type ResponsesInputItem = {
    role: 'system' | 'developer' | 'user' | 'assistant';
    content: string | ResponsesContentPart[];
} | {
    type: 'function_call';
    call_id: string;
    name: string;
    arguments: string;
} | {
    type: 'function_call_output';
    call_id: string;
    output: string;
};
/** One content part of a role message (text, or a base64 data-URL image). */
export interface ResponsesContentPart {
    type: 'input_text' | 'input_image';
    text?: string;
    /** The image URL; data URLs carry base64 bytes inline. */
    image_url?: string;
}
/** One entry of the `tools` array; `name` lives at the top level (unlike chat). */
export interface ResponsesTool {
    type: 'function';
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}
/** One streamed Responses-API event payload (the `data:` line). */
export interface ResponsesEvent {
    type?: string;
    /** `response.output_item.added` / `.done`: the announced output item. */
    item?: ResponsesOutputItem;
    /** `output_text.delta` / `function_call_arguments.delta`: text fragment. */
    delta?: string;
    /** Which streamed output slot the event targets. */
    output_index?: number;
    /** `response.completed` / `incomplete` / `failed`: terminal state. */
    response?: ResponsesResponse;
    /** `error`: transport-level in-band failure. */
    error?: {
        message?: string;
        code?: string;
    };
}
/** One output item as announced by the stream. */
export interface ResponsesOutputItem {
    type?: string;
    /** `function_call` calls carry both an item `id` and the wire `call_id`. */
    id?: string;
    call_id?: string;
    name?: string;
    /** JSON string; streamed fragment-wise, or whole on `.done`. */
    arguments?: string;
}
/** Terminal response state (attached to `response.completed` etc.). */
export interface ResponsesResponse {
    status?: string;
    error?: {
        message?: string;
        code?: string;
    };
    incomplete_details?: {
        reason?: string;
    };
    usage?: ResponsesUsage;
}
/** Responses-API usage; `input_tokens` includes cache hits (subtract them). */
export interface ResponsesUsage {
    input_tokens: number;
    output_tokens: number;
    input_tokens_details?: {
        cached_tokens?: number;
    };
    output_tokens_details?: {
        reasoning_tokens?: number;
    };
}
/** Root of `https://models.dev/api.json`: one entry per provider id. */
export interface ModelsDevApi {
    [provider: string]: {
        models?: Record<string, ModelsDevModel>;
    };
}
/** Match-shaping hints for the models.dev params lookup. */
export interface ProviderHints {
    /** Family prefix → provider id, consulted before catalog order. */
    defaults?: Record<string, string>;
    /** Exact gateway model id → provider id; wins over {@link defaults}. */
    models?: Record<string, string>;
}
/** One model entry in the models.dev catalog. */
export interface ModelsDevModel {
    name?: string;
    /** Capacity facts: `limit.context` and `limit.output` are token counts. */
    limit?: {
        context?: number;
        output?: number;
    };
    /** How the model takes reasoning control; `effort` carries the levels. */
    reasoning_options?: Array<{
        type: string;
        values?: Array<string | null>;
    }>;
    /** Input/output modalities the model accepts; `image` marks vision models. */
    modalities?: {
        input?: string[];
        output?: string[];
    };
}
/** One models.dev provider match for a gateway model id. */
export interface ModelsDevMatch {
    /** models.dev provider id the entry lives under (e.g. `qwen`, `alibaba`). */
    provider: string;
    /** Human-readable name from the catalog entry, when present. */
    name?: string;
    /** Combined request/response context capacity (`limit.context`). */
    contextWindow?: number;
    /** Per-request output cap (`limit.output`). */
    maxTokens?: number;
    /** Supported reasoning-effort ids (`reasoning_options` type `effort`). */
    reasoningEfforts?: string[];
    /** True when this match's provider is the model's official vendor. */
    official?: boolean;
    /** True when the catalog entry accepts image input (vision model). */
    vision?: boolean;
}
/** Request payload of the `models-dev-params` RPC endpoint. */
export interface ModelsDevParamsRequest {
    /** Provider route whose group owns the hints and proxy fallback. */
    provider?: string;
    /** Gateway model ids to look up, verbatim. */
    modelIds: string[];
    /** Forward-proxy URL to route the api.json download through, when enabled. */
    proxyUrl?: string;
}
/** Response payload of the `models-dev-params` RPC endpoint. */
export interface ModelsDevParamsResponse {
    /** Per requested id: every provider entry that matched it, in catalog order. */
    models: Array<{
        id: string;
        matches: ModelsDevMatch[];
    }>;
}
