// React 밖의 코드(ApiClient)가 화면을 옮길 때 쓴다. 라우터를 만든 App이 등록한다
interface Navigator {
  navigate(path: string): void
  currentPath(): string
}

let registered: Navigator | null = null

export function setNavigator(next: Navigator | null) {
  registered = next
}

export function navigateTo(path: string) {
  registered?.navigate(path)
}

export function currentPath(): string | null {
  return registered?.currentPath() ?? null
}
