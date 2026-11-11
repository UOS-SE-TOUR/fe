// React 밖의 코드(ApiClient)가 화면을 옮길 때 쓴다. 라우터를 만든 App이 이동 함수를 등록한다
type Navigate = (path: string) => void

let navigate: Navigate | null = null

export function setNavigate(next: Navigate | null) {
  navigate = next
}

export function navigateTo(path: string) {
  navigate?.(path)
}
