var __knownSymbol = (name2, symbol) => (symbol = Symbol[name2]) ? symbol : Symbol.for("Symbol." + name2);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose, inner;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) {
      dispose = value[__knownSymbol("dispose")];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") __typeError("Object not disposable");
    if (inner) dispose = function() {
      try {
        inner.call(this);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};

// src/index.ts
import z from "@deepseek-ai/schemastery";
import {
  assertUsableApiKey as assertUsableApiKey2,
  LlmError as LlmError5,
  resolveRetryPolicy,
  RetryPolicySchema
} from "@deepseek-ai/dsh-llm";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";

// src/adapter.ts
import {
  assertUsableApiKey,
  attributionHeaders,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmAdapter,
  LlmError as LlmError4,
  ProviderRequestId,
  QUOTA_EXCEEDED_CODE,
  ReasoningEffortId
} from "@deepseek-ai/dsh-llm";
import { idleWatchdog, timeoutOf } from "@deepseek-ai/dsh-timeout";
import { fetch as undiciFetch, ProxyAgent } from "undici";

// src/serialize.ts
import { contentHasImage, LlmError } from "@deepseek-ai/dsh-llm";
function flattenText(blocks) {
  return blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
}
function imagePart(block, dataUrl) {
  return {
    type: "image_url",
    image_url: { url: dataUrl }
  };
}
function assertTextOnly(blocks) {
  if (contentHasImage(blocks)) {
    throw new LlmError("The NewAPI chat-completions adapter does not support image content.", "UNSUPPORTED_CONTENT");
  }
}
function serializeAssistant(message) {
  const text = flattenText(message.content);
  const reasoning = message.content.filter((block) => block.type === "reasoning").map((block) => block.text).join("");
  const toolCalls = message.content.filter((block) => block.type === "tool-call").map((block) => ({
    id: block.id,
    type: "function",
    function: { name: block.name, arguments: block.arguments }
  }));
  return {
    role: "assistant",
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
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
  };
}
function serializeUserContent(message, images) {
  if (images !== void 0 && contentHasImage(message.content)) {
    const parts = [];
    for (const block of message.content) {
      if (block.type === "text") parts.push({ type: "text", text: block.text });
      if (block.type === "image") {
        const dataUrl = images.get(block.attachment.attachmentId);
        if (dataUrl !== void 0) parts.push(imagePart(block, dataUrl));
      }
    }
    return parts;
  }
  assertTextOnly(message.content);
  return flattenText(message.content);
}
function serializeMessages(messages, images) {
  const wire = [];
  for (const message of messages) {
    if (message.role === "system") {
      assertTextOnly(message.content);
      wire.push({ role: "system", content: flattenText(message.content) });
      continue;
    }
    if (message.role === "assistant") {
      assertTextOnly(message.content);
      wire.push(serializeAssistant(message));
      continue;
    }
    const toolResults = message.content.filter((block) => block.type === "tool-result");
    const content = serializeUserContent(message, images);
    const text = typeof content === "string" ? content : flattenText(message.content);
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({ role: "user", content });
    }
    for (const result of toolResults) {
      wire.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        // Empty tool output still needs SOME content on the wire.
        content: flattenText(result.content) || "(no output)"
      });
    }
  }
  return wire;
}
function serializeRequest(options, images) {
  const messages = [];
  if (options.system !== void 0) {
    messages.push({ role: "system", content: options.system });
  }
  messages.push(...serializeMessages(options.messages, images));
  const tools = options.tools?.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...tools !== void 0 && tools.length > 0 ? { tools } : {},
    ...options.temperature !== void 0 ? { temperature: options.temperature } : {},
    ...options.maxTokens === void 0 ? {} : { max_tokens: options.maxTokens },
    ...options.reasoningEffort !== void 0 ? { reasoning_effort: options.reasoningEffort } : {},
    ...options.stop !== void 0 ? { stop: options.stop } : {}
  };
}
function toResponsesContent(parts) {
  return parts.map((part) => {
    if (part.type === "image_url") {
      return { type: "input_image", image_url: part.image_url?.url ?? "" };
    }
    return { type: "input_text", text: part.text ?? "" };
  });
}
function serializeResponsesRequest(options, images) {
  const input = [];
  for (const message of options.messages) {
    if (message.role === "system") {
      assertTextOnly(message.content);
      input.push({ role: "system", content: flattenText(message.content) });
      continue;
    }
    if (message.role === "assistant") {
      const text2 = flattenText(message.content);
      const reasoning = message.content.filter((block) => block.type === "reasoning").map((block) => block.text).join("");
      const toolCalls = message.content.filter((block) => block.type === "tool-call").map((block) => ({
        type: "function_call",
        call_id: block.id,
        name: block.name,
        arguments: block.arguments
      }));
      if (text2.length > 0) input.push({ role: "assistant", content: text2 });
      for (const call of toolCalls) input.push(call);
      continue;
    }
    const toolResults = message.content.filter((block) => block.type === "tool-result");
    const content = serializeUserContent(message, images);
    const text = typeof content === "string" ? content : flattenText(message.content);
    const parts = Array.isArray(content) ? toResponsesContent(content) : void 0;
    if (text.length > 0 || parts !== void 0 && parts.length > 0) {
      input.push({
        role: "user",
        content: parts !== void 0 && parts.some((p) => p.type === "input_image") ? parts : text
      });
    }
    for (const result of toolResults) {
      input.push({
        type: "function_call_output",
        call_id: result.toolCallId,
        output: flattenText(result.content) || "(no output)"
      });
    }
  }
  const tools = options.tools?.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));
  return {
    model: options.model,
    input,
    stream: true,
    stream_options: { include_usage: true },
    ...options.system !== void 0 && options.system.length > 0 ? { instructions: options.system } : {},
    ...tools !== void 0 && tools.length > 0 ? { tools } : {},
    ...options.temperature !== void 0 ? { temperature: options.temperature } : {},
    ...options.maxTokens === void 0 ? {} : { max_output_tokens: options.maxTokens },
    ...options.reasoningEffort !== void 0 ? { reasoning: { effort: options.reasoningEffort } } : {}
  };
}

// src/sse.ts
import { EventSourceParserStream } from "eventsource-parser/stream";
import { LlmError as LlmError2 } from "@deepseek-ai/dsh-llm";
var DONE = "[DONE]";
async function* parseSse(stream, onComment, requireDone = true) {
  const events = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream({ onComment }));
  for await (const { data } of events) {
    yield data;
    if (data === DONE) return;
  }
  if (requireDone) throw new LlmError2("SSE stream ended without [DONE]", "STREAM_CLOSED");
}

// src/translate.ts
import { EMPTY_RESPONSE_CODE, LlmError as LlmError3, ToolCallId } from "@deepseek-ai/dsh-llm";
function mapFinishReason(reason) {
  switch (reason) {
    case "stop":
      return { kind: "stop" };
    case "tool_calls":
      return { kind: "tool-calls" };
    case "length":
      return { kind: "max-tokens" };
    default:
      return {
        kind: "error",
        failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() }
      };
  }
}
function mapUsage(usage) {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  return {
    inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens,
    ...cacheRead !== void 0 ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== void 0 ? { reasoningTokens: reasoning } : {}
  };
}
function closeBlock(block) {
  switch (block.kind) {
    case "text":
      return { type: "text", text: block.text };
    case "reasoning":
      return { type: "reasoning", text: block.text };
    case "tool-call":
      return {
        type: "tool-call",
        id: ToolCallId(block.callId ?? ""),
        name: block.name ?? "",
        arguments: block.text
      };
  }
}
async function* translate(payloads) {
  let nextIndex = 0;
  let textBlock;
  let reasoningBlock;
  const toolBlocks = /* @__PURE__ */ new Map();
  const order = [];
  let pendingFinish;
  let pendingUsage;
  function open(kind) {
    const block = { index: nextIndex++, kind, text: "" };
    order.push(block);
    return block;
  }
  for await (const payload of payloads) {
    if (payload === DONE) {
      for (const block of order) {
        yield { type: "block-end", index: block.index, block: closeBlock(block) };
      }
      if (pendingUsage) yield { type: "usage", usage: pendingUsage };
      const reason = pendingFinish ?? { kind: "stop" };
      yield {
        type: "finish",
        reason: reason.kind === "stop" && order.length === 0 ? {
          kind: "error",
          failure: { message: "model returned a completed response with no content", code: EMPTY_RESPONSE_CODE }
        } : reason
      };
      return;
    }
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      throw new LlmError3(`malformed SSE payload: ${payload.slice(0, 120)}`, "MALFORMED_RESPONSE");
    }
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      const reasoning = delta?.reasoning_content;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open("reasoning");
          yield { type: "block-start", index: reasoningBlock.index, blockType: "reasoning" };
        }
        reasoningBlock.text += reasoning;
        yield { type: "reasoning-delta", index: reasoningBlock.index, text: reasoning };
      }
      const content = delta?.content;
      if (typeof content === "string" && content.length > 0) {
        if (!textBlock) {
          textBlock = open("text");
          yield { type: "block-start", index: textBlock.index, blockType: "text" };
        }
        textBlock.text += content;
        yield { type: "text-delta", index: textBlock.index, text: content };
      }
      for (const call of delta?.tool_calls ?? []) {
        let block = toolBlocks.get(call.index);
        if (!block) {
          block = open("tool-call");
          toolBlocks.set(call.index, block);
          yield { type: "block-start", index: block.index, blockType: "tool-call" };
        }
        if (call.id !== void 0 && call.id.length > 0) block.callId = call.id;
        if (call.function?.name !== void 0 && call.function.name.length > 0) block.name = call.function.name;
        const fragment = call.function?.arguments ?? "";
        block.text += fragment;
        yield {
          type: "tool-call-delta",
          index: block.index,
          id: ToolCallId(block.callId ?? ""),
          ...block.name !== void 0 ? { name: block.name } : {},
          argumentsDelta: fragment
        };
      }
      if (typeof choice.finish_reason === "string") {
        pendingFinish = mapFinishReason(choice.finish_reason);
      }
    }
    if (chunk.usage) pendingUsage = mapUsage(chunk.usage);
  }
  throw new LlmError3("SSE payload stream ended without [DONE]", "STREAM_CLOSED");
}
function mapResponsesUsage(usage) {
  const cacheRead = usage.input_tokens_details?.cached_tokens;
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  return {
    inputTokens: usage.input_tokens - (cacheRead ?? 0),
    outputTokens: usage.output_tokens,
    ...cacheRead !== void 0 ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== void 0 ? { reasoningTokens: reasoning } : {}
  };
}
async function* translateResponses(payloads) {
  let nextIndex = 0;
  let textBlock;
  const toolBlocks = /* @__PURE__ */ new Map();
  const order = [];
  let pendingUsage;
  function open(kind) {
    const block = { index: nextIndex++, kind, text: "" };
    order.push(block);
    return block;
  }
  function* flush() {
    for (const block of order) {
      yield { type: "block-end", index: block.index, block: closeBlock(block) };
    }
    if (pendingUsage !== void 0) yield { type: "usage", usage: pendingUsage };
  }
  function finish(reason) {
    return {
      type: "finish",
      reason: reason.kind === "stop" && order.length === 0 ? {
        kind: "error",
        failure: { message: "model returned a completed response with no content", code: EMPTY_RESPONSE_CODE }
      } : reason
    };
  }
  for await (const payload of payloads) {
    if (payload === DONE) {
      yield* flush();
      yield finish({ kind: "stop" });
      return;
    }
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      throw new LlmError3(`malformed SSE payload: ${payload.slice(0, 120)}`, "MALFORMED_RESPONSE");
    }
    switch (event.type) {
      case "response.output_text.delta": {
        const delta = event.delta;
        if (typeof delta === "string" && delta.length > 0) {
          if (!textBlock) {
            textBlock = open("text");
            yield { type: "block-start", index: textBlock.index, blockType: "text" };
          }
          textBlock.text += delta;
          yield { type: "text-delta", index: textBlock.index, text: delta };
        }
        break;
      }
      case "response.output_item.added": {
        const item = event.item;
        if (item?.type !== "function_call") break;
        const outputIndex = event.output_index ?? 0;
        const block = open("tool-call");
        toolBlocks.set(outputIndex, block);
        if (item.call_id !== void 0 && item.call_id.length > 0) block.callId = item.call_id;
        if (block.callId === void 0 && item.id !== void 0 && item.id.length > 0) block.callId = item.id;
        if (item.name !== void 0 && item.name.length > 0) block.name = item.name;
        yield { type: "block-start", index: block.index, blockType: "tool-call" };
        if (typeof item.arguments === "string" && item.arguments.length > 0) {
          block.text += item.arguments;
          yield {
            type: "tool-call-delta",
            index: block.index,
            id: ToolCallId(block.callId ?? ""),
            ...block.name !== void 0 ? { name: block.name } : {},
            argumentsDelta: item.arguments
          };
        }
        break;
      }
      case "response.function_call_arguments.delta": {
        const outputIndex = event.output_index ?? 0;
        let block = toolBlocks.get(outputIndex);
        if (!block) {
          block = open("tool-call");
          toolBlocks.set(outputIndex, block);
          yield { type: "block-start", index: block.index, blockType: "tool-call" };
        }
        const delta = event.delta ?? "";
        block.text += delta;
        yield {
          type: "tool-call-delta",
          index: block.index,
          id: ToolCallId(block.callId ?? ""),
          ...block.name !== void 0 ? { name: block.name } : {},
          argumentsDelta: delta
        };
        break;
      }
      case "response.output_item.done": {
        const item = event.item;
        const block = toolBlocks.get(event.output_index ?? 0);
        if (item?.type !== "function_call" || block === void 0) break;
        if (item.call_id !== void 0 && item.call_id.length > 0) block.callId = item.call_id;
        if (block.callId === void 0 && item.id !== void 0 && item.id.length > 0) block.callId = item.id;
        if (item.name !== void 0 && item.name.length > 0) block.name = item.name;
        if (block.text.length === 0 && typeof item.arguments === "string" && item.arguments.length > 0) {
          block.text += item.arguments;
          yield {
            type: "tool-call-delta",
            index: block.index,
            id: ToolCallId(block.callId ?? ""),
            ...block.name !== void 0 ? { name: block.name } : {},
            argumentsDelta: item.arguments
          };
        }
        break;
      }
      case "response.completed": {
        if (event.response?.usage) pendingUsage = mapResponsesUsage(event.response.usage);
        yield* flush();
        yield finish({ kind: "stop" });
        return;
      }
      case "response.incomplete": {
        const reason = event.response?.incomplete_details?.reason ?? "unknown";
        yield* flush();
        yield finish({ kind: "error", failure: { message: `model stopped: ${reason}`, code: "INCOMPLETE" } });
        return;
      }
      case "response.failed": {
        const failure = event.response?.error;
        yield* flush();
        yield finish({
          kind: "error",
          failure: {
            message: failure?.message ?? "model response failed",
            code: failure?.code ?? "RESPONSE_FAILED"
          }
        });
        return;
      }
      case "error": {
        throw new LlmError3(
          event.error?.message ?? "Responses API stream error",
          event.error?.code ?? "INVALID_REQUEST"
        );
      }
    }
  }
  throw new LlmError3("Responses-API SSE payload stream ended without a terminal event", "STREAM_CLOSED");
}

// src/adapter.ts
var PKG = "llm-newapi";
var DEFAULT_MODEL_EXCLUDE_PATTERNS = ["embed", "rerank", "ranker"];
var DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
var DEFAULT_CONTEXT_WINDOW = 128e3;
var STREAM_IDLE_TIMEOUT_CODE = "LLM_STREAM_IDLE_TIMEOUT";
var MODELS_DEV_API_URL = "https://models.dev/api.json";
var MODELS_DEV_TIMEOUT_MS = 3e4;
function modelsDevMatch(provider, entry) {
  const contextWindow = entry.limit?.context;
  const maxTokens = entry.limit?.output;
  const reasoningEfforts = entry.reasoning_options?.filter((option) => option?.type === "effort").flatMap((option) => (option.values ?? []).filter((value) => typeof value === "string" && value.length > 0));
  const vision = entry.modalities?.input?.includes("image");
  return {
    provider,
    ...entry.name !== void 0 && entry.name.length > 0 ? { name: entry.name } : {},
    ...contextWindow !== void 0 ? { contextWindow } : {},
    ...maxTokens !== void 0 ? { maxTokens } : {},
    ...reasoningEfforts !== void 0 && reasoningEfforts.length > 0 ? { reasoningEfforts } : {},
    ...vision === true ? { vision: true } : {}
  };
}
var DEFAULT_PROVIDER_HINTS = {
  defaults: {
    glm: "zai",
    gpt: "openai",
    o: "openai",
    claude: "anthropic",
    deepseek: "deepseek",
    gemini: "google",
    grok: "xai",
    hunyuan: "tencent",
    qwen: "alibaba",
    kimi: "moonshotai",
    // xiaomi is the vendor key mimo models live under (mimo-v2* family);
    // no separate xiaomimimo provider exists in the catalog.
    mimo: "xiaomi",
    minimax: "minimax"
  }
};
function hintedProvider(id, bare, hints) {
  const exact = hints?.models?.[id] ?? hints?.models?.[bare];
  if (exact !== void 0) return exact;
  const lower = bare.toLowerCase();
  const entries = Object.entries({ ...DEFAULT_PROVIDER_HINTS.defaults, ...hints?.defaults });
  const hit = entries.filter(([prefix]) => lower.startsWith(prefix.toLowerCase())).sort((a, b) => b[0].length - a[0].length)[0];
  return hit?.[1];
}
function matchModelsDev(api, id, hints) {
  const bare = id.slice(id.lastIndexOf("/") + 1);
  const keys = /* @__PURE__ */ new Set([id, bare]);
  const hinted = hintedProvider(id, bare, hints);
  const exact = /* @__PURE__ */ new Map();
  const near = /* @__PURE__ */ new Map();
  for (const [provider, catalog] of Object.entries(api)) {
    const models = catalog?.models;
    if (models === void 0 || typeof models !== "object") continue;
    for (const key of keys) {
      const entry = models[key];
      if (entry === void 0 || typeof entry !== "object") continue;
      const match = modelsDevMatch(provider, entry);
      if (match !== void 0) exact.set(provider, match);
    }
    if (provider === hinted && !exact.has(provider)) {
      const hit = Object.keys(models).filter((key) => key.includes(bare) || bare.includes(key)).map((key) => ({ key, entry: models[key] })).sort((a, b) => a.key.length - b.key.length)[0];
      const entry = hit?.entry;
      const match = entry === void 0 ? void 0 : modelsDevMatch(provider, entry);
      if (match !== void 0) near.set(provider, match);
    }
  }
  const ordered = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (match, official) => {
    if (seen.has(match.provider)) return;
    seen.add(match.provider);
    ordered.push(official ? { ...match, official: true } : match);
  };
  const hintedMatch = exact.get(hinted ?? "") ?? near.get(hinted ?? "");
  if (hinted !== void 0 && hintedMatch !== void 0) push(hintedMatch, true);
  for (const match of exact.values()) push(match, false);
  for (const match of near.values()) push(match, false);
  return ordered;
}
function normalizeBaseUrl(raw) {
  const base = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) {
    throw new Error(`${PKG}: baseURL must be an absolute http(s) URL including the /v1 prefix, e.g. http://gw.local:3000/v1 (got: ${raw.trim()})`);
  }
  return base;
}
function modelInfo(provider, model) {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === void 0 ? {} : { description: model.description },
    inputModalities: model.vision === true ? ["text", "image"] : ["text"]
  };
}
var EFFORT_RUNG = {
  max: 7,
  xhigh: 6,
  high: 5,
  medium: 4,
  low: 3,
  minimal: 2,
  none: 1,
  default: 0
};
function highestEffort(efforts) {
  return [...efforts].sort((a, b) => (EFFORT_RUNG[b] ?? -1) - (EFFORT_RUNG[a] ?? -1))[0];
}
var BRAND_SPELLING = {
  glm: "GLM",
  gpt: "GPT",
  deepseek: "DeepSeek"
};
function modelNameFromId(id) {
  const slash = id.lastIndexOf("/");
  const prefix = slash === -1 ? void 0 : id.slice(0, slash);
  const words = id.slice(slash + 1).split("-").filter((word) => word.length > 0);
  const spelled = words.map((word, at) => {
    if (word.length === 1) return word.toUpperCase();
    const brand = BRAND_SPELLING[word];
    if (brand !== void 0) return brand;
    let result = word.charAt(0).toUpperCase() + word.slice(1);
    if (at === words.length - 1) {
      result = result.replace(/([0-9.])([bkm])$/, (_match, head, tail) => head + tail.toUpperCase());
    }
    return result;
  }).join(" ");
  return prefix === void 0 ? spelled : `${spelled}[${prefix}]`;
}
function displayModelName(id, listed) {
  if (listed !== void 0 && listed.length > 0) return listed;
  return modelNameFromId(id);
}
function providerRetryAfterMs(value) {
  if (value === null) return void 0;
  if (/^\d+$/.test(value)) {
    const delay2 = Number(value) * 1e3;
    return Number.isFinite(delay2) && delay2 > 0 ? delay2 : void 0;
  }
  const delay = Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? delay : void 0;
}
function requestId(headers) {
  const value = headers.get("x-request-id");
  return value === null || value.length === 0 ? void 0 : ProviderRequestId(value);
}
function httpErrorCode(status, error) {
  if (status === 401 || status === 403) return "AUTH";
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(" ");
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE;
  if (status === 429) return "RATE_LIMIT";
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE;
    return "INVALID_REQUEST";
  }
  if (status >= 500) return "SERVER";
  return `HTTP_${status}`;
}
function imageDataUrl(image) {
  return `data:${image.ref.mediaType};base64,${Buffer.from(image.data).toString("base64")}`;
}
var NewApiAdapter = class extends LlmAdapter {
  constructor(config) {
    super();
    this.config = config;
  }
  providerInfo(provider) {
    const connection = this.config.options(provider);
    return { id: provider, name: connection.displayName || "NewAPI" };
  }
  providerRetryPolicy(provider) {
    return this.config.options(provider).retryPolicy;
  }
  listModels(provider) {
    return Promise.resolve(this.config.options(provider).models.map((model) => modelInfo(provider, model)));
  }
  resolveModel(provider, model, _signal) {
    const connection = this.config.options(provider);
    const configured = connection.models.find((entry) => entry.id === model);
    const defaultMaxTokens = configured?.maxTokens ?? connection.maxTokens;
    return Promise.resolve({
      // The chat-completions wire route is text-only unless the catalog row
      // explicitly declares vision — the uncatalogued fallback declares the
      // same negative capability, so "unknown" can never let the host accept
      // and persist images the serializer must then reject.
      ...configured === void 0 ? { provider, id: model, name: model, inputModalities: ["text"] } : modelInfo(provider, configured),
      context: { contextWindow: configured?.contextWindow ?? connection.defaultContextWindow },
      // Reasoning efforts arrive as catalog facts (from models.dev via the
      // update action): a row that carries them offers the effort selector,
      // and an explicit effort rides the wire as `reasoning_effort`. The
      // default is the row's configured preset, falling back to the highest
      // rung the catalog declared (max > xhigh > high > medium > low > …), so
      // switching into reasoning mode selects a level automatically. Rows
      // without the fact keep declaring nothing — an explicit effort then
      // rejects before provider I/O, same as before.
      ...configured?.reasoningEfforts !== void 0 && configured.reasoningEfforts.length > 0 ? {
        reasoning: {
          efforts: configured.reasoningEfforts.map((effort) => ({
            id: ReasoningEffortId(effort),
            name: effort.charAt(0).toUpperCase() + effort.slice(1)
          })),
          ...configured.defaultReasoningEffort !== void 0 && configured.reasoningEfforts.includes(configured.defaultReasoningEffort) ? { defaultEffort: ReasoningEffortId(configured.defaultReasoningEffort) } : { defaultEffort: ReasoningEffortId(highestEffort(configured.reasoningEfforts)) }
        }
      } : {},
      ...defaultMaxTokens === void 0 ? {} : { defaultMaxTokens }
    });
  }
  /**
   * Interrogate one gateway endpoint for the models it advertises, serving
   * the settings-namespace discovery the plugin registered. A draft being
   * edited supplies its own base and one-shot credential; otherwise both
   * come from the current connection snapshot.
   * @param request - the discovery draft (endpoint, protocol, credential, cancellation).
   * @returns the advertised models, deduplicated by the runtime, enriched
   *   with context/maxTokens facts from the configured catalog when ids match.
   */
  /**
   * The provider route backing an endpoint-less draft: the configured
   * default, else the legacy `newapi` route.
   */
  defaultProviderRoute() {
    return this.config.defaultProvider?.() ?? "newapi";
  }
  async discoverModels(request, signal) {
    const connection = request.provider !== void 0 ? this.config.options(request.provider) : this.config.options(this.defaultProviderRoute());
    const base = request.baseURL !== void 0 && request.baseURL.length > 0 ? normalizeBaseUrl(request.baseURL) : connection.baseURL;
    const apiKey = request.apiKey !== void 0 ? assertUsableApiKey(request.apiKey, PKG, "the draft credential") : await this.config.resolveApiKey(connection);
    let response;
    try {
      response = await fetch(`${base}/models`, {
        method: "GET",
        headers: {
          "authorization": `Bearer ${apiKey}`,
          "accept": "application/json",
          ...attributionHeaders()
        },
        ...signal === void 0 ? {} : { signal }
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new LlmError4(`NewAPI model discovery request to ${base} failed`, "TRANSPORT", { cause: error });
    }
    if (!response.ok) {
      let providerError;
      try {
        providerError = (await response.json()).error;
      } catch {
      }
      const id = requestId(response.headers);
      throw new LlmError4(
        providerError?.message ?? `NewAPI model discovery error (HTTP ${response.status})`,
        httpErrorCode(response.status, providerError),
        {
          status: response.status,
          ...id === void 0 ? {} : { requestId: id }
        }
      );
    }
    let list;
    try {
      list = await response.json();
    } catch {
      throw new LlmError4(`NewAPI model discovery from ${base} returned a malformed body`, "MALFORMED_RESPONSE");
    }
    const catalog = new Map(connection.models.map((model) => [model.id, model]));
    const excludes = connection.modelExcludePatterns.map((pattern) => pattern.toLowerCase());
    const models = [];
    for (const entry of list.data ?? []) {
      if (typeof entry?.id !== "string" || entry.id.length === 0) continue;
      const id = entry.id.toLowerCase();
      if (excludes.some((pattern) => id.includes(pattern))) continue;
      const known = catalog.get(entry.id);
      models.push({
        id: entry.id,
        name: displayModelName(entry.id, entry.name),
        ...known?.contextWindow !== void 0 ? { contextWindow: known.contextWindow } : {},
        ...known?.maxTokens !== void 0 ? { maxTokens: known.maxTokens } : {}
      });
    }
    models.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return models;
  }
  /**
   * Download the models.dev catalog (optionally through the configured
   * forward proxy) and match every requested gateway id against it, serving
   * the `models-dev-params` RPC endpoint. Runs host-side on purpose: the
   * browser only names the ids and the proxy, so no cross-origin download
   * happens and the proxy is a plain HTTP forward proxy Node can use.
   * @param request - gateway model ids and an optional proxy URL.
   * @param signal - caller cancellation.
   * @returns per id: every provider entry that matched it (possibly several —
   *   the user resolves which provider's facts to adopt), possibly none.
   */
  async fetchModelsDevParams(request, signal) {
    const providerRoute = request.provider ?? this.defaultProviderRoute();
    const proxyUrl = request.proxyUrl !== void 0 && request.proxyUrl.length > 0 ? request.proxyUrl : this.config.options(providerRoute).proxyUrl;
    const dispatcher = proxyUrl !== void 0 ? new ProxyAgent(proxyUrl) : void 0;
    let api;
    try {
      const request_ = {
        headers: { accept: "application/json", ...attributionHeaders() },
        signal: AbortSignal.any([signal, AbortSignal.timeout(MODELS_DEV_TIMEOUT_MS)])
      };
      const response = dispatcher === void 0 ? await fetch(MODELS_DEV_API_URL, request_) : await undiciFetch(MODELS_DEV_API_URL, { ...request_, dispatcher });
      if (!response.ok) {
        throw new LlmError4(
          `models.dev catalog fetch failed (HTTP ${response.status})`,
          httpErrorCode(response.status),
          { status: response.status }
        );
      }
      api = await response.json();
    } catch (error) {
      if (error instanceof LlmError4) throw error;
      if (signal.aborted) throw error;
      const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : error instanceof Error ? `: ${error.message}` : "";
      const remedy = proxyUrl !== void 0 ? ` \u2014 the proxy at ${proxyUrl} is unreachable; check that it is running, or change or disable the proxy setting` : " \u2014 if the direct route cannot reach models.dev, enable the proxy";
      throw new LlmError4(
        `models.dev catalog fetch failed${cause}${remedy}`,
        "TRANSPORT",
        { cause: error }
      );
    } finally {
      void dispatcher?.close().catch(() => {
      });
    }
    const hints = this.config.options(providerRoute).providerHints;
    return {
      models: await Promise.all(request.modelIds.map(async (id) => ({
        id,
        matches: await this.prioritizeOfficial(id, matchModelsDev(api, id, hints))
      })))
    };
  }
  /**
   * Registry-based official priority, complementing the hint-driven one
   * inside {@link matchModelsDev}: when the hints did NOT flag a match
   * official yet, a route registered on ctx.llm that officially serves the
   * id (bare, or the last segment of a routed id) still leads. Runs only
   * when nothing is flagged, so the two mechanisms never fight.
   * @param id - the gateway model id.
   * @param matches - every catalog match, hinted order already applied.
   * @returns matches with the registry-official one first, flagged.
   */
  async prioritizeOfficial(id, matches) {
    const hook = this.config.officialProviderOf;
    if (hook === void 0 || matches.length < 2 || matches.some((match) => match.official === true)) return matches;
    const slash = id.lastIndexOf("/");
    const official = await hook(id) ?? (slash === -1 ? void 0 : await hook(id.slice(slash + 1)));
    if (official === void 0) return matches;
    const at = matches.findIndex((match) => match.provider === official);
    const hit = at === -1 ? void 0 : matches[at];
    if (hit === void 0) return matches;
    const rest = matches.filter((_match, index) => index !== at);
    return [{ ...hit, official: true }, ...rest];
  }
  async *stream(options) {
    var _stack = [];
    try {
      const connection = this.config.options(options.provider);
      const apiKey = await this.config.resolveApiKey(connection);
      const consumer = new AbortController();
      const upstream = options.signal === void 0 ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]);
      const watchdog = __using(_stack, idleWatchdog(upstream, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE));
      const iterator = this.request(
        options,
        watchdog.signal,
        connection,
        apiKey,
        () => {
          watchdog.pulse();
        }
      )[Symbol.asyncIterator]();
      let exhausted = false;
      try {
        while (true) {
          const result = await watchdog.next(iterator);
          if (result.done) {
            exhausted = true;
            return;
          }
          yield result.value;
        }
      } catch (error) {
        if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== void 0) {
          throw new LlmError4(
            `NewAPI stream idle timeout after ${connection.streamIdleTimeoutMs}ms`,
            "TIMEOUT",
            { cause: error }
          );
        }
        if (options.signal?.aborted) {
          throw new LlmError4("NewAPI request aborted by caller", "ABORTED", { cause: error });
        }
        if (error instanceof LlmError4) throw error;
        throw new LlmError4(`NewAPI stream from ${connection.baseURL} failed`, "TRANSPORT", { cause: error });
      } finally {
        consumer.abort("NewAPI stream consumer stopped");
        if (!exhausted && iterator.return !== void 0) {
          try {
            await iterator.return();
          } catch (_abortedTransportTeardown) {
          }
        }
      }
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /**
   * Resolve every image block of a request to a data URL when the selected
   * model is a vision catalog row and a resolver is wired. Missing resolver
   * or text-only row returns `undefined` (text-only serialization).
   * @param options - the request; `options.model` selects the catalog row.
   * @param signal - caller cancellation for attachment reads.
   * @param connection - the group's connection facts.
   * @returns attachmentId → data URL, or `undefined` when no image support.
   */
  async resolveRequestImages(options, signal, connection) {
    const resolver = this.config.resolveImage;
    if (resolver === void 0) return void 0;
    const configured = connection.models.find((entry) => entry.id === options.model);
    if (configured?.vision !== true) return void 0;
    const refs = [];
    for (const message of options.messages) {
      for (const block of message.content) {
        if (block.type === "image") refs.push(block.attachment);
      }
    }
    if (refs.length === 0) return void 0;
    const resolved = await Promise.all(refs.map((ref) => resolver(ref, signal)));
    return new Map(resolved.map((image) => [image.ref.attachmentId, imageDataUrl(image)]));
  }
  async *request(options, signal, connection, apiKey, onComment) {
    const images = await this.resolveRequestImages(options, signal, connection);
    const responses = connection.apiType === "responses";
    const body = responses ? serializeResponsesRequest(options, images) : serializeRequest(options, images);
    const payload = JSON.stringify(body);
    const headers = {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
      "accept": "text/event-stream",
      // The mandatory product attribution; nothing per-request or per-user
      // rides on a third-party gateway request.
      ...attributionHeaders()
    };
    let response;
    try {
      response = await fetch(`${connection.baseURL}${responses ? "/responses" : "/chat/completions"}`, {
        method: "POST",
        headers,
        body: payload,
        signal
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new LlmError4(
        `NewAPI request to ${connection.baseURL} failed`,
        "TRANSPORT",
        { cause: error }
      );
    }
    if (!response.ok) {
      let message = `NewAPI error (HTTP ${response.status})`;
      let providerError;
      try {
        const parsed = await response.json();
        providerError = parsed.error;
        if (providerError?.message) message = providerError.message;
      } catch {
      }
      const delay = providerRetryAfterMs(response.headers.get("retry-after"));
      const id = requestId(response.headers);
      throw new LlmError4(message, httpErrorCode(response.status, providerError), {
        status: response.status,
        ...delay === void 0 ? {} : { providerRetryAfterMs: delay },
        ...id === void 0 ? {} : { requestId: id }
      });
    }
    if (!response.body) {
      throw new LlmError4("NewAPI returned no response body", "EMPTY_RESPONSE");
    }
    yield* responses ? translateResponses(parseSse(response.body, onComment, false)) : translate(parseSse(response.body, onComment));
  }
};

// src/index.ts
var name = "llm-newapi";
var inject = ["llm"];
var NS = "llm-newapi";
var BASE_URL_ENV = "NEWAPI_BASE_URL";
var DEFAULT_BASE_URL = "https://newapi.example.com/v1";
function groupRoute(id) {
  return id === "newapi" ? "newapi" : `newapi-${id}`;
}
function groupCredRef(id) {
  const safe = id.replace(/[^A-Za-z0-9_]/g, "_");
  return credentialRef(id === "newapi" ? "newapi" : `newapi_${safe}`);
}
function settingsPathOf(raw, providerRoute) {
  if (Array.isArray(raw.groups) && raw.groups.length > 0) {
    const index = raw.groups.findIndex((candidate) => groupRoute(candidate.id) === providerRoute);
    return index >= 0 ? ["groups", String(index)] : [];
  }
  return [];
}
var catalogModel = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  reasoningEfforts: z.array(z.string()),
  defaultReasoningEffort: z.string(),
  vision: z.boolean()
});
var DEFAULT_PROXY_URL = "http://127.0.0.1:7890";
var proxySchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(DEFAULT_PROXY_URL)
});
var groupSchema = z.object({
  id: z.string().required(),
  name: z.string(),
  apiType: z.union(["chat", "responses"]),
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
    models: z.object({})
  }),
  retryPolicy: RetryPolicySchema
});
var Config = z.object({
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
    models: z.object({})
  }),
  retryPolicy: RetryPolicySchema
});
function resolveModels(models) {
  const seen = /* @__PURE__ */ new Set();
  return (models ?? []).map((model) => {
    if (model.id.length === 0) throw new Error(`${PKG}: catalog model ids must be non-empty`);
    if (model.name !== void 0 && model.name.length === 0) {
      throw new Error(`${PKG}: catalog model "${model.id}" has an empty name`);
    }
    if (model.contextWindow !== void 0 && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" contextWindow must be a positive integer`
      );
    }
    if (model.maxTokens !== void 0 && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" maxTokens must be a positive integer`
      );
    }
    if (seen.has(model.id)) throw new Error(`${PKG}: duplicate catalog model "${model.id}"`);
    seen.add(model.id);
    for (const effort of model.reasoningEfforts ?? []) {
      if (effort.length === 0) throw new Error(`${PKG}: catalog model "${model.id}" has an empty reasoning effort`);
    }
    if (model.defaultReasoningEffort !== void 0 && !(model.reasoningEfforts ?? []).includes(model.defaultReasoningEffort)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" default reasoning effort "${model.defaultReasoningEffort}" is not among its reasoning efforts`
      );
    }
    return {
      id: model.id,
      ...model.name === void 0 ? {} : { name: model.name },
      ...model.description === void 0 ? {} : { description: model.description },
      ...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
      ...model.reasoningEfforts === void 0 || model.reasoningEfforts.length === 0 ? {} : { reasoningEfforts: model.reasoningEfforts },
      ...model.defaultReasoningEffort === void 0 ? {} : { defaultReasoningEffort: model.defaultReasoningEffort },
      ...model.vision === true ? { vision: true } : {}
    };
  });
}
function expandGroups(config, environment) {
  if (config.groups !== void 0 && config.groups.length > 0) return config.groups;
  const named = config.baseURL !== void 0 && config.baseURL.trim().length > 0 ? config.baseURL : environment?.get(BASE_URL_ENV)?.value;
  return [{
    id: "newapi",
    name: "NewAPI",
    baseURL: named !== void 0 && named.trim().length > 0 ? named : DEFAULT_BASE_URL,
    ...config.models === void 0 ? {} : { models: config.models },
    ...config.modelExcludePatterns === void 0 ? {} : { modelExcludePatterns: config.modelExcludePatterns },
    ...config.defaultContextWindow === void 0 ? {} : { defaultContextWindow: config.defaultContextWindow },
    ...config.maxTokens === void 0 ? {} : { maxTokens: config.maxTokens },
    ...config.streamIdleTimeoutMs === void 0 ? {} : { streamIdleTimeoutMs: config.streamIdleTimeoutMs },
    ...config.proxy === void 0 ? {} : { proxy: config.proxy },
    ...config.providerHints === void 0 ? {} : { providerHints: config.providerHints },
    ...config.retryPolicy === void 0 ? {} : { retryPolicy: config.retryPolicy }
  }];
}
function validateProxyUrl(proxyUrlRaw, pkg) {
  try {
    new URL(proxyUrlRaw);
  } catch {
    throw new Error(`${pkg}: proxy.url must be an absolute URL (got: ${proxyUrlRaw})`);
  }
  if (!/^https?:$/.test(new URL(proxyUrlRaw).protocol)) {
    throw new Error(`${pkg}: proxy.url must be an http(s) URL (got: ${proxyUrlRaw})`);
  }
}
function resolveGroupOptions(group, environment) {
  const route = groupRoute(group.id);
  const rawBase = group.baseURL.trim().length > 0 ? group.baseURL : DEFAULT_BASE_URL;
  const modelExcludePatterns = group.modelExcludePatterns ?? [...DEFAULT_MODEL_EXCLUDE_PATTERNS];
  for (const pattern of modelExcludePatterns) {
    if (pattern.length === 0) throw new Error(`${PKG}: modelExcludePatterns entries must be non-empty`);
  }
  if (group.defaultContextWindow !== void 0 && (!Number.isInteger(group.defaultContextWindow) || group.defaultContextWindow <= 0)) {
    throw new Error(`${PKG}: defaultContextWindow must be a positive integer`);
  }
  if (group.maxTokens !== void 0 && (!Number.isSafeInteger(group.maxTokens) || group.maxTokens <= 0)) {
    throw new Error(`${PKG}: maxTokens must be a positive safe integer`);
  }
  const streamIdleTimeoutMs = group.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `${PKG}: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`
    );
  }
  const defaultContextWindow = group.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const proxyEnabled = group.proxy?.enabled === true;
  const proxyUrlRaw = group.proxy?.url ?? DEFAULT_PROXY_URL;
  if (proxyEnabled) validateProxyUrl(proxyUrlRaw, PKG);
  return {
    provider: route,
    displayName: group.name ?? group.id,
    apiType: group.apiType === "responses" ? "responses" : "chat",
    baseURL: normalizeBaseUrl(rawBase),
    apiKeyRef: groupCredRef(group.id),
    models: resolveModels(group.models),
    modelExcludePatterns,
    defaultContextWindow,
    streamIdleTimeoutMs,
    ...proxyEnabled ? { proxyUrl: proxyUrlRaw } : {},
    providerHints: {
      defaults: { ...group.providerHints?.defaults },
      models: { ...group.providerHints?.models }
    },
    retryPolicy: resolveRetryPolicy(group.retryPolicy, `${PKG}: retryPolicy`),
    ...group.maxTokens === void 0 ? {} : { maxTokens: group.maxTokens }
  };
}
function resolveAdapterOptions(config, environment) {
  const groups = expandGroups(config, environment);
  const first = groups[0];
  if (first === void 0) throw new Error(`${PKG}: at least one gateway group is required`);
  return resolveGroupOptions(first, environment);
}
function apply(ctx, config) {
  let current = () => config;
  let lastConfig;
  let lastGroups;
  let lastDefaultProvider;
  function resolveGroups() {
    const raw = current();
    if (raw === lastConfig && lastGroups !== void 0) return lastGroups;
    try {
      const groups = expandGroups(raw, launchEnvironmentOf(ctx));
      const resolved = groups.map((g) => resolveGroupOptions(g, launchEnvironmentOf(ctx)));
      lastConfig = raw;
      lastGroups = resolved;
      const first = resolved[0];
      lastDefaultProvider = first === void 0 ? "newapi" : first.provider;
      return resolved;
    } catch (error) {
      if (lastGroups === void 0) throw error;
      lastConfig = raw;
      ctx.logger.error(`${PKG}: keeping the last good configuration after an invalid settings section`);
      ctx.logger.error(error);
      return lastGroups;
    }
  }
  const options = (provider) => {
    const groups = resolveGroups();
    const hit = groups.find((g) => g.provider === provider);
    if (hit !== void 0) return hit;
    const fallback = groups[0];
    if (fallback === void 0) {
      throw new Error(`${PKG}: no gateway group is configured; add one on the NewAPI settings page`);
    }
    return fallback;
  };
  const defaultProvider = () => {
    resolveGroups();
    return lastDefaultProvider ?? "newapi";
  };
  const resolveApiKey = async (connection) => {
    const ref = connection.apiKeyRef;
    const credentials = ctx.get("credentials");
    if (credentials !== void 0) {
      const hit = await credentials.resolve(ref);
      if (hit !== void 0) return assertUsableApiKey2(hit.value, PKG, ref);
    }
    throw new LlmError5(
      `${PKG}: no API key for provider route "${connection.provider}"; configure it on the NewAPI settings page in dsh web (credentials reference "${ref}")`,
      "MISSING_CREDENTIAL"
    );
  };
  let indexCache;
  const officialProviderOf = async (modelId) => {
    const routes = ctx.llm.listProviders().map((provider) => provider.id).sort().join(",");
    if (indexCache === void 0 || indexCache.routes !== routes) {
      const byModel = /* @__PURE__ */ new Map();
      for (const provider of ctx.llm.listProviders()) {
        const groups = resolveGroups();
        if (groups.some((g) => g.provider === provider.id)) continue;
        try {
          for (const model of await ctx.llm.listModels(provider.id)) {
            byModel.set(model.id, provider.id);
          }
        } catch {
        }
      }
      indexCache = { routes, byModel };
    }
    return indexCache.byModel.get(modelId);
  };
  const adapter = new NewApiAdapter({
    options,
    defaultProvider,
    resolveApiKey,
    officialProviderOf,
    // Resolve image bytes from the attachment store lazily: the service may
    // mount after this plugin, so read it per request. Absent service (or a
    // vision row with no resolver) keeps the text-only wire.
    resolveImage: (ref, signal) => {
      const store = ctx.get("attachments");
      if (store?.readImage === void 0) {
        throw new LlmError5("The NewAPI chat-completions adapter has no image resolver available.", "UNSUPPORTED_CONTENT");
      }
      return store.readImage(ref, signal);
    }
  });
  const initial = resolveGroups();
  const entriesInitial = initial.map((g) => ({
    provider: g.provider,
    displayName: g.displayName,
    settingsNs: NS,
    settingsPath: settingsPathOf(current(), g.provider),
    declared: true
  }));
  const directory = ctx.llm.registerConfigurableProviders(entriesInitial);
  const registration = ctx.llm.registerAdapter(initial.map((g) => g.provider), adapter);
  function syncProviders() {
    const groups = resolveGroups();
    const entries = groups.map((g) => ({
      provider: g.provider,
      displayName: g.displayName,
      settingsNs: NS,
      settingsPath: settingsPathOf(current(), g.provider),
      declared: true
    }));
    directory.replace(entries);
    registration.replace(groups.map((g) => g.provider));
  }
  ctx.llm.registerModelDiscovery(NS, (request, signal) => adapter.discoverModels(request, signal));
  ctx.inject(["connection"], (cctx) => {
    const connection = cctx.get("connection");
    cctx.effect(() => connection.rpc.handle(
      "/llm-newapi",
      (endpoint, payload, signal) => {
        if (endpoint !== "models-dev-params") {
          return Promise.resolve({
            ok: false,
            error: { code: "internal", message: `llm-newapi: unknown endpoint ${endpoint}`, details: {} }
          });
        }
        const request = payload;
        return adapter.fetchModelsDevParams(request, signal).then((value) => ({ ok: true, value })).catch((error) => ({
          ok: false,
          error: {
            code: "internal",
            message: error instanceof Error ? error.message : String(error),
            details: {}
          }
        }));
      }
    ), "llm-newapi: models-dev RPC channel");
  });
  syncProviders();
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      validate: (value) => {
        const groups = expandGroups(value, launchEnvironmentOf(ctx));
        for (const g of groups) resolveGroupOptions(g, launchEnvironmentOf(ctx));
      },
      setSource: (source) => {
        current = source;
      },
      onChange: syncProviders
    });
  });
}
export {
  Config,
  DEFAULT_BASE_URL,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MODEL_EXCLUDE_PATTERNS,
  DEFAULT_PROVIDER_HINTS,
  DEFAULT_PROXY_URL,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  NewApiAdapter,
  PKG,
  apply,
  inject,
  matchModelsDev,
  modelNameFromId,
  name,
  normalizeBaseUrl,
  resolveAdapterOptions,
  resolveGroupOptions,
  serializeRequest,
  serializeResponsesRequest
};
//# sourceMappingURL=index.js.map
