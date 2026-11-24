import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthStore } from '@/modules/AuthStore'
import { routes } from '@/router/routes'
import { jsonResponse, stubFetch } from '@/test/http'

let fetchMock: ReturnType<typeof stubFetch>

beforeEach(() => {
  fetchMock = stubFetch()
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
  AuthStore.setMember('STAFF', '김직원')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  AuthStore.clear()
})

function history(id: number, reason: string, changeAmount: number, quantityAfter: number, tourTitle: string | null) {
  return {
    id,
    itemId: 7,
    itemName: '커플 머그컵',
    theme: 'HONEYMOON',
    reason,
    tourId: tourTitle ? 19 : null,
    tourTitle,
    changeAmount,
    quantityAfter,
    createdAt: '2026-11-24T01:15:00Z',
  }
}

function renderPage() {
  const router = createMemoryRouter(routes, {
    initialEntries: ['/staff/items', '/staff/items/history'],
    initialIndex: 1,
  })
  render(<RouterProvider router={router} />)
  return router
}

// 물품·내용·바뀐 수량·바뀐 뒤 수량 칸(때 칸은 뺀다)
function rowTexts() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(1)
        .map((cell) => cell.textContent),
    )
}

it('서버가 준 순서대로 물품·이유·상품·바뀐 수량·바뀐 뒤 수량을 보여 준다', async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse(200, [
      history(4, 'PUT_BACK', 2, 3, '허니문 낭만 투어 12/24 출발 5일'),
      history(3, 'TAKE_OUT', -2, 1, '허니문 낭만 투어 12/24 출발 5일'),
      history(2, 'TAKE_OUT', -2, -1, '허니문 낭만 투어 12/5 출발 5일'),
      history(1, 'REGISTER', 1, 1, null),
    ]),
  )
  renderPage()

  expect(await screen.findByRole('table')).toBeInTheDocument()
  expect(rowTexts()).toEqual([
    ['커플 머그컵 · 허니문 낭만 투어', '취소로 되돌림 · 허니문 낭만 투어 12/24 출발 5일', '+2개', '3개'],
    ['커플 머그컵 · 허니문 낭만 투어', '확정으로 줄임 · 허니문 낭만 투어 12/24 출발 5일', '−2개', '1개'],
    ['커플 머그컵 · 허니문 낭만 투어', '확정으로 줄임 · 허니문 낭만 투어 12/5 출발 5일', '−2개', '부족 1개'],
    ['커플 머그컵 · 허니문 낭만 투어', '등록', '+1개', '1개'],
  ])
  expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/staff/items/history')
})

it('기록이 없으면 없다고 보여 주고, 새로 고침하면 다시 읽는다', async () => {
  fetchMock
    .mockResolvedValueOnce(jsonResponse(200, []))
    .mockResolvedValueOnce(jsonResponse(200, [history(1, 'ADD', 5, 10, null)]))
  renderPage()

  expect(await screen.findByText('아직 기록이 없습니다.')).toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('button', { name: '새로 고침' }))

  expect(await screen.findByRole('table')).toBeInTheDocument()
  expect(rowTexts()).toEqual([['커플 머그컵 · 허니문 낭만 투어', '수량 더하기', '+5개', '10개']])
})

it('불러오지 못하면 문구를 알리고 다시 불러올 수 있다', async () => {
  fetchMock
    .mockResolvedValueOnce(jsonResponse(500, { message: '서버에 문제가 생겼습니다.' }))
    .mockResolvedValueOnce(jsonResponse(200, []))
  renderPage()

  expect(await screen.findByText('기록을 불러오지 못했습니다.')).toBeInTheDocument()
  expect(toast.error).toHaveBeenCalledWith('서버에 문제가 생겼습니다.')
  await userEvent.setup().click(screen.getByRole('button', { name: '다시 불러오기' }))
  expect(await screen.findByText('아직 기록이 없습니다.')).toBeInTheDocument()
})

it('창고 링크로 창고 화면에 돌아간다', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, [])).mockResolvedValueOnce(jsonResponse(200, []))
  const router = renderPage()
  await screen.findByText('아직 기록이 없습니다.')

  await userEvent.setup().click(screen.getByRole('link', { name: '창고' }))

  expect(await screen.findByRole('heading', { name: '창고' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/staff/items')
})
