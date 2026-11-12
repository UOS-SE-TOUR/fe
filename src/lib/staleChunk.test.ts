import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleStaleChunk, reloadOnStaleChunk, STALE_CHUNK_RETRY_MS } from '@/lib/staleChunk'

function preloadError() {
  return new Event('vite:preloadError', { cancelable: true })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-12T09:00:00Z'))
  sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('handleStaleChunk', () => {
  it('화면 파일을 못 받으면 새로고침하고, 오류를 화면에 넘기지 않는다', () => {
    const reload = vi.fn()
    const event = preloadError()

    handleStaleChunk(event, reload)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('새로고침한 지 얼마 안 돼 또 실패하면 다시 새로고침하지 않고 오류를 넘긴다', () => {
    const reload = vi.fn()
    handleStaleChunk(preloadError(), reload)
    vi.advanceTimersByTime(STALE_CHUNK_RETRY_MS - 1)
    const again = preloadError()

    handleStaleChunk(again, reload)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(again.defaultPrevented).toBe(false)
  })

  it('충분히 지난 뒤에 또 실패하면(다음 배포) 다시 새로고침한다', () => {
    const reload = vi.fn()
    handleStaleChunk(preloadError(), reload)
    vi.advanceTimersByTime(STALE_CHUNK_RETRY_MS)

    handleStaleChunk(preloadError(), reload)

    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('세션 저장소를 쓸 수 없어도 새로고침한다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('막힘', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('막힘', 'SecurityError')
    })
    const reload = vi.fn()

    handleStaleChunk(preloadError(), reload)

    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('reloadOnStaleChunk', () => {
  it('vite:preloadError를 들으면 새로고침하고, 그만두면 더 듣지 않는다', () => {
    const reload = vi.fn()
    const stop = reloadOnStaleChunk(reload)

    window.dispatchEvent(preloadError())
    expect(reload).toHaveBeenCalledTimes(1)

    stop()
    vi.advanceTimersByTime(STALE_CHUNK_RETRY_MS)
    window.dispatchEvent(preloadError())
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
