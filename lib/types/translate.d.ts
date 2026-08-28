/**
 * Translate gateway SSE payloads with one stateful harness block per content,
 * reasoning, or tool-call index. An empty initial reasoning delta does not
 * open a block. Finish reason and the latest usage are deferred until
 * `[DONE]`, covering both finish-attached and trailing usage-only shapes
 * while ensuring no chunk follows `finish`.
 *
 * @module dsh-llm-newapi/translate
 */
import type { FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm';
import type { ResponsesUsage, WireUsage } from './types.js';
/**
 * Map the wire finish_reason vocabulary to the harness FinishReason.
 * @param reason - the wire `finish_reason` string.
 * @returns the mapped reason; unrecognized values (content_filter, …) become `{kind: 'error'}` with the uppercased value as `code`.
 */
export declare function mapFinishReason(reason: string): FinishReason;
/**
 * Map wire usage fields. `prompt_tokens` INCLUDES cache hits; the harness
 * TokenUsage convention is DISJOINT counts, so cache reads are subtracted
 * out of `inputTokens`.
 * @param usage - wire usage from the finish chunk or the trailing usage-only chunk.
 * @returns disjoint harness counts; cache/reasoning fields present only when the wire reported them.
 */
export declare function mapUsage(usage: WireUsage): TokenUsage;
/**
 * Consume SSE data payloads (ending with `[DONE]`) and yield StreamChunks.
 * Malformed JSON payloads abort the stream with `MALFORMED_RESPONSE`.
 * @param payloads - SSE data payloads from {@link parseSse}, `[DONE]`-terminated.
 * @returns deltas as they arrive; `block-end`s, `usage`, and `finish` are all deferred to the `[DONE]` sentinel.
 *   A `stop` (or absent) finish with no opened blocks is a degenerate provider completion and maps to an
 *   `EMPTY_RESPONSE` error finish instead of a successful empty message.
 */
export declare function translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk>;
/**
 * Map Responses-API usage to harness TokenUsage. `input_tokens` includes
 * cache hits; the harness convention is disjoint counts, so cache reads are
 * subtracted out.
 * @param usage - usage from the terminal `response.completed` event.
 * @returns disjoint harness counts; cache/reasoning fields present only when the wire reported them.
 */
export declare function mapResponsesUsage(usage: ResponsesUsage): TokenUsage;
/**
 * Translate Responses-API SSE payloads into the same StreamChunk contract as
 * the chat path. One stateful block per streamed output slot: text from
 * `response.output_text.delta`, tool calls opened by `response.output_item
 * .added` (function_call) and filled by `response.function_call_arguments
 * .delta`. The stream is terminated by the terminal events
 * `response.completed` / `response.incomplete` / `response.failed` (and the
 * `[DONE]` sentinel, when a gateway appends one) — flush blocks, then the
 * finish/usage. An in-band `error` event throws.
 * @param payloads - SSE data payloads from {@link parseSse} (no `[DONE]` requirement).
 * @returns deltas as they arrive; `block-end`s, `usage`, and `finish` flush on the terminal event.
 */
export declare function translateResponses(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk>;
