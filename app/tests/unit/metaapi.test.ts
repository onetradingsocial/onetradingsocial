import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { deployAccount } from '@/lib/server/metaapi'

// A fetch that never settles until its abort signal fires — stands in for the
// stalled MetaApi responses that used to burn the whole 60s function budget.
function hangingFetch() {
  return (_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const err = new Error('This operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })
}

describe('metaapi call()', () => {
  beforeEach(() => {
    process.env.METAAPI_TOKEN = 'test-token'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    delete process.env.METAAPI_TOKEN
  })

  it('aborts a stalled request at 15s instead of hanging', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())

    const pending = deployAccount('acc-1')
    await vi.advanceTimersByTimeAsync(15_000)

    expect(await pending).toEqual({ error: 'MetaApi timed out after 15s.' })
  })

  it('does not abort before the timeout elapses', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())

    const pending = deployAccount('acc-1')
    let settled = false
    void pending.then(() => { settled = true })

    await vi.advanceTimersByTimeAsync(14_000)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(await pending).toEqual({ error: 'MetaApi timed out after 15s.' })
  })

  it('reports a transport failure distinctly from a timeout', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')))

    expect(await deployAccount('acc-1')).toEqual({ error: 'Could not reach MetaApi.' })
  })

  it('clears the abort timer once the call succeeds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })))

    expect(await deployAccount('acc-1')).toEqual({ ok: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('short-circuits when the token is unset', async () => {
    delete process.env.METAAPI_TOKEN
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    expect(await deployAccount('acc-1')).toEqual({ error: 'MetaApi is not configured.' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
