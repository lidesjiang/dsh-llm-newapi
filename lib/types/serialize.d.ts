/**
 * Serialize harness messages into gateway chat completions. User text is
 * joined; assistant text becomes `content`, tool calls become `tool_calls`,
 * and tool results become separate tool messages. Assistant reasoning is
 * replayed as `reasoning_content` only on tool-call turns, as required by
 * DeepSeek-family upstreams (other OpenAI-compatible upstreams ignore the
 * field). When the caller supplies resolved image data (a vision catalog
 * row), user messages carry image blocks as OpenAI content parts; otherwise
 * core image blocks are rejected explicitly because the text-only wire route
 * cannot carry them. No reasoning-control fields are emitted unless the
 * catalog declared efforts (then an explicit effort rides as
 * `reasoning_effort`).
 * @module dsh-llm-newapi/serialize
 */
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm';
import type { ResponsesRequest, WireMessage, WireRequest } from './types.js';
/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages; the harness puts each tool result in its own
 * user-role message, so a mixed user message contributes its text first and
 * its tool results as separate wire messages after.
 * @param messages - the harness conversation, in order.
 * @param images - resolved attachmentId → data URL (vision models only).
 * @returns the wire messages; order preserved, each tool result expanded into its own entry.
 */
export declare function serializeMessages(messages: Message[], images?: ReadonlyMap<string, string>): WireMessage[];
/**
 * Build the full wire request. Always streaming (`stream: true`, usage
 * reporting on); optional fields are omitted rather than sent as null, so
 * upstream defaults apply — including `max_tokens`, which this adapter has
 * no default for (heterogeneous upstreams each own their cap). An explicit
 * reasoning effort rides as OpenAI-compatible `reasoning_effort`; it only
 * ever arrives for a row whose catalog declares supported efforts.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param images - resolved attachmentId → data URL (vision models only).
 * @returns the chat-completions request body.
 */
export declare function serializeRequest(options: GenerateOptions, images?: ReadonlyMap<string, string>): WireRequest;
/**
 * Build the wire request for the Responses API endpoint. The RPC shape maps
 * harness concepts to the `input` array (role messages + function_call /
 * function_call_output items), with `instructions` for the system prompt and
 * `max_output_tokens` / `reasoning.effort` in place of chat-completions
 * spellings. Assistant content-less turns (reasoning-only) are omitted — the
 * wire has no reasoning passback field.
 */
export declare function serializeResponsesRequest(options: GenerateOptions, images?: ReadonlyMap<string, string>): ResponsesRequest;
