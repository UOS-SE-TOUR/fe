import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNKNOWN_RESULT_MESSAGE } from '@/modules/ApiClient'
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
  return { tourId, theme: 'GOLF', title, departureDate: '2099-12-01', duration: 5, capacity: 10, appliedCount, status }
}

const recruiting = tour(1, '허니문 낭만 투어 12/24 출발 5일', 2, 'RECRUITING')
const empty = tour(2, '골프 챌린지 투어 12/2 출발 5일', 0, 'RECRUITING')
const confirmed = tour(3, '골프 챌린지 투어 12/3 출발 5일', 3, 'CONFIRMED')
const inProgress = tour(4, '골프 챌린지 투어 11/20 출발 5일', 4, 'IN_PROGRESS')
const completed = tour(5, '골프 챌린지 투어 11/1 출발 3일', 3, 'COMPLETED')
const cancelled = tour(6, '골프 챌린지 투어 11/2 출발 3일', 1, 'CANCELLED')

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
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [recruiting, empty, confirmed, inProgress, completed, cancelled]))
    renderPage()

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(rowTexts()).toEqual([
      [recruiting.title, '2/10명', '모집 중'],
      [empty.title, '0/10명', '모집 중'],
      [confirmed.title, '3/10명', '확정'],
      [inProgress.title, '4/10명', '진행 중'],
      [completed.title, '3/10명', '완료'],
      [cancelled.title, '1/10명', '취소'],
    ])
    expect(within(rowOf(recruiting.title)).getByRole('button', { name: '확정 처리' })).toBeInTheDocument()
    expect(within(rowOf(empty.title)).queryByRole('button')).not.toBeInTheDocument()
    expect(within(rowOf(confirmed.title)).queryByRole('button')).not.toBeInTheDocument()
    expect(within(rowOf(inProgress.title)).getByRole('button', { name: '취소 처리' })).toBeInTheDocument()
    expect(within(rowOf(completed.title)).getByRole('button', { name: '취소 처리' })).toBeInTheDocument()
    expect(within(rowOf(cancelled.title)).queryByRole('button')).not.toBeInTheDocument()
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

describe('확정·취소 처리', () => {
  it('신청이 있는 모집 중 상품을 확정하면 창고·문자 안내 뒤 확정하고 바뀐 상태를 보인다', async () => {
    const done = { ...recruiting, status: 'CONFIRMED' }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [recruiting]))
      .mockResolvedValueOnce(jsonResponse(200, done))
      .mockResolvedValueOnce(jsonResponse(200, [done]))
    renderPage()
    const user = userEvent.setup()
    await screen.findByRole('table')
    await user.click(within(rowOf(recruiting.title)).getByRole('button', { name: '확정 처리' }))

    const dialog = await screen.findByRole('dialog', { name: '확정 처리' })
    expect(dialog).toHaveTextContent('지금 상태: 모집 중 → 바뀔 상태: 확정')
    expect(dialog).toHaveTextContent('신청 2명 몫만큼 창고 물품이 줄고, 신청자 모두에게 확정 문자가 갑니다.')
    await user.click(within(dialog).getByRole('button', { name: '확정 처리' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      `${recruiting.title}을 확정 처리했습니다(지금 상태: 확정)`,
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(postPaths()).toEqual(['/api/v1/staff/tours/1/confirm'])
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(rowTexts()).toEqual([[recruiting.title, '2/10명', '확정']])
    expect(within(rowOf(recruiting.title)).queryByRole('button')).not.toBeInTheDocument()
  })

  it('완료 상품을 늦게 취소하면 물품을 되돌린다고 알리고 취소한다', async () => {
    const done = { ...completed, status: 'CANCELLED' }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [completed]))
      .mockResolvedValueOnce(jsonResponse(200, done))
      .mockResolvedValueOnce(jsonResponse(200, [done]))
    renderPage()
    const user = userEvent.setup()
    await screen.findByRole('table')
    await user.click(within(rowOf(completed.title)).getByRole('button', { name: '취소 처리' }))

    const dialog = await screen.findByRole('dialog', { name: '취소 처리' })
    expect(dialog).toHaveTextContent('지금 상태: 완료 → 바뀔 상태: 취소')
    expect(dialog).toHaveTextContent('이 상품 때문에 줄였던 창고 물품을 되돌립니다.')
    await user.click(within(dialog).getByRole('button', { name: '취소 처리' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      `${completed.title}을 취소 처리했습니다(지금 상태: 취소)`,
    )
    expect(postPaths()).toEqual(['/api/v1/staff/tours/5/cancel'])
  })

  it('닫기를 누르면 보내지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [inProgress]))
    renderPage()
    const user = userEvent.setup()
    await screen.findByRole('table')
    await user.click(within(rowOf(inProgress.title)).getByRole('button', { name: '취소 처리' }))

    const dialog = await screen.findByRole('dialog', { name: '취소 처리' })
    expect(dialog).toHaveTextContent('지금 상태: 진행 중 → 바뀔 상태: 취소')
    await user.click(within(dialog).getByRole('button', { name: '닫기' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(postPaths()).toEqual([])
  })

  it('그사이 상태가 바뀌어 409면 창을 닫고 서버 문구를 알린 뒤 목록을 다시 읽는다', async () => {
    const alreadyConfirmed = { ...recruiting, appliedCount: 3, status: 'CONFIRMED' }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [recruiting]))
      .mockResolvedValueOnce(jsonResponse(409, { message: '신청이 있는 모집 중 상품만 확정할 수 있습니다.' }))
      .mockResolvedValueOnce(jsonResponse(200, [alreadyConfirmed]))
    renderPage()
    const user = userEvent.setup()
    await screen.findByRole('table')
    await user.click(within(rowOf(recruiting.title)).getByRole('button', { name: '확정 처리' }))
    const dialog = await screen.findByRole('dialog', { name: '확정 처리' })
    await user.click(within(dialog).getByRole('button', { name: '확정 처리' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('신청이 있는 모집 중 상품만 확정할 수 있습니다.'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(rowTexts()).toEqual([[recruiting.title, '3/10명', '확정']]))
    expect(within(rowOf(recruiting.title)).queryByRole('button')).not.toBeInTheDocument()
  })

  it('성공 응답이 상품 모양이 아니면 처리됐는지 알 수 없다고 알리고 목록을 다시 읽는다', async () => {
    const done = { ...recruiting, status: 'CONFIRMED' }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [recruiting]))
      .mockResolvedValueOnce(jsonResponse(200, { tourId: 1 }))
      .mockResolvedValueOnce(jsonResponse(200, [done]))
    renderPage()
    const user = userEvent.setup()
    await screen.findByRole('table')
    await user.click(within(rowOf(recruiting.title)).getByRole('button', { name: '확정 처리' }))
    await user.click(
      within(await screen.findByRole('dialog', { name: '확정 처리' })).getByRole('button', { name: '확정 처리' }),
    )

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UNKNOWN_RESULT_MESSAGE))
    await waitFor(() => expect(rowTexts()).toEqual([[recruiting.title, '2/10명', '확정']]))
  })

  it('응답 없이 연결이 끊기면 처리됐는지 알 수 없다고 한 번만 알리고 다시 읽지 않는다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [recruiting]))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderPage()
    const user = userEvent.setup()
    await screen.findByRole('table')
    await user.click(within(rowOf(recruiting.title)).getByRole('button', { name: '확정 처리' }))
    await user.click(
      within(await screen.findByRole('dialog', { name: '확정 처리' })).getByRole('button', { name: '확정 처리' }),
    )

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UNKNOWN_RESULT_MESSAGE))
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('출발일이 오늘이거나 지난 모집 중 상품에는 확정 단추를 두지 않는다', async () => {
    const departed = { ...recruiting, departureDate: '2000-01-01' }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [departed]))
    renderPage()

    await screen.findByRole('table')
    expect(within(rowOf(recruiting.title)).queryByRole('button')).not.toBeInTheDocument()
  })

  it('처리한 뒤 서버 오류면 처리됐는지 알 수 없다고 알리고 목록을 다시 읽는다', async () => {
    const done = { ...recruiting, status: 'CONFIRMED' }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [recruiting]))
      .mockResolvedValueOnce(jsonResponse(500, { message: '서버에 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.' }))
      .mockResolvedValueOnce(jsonResponse(200, [done]))
    renderPage()
    const user = userEvent.setup()
    await screen.findByRole('table')
    await user.click(within(rowOf(recruiting.title)).getByRole('button', { name: '확정 처리' }))
    await user.click(
      within(await screen.findByRole('dialog', { name: '확정 처리' })).getByRole('button', { name: '확정 처리' }),
    )

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UNKNOWN_RESULT_MESSAGE))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(rowTexts()).toEqual([[recruiting.title, '2/10명', '확정']]))
  })

  it('처리한 뒤 다시 읽기가 실패해도 바꾼 표는 그대로 두고 알린다', async () => {
    const done = { ...recruiting, status: 'CONFIRMED' }
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, [recruiting]))
      .mockResolvedValueOnce(jsonResponse(200, done))
      .mockResolvedValueOnce(jsonResponse(502, { message: '서버에 연결할 수 없습니다.' }))
    renderPage()
    const user = userEvent.setup()
    await screen.findByRole('table')
    await user.click(within(rowOf(recruiting.title)).getByRole('button', { name: '확정 처리' }))
    await user.click(
      within(await screen.findByRole('dialog', { name: '확정 처리' })).getByRole('button', { name: '확정 처리' }),
    )

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('서버에 연결할 수 없습니다.'))
    expect(rowTexts()).toEqual([[recruiting.title, '2/10명', '확정']])
    expect(screen.queryByText('상품 목록을 불러오지 못했습니다.')).not.toBeInTheDocument()
  })
})
