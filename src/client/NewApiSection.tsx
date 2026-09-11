/**
 * The NewAPI settings section: a group manager for multiple third-party
 * gateways. Each group is a card with its own API key (write-only), gateway
 * base URL, proxy, and model catalog with endpoint interrogation. The model
 * catalog mirrors the official Models page: one bordered entry per model with
 * id and display name on the row, capacities + reasoning efforts + a vision
 * toggle behind the row's own disclosure. Pure props — no ctx, no contexts,
 * no subscription machinery; everything arrives through the inject face the
 * apply closure owns. Styles come from the fiber-scoped `newapi-*` stylesheet.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ClientRemote, LlmDiscoveredModel, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { NewApiKey } from './locale.ts'
import type { ModelsDevParamsRequest, ModelsDevParamsResponse } from './params-types.ts'

/**
 * One editable group entry, structurally open like the official editors: a
 * field this card does not edit survives being edited here rather than being
 * dropped by a rebuild.
 */
type GroupDraft = Record<string, unknown>

/** A group's model rows, structurally open like the official editors. */
type ModelDraft = Record<string, unknown>

/** A row's text field, or the empty string when unset or not a string. */
function textOf(model: GroupDraft | ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/** A row's numeric field, or `undefined` when unset or not a number. */
function numberOf(model: ModelDraft, key: string): number | undefined {
  const value = model[key]
  return typeof value === 'number' ? value : undefined
}

/** The two token counts edited as K/M-suffixed text behind a row's disclosure. */
type CapacityField = 'contextWindow' | 'maxTokens'

/** Accepted capacity spellings: a decimal count with an optional K/M suffix. */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i

/** Decimal suffix scales — `1M` is 1000K, matching how model capacities are quoted. */
const CAPACITY_SCALE = { k: 1_000, m: 1_000_000 } as const

/** Read a typed capacity, so a user can write `256K` or `1M`. */
function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const match = CAPACITY_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  const suffix = match[2]?.toLowerCase()
  const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix] : 1
  const scaled = Number(match[1]) * scale
  const rounded = Math.round(scaled)
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
}

/** Spell a stored count back in the shortest round-trippable form. */
function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value)
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`
  return String(value)
}

/** What an empty capacity field is worth, shown as its placeholder. */
const CAPACITY_HINT: Readonly<Record<CapacityField, string>> = {
  contextWindow: '128K',
  maxTokens: '8K',
}

/** The highest rung in a row's declared efforts — the dropdown's value when no preset was chosen. */
const EFFORT_RUNG: Readonly<Record<string, number>> = {
  max: 7, xhigh: 6, high: 5, medium: 4, low: 3, minimal: 2, none: 1, default: 0,
}

function highestOf(efforts: readonly unknown[]): string {
  const ids = efforts.filter((effort): effort is string => typeof effort === 'string')
  return [...ids].sort((a, b) => (EFFORT_RUNG[b] ?? -1) - (EFFORT_RUNG[a] ?? -1))[0] ?? ''
}

/** Whether a discovered model matches the candidate filter text: empty matches
 *  everything, otherwise a case-insensitive substring of the id or display name. */
function matchesFilter(model: LlmDiscoveredModel, filter: string): boolean {
  const needle = filter.trim().toLowerCase()
  if (needle.length === 0) return true
  if (model.id.toLowerCase().includes(needle)) return true
  return model.name !== undefined && model.name.toLowerCase().includes(needle)
}

/** Disclosure chevron; rotates to point down while its row is open. */
function IconChevron({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
      style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
    >
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Removal glyph for one model row / group. */
function IconTrash(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/** Add glyph (used for "add group" / "add model"). */
function IconPlus(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Inject face: the typed Remote projection, the bound translate, and the models.dev params call. */
export interface NewApiSectionProps {
  api: Pick<ClientRemote, 'settings' | 'credentials' | 'llm'>
  t: (key: NewApiKey) => string
  fetchModelParams: (
    request: ModelsDevParamsRequest,
  ) => Promise<{ ok: true; value: ModelsDevParamsResponse } | { ok: false; error: { message: string } }>
}

const NS = 'llm-newapi'
/** The default proxy text box's value and placeholder (mirrors the host default). */
const DEFAULT_PROXY_URL = 'http://127.0.0.1:7890'

/** Provider route for a group id (mirrors the host's groupRoute). */
function groupRoute(id: string): string {
  return id === 'newapi' ? 'newapi' : `newapi-${id}`
}

/**
 * Credential ref for a group id (mirrors the host's groupCredRef). The
 * credentials seam forbids hyphens, so the ref uses the underscore form while
 * the provider route keeps the hyphenated `newapi-<id>`.
 */
function groupCredRef(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_]/g, '_')
  return id === 'newapi' ? 'newapi' : `newapi_${safe}`
}

/**
 * Derived credential ref for a group's official-direct API key (mirrors the
 * host's groupOfficialCredRef): the `deepseek_official` prefix never collides
 * with a gateway ref nor the official plugin's DEEPSEEK_API_KEY reference, so
 * each group keeps one key per mode.
 */
function groupOfficialCredRef(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_]/g, '_')
  return id === 'newapi' ? 'deepseek_official' : `deepseek_official_${safe}`
}

/** Wire protocol of a group: `chat` (default) or `responses`. */
function apiTypeOf(group: GroupDraft): 'chat' | 'responses' {
  return textOf(group, 'apiType') === 'responses' ? 'responses' : 'chat'
}

/** Connection mode of a group: `newapi` (default) or `official-direct`. */
function modeOf(group: GroupDraft): 'newapi' | 'official-direct' {
  return textOf(group, 'mode') === 'official-direct' ? 'official-direct' : 'newapi'
}

/** Convert a stored section value into editable group drafts without dropping fields. */
function toGroupDrafts(source: unknown): GroupDraft[] {
  if (Array.isArray(source)) {
    return source.map(entry =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? entry as GroupDraft
        : {})
  }
  return []
}

/** Convert a stored model list into editable rows without dropping fields. */
function toModelDrafts(source: unknown): ModelDraft[] {
  if (!Array.isArray(source)) return []
  return source.map(entry =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? entry as ModelDraft
      : {})
}

/** Buffer key for one capacity field; the row half moves when rows do. */
function bufferKey(index: number, field: CapacityField): string {
  return `${String(index)}:${field}`
}

/**
 * Render the NewAPI settings section.
 */
export function NewApiSection(props: NewApiSectionProps): ReactNode {
  const { api, t } = props
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorText, setErrorText] = useState<string | undefined>(undefined)
  const [revision, setRevision] = useState<number>(0)
  const [writable, setWritable] = useState(true)
  // Group drafts (each holds id/name/baseURL/models/proxy/...).
  const [groups, setGroups] = useState<GroupDraft[]>([])
  // Credential facts per group ref.
  const [credentials, setCredentials] = useState<Record<string, { configured: boolean; locked: boolean }>>({})
  // Per-group key draft (write-only input buffers).
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  // Expanded groups: Set<groupId>.
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set())
  // Per-group expanded model rows: Map<groupId, Set<rowIndex>>.
  const [expandedModels, setExpandedModels] = useState<ReadonlyMap<string, ReadonlySet<number>>>(new Map())
  // Per-group capacity edit buffers: Map<groupId, Map<bufferKey, string>>.
  const [editing, setEditing] = useState<ReadonlyMap<string, ReadonlyMap<string, string>>>(new Map())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  // Fetch-model candidates + picked per group.
  const [candidates, setCandidates] = useState<ReadonlyMap<string, readonly LlmDiscoveredModel[]>>(new Map())
  const [picked, setPicked] = useState<ReadonlyMap<string, ReadonlySet<string>>>(new Map())
  // Per-group candidate filter text (live search input).
  const [filters, setFilters] = useState<ReadonlyMap<string, string>>(new Map())
  // Per-group proxy drafts.
  const [proxies, setProxies] = useState<ReadonlyMap<string, { enabled: boolean; url: string }>>(new Map())
  // Per-group models.dev params panel.
  const [params, setParams] = useState<ReadonlyMap<string, ModelsDevParamsResponse>>(new Map())
  const [paramChoices, setParamChoices] = useState<ReadonlyMap<string, ReadonlyMap<string, number>>>(new Map())
  const [paramsBusy, setParamsBusy] = useState(false)
  const paramsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    paramsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }, [params])

  /** Per-group model rows. */
  const modelsOf = (group: GroupDraft): ModelDraft[] => toModelDrafts(group.models)

  const load = async (): Promise<void> => {
    setStatus('loading')
    setErrorText(undefined)
    try {
      const described = await api.settings.describe()
      if (!described.ok) {
        setErrorText(described.error.message)
        setStatus('error')
        return
      }
      setWritable(described.value.writable)
      const section = described.value.namespaces.find((entry: SettingsNamespaceView) => entry.ns === NS)
      if (section === undefined) {
        setErrorText(t('nsNotRegistered'))
        setStatus('error')
        return
      }
      const value = (section.value ?? {}) as Record<string, unknown>
      setRevision(section.revision)
      // Accept both the new `groups` array and the legacy flat section as a
      // single group, so an existing settings.yaml keeps rendering.
      const storedGroups = Array.isArray(value.groups) && value.groups.length > 0
        ? value.groups
        : [{ id: 'newapi', ...(typeof value.baseURL === 'string' ? { baseURL: value.baseURL } : {}), ...(Array.isArray(value.models) ? { models: value.models } : {}) }]
      const drafts = toGroupDrafts(storedGroups)
      setGroups(drafts)
      // Credential facts for every group ref — the gateway ref of every group
      // plus the official ref of each official-direct group.
      const refs = [...new Set(drafts.flatMap(group => {
        const gid = textOf(group, 'id') || 'newapi'
        return modeOf(group) === 'official-direct'
          ? [groupCredRef(gid), groupOfficialCredRef(gid)]
          : [groupCredRef(gid)]
      }))]
      const credential = await api.credentials.describe(refs)
      if (credential.ok) {
        const byRef: Record<string, { configured: boolean; locked: boolean }> = {}
        for (const ref of refs) {
          const view = credential.value[ref]
          byRef[ref] = {
            configured: view?.configured === true,
            locked: view?.writable === false,
          }
        }
        setCredentials(byRef)
      }
      // Groups start collapsed: with several gateways an expanded-by-default
      // page is a wall of forms. The chevron opens one on demand.
      setExpandedGroups(new Set())
      setExpandedModels(new Map())
      setEditing(new Map())
      setKeyDrafts({})
      setStatus('ready')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
      setStatus('error')
    }
  }

  useEffect(() => { void load() }, [])

  const saved = (text: string): void => {
    setNotice(text)
    void load()
  }

  /** Refuse the save when a group or model row cannot be written. */
  const catalogProblem = (): string | undefined => {
    const seenGroups = new Set<string>()
    for (const [gIndex, group] of groups.entries()) {
      const gid = textOf(group, 'id').trim()
      if (gid.length === 0) return `${t('groupIdRequired')} (${t('groups')} ${String(gIndex + 1)})`
      if (seenGroups.has(gid)) return `${t('groupIdDuplicate')} (${gid})`
      seenGroups.add(gid)
      const seen = new Set<string>()
      for (const [index, model] of modelsOf(group).entries()) {
        const id = textOf(model, 'id').trim()
        if (id.length === 0) return `${t('modelIdRequired')} (${t('models')} ${String(index + 1)})`
        if (seen.has(id)) return `${t('modelIdDuplicate')} (${id})`
        seen.add(id)
        for (const field of ['contextWindow', 'maxTokens'] as const) {
          const groupEditing = editing.get(gid) ?? new Map<string, string>()
          const buffer = groupEditing.get(bufferKey(index, field))
          if (buffer !== undefined && Number.isNaN(parseCapacity(buffer) ?? 0)) {
            return `${t('capacityInvalid')} (${id} · ${t(field)})`
          }
        }
      }
    }
    return undefined
  }

  const save = async (): Promise<void> => {
    const problem = catalogProblem()
    if (problem !== undefined) {
      setErrorText(problem)
      return
    }
    setBusy(true)
    setNotice(undefined)
    setErrorText(undefined)
    try {
      const ops: SettingsPathOpView[] = []
      const serializedGroups = groups.map(group => {
        const id = textOf(group, 'id').trim()
        const name = textOf(group, 'name').trim()
        const baseURL = textOf(group, 'baseURL').trim()
        const mode = modeOf(group)
        const officialBaseURL = textOf(group, 'officialBaseURL').trim()
        const proxy = proxies.get(id)
        const models = mode === 'official-direct' ? [] : modelsOf(group).map(model => {
          const mid = textOf(model, 'id').trim()
          const mname = textOf(model, 'name').trim()
          const contextWindow = numberOf(model, 'contextWindow')
          const maxTokens = numberOf(model, 'maxTokens')
          const efforts = Array.isArray(model.reasoningEfforts)
            ? model.reasoningEfforts.filter((effort): effort is string => typeof effort === 'string' && effort.length > 0)
            : []
          const preset = typeof model.defaultReasoningEffort === 'string'
            && efforts.includes(model.defaultReasoningEffort)
            ? model.defaultReasoningEffort
            : undefined
          return {
            id: mid,
            ...mname.length > 0 ? { name: mname } : {},
            ...contextWindow !== undefined ? { contextWindow } : {},
            ...maxTokens !== undefined ? { maxTokens } : {},
            ...efforts.length > 0 ? { reasoningEfforts: efforts } : {},
            ...preset !== undefined ? { defaultReasoningEffort: preset } : {},
            ...model.vision === true ? { vision: true } : {},
          }
        })
        return {
          id,
          ...name.length > 0 ? { name } : {},
          ...mode === 'official-direct' ? { mode: 'official-direct' as const } : {},
          ...mode === 'official-direct' && officialBaseURL.length > 0 ? { officialBaseURL } : {},
          ...baseURL.length > 0 && mode === 'newapi' ? { baseURL } : {},
          ...apiTypeOf(group) === 'responses' && mode === 'newapi' ? { apiType: 'responses' as const } : {},
          models,
          ...mode === 'newapi' && proxy !== undefined ? {
            proxy: {
              enabled: proxy.enabled,
              url: proxy.url.trim().length > 0 ? proxy.url.trim() : DEFAULT_PROXY_URL,
            },
          } : {},
        }
      })
      // Replace the whole groups array in one op; drop the legacy flat keys.
      ops.push({ op: 'set', path: ['groups'], value: serializedGroups })
      ops.push({ op: 'unset', path: ['baseURL'] })
      ops.push({ op: 'unset', path: ['models'] })
      const mutated = await api.settings.mutate(NS, ops, revision)
      if (!mutated.ok) {
        setErrorText(mutated.error.message)
        return
      }
      setRevision(mutated.value.revision)
      // Write each non-empty key draft to its group's credential ref.
      for (const [ref, draft] of Object.entries(keyDrafts)) {
        const key = draft.trim()
        if (key.length === 0) continue
        const stored = await api.credentials.set(ref, key)
        if (!stored.ok) {
          setErrorText(stored.error.message)
          return
        }
      }
      setKeyDrafts({})
      saved(t('saved'))
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  // ── Group-level operations ───────────────────────────────────────────────

  const patchGroup = (index: number, next: Record<string, unknown>): void => {
    setGroups(current => current.map((group, at) => at === index ? { ...group, ...next } : group))
  }

  const addGroup = (): void => {
    const id = `gw${String(groups.length + 1)}`
    setGroups(current => [...current, { id, name: '', baseURL: '' }])
    setExpandedGroups(current => new Set(current).add(id))
  }

  const removeGroup = (index: number): void => {
    const id = textOf(groups[index] ?? {}, 'id')
    setGroups(current => current.filter((_g, at) => at !== index))
    if (id.length > 0) {
      const nextExpanded = new Set(expandedGroups)
      nextExpanded.delete(id)
      setExpandedGroups(nextExpanded)
    }
  }

  const toggleGroupExpanded = (id: string): void => {
    setExpandedGroups(current => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  /** Remap every per-group UI state from one group id to another when the id field is edited. */
  const remapGroupId = (oldId: string, newId: string): void => {
    if (oldId === newId) return
    setExpandedGroups(current => {
      const next = new Set(current)
      if (next.has(oldId)) { next.delete(oldId); next.add(newId) }
      return next
    })
    const remapMap = <T,>(current: ReadonlyMap<string, T>): ReadonlyMap<string, T> => {
      if (!current.has(oldId)) return current
      const next = new Map(current)
      const value = next.get(oldId)
      if (value !== undefined) next.set(newId, value)
      next.delete(oldId)
      return next
    }
    setExpandedModels(current => remapMap(current))
    setEditing(current => remapMap(current))
    setCandidates(current => remapMap(current))
    setPicked(current => remapMap(current))
    setFilters(current => remapMap(current))
    setProxies(current => remapMap(current))
    setParams(current => remapMap(current))
    setParamChoices(current => remapMap(current))
  }

  // ── Per-model operations (within one group) ──────────────────────────────

  const patchModel = (gid: string, index: number, next: Record<string, string | number | boolean | string[] | undefined>): void => {
    setGroups(current => current.map(group => {
      if (textOf(group, 'id') !== gid) return group
      const models = modelsOf(group).map((model, at) => {
        if (at !== index) return model
        const cleared = new Set(
          Object.entries(next).filter(([, value]) => value === undefined || value === '').map(([key]) => key),
        )
        return Object.fromEntries(
          Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)),
        )
      })
      return { ...group, models }
    }))
  }

  const toggleModelExpanded = (gid: string, index: number): void => {
    setExpandedModels(current => {
      const rows = new Set(current.get(gid) ?? new Set<number>())
      if (!rows.delete(index)) rows.add(index)
      return new Map(current).set(gid, rows)
    })
  }

  const capacityText = (gid: string, model: ModelDraft, index: number, field: CapacityField): string =>
    (editing.get(gid) ?? new Map<string, string>()).get(bufferKey(index, field))
      ?? (numberOf(model, field) === undefined ? '' : formatCapacity(numberOf(model, field) as number))

  const editCapacity = (gid: string, index: number, field: CapacityField, text: string): void => {
    setEditing(current => {
      const groupEditing = new Map(current.get(gid) ?? new Map<string, string>())
      groupEditing.set(bufferKey(index, field), text)
      return new Map(current).set(gid, groupEditing)
    })
    patchModel(gid, index, { [field]: parseCapacity(text) })
  }

  /** Reindex a group's edit buffers after a row removal. */
  const reindexOnRemove = (current: ReadonlyMap<string, ReadonlyMap<string, string>>, gid: string, index: number): ReadonlyMap<string, ReadonlyMap<string, string>> => {
    const groupEditing = current.get(gid)
    if (groupEditing === undefined) return current
    const next = new Map<string, string>()
    for (const [key, value] of groupEditing) {
      const at = Number(key.slice(0, key.indexOf(':')))
      if (at === index) continue
      next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, value)
    }
    return new Map(current).set(gid, next)
  }

  const removeModel = (gid: string, index: number): void => {
    setGroups(current => current.map(group => {
      if (textOf(group, 'id') !== gid) return group
      return { ...group, models: modelsOf(group).filter((_m, at) => at !== index) }
    }))
    setExpandedModels(current => {
      const rows = current.get(gid)
      if (rows === undefined) return current
      const next = new Set<number>()
      for (const at of rows) {
        if (at < index) next.add(at)
        else if (at > index) next.add(at - 1)
      }
      return new Map(current).set(gid, next)
    })
    setEditing(current => reindexOnRemove(current, gid, index))
  }

  const addModel = (gid: string): void => {
    setGroups(current => current.map(group => {
      if (textOf(group, 'id') !== gid) return group
      return { ...group, models: [...modelsOf(group), { id: '' }] }
    }))
  }

  const clearModels = (gid: string): void => {
    setGroups(current => current.map(group => {
      if (textOf(group, 'id') !== gid) return group
      return { ...group, models: [] }
    }))
    setExpandedModels(current => new Map(current).set(gid, new Set()))
    setEditing(current => new Map(current).set(gid, new Map()))
    setParams(current => new Map(current).set(gid, undefined as never))
    setParamChoices(current => new Map(current).set(gid, new Map()))
  }

  // ── Per-group model discovery + models.dev params ────────────────────────

  const fetchModels = async (gid: string): Promise<void> => {
    setBusy(true)
    setErrorText(undefined)
    setCandidates(current => new Map(current).set(gid, undefined as never))
    try {
      const group = groups.find(g => textOf(g, 'id') === gid)
      const baseURL = textOf(group ?? {}, 'baseURL').trim()
      const key = (keyDrafts[groupCredRef(gid)] ?? '').trim()
      const response = await api.llm.discoverModels(NS, {
        ...baseURL.length > 0 ? { provider: groupRoute(gid), baseURL } : { provider: groupRoute(gid) },
        ...key.length > 0 ? { apiKey: key } : {},
      })
      if (!response.ok) {
        setErrorText(response.error.message)
        return
      }
      const found = response.value
      found.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      if (found.length === 0) {
        setErrorText(t('fetchEmpty'))
        return
      }
      const groupModels = toModelDrafts(group?.models)
      const known = new Set(groupModels.map(model => textOf(model, 'id')))
      setCandidates(current => new Map(current).set(gid, found))
      setPicked(current => new Map(current).set(gid, new Set(found.filter(model => !known.has(model.id)).map(model => model.id))))
      setFilters(current => new Map(current).set(gid, ''))
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const adopt = (gid: string): void => {
    const found = candidates.get(gid)
    if (found === undefined) return
    const group = groups.find(g => textOf(g, 'id') === gid)
    const existing = new Map(modelsOf(group ?? {}).map(model => [textOf(model, 'id'), model]))
    const selected = picked.get(gid) ?? new Set<string>()
    for (const candidate of found) {
      if (!selected.has(candidate.id)) continue
      if (existing.has(candidate.id)) continue
      existing.set(candidate.id, {
        id: candidate.id,
        ...candidate.name === undefined ? {} : { name: candidate.name },
        ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
        ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
      })
    }
    const merged = [...existing.values()].sort((a, b) => {
      const ai = textOf(a, 'id').trim()
      const bi = textOf(b, 'id').trim()
      if (ai.length === 0) return bi.length === 0 ? 0 : 1
      if (bi.length === 0) return -1
      return ai < bi ? -1 : ai > bi ? 1 : 0
    })
    patchGroup(groups.findIndex(g => textOf(g, 'id') === gid), { models: merged })
    setCandidates(current => new Map(current).set(gid, undefined as never))
    setPicked(current => new Map(current).set(gid, new Set()))
    setFilters(current => new Map(current).set(gid, ''))
  }

  const toggle = (gid: string, id: string): void => {
    setPicked(current => {
      const next = new Set(current.get(gid) ?? new Set<string>())
      if (!next.delete(id)) next.add(id)
      return new Map(current).set(gid, next)
    })
  }

  /** Select or deselect every candidate currently visible under the group filter. */
  const toggleAll = (gid: string): void => {
    const filter = filters.get(gid) ?? ''
    const visible = (candidates.get(gid) ?? []).filter(model => matchesFilter(model, filter))
    if (visible.length === 0) return
    const selected = picked.get(gid) ?? new Set<string>()
    const allSelected = visible.every(model => selected.has(model.id))
    setPicked(current => {
      const next = new Set(current.get(gid) ?? new Set<string>())
      for (const model of visible) {
        if (allSelected) next.delete(model.id)
        else next.add(model.id)
      }
      return new Map(current).set(gid, next)
    })
  }

  /** Ask the host what models.dev knows about one group's rows. */
  const updateParams = async (gid: string): Promise<void> => {
    const group = groups.find(g => textOf(g, 'id') === gid)
    const ids = modelsOf(group ?? {}).map(model => textOf(model, 'id').trim()).filter(id => id.length > 0)
    if (ids.length === 0) {
      setErrorText(t('paramsNoModels'))
      return
    }
    const proxy = proxies.get(gid)
    setParamsBusy(true)
    setErrorText(undefined)
    setParams(current => new Map(current).set(gid, undefined as never))
    try {
      const response = await props.fetchModelParams({
        provider: groupRoute(gid),
        modelIds: ids,
        ...proxy !== undefined && proxy.enabled && proxy.url.trim().length > 0 ? { proxyUrl: proxy.url.trim() } : {},
      })
      if (!response.ok) {
        setErrorText(response.error.message)
        return
      }
      setParams(current => new Map(current).set(gid, response.value))
      setParamChoices(current => new Map(current).set(gid, new Map()))
      const matched = response.value.models.filter(entry => entry.matches.length > 0).length
      setNotice(
        t('paramsSummary')
          .replace('{matched}', String(matched))
          .replace('{unmatched}', String(response.value.models.length - matched)),
      )
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setParamsBusy(false)
    }
  }

  const chosenMatch = (gid: string, entry: { id: string; matches: ModelsDevParamsResponse['models'][number]['matches'] }) =>
    entry.matches[(paramChoices.get(gid) ?? new Map<string, number>()).get(entry.id) ?? 0] ?? entry.matches[0]

  /** Apply the panel's chosen matches to the rows. */
  const applyParams = (gid: string, overwrite: boolean): void => {
    const groupParams = params.get(gid)
    if (groupParams === undefined) return
    const byId = new Map(groupParams.models.map(entry => [entry.id, entry]))
    let touched = 0
    const group = groups.find(g => textOf(g, 'id') === gid)
    const next = modelsOf(group ?? {}).map(model => {
      const id = textOf(model, 'id').trim()
      const entry = byId.get(id)
      const match = entry === undefined || entry.matches.length === 0 ? undefined : chosenMatch(gid, entry)
      if (match === undefined) return model
      const nextContext = match.contextWindow
      const nextMax = match.maxTokens
      const nextEfforts = match.reasoningEfforts
      const currentContext = numberOf(model, 'contextWindow')
      const currentMax = numberOf(model, 'maxTokens')
      const hasEfforts = Array.isArray(model.reasoningEfforts)
      const takeContext = nextContext !== undefined && (overwrite || currentContext === undefined)
      const takeMax = nextMax !== undefined && (overwrite || currentMax === undefined)
      const takeEfforts = nextEfforts !== undefined && nextEfforts.length > 0 && (overwrite || !hasEfforts)
      const takeVision = match.vision === true && (overwrite || model.vision !== true)
      if (!takeContext && !takeMax && !takeEfforts && !takeVision) return model
      touched += 1
      return {
        ...model,
        ...takeContext && nextContext !== undefined ? { contextWindow: nextContext } : {},
        ...takeMax && nextMax !== undefined ? { maxTokens: nextMax } : {},
        ...takeEfforts && nextEfforts !== undefined ? { reasoningEfforts: nextEfforts } : {},
        ...takeVision ? { vision: true } : {},
      }
    })
    patchGroup(groups.findIndex(g => textOf(g, 'id') === gid), { models: next })
    setParams(current => new Map(current).set(gid, undefined as never))
    setParamChoices(current => new Map(current).set(gid, new Map()))
    setNotice(`${t('paramsApplied')} (${String(touched)})`)
  }

  if (status === 'loading') return <section aria-label={t('nav')}><p>…</p></section>
  if (status === 'error') {
    return (
      <section aria-label={t('nav')}>
        <p className="newapi-error">{`${t('loadFailed')}: ${errorText ?? ''}`}</p>
        <button type="button" className="newapi-button" onClick={() => { void load() }}>{t('retry')}</button>
      </section>
    )
  }

  return (
    <section aria-label={t('nav')}>
      <p className="newapi-intro">{t('intro')}</p>
      {notice === undefined ? null : <p role="status">{notice}</p>}
      {!writable ? <p>{t('readOnly')}</p> : null}
      {errorText === undefined ? null : <p className="newapi-error">{errorText}</p>}

      <div className="newapi-groups">
        {groups.length === 0 ? <p className="newapi-empty">{t('noGroups')}</p> : null}
        {groups.map((group, index) => {
          const gid = textOf(group, 'id').trim()
          const mode = modeOf(group)
          const ref = groupCredRef(gid.length > 0 ? gid : 'newapi')
          const cred = credentials[ref]
          // Official-direct facts: the group's official credential ref, its
          // stored/locked state, and the write-only key draft buffer.
          const officialRef = groupOfficialCredRef(gid.length > 0 ? gid : 'newapi')
          const officialCred = mode === 'official-direct' ? credentials[officialRef] : undefined
          const officialKeyDraft = mode === 'official-direct' ? keyDrafts[officialRef] ?? '' : ''
          const expanded = expandedGroups.has(gid)
          const groupModels = mode === 'official-direct' ? [] : modelsOf(group)
          const groupProxy = proxies.get(gid) ?? { enabled: false, url: DEFAULT_PROXY_URL }
          const groupParams = mode === 'official-direct' ? undefined : params.get(gid)
          const groupCandidates = mode === 'official-direct' ? undefined : candidates.get(gid)
          const keyDraft = keyDrafts[ref] ?? ''
          const groupFilter = filters.get(gid) ?? ''
          const visible = (groupCandidates ?? []).filter(model => matchesFilter(model, groupFilter))
          const selected = picked.get(gid) ?? new Set<string>()
          const allVisibleSelected = visible.length > 0 && visible.every(model => selected.has(model.id))

          return (
            <div key={index} className="newapi-group">
              <div className="newapi-group-head">
                <button
                  type="button" className="newapi-group-toggle"
                  aria-label={expanded ? t('groupCollapsed') : t('groupExpanded')}
                  aria-expanded={expanded}
                  onClick={() => { toggleGroupExpanded(gid) }}
                >
                  <IconChevron open={expanded} />
                </button>
                <input
                  className="newapi-input newapi-group-name" type="text"
                  placeholder={t('groupNamePlaceholder')} value={textOf(group, 'name')}
                  aria-label={`${t('groupName')} ${String(index + 1)}`}
                  onChange={(event) => { patchGroup(index, { name: event.target.value }) }}
                />
                <span className="newapi-badge" title={t('groupRoute')}>{groupRoute(gid)}</span>
                {mode === 'official-direct'
                  ? <span className="newapi-badge" title={t('modeOfficialHint')}>{t('officialBadge')}</span>
                  : null}
                {mode === 'newapi' && apiTypeOf(group) === 'responses' ? <span className="newapi-badge" title={t('apiTypeResponsesHint')}>{t('apiTypeResponses')}</span> : null}
                <span
                  className={`newapi-statusdot ${(mode === 'official-direct' ? officialCred?.configured === true : cred?.configured === true) ? 'newapi-statusdot--ok' : 'newapi-statusdot--warn'}`}
                  title={(mode === 'official-direct' ? officialCred?.configured === true : cred?.configured === true) ? t('keyStored') : t('keyMissing')}
                />
                <span className="newapi-count">{mode === 'official-direct' ? t('officialBadge') : `${String(groupModels.length)} ${t('models')}`}</span>
                <button
                  type="button" className="newapi-iconbutton newapi-iconbutton--danger"
                  aria-label={`${t('removeGroup')} ${String(index + 1)}`}
                  title={t('removeGroup')}
                  onClick={() => { removeGroup(index) }}
                >
                  <IconTrash />
                </button>
              </div>

              {expanded
                ? (
                  <div className="newapi-group-body">
                    <div className="newapi-field">
                      <label htmlFor={`newapi-id-${index}`}>{t('groupId')}</label>
                      <input
                        id={`newapi-id-${index}`} type="text" className="newapi-input"
                        placeholder={t('groupIdPlaceholder')} value={textOf(group, 'id')}
                        aria-label={`${t('groupId')} ${String(index + 1)}`}
                        onChange={(event) => {
                          const oldId = textOf(group, 'id')
                          patchGroup(index, { id: event.target.value })
                          remapGroupId(oldId, event.target.value)
                        }}
                      />
                    </div>

                    <div className="newapi-field">
                      <label htmlFor={`newapi-mode-${index}`}>{t('mode')}</label>
                      <select
                        id={`newapi-mode-${index}`} className="newapi-select"
                        aria-label={`${t('mode')} ${String(index + 1)}`}
                        value={modeOf(group)}
                        onChange={(event) => { patchGroup(index, { mode: event.target.value }) }}
                      >
                        <option value="newapi">{t('modeNewapi')}</option>
                        <option value="official-direct">{t('modeOfficial')}</option>
                      </select>
                      {modeOf(group) === 'official-direct' ? <span className="newapi-hint">{t('modeOfficialHint')}</span> : null}
                    </div>

                    {modeOf(group) === 'official-direct'
                      ? (
                        <>
                          <div className="newapi-field">
                            <label htmlFor={`newapi-okey-${index}`}>{t('officialKeyInput')}</label>
                            <input
                              id={`newapi-okey-${index}`} type="password" autoComplete="off" className="newapi-input"
                              disabled={officialCred?.locked === true}
                              aria-label={`${t('officialKeyInput')} ${String(index + 1)}`}
                              placeholder={officialCred?.locked === true
                                ? t('keyEnvLocked')
                                : officialCred?.configured === true ? t('keyStored') : t('keyMissing')}
                              value={officialKeyDraft}
                              onChange={(event) => {
                                setKeyDrafts(current => ({ ...current, [officialRef]: event.target.value }))
                              }}
                            />
                          </div>

                          <div className="newapi-field">
                            <label htmlFor={`newapi-obase-${index}`}>{t('officialBaseUrl')}</label>
                            <input
                              id={`newapi-obase-${index}`} type="text" className="newapi-input" placeholder={t('officialBaseUrlPlaceholder')}
                              value={textOf(group, 'officialBaseURL')}
                              aria-label={`${t('officialBaseUrl')} ${String(index + 1)}`}
                              onChange={(event) => { patchGroup(index, { officialBaseURL: event.target.value }) }}
                            />
                          </div>
                        </>
                      )
                      : (
                        <>
                          <div className="newapi-field">
                            <label htmlFor={`newapi-key-${index}`}>{t('keyInput')}</label>
                            <input
                              id={`newapi-key-${index}`} type="password" autoComplete="off" className="newapi-input"
                              disabled={cred?.locked === true}
                              aria-label={`${t('keyInput')} ${String(index + 1)}`}
                              placeholder={cred?.locked === true
                                ? t('keyEnvLocked')
                                : cred?.configured === true ? t('keyStored') : t('keyMissing')}
                              value={keyDraft}
                              onChange={(event) => {
                                setKeyDrafts(current => ({ ...current, [ref]: event.target.value }))
                              }}
                            />
                          </div>

                          <div className="newapi-field">
                            <label htmlFor={`newapi-base-${index}`}>{t('baseUrl')}</label>
                            <input
                              id={`newapi-base-${index}`} type="text" className="newapi-input" placeholder={t('baseUrlPlaceholder')}
                              value={textOf(group, 'baseURL')}
                              aria-label={`${t('baseUrl')} ${String(index + 1)}`}
                              onChange={(event) => { patchGroup(index, { baseURL: event.target.value }) }}
                            />
                          </div>

                          <div className="newapi-field">
                            <label htmlFor={`newapi-type-${index}`}>{t('apiType')}</label>
                            <select
                              id={`newapi-type-${index}`} className="newapi-select"
                              aria-label={`${t('apiType')} ${String(index + 1)}`}
                              value={apiTypeOf(group)}
                              onChange={(event) => { patchGroup(index, { apiType: event.target.value }) }}
                            >
                              <option value="chat">{t('apiTypeChat')}</option>
                              <option value="responses">{t('apiTypeResponses')}</option>
                            </select>
                            {apiTypeOf(group) === 'responses' ? <span className="newapi-hint">{t('apiTypeResponsesHint')}</span> : null}
                          </div>

                          <div className="newapi-proxyrow">
                            <label>
                              <input
                                type="checkbox" checked={groupProxy.enabled}
                                aria-label={`${t('proxyToggle')} ${String(index + 1)}`}
                                onChange={(event) => {
                                  setProxies(current => new Map(current).set(gid, { ...groupProxy, enabled: event.target.checked }))
                                }}
                              />
                              {t('proxyToggle')}
                            </label>
                            {groupProxy.enabled
                              ? (
                                <input
                                  className="newapi-input" type="text" style={{ maxWidth: 220 }}
                                  aria-label={`${t('proxyUrl')} ${String(index + 1)}`} placeholder={DEFAULT_PROXY_URL}
                                  value={groupProxy.url}
                                  onChange={(event) => {
                                    setProxies(current => new Map(current).set(gid, { ...groupProxy, url: event.target.value }))
                                  }}
                                />
                              )
                              : null}
                          </div>

                          <section className="newapi-catalog" aria-label={`${t('models')} ${String(index + 1)}`}>
                            <div className="newapi-catalog-head">
                              <span className="newapi-catalog-title">{t('models')}</span>
                              <div className="newapi-catalog-actions" style={{ display: 'flex', gap: 4 }}>
                                <button type="button" className="newapi-linkbutton" disabled={busy} onClick={() => { void fetchModels(gid) }}>
                                  {busy ? t('fetching') : t('fetchModels')}
                                </button>
                                <button type="button" className="newapi-linkbutton" disabled={paramsBusy} onClick={() => { void updateParams(gid) }}>
                                  {paramsBusy ? t('paramsFetching') : t('updateParams')}
                                </button>
                                <button type="button" className="newapi-linkbutton" disabled={busy || groupModels.length === 0} onClick={() => { clearModels(gid) }}>
                                  {t('clearModels')}
                                </button>
                              </div>
                            </div>
                            {groupModels.length === 0 ? <p className="newapi-empty">{t('modelsEmpty')}</p> : null}
                            {groupModels.map((model, mIndex) => {
                              const rowExpanded = (expandedModels.get(gid) ?? new Set<number>()).has(mIndex)
                              return (
                                <div key={mIndex} className="newapi-entry">
                                  <div className="newapi-modelrow">
                                    <input
                                      className="newapi-input" type="text" value={textOf(model, 'id')}
                                      placeholder={t('modelId')} aria-label={`${t('modelId')} ${String(mIndex + 1)}`}
                                      onChange={(event) => { patchModel(gid, mIndex, { id: event.target.value }) }}
                                    />
                              <input
                                className="newapi-input" type="text" value={textOf(model, 'name')}
                                placeholder={t('modelName')} aria-label={`${t('modelName')} ${String(mIndex + 1)}`}
                                onChange={(event) => { patchModel(gid, mIndex, { name: event.target.value === '' ? undefined : event.target.value }) }}
                              />
                              <label className="newapi-vision" title={t('visionHint')}>
                                <input
                                  type="checkbox" checked={model.vision === true}
                                  aria-label={`${t('vision')} ${String(mIndex + 1)}`}
                                  onChange={(event) => { patchModel(gid, mIndex, { vision: event.target.checked }) }}
                                />
                                {t('vision')}
                              </label>
                              <button
                                type="button" className="newapi-iconbutton"
                                aria-label={`${t('modelAdvanced')} ${String(mIndex + 1)}`}
                                aria-expanded={rowExpanded}
                                title={t('modelAdvanced')}
                                onClick={() => { toggleModelExpanded(gid, mIndex) }}
                              >
                                <IconChevron open={rowExpanded} />
                              </button>
                              <button
                                type="button" className="newapi-iconbutton newapi-iconbutton--danger"
                                aria-label={`${t('removeModel')} ${String(mIndex + 1)}`}
                                title={t('removeModel')}
                                onClick={() => { removeModel(gid, mIndex) }}
                              >
                                <IconTrash />
                              </button>
                            </div>
                            {rowExpanded
                              ? (
                                <div className="newapi-modeladvanced">
                                  <label className="newapi-modelfield">
                                    <span className="newapi-modelfield-label">{t('contextWindow')}</span>
                                    <input
                                      className="newapi-input" type="text" inputMode="numeric"
                                      value={capacityText(gid, model, mIndex, 'contextWindow')}
                                      placeholder={CAPACITY_HINT.contextWindow}
                                      aria-label={`${t('contextWindow')} ${String(mIndex + 1)}`}
                                      onChange={(event) => { editCapacity(gid, mIndex, 'contextWindow', event.target.value) }}
                                    />
                                  </label>
                                  <label className="newapi-modelfield">
                                    <span className="newapi-modelfield-label">{t('maxTokens')}</span>
                                    <input
                                      className="newapi-input" type="text" inputMode="numeric"
                                      value={capacityText(gid, model, mIndex, 'maxTokens')}
                                      placeholder={CAPACITY_HINT.maxTokens}
                                      aria-label={`${t('maxTokens')} ${String(mIndex + 1)}`}
                                      onChange={(event) => { editCapacity(gid, mIndex, 'maxTokens', event.target.value) }}
                                    />
                                  </label>
                                  <label className="newapi-modelfield">
                                    <span className="newapi-modelfield-label">{t('reasoningEfforts')}</span>
                                    <input
                                      className="newapi-input" type="text"
                                      placeholder={t('reasoningEffortsPlaceholder')}
                                      aria-label={`${t('reasoningEfforts')} ${String(mIndex + 1)}`}
                                      value={Array.isArray(model.reasoningEfforts)
                                        ? model.reasoningEfforts.filter((e): e is string => typeof e === 'string').join(', ')
                                        : ''}
                                      onChange={(event) => {
                                        const efforts = event.target.value.split(',')
                                          .map(part => part.trim())
                                          .filter(part => part.length > 0)
                                        patchModel(gid, mIndex, { reasoningEfforts: efforts.length > 0 ? efforts : undefined })
                                      }}
                                    />
                                  </label>
                                  {Array.isArray(model.reasoningEfforts) && model.reasoningEfforts.length > 0
                                    ? (
                                      <label className="newapi-modelfield">
                                        <span className="newapi-modelfield-label">{t('defaultEffort')}</span>
                                        <select
                                          className="newapi-select"
                                          aria-label={`${t('defaultEffort')} ${String(mIndex + 1)}`}
                                          value={typeof model.defaultReasoningEffort === 'string'
                                            && model.reasoningEfforts.includes(model.defaultReasoningEffort)
                                            ? model.defaultReasoningEffort
                                            : highestOf(model.reasoningEfforts)}
                                          onChange={(event) => {
                                            patchModel(gid, mIndex, { defaultReasoningEffort: event.target.value })
                                          }}
                                        >
                                          {model.reasoningEfforts.map((effort) => (
                                            <option key={effort} value={effort}>{effort}</option>
                                          ))}
                                        </select>
                                      </label>
                                    )
                                    : null}
                                </div>
                              )
                              : null}
                          </div>
                        )
                      })}
                      <button
                        type="button" className="newapi-addmodel"
                        disabled={busy}
                        onClick={() => { addModel(gid) }}
                      >
                        <IconPlus /> {t('addModel')}
                      </button>
                    </section>

                    {modeOf(group) === 'newapi' && groupCandidates !== undefined ? (
                      <div className="newapi-candidates">
                        <div className="newapi-candidates-head">
                          <strong>{t('fetchTitle')}</strong>
                          <button type="button" className="newapi-linkbutton" disabled={visible.length === 0} onClick={() => { toggleAll(gid) }}>
                            {allVisibleSelected ? t('fetchUnselectAll') : t('fetchSelectAll')}
                          </button>
                        </div>
                        <input
                          className="newapi-input newapi-candidates-search" type="text"
                          placeholder={t('fetchSearch')} aria-label={t('fetchSearch')}
                          value={groupFilter}
                          onChange={(event) => {
                            setFilters(current => new Map(current).set(gid, event.target.value))
                          }}
                        />
                        <ul>
                          {visible.map(model => (
                            <li key={model.id}>
                              <label>
                                <input
                                  type="checkbox" checked={selected.has(model.id)}
                                  onChange={() => { toggle(gid, model.id) }}
                                />
                                {' '}
                                {model.id}{model.name === undefined || model.name === model.id ? '' : ` (${model.name})`}
                              </label>
                            </li>
                          ))}
                        </ul>
                        <button type="button" className="newapi-button newapi-button--primary" disabled={selected.size === 0} onClick={() => { adopt(gid) }}>
                          {t('fetchAdopt')}
                        </button>
                        {' '}
                        <button type="button" className="newapi-button" onClick={() => { setCandidates(current => new Map(current).set(gid, undefined as never)); setPicked(current => new Map(current).set(gid, new Set())); setFilters(current => new Map(current).set(gid, '')) }}>
                          {t('fetchCancel')}
                        </button>
                      </div>
                     ) : null}

                    {modeOf(group) === 'newapi' && groupParams !== undefined ? (
                      <div className="newapi-params" ref={paramsRef}>
                        <strong>{t('paramsTitle')}</strong>
                        <p className="newapi-params-summary">{
                          t('paramsSummary')
                            .replace('{matched}', String(groupParams.models.filter(entry => entry.matches.length > 0).length))
                            .replace('{unmatched}', String(groupParams.models.filter(entry => entry.matches.length === 0).length))
                        }</p>
                        {groupParams.models.map(entry => {
                          if (entry.matches.length === 0) {
                            return (
                              <div key={entry.id} className="newapi-params-row">
                                <span className="newapi-params-id">{entry.id}</span>
                                <span className="newapi-params-unmatched">{t('paramsUnmatched')}</span>
                                <span />
                              </div>
                            )
                          }
                          if (entry.matches.length === 1) {
                            const match = entry.matches[0]
                            if (match === undefined) return null
                            return (
                              <div key={entry.id} className="newapi-params-row">
                                <span className="newapi-params-id">{entry.id}</span>
                                <span className="newapi-params-values">
                                  {`${match.official === true ? `${t('officialMark')} · ` : ''}${match.provider} · ${t('contextWindow')} ${match.contextWindow ?? '—'} / ${t('maxTokens')} ${match.maxTokens ?? '—'}${match.vision === true ? ` · ${t('vision')}` : ''}${match.reasoningEfforts !== undefined && match.reasoningEfforts.length > 0 ? ` · ${t('modelReasoning')}: ${match.reasoningEfforts.join('/')}` : ''}`}
                                </span>
                                <span />
                              </div>
                            )
                          }
                          const chosen = (paramChoices.get(gid) ?? new Map<string, number>()).get(entry.id) ?? 0
                          const match = entry.matches[chosen] ?? entry.matches[0]
                          if (match === undefined) return null
                          return (
                            <div key={entry.id} className="newapi-params-row">
                              <span className="newapi-params-id">{entry.id}</span>
                              <select
                                className="newapi-select" aria-label={`${t('paramsProvider')} ${entry.id}`}
                                value={String(chosen)}
                                onChange={(event) => {
                                  setParamChoices(current => {
                                    const groupChoices = new Map(current.get(gid) ?? new Map<string, number>())
                                    groupChoices.set(entry.id, Number(event.target.value))
                                    return new Map(current).set(gid, groupChoices)
                                  })
                                }}
                              >
                                {entry.matches.map((candidate, at) => (
                                  <option key={candidate.provider} value={String(at)}>
                                    {`${candidate.official === true ? `${t('officialMark')} · ` : ''}${candidate.provider}: ${t('contextWindow')} ${candidate.contextWindow ?? '—'} / ${t('maxTokens')} ${candidate.maxTokens ?? '—'}${candidate.vision === true ? ` · ${t('vision')}` : ''}${candidate.reasoningEfforts !== undefined && candidate.reasoningEfforts.length > 0 ? ` · ${t('modelReasoning')}: ${candidate.reasoningEfforts.join('/')}` : ''}`}
                                  </option>
                                ))}
                              </select>
                              <span className="newapi-params-values">{match.provider}</span>
                            </div>
                          )
                        })}
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button type="button" className="newapi-button newapi-button--primary" onClick={() => { applyParams(gid, true) }}>
                            {t('paramsOverwrite')}
                          </button>
                          <button type="button" className="newapi-button" onClick={() => { applyParams(gid, false) }}>
                            {t('paramsFillBlank')}
                          </button>
                          <button type="button" className="newapi-button" onClick={() => { setParams(current => new Map(current).set(gid, undefined as never)); setParamChoices(current => new Map(current).set(gid, new Map())) }}>
                            {t('fetchCancel')}
                          </button>
                        </div>
                      </div>
                     ) : null}
                        </>
                      )}
                  </div>
                )
                : null}
            </div>
          )
        })}
      </div>

      <button type="button" className="newapi-addgroup" disabled={busy || !writable} onClick={addGroup}>
        <IconPlus /> {t('addGroup')}
      </button>

      <p className="newapi-hint">{t('modelHint')}</p>

      <button type="button" className="newapi-button newapi-button--primary" disabled={busy || !writable} onClick={() => { void save() }}>
        {busy ? t('applying') : t('apply')}
      </button>
    </section>
  )
}
