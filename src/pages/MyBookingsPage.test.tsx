import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyBookingResponse } from '@/lib/tours'
import { AuthStore } from '@/modules/AuthStore'
import { jsonResponse, stubFetch } from '@/test/http'
import { renderAt, sentRequest } from '@/test/router'

const recruiting: MyBookingResponse = {
  bookingId: 21,
  tourId: 9,
  title: '허니문 낭만 투어 12/20 출발 5일',
  departureDate: '2026-12-20',
  duration: 5,
  level: 'GRAND',
  levelName: '그랜드',
  headcount: 2,
  finalPrice: 3_000_000,
  appliedAt: '2026-11-20T03:15:00.123456Z',
  status: 'RECRUITING',
  headcountToConfirm: 2,
}

const confirmed: MyBookingResponse = {
  bookingId: 20,
  tourId: 8,
  title: '골프 챌린지 투어 11/30 출발 1일',
  departureDate: '2026-11-30',
  duration: 1,
  level: 'PREMIUM',
  levelName: '프리미엄',
  headcount: 3,
  finalPrice: 1_350_000,
  appliedAt: '2026-11-19T10:00:00Z',
  status: 'CONFIRMED',
  headcountToConfirm: 0,
}

let fetchMock: ReturnType<typeof stubFetch>

beforeEach(() => {
  fetchMock = stubFetch()
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
  AuthStore.setMember('CUSTOMER', '홍길동')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  AuthStore.clear()
})

function itemTexts(): string[] {
  return screen.getAllByRole('listitem').map((item) => item.textContent ?? '')
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('신청 목록', () => {
  it('서버가 준 순서대로 신청마다 상품 이름·출발일·투어 등급·인원·최종 가격·상품 상태를 보여 준다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [recruiting, confirmed]))
    renderAt('/bookings')

    expect(await screen.findByRole('heading', { name: '내 신청' })).toBeInTheDocument()
    const [first, second] = await screen.findAllByRole('listitem')
    expect(within(first).getByText('허니문 낭만 투어 12/20 출발 5일')).toBeInTheDocument()
    expect(within(first).getByText('2026년 12월 20일 출발 · 그랜드 · 2명')).toBeInTheDocument()
    expect(within(first).getByText('3,000,000원')).toBeInTheDocument()
    expect(within(first).getByText('모집 중')).toBeInTheDocument()
    expect(within(second).getByText('골프 챌린지 투어 11/30 출발 1일')).toBeInTheDocument()
    expect(within(second).getByText('2026년 11월 30일 출발 · 프리미엄 · 3명')).toBeInTheDocument()
    expect(within(second).getByText('1,350,000원')).toBeInTheDocument()
    expect(within(second).getByText('확정')).toBeInTheDocument()
    expect(sentRequest(fetchMock)).toEqual({ path: '/api/v1/bookings', method: 'GET', body: undefined })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('모집 중이면 상태 옆에 확정까지 남은 인원을 보여 준다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [recruiting, confirmed]))
    renderAt('/bookings')

    const [first, second] = await screen.findAllByRole('listitem')
    expect(within(first).getByText('확정까지 2명')).toBeInTheDocument()
    expect(within(second).queryByText(/확정까지/)).not.toBeInTheDocument()
  })

  it.each(['CONFIRMED', 'FULL', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED'])(
    '상품 상태가 %s면 확정까지 남은 인원을 보여 주지 않는다',
    async (status) => {
      // 서버가 남은 인원을 주더라도 모집 중이 아니면 보이지 않는다
      fetchMock.mockResolvedValueOnce(jsonResponse(200, [{ ...recruiting, status, headcountToConfirm: 2 }]))
      renderAt('/bookings')

      expect(await screen.findByRole('listitem')).toBeInTheDocument()
      expect(screen.queryByText(/확정까지/)).not.toBeInTheDocument()
    },
  )

  it('신청이 없으면 없다고 보여 준다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []))
    renderAt('/bookings')

    expect(await screen.findByText('신청한 여행이 없습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('불러오지 못하면 문구를 알리고 다시 불러올 수 있다', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { message: '서버에 문제가 생겼습니다.' }))
      .mockResolvedValueOnce(jsonResponse(200, [confirmed]))
    renderAt('/bookings')

    expect(await screen.findByText('내 신청을 불러오지 못했습니다.')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('서버에 문제가 생겼습니다.')

    await userEvent.setup().click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(await screen.findByRole('listitem')).toBeInTheDocument()
    expect(itemTexts()).toEqual([expect.stringContaining('골프 챌린지 투어 11/30 출발 1일')])
    expect(sentRequest(fetchMock, 1)).toEqual({ path: '/api/v1/bookings', method: 'GET', body: undefined })
    expect(screen.queryByText('내 신청을 불러오지 못했습니다.')).not.toBeInTheDocument()
  })

  it.each([
    ['빈 본문', () => new Response('', { status: 200 })],
    ['배열이 아닌 본문', () => jsonResponse(200, { message: '잘못된 응답' })],
    ['칸이 빠진 신청', () => jsonResponse(200, [{ ...recruiting, headcountToConfirm: undefined }])],
  ])('성공 응답인데 %s이면 못 읽은 것으로 보여 주고 공용 알림을 띄운다', async (_, response) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(response())
    renderAt('/bookings')

    expect(await screen.findByText('내 신청을 불러오지 못했습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 불러오기' })).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})

it('고객 메뉴 링크로 고객 첫 화면에 돌아간다', async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, []))
  const router = renderAt('/bookings')
  await screen.findByText('신청한 여행이 없습니다.')

  await userEvent.setup().click(screen.getByRole('link', { name: '고객 메뉴' }))

  expect(await screen.findByRole('heading', { name: '고객 메뉴' })).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/')
})

it('불러오는 중에 다른 화면으로 가면 늦게 온 실패를 알리지 않는다', async () => {
  let finish: (response: Response) => void = () => {}
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)))
  renderAt('/bookings')
  await screen.findByText('내 신청을 불러오는 중입니다.')

  await userEvent.setup().click(screen.getByRole('link', { name: '고객 메뉴' }))
  expect(await screen.findByRole('heading', { name: '고객 메뉴' })).toBeInTheDocument()
  await act(async () => {
    finish(jsonResponse(500, { message: '서버에 문제가 생겼습니다.' }))
    await sleep(20)
  })

  expect(toast.error).not.toHaveBeenCalled()
})
