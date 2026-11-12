// 고객이 로그인 화면에서 막 로그인했는지(설계 CustomerMainPage의 fromLogin). 켜는 쪽은 LoginPage, 읽고 지우는 쪽은 고객 첫 화면이다.
// 새로고침하면 꺼져야 해서 메모리에만 둔다 — 라우터 이동 state에 담으면 브라우저가 기억해 새로고침 뒤에도 남는다
let fromLogin = false

export function markFromLogin() {
  fromLogin = true
}

export function isFromLogin(): boolean {
  return fromLogin
}

export function clearFromLogin() {
  fromLogin = false
}
