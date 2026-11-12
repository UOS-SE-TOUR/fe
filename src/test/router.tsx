import { render } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { routes } from '@/router/routes'

// 화면 주소와 막기까지 실제 라우터 그대로 띄운다
export function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

// stubFetch로 바꾼 fetch에 n번째로 보낸 요청의 주소·메서드·본문
export function sentRequest(fetchMock: { mock: { calls: Parameters<typeof fetch>[] } }, index = 0) {
  const [path, init] = fetchMock.mock.calls[index]
  return {
    path,
    method: init?.method,
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  }
}
