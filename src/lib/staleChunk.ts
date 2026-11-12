const RELOADED_AT_KEY = 'staleChunkReloadedAt'
// 새로고침한 지 이만큼 안 돼 또 실패하면 새 버전에서도 못 받는 것이라 다시 새로고침하지 않는다(새로고침이 되풀이되지 않게)
export const STALE_CHUNK_RETRY_MS = 10_000

function readReloadedAt(): number | null {
  try {
    const value = Number(sessionStorage.getItem(RELOADED_AT_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function writeReloadedAt(time: number) {
  try {
    sessionStorage.setItem(RELOADED_AT_KEY, String(time))
  } catch {
    // 저장하지 못하면 다음 실패 때도 새로고침한다
  }
}

// 새 버전을 배포하면 옛 화면 파일이 없어져, 그 전에 열어 둔 탭이 처음 여는 화면의 파일을 못 받는다.
// 그때 새로고침해 새 버전을 받는다(Vite의 vite:preloadError). 새로고침하면 오류를 화면에 넘기지 않는다
export function handleStaleChunk(event: Event, reload: () => void = () => window.location.reload()) {
  const now = Date.now()
  const reloadedAt = readReloadedAt()
  if (reloadedAt !== null && now - reloadedAt < STALE_CHUNK_RETRY_MS) return
  writeReloadedAt(now)
  event.preventDefault()
  reload()
}

// 돌려준 함수를 부르면 듣기를 그만둔다
export function reloadOnStaleChunk(reload: () => void = () => window.location.reload()): () => void {
  const listener = (event: Event) => handleStaleChunk(event, reload)
  window.addEventListener('vite:preloadError', listener)
  return () => window.removeEventListener('vite:preloadError', listener)
}
