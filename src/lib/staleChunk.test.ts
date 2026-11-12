import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// "이 페이지에서 새로고침을 시작했다"는 모듈 값이라 테스트마다 모듈을 새로 불러온다
async function load() {
  vi.resetModules()
  return import('@/lib/staleChunk')
}

const NOW = new Date('2026-11-12T09:00:00Z').getTime()
const chunkError = new Error('Failed to fetch dynamically imported module')

// 끝나지 않는 Promise인지 본다(그사이 settle 되면 true)
async function settledSoon(promise: Promise<unknown>): Promise<boolean> {
  let settled = false
  promise.then(
    () => (settled = true),
    () => (settled = true),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  return settled
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
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

  it('새로고침하고 얼마 안 돼 또 못 받으면 새로고침하지 않고 오류를 넘긴다', async () => {
    const before = await load()
    before.recoverFromStaleChunk(chunkError, vi.fn())
    vi.setSystemTime(NOW + before.STALE_CHUNK_RETRY_MS - 1)
    // 새로고침한 뒤의 새 페이지
    const { recoverFromStaleChunk } = await load()
    const reload = vi.fn()

    await expect(recoverFromStaleChunk(chunkError, reload)).rejects.toBe(chunkError)
    expect(reload).not.toHaveBeenCalled()
  })

  it('새로고침하고 충분히 지난 뒤에 또 못 받으면(다음 배포) 다시 새로고침한다', async () => {
    const before = await load()
    before.recoverFromStaleChunk(chunkError, vi.fn())
    vi.setSystemTime(NOW + before.STALE_CHUNK_RETRY_MS)
    const { recoverFromStaleChunk } = await load()
    const reload = vi.fn()

    const result = recoverFromStaleChunk(chunkError, reload)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(await settledSoon(result)).toBe(false)
  })

  it('시계가 뒤로 가 지난 새로고침 시각이 지금보다 뒤여도 새로고침한다', async () => {
    sessionStorage.setItem('staleChunkReloadedAt', String(NOW + 60_000))
    const { recoverFromStaleChunk } = await load()
    const reload = vi.fn()

    recoverFromStaleChunk(chunkError, reload)

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
