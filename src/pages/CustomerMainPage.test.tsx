import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFromLogin, isFromLogin, markFromLogin } from '@/lib/fromLogin'
import type { PreviousTourResponse } from '@/lib/tours'
import { CONNECTION_FAILED_MESSAGE } from '@/modules/ApiClient'
import { AuthStore } from '@/modules/AuthStore'
import { jsonResponse, stubFetch } from '@/test/http'
import { renderAt, sentRequest } from '@/test/router'

const previousTours: PreviousTourResponse[] = [
  {
    bookingId: 12,
    tourId: 7,
    title: '허니문 낭만 투어 10/20 출발 5일',
    departureDate: '2026-10-20',
    duration: 5,
    level: 'PREMIUM',
    levelName: '프리미엄',
    headcount: 2,
    finalPrice: 3_780_000,
  },
  {
    bookingId: 3,
    tourId: 2,
    title: '골프 챌린지 투어 10/20 출발 3일',
    departureDate: '2025-10-20',
    duration: 3,
    level: 'CLASSIC',
    levelName: '클래식',
    headcount: 1,
    finalPrice: 900_000,
  },
]

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
  clearFromLogin()
})

function respondPreviousTours(tours: unknown = previousTours) {
  fetchMock.mockImplementation(async () => jsonResponse(200, tours))
}

describe('CustomerMainPage', () => {
  it('로그인한 고객의 이름을 보여 준다', async () => {
    renderAt('/')

    expect(await screen.findByRole('heading', { name: '고객 메뉴' })).toBeInTheDocument()
    expect(screen.getByText('홍길동님, 안녕하세요.')).toBeInTheDocument()
  })

  it('여행 상품 선택 단추로 상품 선택 화면에 간다', async () => {
    const router = renderAt('/')

    await userEvent.setup().click(await screen.findByRole('link', { name: /^여행 상품 선택/ }))

    expect(await screen.findByRole('heading', { name: '여행 상품 선택' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/tours')
  })

  it('로그아웃하면 로그인 화면으로 보낸다', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const router = renderAt('/')

    await userEvent.setup().click(await screen.findByRole('button', { name: '로그아웃' }))

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(sentRequest(fetchMock)).toEqual({ path: '/api/v1/members/logout', method: 'POST', body: undefined })
    expect(AuthStore.getState().member).toBeNull()
  })

  it('로그아웃이 실패하면 문구를 보여 주고 고객 첫 화면에 둔다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const router = renderAt('/')

    await userEvent.setup().click(await screen.findByRole('button', { name: '로그아웃' }))

    expect(toast.error).toHaveBeenCalledWith(CONNECTION_FAILED_MESSAGE)
    expect(router.state.location.pathname).toBe('/')
    expect(AuthStore.getState().member).toEqual({ memberType: 'CUSTOMER', name: '홍길동' })
  })
})

describe('이전 여행 팝업', () => {
  it('로그인 직후이고 이전 여행이 있으면 서버가 준 순서대로 팝업에 보여 주고 "로그인 직후" 표시를 지운다', async () => {
    markFromLogin()
    respondPreviousTours()
    renderAt('/')

    const popup = await screen.findByRole('dialog', { name: '이전 여행' })
    expect(sentRequest(fetchMock)).toEqual({ path: '/api/v1/bookings/previous', method: 'GET', body: undefined })
    const rows = within(popup).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      '허니문 낭만 투어 10/20 출발 5일2026년 10월 20일 출발 · 5일 · 프리미엄 · 2명3,780,000원',
      '골프 챌린지 투어 10/20 출발 3일2025년 10월 20일 출발 · 3일 · 클래식 · 1명900,000원',
    ])
    expect(within(popup).getByText('지금까지 다녀온 여행 2건입니다.')).toBeInTheDocument()
    expect(isFromLogin()).toBe(false)
  })

  it('닫으면 팝업이 사라지고 고객 메뉴가 보인다', async () => {
    markFromLogin()
    respondPreviousTours()
    renderAt('/')

    await userEvent.setup().click(within(await screen.findByRole('dialog')).getByRole('button', { name: '닫기' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: '고객 메뉴' })).toBeInTheDocument()
  })

  it('한 번 띄운 뒤 다시 열면(새로고침·다른 화면에서 돌아옴) 이전 여행을 부르지 않는다', async () => {
    markFromLogin()
    respondPreviousTours()
    renderAt('/')
    await screen.findByRole('dialog')
    cleanup()

    renderAt('/')

    expect(await screen.findByRole('heading', { name: '고객 메뉴' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('로그인 직후가 아니면 이전 여행을 부르지 않는다', async () => {
    respondPreviousTours()
    renderAt('/')

    expect(await screen.findByRole('heading', { name: '고객 메뉴' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('이전 여행이 없으면 팝업을 띄우지 않고 "로그인 직후" 표시를 지운다', async () => {
    markFromLogin()
    respondPreviousTours([])
    renderAt('/')

    await waitFor(() => expect(isFromLogin()).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    ['서버가 실패를 알리면', () => fetchMock.mockResolvedValue(jsonResponse(503, { message: '서버에 잠시 연결할 수 없습니다.' })), '서버에 잠시 연결할 수 없습니다.'],
    ['연결이 끊기면', () => fetchMock.mockRejectedValue(new TypeError('Failed to fetch')), CONNECTION_FAILED_MESSAGE],
  ])('이전 여행을 못 읽으면(%s) 문구를 보여 주고 "로그인 직후" 표시를 지운다', async (_, respond, message) => {
    markFromLogin()
    respond()
    renderAt('/')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
    expect(isFromLogin()).toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('응답 모양이 다르면 공용 알림을 띄우고 "로그인 직후" 표시를 지운다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    markFromLogin()
    respondPreviousTours([{ bookingId: 12, title: '허니문 낭만 투어 10/20 출발 5일' }])
    renderAt('/')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.'))
    expect(isFromLogin()).toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('응답 전에 다른 화면에 갔다 돌아오면 다시 부르지 않고 늦게 온 응답으로 팝업을 띄우지 않는다', async () => {
    markFromLogin()
    let respond: (response: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)))
    renderAt('/')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(isFromLogin()).toBe(false)
    const user = userEvent.setup()

    await user.click(screen.getByRole('link', { name: /^여행 상품 선택/ }))
    await user.click(await screen.findByRole('link', { name: '고객 첫 화면' }))
    expect(await screen.findByRole('heading', { name: '고객 메뉴' })).toBeInTheDocument()
    const late = jsonResponse(200, previousTours)
    const readBody = vi.spyOn(late, 'text')
    await act(async () => respond(late))
    // 본문을 다 읽은 뒤의 처리는 마이크로태스크뿐이라, 그다음 타이머 한 번이면 끝나 있다
    await waitFor(() => expect(readBody).toHaveBeenCalled())
    await act(async () => {
      await readBody.mock.results[0].value
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('StrictMode에서도 이전 여행을 한 번만 부르고 팝업을 띄운다', async () => {
    markFromLogin()
    respondPreviousTours()
    renderAt('/', { strict: true })

    expect(await screen.findByRole('dialog', { name: '이전 여행' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(isFromLogin()).toBe(false)
  })

  it('로그인 화면에서 고객으로 로그인하면(StrictMode) 고객 첫 화면에 이전 여행 팝업이 뜬다', async () => {
    AuthStore.clear()
    fetchMock.mockImplementation(async (path) =>
      path === '/api/v1/members/login'
        ? jsonResponse(200, { memberType: 'CUSTOMER', name: '홍길동' })
        : jsonResponse(200, previousTours),
    )
    const router = renderAt('/login', { strict: true })
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('아이디'), 'hong')
    await user.type(screen.getByLabelText('비밀번호'), 'password1')
    await user.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('dialog', { name: '이전 여행' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(sentRequest(fetchMock, 1)).toEqual({ path: '/api/v1/bookings/previous', method: 'GET', body: undefined })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
