/**
 * Decode an SSE byte stream into event `data` payloads. Framing — chunk
 * reassembly, UTF-8/CRLF/BOM handling, comment and non-data field skipping,
 * multi-`data:` joining — is `eventsource-parser`'s. Comments are reported
 * only through an optional transport-activity callback. This module keeps
 * the gateway protocol: the literal `[DONE]` is yielded so the caller owns
 * final flushing, and EOF before it raises {@link LlmError}. Framing is
 * spec-strict: an event dispatches only on its blank-line terminator, so an
 * unterminated tail at EOF is truncation, not a flushable payload.
 *
 * @module dsh-llm-newapi/sse
 */
/** The terminal payload the gateway (and OpenAI) sends after the last chunk. */
export declare const DONE = "[DONE]";
/**
 * Parse an SSE byte stream into data payloads. Chat completions yields the
 * `[DONE]` sentinel as the final value and returns; Responses-API streams have
 * no sentinel, so the caller passes `requireDone: false` and owns termination
 * through its own terminal events. With the sentinel required, EOF before it
 * throws `LlmError('STREAM_CLOSED')` (truncated response — the model call
 * cannot be trusted).
 * @param stream - raw SSE bytes; reads may split anywhere, including mid-UTF-8 sequence.
 * @param onComment - optional transport-activity callback; comments never enter the yielded payload stream.
 * @param requireDone - require the `[DONE]` sentinel before EOF (default true).
 * @returns each event's data payload in arrival order, the `[DONE]` sentinel last when required.
 */
export declare function parseSse(stream: ReadableStream<BufferSource>, onComment?: (comment: string) => void, requireDone?: boolean): AsyncGenerator<string>;
