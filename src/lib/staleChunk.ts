const RELOADED_KEY = 'staleChunkReloaded'
// 새로고침이 이만큼 지나도 일어나지 않으면 기다리기를 그만두고 오류 화면을 보인다
export const RELOAD_WAIT_MS = 30_000

// 한 화면의 파일 여럿이 함께 실패해도 새로고침은 한 번이다
let reloadWait: Promise<never> | null = null

// 새로고침한 뒤 아직 화면 파일을 하나도 못 받았는지. 저장소를 쓸 수 없으면 null
function wasReloaded(): boolean | null {
  try {
    return sessionStorage.getItem(RELOADED_KEY) === '1'
  } catch {
    return null
  }
}

function markReloaded(): boolean {
  try {
    sessionStorage.setItem(RELOADED_KEY, '1')
    return true
  } catch {
    return false
  }
}

export function markChunkLoaded() {
  try {
    sessionStorage.removeItem(RELOADED_KEY)
  } catch {
    // 지우지 못하면 다음 실패 때 오류 화면을 보인다
  }
}

// 새 버전 배포로 옛 화면 파일이 없어진 것으로 보고 한 번 새로고침한다. 연결이 끊겼거나, 새로고침하고도 또 못 받았거나,
// 되풀이를 막을 저장소가 없으면 오류를 넘긴다
export function recoverFromStaleChunk(
  error: unknown,
  reload: () => void = () => window.location.reload(),
): Promise<never> {
  if (reloadWait) return reloadWait
  if (!navigator.onLine) return Promise.reject(error)
  if (wasReloaded() !== false || !markReloaded()) return Promise.reject(error)
  reloadWait = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reloadWait = null
      reject(error)
    }, RELOAD_WAIT_MS)
  })
  reload()
  return reloadWait
}
