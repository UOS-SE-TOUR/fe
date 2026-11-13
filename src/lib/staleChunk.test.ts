import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// "이 페이지에서 새로고침을 기다리는 중"은 모듈 값이라 테스트마다 모듈을 새로 불러온다
async function load() {
  vi.resetModules()
  return import('@/lib/staleChunk')
}

const chunkError = new Error('Failed to fetch dynamically imported module')

// 그사이 끝났으면(settle) true
async function settledSoon(promise: Promise<unknown>): Promise<boolean> {
  let settled = false
  promise.then(
    () => (settled = true),
    () => (settled = true),
  )
  await vi.advanceTimersByTimeAsync(0)
  return settled
}

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('recoverFromStaleChunk', () => {
  it('화면 파일을 처음 못 받으면 새로고침하고, 새로고침이 끝날 때까지 기다린다', async () => {
    const { recoverFromStaleChunk } = await load()
    const reload = vi.fn()

    const result = recoverFromStaleChunk(chunkError, reload)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(await settledSoon(result)).toBe(false)
  })

  it('한 화면의 파일 여럿이 함께 실패해도 새로고침은 한 번이고 모두 기다린다', async () => {
    const { recoverFromStaleChunk } = await load()
    const reload = vi.fn()

    const first = recoverFromStaleChunk(chunkError, reload)
    const second = recoverFromStaleChunk(chunkError, reload)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(await settledSoon(first)).toBe(false)
    expect(await settledSoon(second)).toBe(false)
  })

  it('새로고침했는데 아직 화면 파일을 하나도 못 받았으면, 걸린 시간과 상관없이 다시 새로고침하지 않고 오류를 넘긴다', async () => {
    // 앞 페이지의 기다림. 실제로는 새로고침되면 사라진다
    void (await load()).recoverFromStaleChunk(chunkError, vi.fn()).catch(() => {})
    vi.advanceTimersByTime(60 * 60 * 1000)
    // 새로고침한 뒤의 새 페이지
    const { recoverFromStaleChunk } = await load()
    const reload = vi.fn()

    await expect(recoverFromStaleChunk(chunkError, reload)).rejects.toBe(chunkError)
    expect(reload).not.toHaveBeenCalled()
  })

  it('새로고침 뒤 화면 파일을 받았으면 다음에 또 못 받을 때(다음 배포) 다시 새로고침한다', async () => {
    void (await load()).recoverFromStaleChunk(chunkError, vi.fn()).catch(() => {})
    const { markChunkLoaded, recoverFromStaleChunk } = await load()
    markChunkLoaded()
    const reload = vi.fn()

    void recoverFromStaleChunk(chunkError, reload).catch(() => {})

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('새로고침이 일어나지 않으면(떠나기 확인에서 머무르기 등) 기다리기를 그만두고 오류를 넘긴다', async () => {
    const { recoverFromStaleChunk, RELOAD_WAIT_MS } = await load()
    const reload = vi.fn()
    const first = recoverFromStaleChunk(chunkError, reload)
    const second = recoverFromStaleChunk(chunkError, reload)
    const firstRejected = expect(first).rejects.toBe(chunkError)
    const secondRejected = expect(second).rejects.toBe(chunkError)

    await vi.advanceTimersByTimeAsync(RELOAD_WAIT_MS)

    await firstRejected
    await secondRejected
    // 새로고침한 표시가 남아 있어 이제는 오류 화면(다시 불러오기 단추)으로 넘긴다
    await expect(recoverFromStaleChunk(chunkError, reload)).rejects.toBe(chunkError)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('연결이 끊겨 못 받았으면 새로고침하지 않고 오류를 넘긴다', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { recoverFromStaleChunk } = await load()
    const reload = vi.fn()

    await expect(recoverFromStaleChunk(chunkError, reload)).rejects.toBe(chunkError)
    expect(reload).not.toHaveBeenCalled()
  })

  it.each([
    ['읽기', 'getItem'],
    ['쓰기', 'setItem'],
  ] as const)('세션 저장소 %s가 막혔으면 되풀이를 막을 수 없어 새로고침하지 않고 오류를 넘긴다', async (_, method) => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new DOMException('막힘', 'SecurityError')
    })
    const { recoverFromStaleChunk } = await load()
    const reload = vi.fn()

    await expect(recoverFromStaleChunk(chunkError, reload)).rejects.toBe(chunkError)
    expect(reload).not.toHaveBeenCalled()
  })
})
