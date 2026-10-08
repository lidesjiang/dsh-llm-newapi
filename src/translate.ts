/**
 * Translate gateway SSE payloads with one stateful harness block per content,
 * reasoning, or tool-call index. An empty initial reasoning delta does not
 * open a block. Finish reason and the latest usage are deferred until
 * `[DONE]`, covering both finish-attached and trailing usage-only shapes
 * while ensuring no chunk follows `finish`.
 *
 * @module dsh-llm-newapi/translate
 */

import { EMPTY_RESPONSE_CODE, LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { DONE } from './sse.ts'
import type { ResponsesEvent, ResponsesUsage, WireChunk, WireUsage } from './types.ts'

/** One open block under assembly. */
interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  /** tool-call only */
  callId?: string
  name?: string
}

/**
 * Map the wire finish_reason vocabulary to the harness FinishReason.
 * @param reason - the wire `finish_reason` string.
 * @returns the mapped reason; unrecognized values (content_filter, …) become `{kind: 'error'}` with the uppercased value as `code`.
 */
export function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop': return { kind: 'stop' }
    case 'tool_calls': return { kind: 'tool-calls' }
    case 'length': return { kind: 'max-tokens' }
    default:
      // content_filter, insufficient_system_resource, future additions.
      return {
        kind: 'error',
        failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() },
      }
  }
}

/**
 * Map wire usage fields. `prompt_tokens` INCLUDES cache hits; the harness
 * TokenUsage convention is DISJOINT counts, so cache reads are subtracted
 * out of `inputTokens`.
 * @param usage - wire usage from the finish chunk or the trailing usage-only chunk.
 * @returns disjoint harness counts; cache/reasoning fields present only when the wire reported them.
 */
export function mapUsage(usage: WireUsage): TokenUsage {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens,
    ...cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== undefined ? { reasoningTokens: reasoning } : {},
  }
}

/** Assemble the final ContentBlock for one open block. */
function closeBlock(block: OpenBlock): ContentBlock {
  switch (block.kind) {
    case 'text': return { type: 'text', text: block.text }
    case 'reasoning': return { type: 'reasoning', text: block.text }
    case 'tool-call': return {
      type: 'tool-call',
      id: ToolCallId(block.callId ?? ''),
      name: block.name ?? '',
      arguments: block.text,
    }
  }
}

const DSML_PREFIXES = ['<|DSML|', '<｜DSML｜', '</|DSML|', '</｜DSML｜'] as const
const THINK_CLOSE = '</think>'

interface DsmlTag {
  attributes: string
  closing: boolean
  selfClosing: boolean
  name: string
}

function parseDsmlTag(value: string): DsmlTag | undefined {
  const match = /^<(\/?)\s*(?:\||｜)DSML(?:\||｜)([A-Za-z][\w-]*)([^>]*)>$/u.exec(value)
  if (!match) return undefined
  const attributes = match[3] ?? ''
  return {
    closing: match[1] === '/',
    name: match[2]!,
    selfClosing: !match[1] && /\/\s*$/.test(attributes),
    attributes: attributes.replace(/\/\s*$/, ''),
  }
}

function dsmlAttribute(attributes: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'u').exec(attributes)
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

interface DsmlInvocation {
  name: string
  arguments: string
}

type DsmlSegment = { type: 'text'; text: string } | { type: 'tool-call'; invocation: DsmlInvocation }

function parseDsmlArguments(body: string): string | undefined {
  const parameterPattern = /<(?:\||｜)DSML(?:\||｜)parameter\b([^>]*)>([\s\S]*?)<\/(?:\||｜)DSML(?:\||｜)parameter\s*>/gu
  const parameters = [...body.matchAll(parameterPattern)].map(match => ({
    name: dsmlAttribute(match[1] ?? '', 'name'),
    string: dsmlAttribute(match[1] ?? '', 'string') !== 'false',
    value: match[2] ?? '',
  })).filter((parameter): parameter is typeof parameter & { name: string } => Boolean(parameter.name))

  const argumentParameter = parameters.find(parameter => parameter.name === 'arguments')
  if (argumentParameter) {
    const value = argumentParameter.value.trim()
    if (value.length === 0) return '{}'
    if (!argumentParameter.string) {
      try {
        return JSON.stringify(JSON.parse(value))
      } catch {
        return undefined
      }
    }
    try {
      JSON.parse(value)
      return value
    } catch {
      return JSON.stringify(argumentParameter.value)
    }
  }

  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const parameter of parameters) {
    if (parameter.string) {
      values[parameter.name] = parameter.value
      continue
    }
    try {
      values[parameter.name] = JSON.parse(parameter.value.trim()) as unknown
    } catch {
      return undefined
    }
  }
  return JSON.stringify(values) ?? '{}'
}

function parseDsmlInvocations(block: string): DsmlInvocation[] {
  const invocationPattern = /<(?:\||｜)DSML(?:\||｜)invoke\b([^>]*)>([\s\S]*?)<\/(?:\||｜)DSML(?:\||｜)invoke\s*>/gu
  const invocations: DsmlInvocation[] = []
  for (const match of block.matchAll(invocationPattern)) {
    const name = dsmlAttribute(match[1] ?? '', 'name')
    const argumentsText = parseDsmlArguments(match[2] ?? '')
    if (name && argumentsText !== undefined) invocations.push({ name, arguments: argumentsText })
  }
  return invocations
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function toolCallSignature(name: string, argumentsText: string): string {
  try {
    return `${name}\u0000${canonicalJson(JSON.parse(argumentsText) as unknown)}`
  } catch {
    return `${name}\u0000${argumentsText.trim()}`
  }
}

function longestSuffixPrefix(value: string, prefixes: readonly string[]): number {
  let longest = 0
  for (const prefix of prefixes) {
    const maximum = Math.min(value.length, prefix.length)
    for (let length = maximum; length > longest; length--) {
      if (prefix.startsWith(value.slice(-length))) {
        longest = length
        break
      }
    }
  }
  return longest
}

/**
 * Parse DSML tool calls from assistant content while preserving surrounding
 * prose. Possible marker prefixes and complete invocations are buffered across
 * SSE deltas so protocol text is never exposed as ordinary assistant text.
 */
class DsmlContentParser {
  private pending = ''

  push(fragment: string): DsmlSegment[] {
    this.pending += fragment
    const output: DsmlSegment[] = []

    while (this.pending.length > 0) {
      const marker = this.findMarker(this.pending)
      if (!marker) {
        const partialMarker = longestSuffixPrefix(this.pending, DSML_PREFIXES)
        const beforePartialMarker = this.pending.slice(0, this.pending.length - partialMarker)
        const adjacentThink = /\s*<\/think>\s*$/u.exec(beforePartialMarker)
        const hold = Math.max(
          partialMarker + (adjacentThink ? beforePartialMarker.length - adjacentThink.index : 0),
          longestSuffixPrefix(this.pending, [THINK_CLOSE]),
          /\s*<\/think>\s*$/u.exec(this.pending)?.[0].length ?? 0,
        )
        this.pushText(output, this.pending.slice(0, this.pending.length - hold))
        this.pending = hold > 0 ? this.pending.slice(-hold) : ''
        break
      }

      const precedingText = this.pending.slice(0, marker.index).replace(/\s*<\/think>\s*$/u, '')
      this.pushText(output, precedingText)
      this.pending = this.pending.slice(marker.index)

      const extracted = this.extractBlock()
      if (!extracted) break
      this.pending = this.pending.slice(extracted.end)
      for (const invocation of parseDsmlInvocations(extracted.raw)) {
        output.push({ type: 'tool-call', invocation })
      }
    }

    return output
  }

  finish(): DsmlSegment[] {
    // An incomplete DSML call is not executable and must not leak as text.
    if (this.findMarker(this.pending)) {
      this.pending = ''
      return []
    }
    const partialMarker = longestSuffixPrefix(this.pending, DSML_PREFIXES)
    let tail = this.pending.slice(0, this.pending.length - partialMarker)
    if (partialMarker > 0) tail = tail.replace(/\s*<\/think>\s*$/u, '')
    this.pending = ''
    return tail.length > 0 ? [{ type: 'text', text: tail }] : []
  }

  private findMarker(value: string, startIndex = 0): { index: number; prefix: string } | undefined {
    let result: { index: number; prefix: string } | undefined
    for (const prefix of DSML_PREFIXES) {
      const index = value.indexOf(prefix, startIndex)
      if (index >= 0 && (result === undefined || index < result.index)) result = { index, prefix }
    }
    return result
  }

  private extractBlock(): { end: number; raw: string } | undefined {
    const stack: string[] = []
    let cursor = 0
    let sawOpening = false

    while (cursor < this.pending.length) {
      const marker = this.findMarker(this.pending, cursor)
      if (!marker) return undefined
      const tagEnd = this.pending.indexOf('>', marker.index + marker.prefix.length)
      if (tagEnd < 0) return undefined
      const tag = parseDsmlTag(this.pending.slice(marker.index, tagEnd + 1))
      cursor = tagEnd + 1
      if (!tag) continue

      if (tag.closing) {
        const matchIndex = stack.lastIndexOf(tag.name)
        if (matchIndex >= 0) {
          stack.length = matchIndex
          if (stack.length === 0) return { end: tagEnd + 1, raw: this.pending.slice(0, tagEnd + 1) }
        } else if (!sawOpening) {
          return { end: tagEnd + 1, raw: this.pending.slice(0, tagEnd + 1) }
        }
      } else {
        sawOpening = true
        if (tag.selfClosing) {
          if (stack.length === 0) return { end: tagEnd + 1, raw: this.pending.slice(0, tagEnd + 1) }
        } else {
          stack.push(tag.name)
        }
      }
    }

    return undefined
  }

  private pushText(output: DsmlSegment[], text: string): void {
    if (text.length > 0) output.push({ type: 'text', text })
  }
}

/**
 * Consume SSE data payloads (ending with `[DONE]`) and yield StreamChunks.
 * Malformed JSON payloads abort the stream with `MALFORMED_RESPONSE`.
 * @param payloads - SSE data payloads from {@link parseSse}, `[DONE]`-terminated.
 * @returns deltas as they arrive; `block-end`s, `usage`, and `finish` are all deferred to the `[DONE]` sentinel.
 *   A `stop` (or absent) finish with no opened blocks is a degenerate provider completion and maps to an
 *   `EMPTY_RESPONSE` error finish instead of a successful empty message.
 */
export async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textBlock: OpenBlock | undefined
  let reasoningBlock: OpenBlock | undefined
  const toolBlocks = new Map<number, OpenBlock>()
  const order: OpenBlock[] = []
  const dsmlParser = new DsmlContentParser()
  const dsmlCalls: DsmlInvocation[] = []
  let nextDsmlCallId = 0
  let pendingFinish: FinishReason | undefined
  let pendingUsage: TokenUsage | undefined

  function open(kind: OpenBlock['kind']): OpenBlock {
    const block: OpenBlock = { index: nextIndex++, kind, text: '' }
    order.push(block)
    return block
  }

  for await (const payload of payloads) {
    if (payload === DONE) {
      for (const segment of dsmlParser.finish()) {
        if (segment.type === 'text') {
          if (!textBlock) {
            textBlock = open('text')
            yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
          }
          textBlock.text += segment.text
          yield { type: 'text-delta', index: textBlock.index, text: segment.text }
        } else {
          dsmlCalls.push(segment.invocation)
        }
      }

      const structuredCalls = new Set([...toolBlocks.values()]
        .filter(block => block.name !== undefined)
        .map(block => toolCallSignature(block.name!, block.text)))
      let emittedDsmlCalls = 0
      for (const invocation of dsmlCalls) {
        if (structuredCalls.has(toolCallSignature(invocation.name, invocation.arguments))) continue
        const block = open('tool-call')
        block.callId = `dsml-${++nextDsmlCallId}`
        block.name = invocation.name
        block.text = invocation.arguments
        yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: ToolCallId(block.callId),
          name: block.name,
          argumentsDelta: block.text,
        }
        emittedDsmlCalls++
      }

      for (const block of order) {
        yield { type: 'block-end', index: block.index, block: closeBlock(block) }
      }
      if (pendingUsage) yield { type: 'usage', usage: pendingUsage }
      const reason = pendingFinish ?? { kind: 'stop' as const }
      const finalReason = (toolBlocks.size > 0 || emittedDsmlCalls > 0) && reason.kind === 'stop'
        ? { kind: 'tool-calls' as const }
        : reason
      yield {
        type: 'finish',
        reason: finalReason.kind === 'stop' && order.length === 0
          ? {
            kind: 'error',
            failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
          }
          : finalReason,
      }
      return
    }

    let chunk: WireChunk
    try {
      chunk = JSON.parse(payload) as WireChunk
    } catch {
      throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta

      // Reasoning first: reasoning-capable upstreams interleave it before
      // text. The empty-string first chunk must not open a block.
      const reasoning = delta?.reasoning_content
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open('reasoning')
          yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
        }
        reasoningBlock.text += reasoning
        yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning }
      }

      const content = delta?.content
      if (typeof content === 'string' && content.length > 0) {
        for (const segment of dsmlParser.push(content)) {
          if (segment.type === 'text') {
            if (!textBlock) {
              textBlock = open('text')
              yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
            }
            textBlock.text += segment.text
            yield { type: 'text-delta', index: textBlock.index, text: segment.text }
          } else {
            dsmlCalls.push(segment.invocation)
          }
        }
      }

      for (const call of delta?.tool_calls ?? []) {
        let block = toolBlocks.get(call.index)
        if (!block) {
          block = open('tool-call')
          toolBlocks.set(call.index, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        // Non-empty guards: some gateways (glm-5.3 via qcplay) repeat
        // `id`/`name` on every delta as EMPTY strings instead of omitting
        // the field; a presence check alone would clobber the real values
        // carried by the first delta (issue #1).
        if (call.id !== undefined && call.id.length > 0) block.callId = call.id
        if (call.function?.name !== undefined && call.function.name.length > 0) block.name = call.function.name
        const fragment = call.function?.arguments ?? ''
        block.text += fragment
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: ToolCallId(block.callId ?? ''),
          ...block.name !== undefined ? { name: block.name } : {},
          argumentsDelta: fragment,
        }
      }

      if (typeof choice.finish_reason === 'string') {
        pendingFinish = mapFinishReason(choice.finish_reason)
      }
    }

    // Usage may arrive attached to the finish chunk or as a trailing
    // usage-only chunk — keep the latest.
    if (chunk.usage) pendingUsage = mapUsage(chunk.usage)
  }

  // parseSse guarantees the [DONE] sentinel (or throws); reaching here means
  // the payload source violated that contract.
  throw new LlmError('SSE payload stream ended without [DONE]', 'STREAM_CLOSED')
}

// ─── Responses API translation ────────────────────────────────────────────

/**
 * Map Responses-API usage to harness TokenUsage. `input_tokens` includes
 * cache hits; the harness convention is disjoint counts, so cache reads are
 * subtracted out.
 * @param usage - usage from the terminal `response.completed` event.
 * @returns disjoint harness counts; cache/reasoning fields present only when the wire reported them.
 */
export function mapResponsesUsage(usage: ResponsesUsage): TokenUsage {
  const cacheRead = usage.input_tokens_details?.cached_tokens
  const reasoning = usage.output_tokens_details?.reasoning_tokens
  return {
    inputTokens: usage.input_tokens - (cacheRead ?? 0),
    outputTokens: usage.output_tokens,
    ...cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== undefined ? { reasoningTokens: reasoning } : {},
  }
}

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
export async function* translateResponses(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textBlock: OpenBlock | undefined
  const toolBlocks = new Map<number, OpenBlock>()
  const order: OpenBlock[] = []
  let pendingUsage: TokenUsage | undefined

  function open(kind: OpenBlock['kind']): OpenBlock {
    const block: OpenBlock = { index: nextIndex++, kind, text: '' }
    order.push(block)
    return block
  }

  /** Flush every assembled block and the deferred usage. */
  function* flush(): Generator<StreamChunk> {
    for (const block of order) {
      yield { type: 'block-end', index: block.index, block: closeBlock(block) }
    }
    if (pendingUsage !== undefined) yield { type: 'usage', usage: pendingUsage }
  }

  /** Terminal finish; an empty streamed response degrades to EMPTY_RESPONSE. */
  function finish(reason: FinishReason): StreamChunk {
    return {
      type: 'finish',
      reason: reason.kind === 'stop' && order.length === 0
        ? {
          kind: 'error',
          failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
        }
        : reason,
    }
  }

  for await (const payload of payloads) {
    if (payload === DONE) {
      yield* flush()
      yield finish({ kind: 'stop' })
      return
    }

    let event: ResponsesEvent
    try {
      event = JSON.parse(payload) as ResponsesEvent
    } catch {
      throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }

    switch (event.type) {
      case 'response.output_text.delta': {
        const delta = event.delta
        if (typeof delta === 'string' && delta.length > 0) {
          if (!textBlock) {
            textBlock = open('text')
            yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
          }
          textBlock.text += delta
          yield { type: 'text-delta', index: textBlock.index, text: delta }
        }
        break
      }

      case 'response.output_item.added': {
        const item = event.item
        if (item?.type !== 'function_call') break
        const outputIndex = event.output_index ?? 0
        const block = open('tool-call')
        toolBlocks.set(outputIndex, block)
        if (item.call_id !== undefined && item.call_id.length > 0) block.callId = item.call_id
        if (block.callId === undefined && item.id !== undefined && item.id.length > 0) block.callId = item.id
        if (item.name !== undefined && item.name.length > 0) block.name = item.name
        yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        if (typeof item.arguments === 'string' && item.arguments.length > 0) {
          block.text += item.arguments
          yield {
            type: 'tool-call-delta',
            index: block.index,
            id: ToolCallId(block.callId ?? ''),
            ...block.name !== undefined ? { name: block.name } : {},
            argumentsDelta: item.arguments,
          }
        }
        break
      }

      case 'response.function_call_arguments.delta': {
        const outputIndex = event.output_index ?? 0
        let block = toolBlocks.get(outputIndex)
        if (!block) {
          // Argument deltas may lead the added event on non-conforming
          // gateways; open the call on first fragment.
          block = open('tool-call')
          toolBlocks.set(outputIndex, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        const delta = event.delta ?? ''
        block.text += delta
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: ToolCallId(block.callId ?? ''),
          ...block.name !== undefined ? { name: block.name } : {},
          argumentsDelta: delta,
        }
        break
      }

      case 'response.output_item.done': {
        // Non-conforming gateways may deliver the whole function call here
        // instead of argument deltas; adopt identity and (only if no
        // argument fragment arrived) the full arguments — never double them.
        const item = event.item
        const block = toolBlocks.get(event.output_index ?? 0)
        if (item?.type !== 'function_call' || block === undefined) break
        if (item.call_id !== undefined && item.call_id.length > 0) block.callId = item.call_id
        if (block.callId === undefined && item.id !== undefined && item.id.length > 0) block.callId = item.id
        if (item.name !== undefined && item.name.length > 0) block.name = item.name
        if (block.text.length === 0 && typeof item.arguments === 'string' && item.arguments.length > 0) {
          block.text += item.arguments
          yield {
            type: 'tool-call-delta',
            index: block.index,
            id: ToolCallId(block.callId ?? ''),
            ...block.name !== undefined ? { name: block.name } : {},
            argumentsDelta: item.arguments,
          }
        }
        break
      }

      case 'response.completed': {
        if (event.response?.usage) pendingUsage = mapResponsesUsage(event.response.usage)
        yield* flush()
        yield finish({ kind: 'stop' })
        return
      }

      case 'response.incomplete': {
        const reason = event.response?.incomplete_details?.reason ?? 'unknown'
        yield* flush()
        yield finish({ kind: 'error', failure: { message: `model stopped: ${reason}`, code: 'INCOMPLETE' } })
        return
      }

      case 'response.failed': {
        const failure = event.response?.error
        yield* flush()
        yield finish({
          kind: 'error',
          failure: {
            message: failure?.message ?? 'model response failed',
            code: failure?.code ?? 'RESPONSE_FAILED',
          },
        })
        return
      }

      case 'error': {
        throw new LlmError(
          event.error?.message ?? 'Responses API stream error',
          event.error?.code ?? 'INVALID_REQUEST',
        )
      }
    }
  }

  // No terminal event arrived before EOF — the stream is truncated.
  throw new LlmError('Responses-API SSE payload stream ended without a terminal event', 'STREAM_CLOSED')
}

interface MessagesEvent {
  type?: string
  index?: number
  content_block?: { type?: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string }
  message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
  usage?: { output_tokens?: number }
  error?: { type?: string; message?: string }
}

/** Map Anthropic's stop reasons onto the provider-neutral harness contract. */
function mapMessagesFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
    case undefined: return { kind: 'stop' }
    case 'tool_use': return { kind: 'tool-calls' }
    case 'max_tokens': return { kind: 'max-tokens' }
    default: return { kind: 'error', failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() } }
  }
}

/** Translate Anthropic Messages SSE events into harness StreamChunks. */
export async function* translateMessages(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  const blocks = new Map<number, OpenBlock>()
  const order: OpenBlock[] = []
  const closed = new Set<OpenBlock>()
  let pendingFinish: FinishReason | undefined
  let pendingUsage: TokenUsage | undefined

  function open(kind: OpenBlock['kind'], wireIndex: number): OpenBlock {
    const block: OpenBlock = { index: nextIndex++, kind, text: '' }
    blocks.set(wireIndex, block)
    order.push(block)
    return block
  }

  function* close(block: OpenBlock): Generator<StreamChunk> {
    if (closed.has(block)) return
    closed.add(block)
    yield { type: 'block-end', index: block.index, block: closeBlock(block) }
  }

  for await (const payload of payloads) {
    let event: MessagesEvent
    try { event = JSON.parse(payload) as MessagesEvent } catch {
      throw new LlmError(`malformed Messages SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }

    switch (event.type) {
      case 'message_start': {
        const usage = event.message?.usage
        if (usage !== undefined) {
          const input = usage.input_tokens ?? 0
          const cacheRead = usage.cache_read_input_tokens
          const cacheWrite = usage.cache_creation_input_tokens
          pendingUsage = {
            inputTokens: input,
            outputTokens: 0,
            ...cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {},
            ...cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {},
          }
        }
        break
      }
      case 'content_block_start': {
        const wireIndex = event.index ?? 0
        const source = event.content_block
        if (source?.type === 'text' || source?.type === 'thinking' || source?.type === 'tool_use') {
          const kind = source.type === 'thinking' ? 'reasoning' : source.type === 'tool_use' ? 'tool-call' : 'text'
          const block = open(kind, wireIndex)
          if (kind === 'tool-call') {
            if (source.id !== undefined) block.callId = source.id
            if (source.name !== undefined) block.name = source.name
            yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
            const initial = source.input
            if (initial !== undefined && typeof initial === 'object' && initial !== null && Object.keys(initial).length > 0) {
              const fragment = JSON.stringify(initial)
              block.text += fragment
              yield { type: 'tool-call-delta', index: block.index, id: ToolCallId(block.callId ?? ''), ...(block.name ? { name: block.name } : {}), argumentsDelta: fragment }
            }
          } else {
            yield { type: 'block-start', index: block.index, blockType: kind }
            const initial = kind === 'reasoning' ? source.thinking : source.text
            if (typeof initial === 'string' && initial.length > 0) {
              block.text = initial
              yield kind === 'reasoning'
                ? { type: 'reasoning-delta', index: block.index, text: initial }
                : { type: 'text-delta', index: block.index, text: initial }
            }
          }
        }
        break
      }
      case 'content_block_delta': {
        const block = blocks.get(event.index ?? 0)
        const delta = event.delta
        if (block === undefined || delta === undefined) break
        if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
          block.text += delta.text
          yield { type: 'text-delta', index: block.index, text: delta.text }
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking.length > 0) {
          block.text += delta.thinking
          yield { type: 'reasoning-delta', index: block.index, text: delta.thinking }
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          block.text += delta.partial_json
          yield { type: 'tool-call-delta', index: block.index, id: ToolCallId(block.callId ?? ''), ...(block.name ? { name: block.name } : {}), argumentsDelta: delta.partial_json }
        }
        break
      }
      case 'content_block_stop': {
        const block = blocks.get(event.index ?? 0)
        if (block !== undefined) yield* close(block)
        break
      }
      case 'message_delta': {
        if (event.delta?.stop_reason !== undefined) pendingFinish = mapMessagesFinishReason(event.delta.stop_reason)
        const output = event.usage?.output_tokens
        if (output !== undefined) pendingUsage = { ...(pendingUsage ?? { inputTokens: 0, outputTokens: 0 }), outputTokens: output }
        break
      }
      case 'message_stop': {
        for (const block of order) yield* close(block)
        if (pendingUsage !== undefined) yield { type: 'usage', usage: pendingUsage }
        const reason = pendingFinish ?? { kind: 'stop' as const }
        yield {
          type: 'finish',
          reason: reason.kind === 'stop' && order.length === 0
            ? { kind: 'error', failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE } }
            : reason,
        }
        return
      }
      case 'error':
        throw new LlmError(event.error?.message ?? 'Messages API stream error', event.error?.type ?? 'RESPONSE_FAILED')
      case 'ping':
        break
    }
  }
  throw new LlmError('Messages API stream ended without message_stop', 'STREAM_CLOSED')
}
