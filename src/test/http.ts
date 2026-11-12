import { vi } from 'vitest'

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// 전역 fetch를 가짜로 바꾼다. 테스트 파일의 afterEach에서 vi.unstubAllGlobals()로 되돌린다
export function stubFetch() {
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
