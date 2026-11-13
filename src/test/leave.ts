import { waitFor } from '@testing-library/react'
import { expect } from 'vitest'

// 탭을 닫으려 할 때 화면이 막는지(beforeunload를 취소하는지)
export function leaveBlocked(): boolean {
  const leaving = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(leaving)
  return leaving.defaultPrevented
}

// 막기를 푸는 effect는 화면이 바뀐 다음 차례에 돌 수 있어(느린 CI에서 실패), 풀릴 때까지 기다린다.
// 화면 이동 막기(useBlocker)도 같은 차례에 풀린다
export async function waitUntilLeaveAllowed() {
  await waitFor(() => expect(leaveBlocked()).toBe(false))
}
