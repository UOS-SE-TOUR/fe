const RELOADED_KEY = 'staleChunkReloaded'
// 새로고침을 시작하고 이만큼 지나도 페이지가 그대로면(떠나기 확인에서 머무르기 등) 기다리기를 그만두고 오류 화면을 보인다
export const RELOAD_WAIT_MS = 10_000

// 이 페이지에서 시작한 새로고침을 기다리는 중이다. 한 화면의 파일 여럿이 함께 실패해도 새로고침은 한 번이다
let reloadWait: Promise<never> | null = null

// "새로고침했는데 아직 화면 파일을 하나도 못 받았다" 표시. 저장소를 쓸 수 없으면 null
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

// 화면 파일을 받았다. 다음 배포 뒤 다시 못 받으면 또 새로고침할 수 있게 표시를 지운다
export function markChunkLoaded() {
  try {
    sessionStorage.removeItem(RELOADED_KEY)
  } catch {
    // 지우지 못하면 다음 실패 때 새로고침하지 않고 오류 화면을 보인다
  }
}

// 화면 파일을 못 받았을 때 부른다. 새 버전 배포로 옛 파일이 없어진 경우로 보고 새로고침해 새 버전을 받으며, 새로고침이
// 끝날 때까지 화면을 그리지 않게 기다린다. 연결이 끊겼거나, 새로고침하고도 아직 못 받았거나, 되풀이를 막을 저장소를 쓸 수
// 없으면 새로고침하지 않고 오류를 넘겨 라우터의 오류 화면이 보이게 한다
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
