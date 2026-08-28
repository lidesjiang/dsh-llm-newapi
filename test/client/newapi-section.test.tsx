// @vitest-environment jsdom
/**
 * NewApiSection behavior over a scripted wire face. These tests assert
 * user-visible outcomes (fields rendered, calls made) — never React internals.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewApiSection } from '../../src/client/NewApiSection.tsx'
import { en } from '../../src/client/locale.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]

/** Expand the first (collapsed) gateway card so its form fields render. */
async function expandFirstGroup(): Promise<void> {
  const toggles = await waitFor(() => screen.getAllByLabelText(t('groupExpanded')))
  fireEvent.click(toggles[0] as HTMLElement)
}

/** One stored group section value (the new groups shape). */
function storedGroups(models: unknown[] = [{ id: 'deepseek-chat', contextWindow: 65536 }]) {
  return {
    groups: [{ id: 'newapi', name: 'NewAPI', baseURL: 'http://gw.local:3000/v1', models }],
  }
}

/** A wire face answering one resolved llm-newapi section. */
function wireFace(overrides: Partial<{
  describeAnswer: unknown
  credentialsAnswer: unknown
}> = {}) {
  return {
    settings: {
      describe: vi.fn(() => Promise.resolve({
        result: {
          ok: true,
          value: overrides.describeAnswer ?? {
            writable: true,
            hasDocument: true,
            namespaces: [{
              ns: 'llm-newapi',
              schema: {},
              value: storedGroups(),
              applies: 'live',
              secrets: [],
              revision: 7,
            }],
          },
        },
      })),
      mutate: vi.fn(() => Promise.resolve({ result: { ok: true, value: { ns: 'llm-newapi', revision: 8 } } })),
    },
    credentials: {
      describe: vi.fn(() => Promise.resolve({
        result: { ok: true, value: overrides.credentialsAnswer ?? { credentials: { newapi: { configured: true, writable: true } } } },
      })),
      set: vi.fn(() => Promise.resolve({ result: { ok: true, value: undefined } })),
    },
    llm: { discoverModels: vi.fn() },
  }
}

/** A params face answering one scripted models.dev lookup. */
function paramsFace() {
  return vi.fn(() => Promise.resolve({
    ok: true as const,
    value: {
      models: [
        { id: 'deepseek-chat', matches: [{ provider: 'deepseek', contextWindow: 128_000, maxTokens: 8_192, reasoningEfforts: ['low', 'medium', 'high'] }] },
        { id: 'qwen/qwen-max', matches: [
          { provider: 'qwen', contextWindow: 262_144, maxTokens: 32_768 },
          { provider: 'alibaba', contextWindow: 131_072 },
        ] },
        { id: 'mystery-model', matches: [] },
      ],
    },
  }))
}

describe('NewApiSection mount', () => {
  it('loads the section on mount and renders the nav while collapsed', async () => {
    const api = wireFace()
    render(<NewApiSection api={api as never} t={t} />)

    // Groups start collapsed; the add-group control is visible.
    await waitFor(() => { expect(screen.getByText(t('addGroup'))).toBeTruthy() })
    // The form fields are inside the collapsed group body and therefore not rendered.
    expect(screen.queryByLabelText(t('baseUrl'))).toBeNull()

    // The mount itself interrogated the settings plane.
    expect(api.settings.describe).toHaveBeenCalledTimes(1)
  })

  it('names the missing namespace when the host has no llm-newapi section', async () => {
    const api = wireFace({ describeAnswer: { writable: true, hasDocument: true, namespaces: [] } })
    render(<NewApiSection api={api as never} t={t} />)

    await waitFor(() => { expect(screen.getByText(new RegExp('not registered'))).toBeTruthy() })
    expect(screen.getByText(t('retry'))).toBeTruthy()
  })
})

describe('environment-supplied credential (read-only)', () => {
  const envCredential = {
    credentials: { newapi: { configured: true, writable: false, source: 'env' } },
  }

  it('locks the key field with the launch-environment placeholder', async () => {
    const api = wireFace({ credentialsAnswer: envCredential })
    render(<NewApiSection api={api as never} t={t} />)
    await expandFirstGroup()

    await waitFor(() => { expect(screen.getByLabelText(t('keyInput'))).toBeTruthy() })
    expect((screen.getByLabelText(t('keyInput')) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText(t('keyInput')) as HTMLInputElement).placeholder).toBe(t('keyEnvLocked'))
  })

  it('saves the section without attempting a shadowed credential write', async () => {
    const api = wireFace({ credentialsAnswer: envCredential })
    render(<NewApiSection api={api as never} t={t} />)
    await expandFirstGroup()

    await waitFor(() => { expect(screen.getByLabelText(t('baseUrl'))).toBeTruthy() })
    fireEvent.change(screen.getByLabelText(t('baseUrl')), { target: { value: 'http://other:3000/v1' } })
    fireEvent.click(screen.getByText(t('apply')))

    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    expect(api.credentials.set).not.toHaveBeenCalled()
    await waitFor(() => { expect(screen.getByText(t('saved'))).toBeTruthy() })
  })
})

describe('models.dev params update', () => {
  function groupsValue(models: unknown[]) {
    return {
      writable: true,
      hasDocument: true,
      namespaces: [{
        ns: 'llm-newapi',
        schema: {},
        value: storedGroups(models),
        applies: 'live',
        secrets: [],
        revision: 7,
      }],
    }
  }

  it('shows the summary and applies chosen provider facts overwriting existing values', async () => {
    const api = wireFace({
      describeAnswer: groupsValue([{ id: 'deepseek-chat' }, { id: 'qwen/qwen-max' }, { id: 'mystery-model' }]),
    })
    const fetchModelParams = paramsFace()
    render(<NewApiSection api={api as never} t={t} fetchModelParams={fetchModelParams as never} />)
    await expandFirstGroup()

    await waitFor(() => { expect(screen.getByText(t('updateParams'))).toBeTruthy() })
    fireEvent.click(screen.getByText(t('updateParams')))
    await waitFor(() => { expect(screen.getByText(t('paramsTitle'))).toBeTruthy() })
    expect(screen.getByRole('status').textContent).toBe(
      t('paramsSummary').replace('{matched}', '2').replace('{unmatched}', '1'),
    )
    expect(screen.getAllByText((_, element) =>
      element?.textContent === t('paramsSummary').replace('{matched}', '2').replace('{unmatched}', '1'),
    )).toHaveLength(2)
    expect(screen.getByText(t('paramsUnmatched'))).toBeTruthy()
    const picker = screen.getByLabelText(`${t('paramsProvider')} qwen/qwen-max`) as HTMLSelectElement
    expect(picker.options.length).toBe(2)

    fireEvent.click(screen.getByText(t('paramsOverwrite')))
    await waitFor(() => { expect(screen.getByText(new RegExp(t('paramsApplied')))).toBeTruthy() })
    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    const groups = api.settings.mutate.mock.calls[0][0].ops
      .find((op: { path: string[] }) => op.path[0] === 'groups').value
    const models = groups[0].models
    expect(models[0]).toEqual({ id: 'deepseek-chat', contextWindow: 128_000, maxTokens: 8_192, reasoningEfforts: ['low', 'medium', 'high'] })
    expect(models[1]).toEqual({ id: 'qwen/qwen-max', contextWindow: 262_144, maxTokens: 32_768 })
    expect(models[2]).toEqual({ id: 'mystery-model' })
  })

  it('fill-blank mode keeps values the rows already carry', async () => {
    const api = wireFace()
    const fetchModelParams = paramsFace()
    render(<NewApiSection api={api as never} t={t} fetchModelParams={fetchModelParams as never} />)
    await expandFirstGroup()

    await waitFor(() => { expect(screen.getByText(t('updateParams'))).toBeTruthy() })
    fireEvent.click(screen.getByText(t('updateParams')))
    await waitFor(() => { expect(screen.getByText(t('paramsOverwrite'))).toBeTruthy() })
    fireEvent.click(screen.getByText(t('paramsFillBlank')))
    await waitFor(() => { expect(screen.getByText(new RegExp(t('paramsApplied')))).toBeTruthy() })
    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    const groups = api.settings.mutate.mock.calls[0][0].ops
      .find((op: { path: string[] }) => op.path[0] === 'groups').value
    const models = groups[0].models
    expect(models[0]).toEqual({ id: 'deepseek-chat', contextWindow: 65_536, maxTokens: 8_192, reasoningEfforts: ['low', 'medium', 'high'] })
  })

  it('sends the proxy url only while the toggle is on, and persists the proxy section', async () => {
    const api = wireFace()
    const fetchModelParams = paramsFace()
    render(<NewApiSection api={api as never} t={t} fetchModelParams={fetchModelParams as never} />)
    await expandFirstGroup()

    await waitFor(() => { expect(screen.getByLabelText(`${t('proxyToggle')} 1`)).toBeTruthy() })
    fireEvent.click(screen.getByText(t('updateParams')))
    await waitFor(() => { expect(fetchModelParams).toHaveBeenCalledTimes(1) })
    expect(fetchModelParams.mock.calls[0][0].proxyUrl).toBeUndefined()

    fireEvent.click(screen.getByLabelText(`${t('proxyToggle')} 1`))
    fireEvent.change(screen.getByLabelText(`${t('proxyUrl')} 1`), { target: { value: 'http://127.0.0.1:7897' } })
    fireEvent.click(screen.getByText(t('updateParams')))
    await waitFor(() => { expect(fetchModelParams).toHaveBeenCalledTimes(2) })
    expect(fetchModelParams.mock.calls[1][0].proxyUrl).toBe('http://127.0.0.1:7897')

    fireEvent.click(screen.getByText(t('fetchCancel')))
    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    const groups = api.settings.mutate.mock.calls[0][0].ops
      .find((op: { path: string[] }) => op.path[0] === 'groups').value
    expect(groups[0].proxy).toEqual({ enabled: true, url: 'http://127.0.0.1:7897' })
  })
})

describe('model catalog', () => {
  /** The models op of the first mutate call. */
  function savedModels(api: ReturnType<typeof wireFace>): Array<Record<string, unknown>> {
    const groups = api.settings.mutate.mock.calls[0][0].ops
      .find((op: { path: string[] }) => op.path[0] === 'groups').value
    return groups[0].models
  }

  it('sorts fetched candidates by id and the adopted rows keep that order', async () => {
    const api = wireFace()
    api.llm.discoverModels.mockResolvedValueOnce({
      result: {
        ok: true,
        value: { models: [{ id: 'zhipu/glm-5.3' }, { id: 'aa-first' }, { id: 'deepseek-chat' }] },
      },
    })
    render(<NewApiSection api={api as never} t={t} fetchModelParams={paramsFace() as never} />)
    await expandFirstGroup()

    await waitFor(() => { expect(screen.getByText(t('fetchModels'))).toBeTruthy() })
    fireEvent.click(screen.getByText(t('fetchModels')))
    await waitFor(() => { expect(screen.getByText(t('fetchAdopt'))).toBeTruthy() })
    const listed = screen.getAllByRole('listitem').map(item => item.textContent ?? '')
    expect(listed[0]).toContain('aa-first')
    expect(listed[1]).toContain('deepseek-chat')
    expect(listed[2]).toContain('zhipu/glm-5.3')

    fireEvent.click(screen.getByText(t('fetchAdopt')))
    await waitFor(() => { expect((screen.getByLabelText(`${t('modelId')} 1`) as HTMLInputElement).value).toBe('aa-first') })
    expect((screen.getByLabelText(`${t('modelId')} 2`) as HTMLInputElement).value).toBe('deepseek-chat')
    expect((screen.getByLabelText(`${t('modelId')} 3`) as HTMLInputElement).value).toBe('zhipu/glm-5.3')
  })

  it('folds capacities behind the row disclosure and adopts K/M entry', async () => {
    const api = wireFace()
    render(<NewApiSection api={api as never} t={t} />)
    await expandFirstGroup()

    await waitFor(() => { expect(screen.getByLabelText(t('baseUrl'))).toBeTruthy() })
    expect(screen.queryByLabelText(`${t('contextWindow')} 1`)).toBeNull()
    fireEvent.click(screen.getByLabelText(`${t('modelAdvanced')} 1`))
    const context = await waitFor(() => screen.getByLabelText(`${t('contextWindow')} 1`))
    expect((context as HTMLInputElement).value).toBe('65536')

    fireEvent.change(context, { target: { value: '256K' } })
    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    expect(savedModels(api)[0].contextWindow).toBe(256_000)
  })

  it('drops an emptied name instead of storing an empty string', async () => {
    const api = wireFace()
    render(<NewApiSection api={api as never} t={t} />)
    await expandFirstGroup()

    const name = await waitFor(() => screen.getByLabelText(`${t('modelName')} 1`))
    fireEvent.change(name, { target: { value: 'Renamed' } })
    fireEvent.change(name, { target: { value: '' } })
    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    expect(savedModels(api)[0].name).toBeUndefined()
  })

  it('clears every row through the clear action and saves an empty catalog', async () => {
    const api = wireFace()
    render(<NewApiSection api={api as never} t={t} fetchModelParams={paramsFace() as never} />)
    await expandFirstGroup()

    await waitFor(() => { expect(screen.getByText(t('clearModels'))).toBeTruthy() })
    fireEvent.click(screen.getByText(t('clearModels')))
    await waitFor(() => { expect(screen.getByText(t('modelsEmpty'))).toBeTruthy() })
    expect(screen.queryByLabelText(`${t('modelId')} 1`)).toBeNull()
    expect((screen.getByText(t('clearModels')) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    const groups = api.settings.mutate.mock.calls[0][0].ops
      .find((op: { path: string[] }) => op.path[0] === 'groups').value
    expect(groups[0].models).toEqual([])
  })

  it('adds a row through the add-model action and refuses a save with an empty id', async () => {
    const api = wireFace()
    render(<NewApiSection api={api as never} t={t} />)
    await expandFirstGroup()

    await waitFor(() => { expect(screen.getByText(t('addModel'))).toBeTruthy() })
    fireEvent.click(screen.getByText(t('addModel')))
    expect(screen.getByLabelText(`${t('modelId')} 2`)).toBeTruthy()

    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(screen.getByText(new RegExp(t('modelIdRequired')))).toBeTruthy() })
    expect(api.settings.mutate).not.toHaveBeenCalled()
  })

  it('adds a group, refuses duplicate/empty ids, and saves the second gateway', async () => {
    const api = wireFace()
    render(<NewApiSection api={api as never} t={t} />)

    await waitFor(() => { expect(screen.getByText(t('addGroup'))).toBeTruthy() })
    fireEvent.click(screen.getByText(t('addGroup')))
    // The new group card renders its own base URL field.
    await waitFor(() => { expect(screen.getByLabelText(`${t('baseUrl')} 2`)).toBeTruthy() })
    fireEvent.change(screen.getByLabelText(`${t('groupId')} 2`), { target: { value: 'ginka' } })
    fireEvent.change(screen.getByLabelText(`${t('baseUrl')} 2`), { target: { value: 'http://ginka.local:8080/v1' } })
    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    const groups = api.settings.mutate.mock.calls[0][0].ops
      .find((op: { path: string[] }) => op.path[0] === 'groups').value
    expect(groups.length).toBe(2)
    expect(groups[1].id).toBe('ginka')
    expect(groups[1].baseURL).toBe('http://ginka.local:8080/v1')
  })
})

describe('API type selection', () => {
  it('defaults a group to chat and saves responses when selected', async () => {
    const api = wireFace()
    render(<NewApiSection api={api as never} t={t} />)
    await expandFirstGroup()

    const picker = await waitFor(() => screen.getByLabelText(`${t('apiType')} 1`)) as HTMLSelectElement
    expect(picker.value).toBe('chat')

    fireEvent.change(picker, { target: { value: 'responses' } })
    await waitFor(() => { expect(screen.getByText(t('apiTypeResponsesHint'))).toBeTruthy() })
    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    const groups = api.settings.mutate.mock.calls[0][0].ops
      .find((op: { path: string[] }) => op.path[0] === 'groups').value
    expect(groups[0].apiType).toBe('responses')
  })

  it('renders the responses badge from storage and keeps it on save', async () => {
    const api = wireFace({
      describeAnswer: {
        writable: true,
        hasDocument: true,
        namespaces: [{
          ns: 'llm-newapi',
          schema: {},
          value: { groups: [{ id: 'agents', apiType: 'responses', baseURL: 'http://agents.local:8080/v1' }] },
          applies: 'live',
          secrets: [],
          revision: 7,
        }],
      },
    })
    render(<NewApiSection api={api as never} t={t} />)

    // The collapsed card already shows the protocol badge.
    await waitFor(() => { expect(screen.getAllByText(t('apiTypeResponses'))[0]).toBeTruthy() })
    await expandFirstGroup()
    const picker = await waitFor(() => screen.getByLabelText(`${t('apiType')} 1`)) as HTMLSelectElement
    expect(picker.value).toBe('responses')

    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    const groups = api.settings.mutate.mock.calls[0][0].ops
      .find((op: { path: string[] }) => op.path[0] === 'groups').value
    expect(groups[0].apiType).toBe('responses')
  })

  it('omits apiType from the saved group while chat is the default', async () => {
    const api = wireFace()
    render(<NewApiSection api={api as never} t={t} />)
    await expandFirstGroup()

    const picker = await waitFor(() => screen.getByLabelText(`${t('apiType')} 1`)) as HTMLSelectElement
    expect(picker.value).toBe('chat')
    fireEvent.click(screen.getByText(t('apply')))
    await waitFor(() => { expect(api.settings.mutate).toHaveBeenCalledTimes(1) })
    const groups = api.settings.mutate.mock.calls[0][0].ops
      .find((op: { path: string[] }) => op.path[0] === 'groups').value
    expect(groups[0].apiType).toBeUndefined()
  })
})
