import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function tour(tourId: number, title: string, appliedCount: number, status: string) {
  return { tourId, theme: 'GOLF', title, departureDate: '2026-12-01', duration: 5, capacity: 10, appliedCount, status }
}

const recruiting = tour(1, '골프 챌린지 투어 12/1 출발 5일', 2, 'RECRUITING')
const confirmed = tour(2, '골프 챌린지 투어 12/2 출발 5일', 3, 'CONFIRMED')
const inProgress = tour(3, '골프 챌린지 투어 11/20 출발 5일', 4, 'IN_PROGRESS')
const completed = tour(4, '골프 챌린지 투어 11/1 출발 3일', 3, 'COMPLETED')

function renderPage() {
  const router = createMemoryRouter(routes, { initialEntries: ['/staff', '/staff/tours'], initialIndex: 1 })
  render(<RouterProvider router={router} />)
  return router
}

function rowOf(title: string) {
  const row = screen.getAllByRole('row').find((item) => within(item).queryByRole('cell', { name: title }))
  if (!row) throw new Error(`${title} 줄이 없다`)
  return row
}

// 상품·신청 인원·상태 칸(단추 칸은 뺀다)
function rowTexts() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .slice(0, 3)
        .map((cell) => cell.textContent),
    )
}

function postPaths() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([path]) => path)
}

describe('상품 목록', () => {
  it('서버가 준 순서대로 상품·신청 인원·상태를 보이고, 할 수 있는 처리 단추만 둔다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [recruiting, confirmed, inProgress, completed]))
    renderPage()

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(rowTexts()).toEqual([
      [recruiting.title, '2/10명', '모집 중'],
      [confirmed.title, '3/10명', '확정'],
      [inProgress.title, '4/10명', '진행 중'],
      [completed.title, '3/10명', '완료'],
    ])
    expect(within(rowOf(recruiting.title)).getByRole('button', { name: '출발 처리' })).toBeInTheDocument()
    expect(within(rowOf(confirmed.title)).getByRole('button', { name: '출발 처리' })).toBeInTheDocument()
    expect(within(rowOf(inProgress.title)).getByRole('button', { name: '완료 처리' })).toBeInTheDocument()
    expect(within(rowOf(completed.title)).queryByRole('button')).not.toBeInTheDocument()
  })

  it('불러오지 못하면 문구를 알리고 다시 불러올 수 있다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { message: '서버에 문제가 생겼습니다.' }))
      .mockResolvedValueOnce(jsonResponse(200, [confirmed]))
    renderPage()

    expect(await screen.findByText('상품 목록을 불러오지 못했습니다.')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('서버에 문제가 생겼습니다.')

    await userEvent.setup().click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(rowTexts()).toEqual([[confirmed.title, '3/10명', '확정']])
  })
})

describe('출발·완료 처리', () => {
  it('모집 중인 상품은 취소된다고 알리고, 확인하면 출발 처리한 뒤 바뀐 상태를 보인다', async () => {
    const cancelled = { ...recruiting, status: 'CANCELLED' }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [recruiting]))
      .mockResolvedValueOnce(jsonResponse(200, cancelled))
      .mockResolvedValueOnce(jsonResponse(200, [cancelled]))
    renderPage()
    const user = userEvent.setup()
    await screen.findByRole('table')
    await user.click(within(rowOf(recruiting.title)).getByRole('button', { name: '출발 처리' }))

    const dialog = await screen.findByRole('dialog', { name: '출발 처리' })
    expect(dialog).toHaveTextContent('지금 상태: 모집 중 → 바뀔 상태: 취소')
    expect(dialog).toHaveTextContent('신청이 3명 미만이라 출발하지 않고 취소됩니다.')
    await user.click(within(dialog).getByRole('button', { name: '출발 처리' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      `${recruiting.title}을 출발 처리했습니다(지금 상태: 취소)`,
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(postPaths()).toEqual(['/api/v1/staff/tours/1/depart'])
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(rowTexts()).toEqual([[recruiting.title, '2/10명', '취소']])
    expect(within(rowOf(recruiting.title)).queryByRole('button')).not.toBeInTheDocument()
  })

  it('진행 중인 상품을 완료 처리한다', async () => {
    const done = { ...inProgress, status: 'COMPLETED' }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [inProgress]))
      .mockResolvedValueOnce(jsonResponse(200, done))
      .mockResolvedValueOnce(jsonResponse(200, [done]))
    renderPage()
    const user = userEvent.setup()
    await screen.findByRole('table')
    await user.click(within(rowOf(inProgress.title)).getByRole('button', { name: '완료 처리' }))

    const dialog = await screen.findByRole('dialog', { name: '완료 처리' })
    expect(dialog).toHaveTextContent('지금 상태: 진행 중 → 바뀔 상태: 완료')
    expect(dialog).not.toHaveTextContent('취소됩니다')
    await user.click(within(dialog).getByRole('button', { name: '완료 처리' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      `${inProgress.title}을 완료 처리했습니다(지금 상태: 완료)`,
    )
    expect(postPaths()).toEqual(['/api/v1/staff/tours/3/complete'])
  })

  it('닫기를 누르면 보내지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [confirmed]))
    renderPage()
    const user = userEvent.setup()
    await screen.findByRole('table')
    await user.click(within(rowOf(confirmed.title)).getByRole('button', { name: '출발 처리' }))

    const dialog = await screen.findByRole('dialog', { name: '출발 처리' })
    expect(dialog).toHaveTextContent('지금 상태: 확정 → 바뀔 상태: 진행 중')
    await user.click(within(dialog).getByRole('button', { name: '닫기' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(postPaths()).toEqual([])
  })

  it('그사이 상태가 바뀌어 409면 문구를 창에 보이고 목록을 다시 읽는다', async () => {
    const alreadyGone = { ...confirmed, status: 'IN_PROGRESS' }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [confirmed]))
      .mockResolvedValueOnce(jsonResponse(409, { message: '모집 중·확정·마감인 상품만 출발 처리할 수 있습니다.' }))
      .mockResolvedValueOnce(jsonResponse(200, [alreadyGone]))
    renderPage()
    const user = userEvent.setup()
    await screen.findByRole('table')
    await user.click(within(rowOf(confirmed.title)).getByRole('button', { name: '출발 처리' }))
    const dialog = await screen.findByRole('dialog', { name: '출발 처리' })
    await user.click(within(dialog).getByRole('button', { name: '출발 처리' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '모집 중·확정·마감인 상품만 출발 처리할 수 있습니다.',
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await user.click(within(dialog).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(rowTexts()).toEqual([[confirmed.title, '3/10명', '진행 중']])
    expect(toast.error).not.toHaveBeenCalled()
  })
})
