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

import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type {
  ResponsesContentPart,
  ResponsesInputItem,
  ResponsesRequest,
  ResponsesTool,
  WireContentPart,
  WireMessage,
  WireRequest,
  WireTool,
} from './types.ts'

/** Join the text blocks of a message (used for user/tool-result content). */
function flattenText(blocks: ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** OpenAI content part for one resolved image block. */
function imagePart(block: Extract<ContentBlock, { type: 'image' }>, dataUrl: string): WireContentPart {
  return {
    type: 'image_url',
    image_url: { url: dataUrl },
  }
}

/**
 * Reject core image content when the caller supplied no image data: the
 * text-only wire route cannot carry it. The harness projects images to text
 * placeholders for text-only models before this point, so this only fires for
 * a vision model whose resolver is missing.
 */
function assertTextOnly(blocks: readonly ContentBlock[]): void {
  if (contentHasImage(blocks)) {
    throw new LlmError('The NewAPI chat-completions adapter does not support image content.', 'UNSUPPORTED_CONTENT')
  }
}

/** Serialize one assistant message (text + reasoning + tool calls). */
function serializeAssistant(message: Message): WireMessage {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))

  return {
    role: 'assistant',
    // Text-less turns send "" — NEVER null. Pure tool-call turns: some
    // gateways reject null outright. Reasoning-ONLY turns (the model can
    // answer entirely in the reasoning channel): the wire API rejects
    // null-content/no-tool_calls assistant messages with a 400, and since
    // the message sits durably in the session log, a null here bricks every
    // later turn of that session.
    content: text,
    // DeepSeek-family upstream passback rule: reasoning_content must return
    // on tool-call turns; it is ignored on plain turns, so we drop it there
    // to save tokens.
    ...toolCalls.length > 0 && reasoning.length > 0 ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/**
 * One user message's wire content: a plain string when text-only, or an array
 * of OpenAI content parts (text + image_url) when images were resolved.
 * @param message - the user-role message.
 * @param images - resolved attachmentId → data URL, or `undefined` text-only.
 * @returns the wire content value.
 */
function serializeUserContent(message: Message, images?: ReadonlyMap<string, string>): string | WireContentPart[] {
  if (images !== undefined && contentHasImage(message.content)) {
    const parts: WireContentPart[] = []
    for (const block of message.content) {
      if (block.type === 'text') parts.push({ type: 'text', text: block.text })
      if (block.type === 'image') {
        const dataUrl = images.get(block.attachment.attachmentId)
        if (dataUrl !== undefined) parts.push(imagePart(block, dataUrl))
      }
    }
    return parts
  }
  assertTextOnly(message.content)
  return flattenText(message.content)
}

/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages; the harness puts each tool result in its own
 * user-role message, so a mixed user message contributes its text first and
 * its tool results as separate wire messages after.
 * @param messages - the harness conversation, in order.
 * @param images - resolved attachmentId → data URL (vision models only).
 * @returns the wire messages; order preserved, each tool result expanded into its own entry.
 */
export function serializeMessages(messages: Message[], images?: ReadonlyMap<string, string>): WireMessage[] {
  const wire: WireMessage[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      assertTextOnly(message.content)
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      assertTextOnly(message.content)
      wire.push(serializeAssistant(message))
      continue
    }
    // user role: tool results ride in user messages in the harness
    // vocabulary, but the gateway wants them as role:'tool' messages.
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const content = serializeUserContent(message, images)
    const text = typeof content === 'string' ? content : flattenText(message.content)
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({ role: 'user', content })
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        // Empty tool output still needs SOME content on the wire.
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

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
export function serializeRequest(options: GenerateOptions, images?: ReadonlyMap<string, string>): WireRequest {
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...serializeMessages(options.messages, images))

  const tools: WireTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.reasoningEffort !== undefined ? { reasoning_effort: options.reasoningEffort } : {},
    ...options.stop !== undefined ? { stop: options.stop } : {},
  }
}

// ─── Responses API serialization ──────────────────────────────────────────

/** Map chat wire content parts to Responses-API input parts. */
function toResponsesContent(parts: WireContentPart[]): ResponsesContentPart[] {
  return parts.map(part => {
    if (part.type === 'image_url') {
      return { type: 'input_image', image_url: part.image_url?.url ?? '' }
    }
    return { type: 'input_text', text: part.text ?? '' }
  })
}

/**
 * Build the wire request for the Responses API endpoint. The RPC shape maps
 * harness concepts to the `input` array (role messages + function_call /
 * function_call_output items), with `instructions` for the system prompt and
 * `max_output_tokens` / `reasoning.effort` in place of chat-completions
 * spellings. Assistant content-less turns (reasoning-only) are omitted — the
 * wire has no reasoning passback field.
 */
export function serializeResponsesRequest(
  options: GenerateOptions,
  images?: ReadonlyMap<string, string>,
): ResponsesRequest {
  const input: ResponsesInputItem[] = []

  for (const message of options.messages) {
    if (message.role === 'system') {
      assertTextOnly(message.content)
      input.push({ role: 'system', content: flattenText(message.content) })
      continue
    }

    if (message.role === 'assistant') {
      const text = flattenText(message.content)
      const reasoning = message.content
        .filter(block => block.type === 'reasoning')
        .map(block => block.text)
        .join('')
      const toolCalls = message.content
        .filter(block => block.type === 'tool-call')
        .map(block => ({
          type: 'function_call' as const,
          call_id: block.id,
          name: block.name,
          arguments: block.arguments,
        }))
      // Emit visible-text assistant message, then function-call items.
      // Omit content-less turns (reasoning-only has no wire representation).
      if (text.length > 0) input.push({ role: 'assistant', content: text })
      for (const call of toolCalls) input.push(call)
      continue
    }

    // user-role messages: text + optional images + tool results.
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const content = serializeUserContent(message, images)
    const text = typeof content === 'string' ? content : flattenText(message.content)
    const parts = Array.isArray(content) ? toResponsesContent(content) : undefined
    if (text.length > 0 || (parts !== undefined && parts.length > 0)) {
      input.push({
        role: 'user',
        content: parts !== undefined && parts.some(p => p.type === 'input_image') ? parts : text,
      })
    }
    for (const result of toolResults) {
      input.push({
        type: 'function_call_output',
        call_id: result.toolCallId,
        output: flattenText(result.content) || '(no output)',
      })
    }
  }

  const tools: ResponsesTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))

  return {
    model: options.model,
    input,
    stream: true,
    stream_options: { include_usage: true },
    ...options.system !== undefined && options.system.length > 0 ? { instructions: options.system } : {},
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_output_tokens: options.maxTokens },
    ...options.reasoningEffort !== undefined ? { reasoning: { effort: options.reasoningEffort } } : {},
  }
}
