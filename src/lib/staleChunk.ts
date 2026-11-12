const RELOADED_AT_KEY = 'staleChunkReloadedAt'
// 새로고침하고 이만큼 안 돼 또 못 받으면 새 버전에서도 못 받는 것이라 다시 새로고침하지 않는다(되풀이 막기)
export const STALE_CHUNK_RETRY_MS = 10_000

// 이 페이지에서 새로고침을 이미 시작했다. 한 화면의 파일 여럿이 함께 실패해도 새로고침은 한 번이다
let reloading = false

// 저장소를 쓸 수 없으면 null
function lastReloadAt(): number | null {
  try {
    return Number(sessionStorage.getItem(RELOADED_AT_KEY)) || 0
  } catch {
    return null
  }
}

function markReload(time: number): boolean {
  try {
    sessionStorage.setItem(RELOADED_AT_KEY, String(time))
    return true
  } catch {
    return false
  }
}

// 화면 파일을 못 받았을 때 부른다. 새 버전 배포로 옛 파일이 없어진 경우로 보고 새로고침해 새 버전을 받으며, 새로고침이
// 끝날 때까지 화면을 그리지 않게 끝나지 않는 Promise를 돌려준다. 연결이 끊겼거나, 새로고침하고도 또 못 받았거나, 되풀이를
// 막을 저장소를 쓸 수 없으면 새로고침하지 않고 오류를 넘겨 라우터의 오류 화면이 보이게 한다
export function recoverFromStaleChunk(
  error: unknown,
  reload: () => void = () => window.location.reload(),
): Promise<never> {
  const waitForReload = new Promise<never>(() => {})
  if (reloading) return waitForReload
  if (!navigator.onLine) return Promise.reject(error)
  const last = lastReloadAt()
  if (last === null) return Promise.reject(error)
  const now = Date.now()
  const elapsed = now - last
  if (last > 0 && elapsed >= 0 && elapsed < STALE_CHUNK_RETRY_MS) return Promise.reject(error)
  if (!markReload(now)) return Promise.reject(error)
  reloading = true
  reload()
  return waitForReload
}
