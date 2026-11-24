import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tourLevelLabel, type TourLevel } from '@/lib/labels'
import type {
  MyBookingResponse,
  OptionCategory,
  PriceQuote,
  TourLevelsResponse,
  TourOptionsResponse,
} from '@/lib/tours'
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
  optionIds: [22],
  finalPrice: 3_000_000,
  appliedAt: '2026-11-20T03:15:00.123456Z',
  status: 'RECRUITING',
  headcountToConfirm: 2,
  changeable: true,
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
  optionIds: [],
  finalPrice: 1_350_000,
  appliedAt: '2026-11-19T10:00:00Z',
  status: 'CONFIRMED',
  headcountToConfirm: 0,
  changeable: false,
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

  it('상세 칸이 있으면 자세히 보기에 신청한 때·옵션(기본 제공 표시)·할인 전후 가격을 보여 준다', async () => {
    const detailed: MyBookingResponse = {
      ...confirmed,
      finalPrice: 1_215_000,
      appliedAt: '2026-11-19T16:00:00Z', // 서울로는 11월 20일 오전 1시
      totalPrice: 1_350_000,
      discount: 135_000,
      options: [
        { category: 'HOTEL', name: '5등급 호텔', chosen: false },
        { category: 'TRANSPORT', name: '비행기 비즈니스석', chosen: true },
        { category: 'MEAL', name: '고급 레스토랑', chosen: false },
        { category: 'EXTRA', name: '샴페인', chosen: false },
        { category: 'EXTRA', name: '커피', chosen: true },
      ],
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [detailed, recruiting]))
    renderAt('/bookings')

    const [first, second] = await screen.findAllByRole('listitem')
    const details = within(first).getByText('자세히 보기').closest('details')
    expect(details).not.toHaveAttribute('open')
    await userEvent.setup().click(within(first).getByText('자세히 보기'))
    expect(details).toHaveAttribute('open')

    const terms = within(first)
      .getAllByRole('term')
      .map((term) => term.textContent)
    const definitions = within(first)
      .getAllByRole('definition')
      .map((definition) => definition.textContent)
    expect(terms).toEqual(['신청한 때', '호텔', '교통', '식사', '추가 옵션', '가격'])
    expect(definitions.slice(1)).toEqual([
      '5등급 호텔(기본 제공)',
      '비행기 비즈니스석',
      '고급 레스토랑(기본 제공)',
      '샴페인(기본 제공), 커피',
      '1,350,000원 − 할인 135,000원 = 1,215,000원',
    ])
    expect(definitions[0]).toContain('2026년 11월 20일')
    expect(within(second).queryByText('자세히 보기')).not.toBeInTheDocument()
  })

  it('신청한 때를 날짜로 읽지 못하면 그 줄만 빼고, 모르는 옵션 종류가 있으면 상세를 그리지 않는다', async () => {
    const details = { totalPrice: 1_350_000, discount: 0 }
    const badTime: MyBookingResponse = {
      ...confirmed,
      ...details,
      appliedAt: '날짜 아님',
      options: [{ category: 'HOTEL', name: '5등급 호텔', chosen: false }],
    }
    const unknownCategory = {
      ...recruiting,
      totalPrice: 3_000_000, // 가격 식은 맞고 옵션 종류만 모른다
      discount: 0,
      options: [{ category: 'INSURANCE', name: '여행자 보험', chosen: true }],
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [badTime, unknownCategory]))
    renderAt('/bookings')

    const [first, second] = await screen.findAllByRole('listitem')
    await userEvent.setup().click(within(first).getByText('자세히 보기'))
    expect(
      within(first)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['호텔', '가격'])
    expect(within(second).queryByText('자세히 보기')).not.toBeInTheDocument()
  })

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
    ['옵션 ID가 목록이 아닌 신청', () => jsonResponse(200, [{ ...recruiting, optionIds: '22' }])],
    ['바꿀 수 있는지가 빠진 신청', () => jsonResponse(200, [{ ...recruiting, changeable: undefined }])],
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

describe('신청 바꾸기', () => {
  const BOOKINGS = 'GET /api/v1/bookings'
  const LEVELS = 'GET /api/v1/tours/9/levels'
  const QUOTE = 'POST /api/v1/bookings/21/quote'
  const CHANGE = 'POST /api/v1/bookings/21/change'
  const CANNOT_CHANGE = '출발했거나 취소된 여행은 바꿀 수 없습니다.'
  const NOT_FOUND = '신청을 찾을 수 없습니다.'
  const NOT_THIS_TOUR = '이 상품에 없는 옵션입니다.'
  const SERVER_ERROR = '서버에 문제가 생겼습니다.'

  const levels: TourLevelsResponse = {
    service: '커플 스파',
    souvenir: '커플 앨범',
    vehicle: '전용 차량',
    levels: [
      { level: 'GRAND', name: '그랜드', price: 1_500_000, hotelGrade: 4, meal: '한식', includesChampagne: false },
      {
        level: 'PREMIUM',
        name: '프리미엄',
        price: 2_000_000,
        hotelGrade: 5,
        meal: '코스 요리',
        includesChampagne: true,
      },
    ],
  }

  const options: TourOptionsResponse = {
    hotels: [{ optionId: 13, name: '5등급 호텔', priceDiff: 200_000 }],
    transports: [{ optionId: 22, name: '리무진', priceDiff: 50_000 }],
    meals: [{ optionId: 31, name: '도시락', priceDiff: -30_000 }],
    extras: [
      { optionId: 41, name: '샴페인', priceDiff: 40_000 },
      { optionId: 42, name: '커피', priceDiff: 5_000 },
    ],
  }

  const categories: [keyof TourOptionsResponse, OptionCategory][] = [
    ['hotels', 'HOTEL'],
    ['transports', 'TRANSPORT'],
    ['meals', 'MEAL'],
    ['extras', 'EXTRA'],
  ]

  interface Choice {
    level: TourLevel
    optionIds: number[]
  }

  // 서버처럼 바꿀 내용으로 가격을 계산한다(등급 가격 + 옵션 요금 차이) × 신청 인원
  function quoteFor({ level, optionIds }: Choice): PriceQuote {
    const chosen = categories.flatMap(([key, category]) =>
      options[key].filter((item) => optionIds.includes(item.optionId)).map((item) => ({ ...item, category })),
    )
    const perPerson =
      levels.levels.find((item) => item.level === level)!.price + chosen.reduce((sum, item) => sum + item.priceDiff, 0)
    const totalPrice = perPerson * recruiting.headcount
    return {
      summary: {
        tourId: recruiting.tourId,
        title: recruiting.title,
        departureDate: recruiting.departureDate,
        duration: recruiting.duration,
        level,
        levelName: tourLevelLabel(level),
        headcount: recruiting.headcount,
        options: chosen,
      },
      totalPrice,
      discount: 0,
      finalPrice: totalPrice,
    }
  }

  function changedFor(choice: Choice): MyBookingResponse {
    return {
      ...recruiting,
      level: choice.level,
      levelName: tourLevelLabel(choice.level),
      optionIds: [...choice.optionIds].sort((a, b) => a - b),
      finalPrice: quoteFor(choice).finalPrice,
    }
  }

  type Reply = Response | ((body: unknown) => Response | Promise<Response>)

  // 한 번만 쓰는 답(먼저 쓴다)과 늘 쓰는 답
  let once: Map<string, Reply[]>
  let always: Map<string, Reply>
  let unexpected: string[]

  function requestKey(input: RequestInfo | URL, init: RequestInit | undefined): string {
    return `${init?.method ?? 'GET'} ${String(input)}`
  }

  function replyOnce(key: string, ...replies: Reply[]) {
    once.set(key, [...(once.get(key) ?? []), ...replies])
  }

  function bodiesOf(key: string): unknown[] {
    return fetchMock.mock.calls
      .filter(([input, init]) => requestKey(input, init) === key)
      .map(([, init]) => JSON.parse(String(init?.body)))
  }

  function countOf(key: string): number {
    return fetchMock.mock.calls.filter(([input, init]) => requestKey(input, init) === key).length
  }

  function failWith(status: number, message: string): Response {
    return jsonResponse(status, { message })
  }

  // 답을 미뤄 두었다가 resolve로 보낸다
  function deferred() {
    let resolve: (response: Response) => void = () => {}
    const reply = () => new Promise<Response>((done) => (resolve = done))
    return { reply, resolve: (response: Response) => resolve(response) }
  }

  beforeEach(() => {
    once = new Map()
    unexpected = []
    always = new Map<string, Reply>([
      [BOOKINGS, () => jsonResponse(200, [recruiting, confirmed])],
      [LEVELS, () => jsonResponse(200, levels)],
      ['GET /api/v1/tours/9/options?level=GRAND', () => jsonResponse(200, options)],
      ['GET /api/v1/tours/9/options?level=PREMIUM', () => jsonResponse(200, options)],
      [QUOTE, (body) => jsonResponse(200, quoteFor(body as Choice))],
      [CHANGE, (body) => jsonResponse(200, changedFor(body as Choice))],
    ])
    fetchMock.mockImplementation(async (input, init) => {
      const key = requestKey(input, init)
      const reply = once.get(key)?.shift() ?? always.get(key)
      if (!reply) {
        unexpected.push(key)
        return failWith(500, `예상하지 않은 요청: ${key}`)
      }
      if (reply instanceof Response) return reply
      return reply(init?.body ? JSON.parse(String(init.body)) : undefined)
    })
    vi.spyOn(toast, 'success').mockImplementation(() => 'toast')
  })

  afterEach(() => {
    expect(unexpected).toEqual([])
  })

  // 첫 줄(모집 중인 허니문 신청)의 바꾸기 단추를 누른다. 창을 열 때의 요청이 바로 실패하면 창이 곧 닫혀, 창을 찾지 않는다
  async function clickChange(user: UserEvent) {
    const router = renderAt('/bookings')
    const [first] = await screen.findAllByRole('listitem')
    await user.click(within(first).getByRole('button', { name: '바꾸기' }))
    return router
  }

  // 창을 열고 지금 내용(그랜드·리무진)의 가격이 나올 때까지 기다린다
  async function openChange(user: UserEvent) {
    const router = await clickChange(user)
    const dialog = await screen.findByRole('dialog', { name: '신청 바꾸기' })
    expect(await within(dialog).findByText('최종 가격 3,100,000원')).toBeInTheDocument()
    return { dialog, router }
  }

  function saveButton(dialog: HTMLElement): HTMLElement {
    return within(dialog).getByRole('button', { name: '바꾸기 저장' })
  }

  async function waitClosed() {
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  }

  it('바꿀 수 있는 신청의 줄에만 바꾸기 단추가 보인다', async () => {
    renderAt('/bookings')

    const [first, second] = await screen.findAllByRole('listitem')
    expect(within(first).getByRole('button', { name: '바꾸기' })).toBeInTheDocument()
    expect(within(second).queryByRole('button', { name: '바꾸기' })).not.toBeInTheDocument()
  })

  it('창을 열면 상품·출발일·인원을 보이고, 지금 등급과 옵션을 골라 두고, 가격 계산을 한 번 불러 가격을 보인다', async () => {
    const { dialog } = await openChange(userEvent.setup())

    expect(
      within(dialog).getByText('허니문 낭만 투어 12/20 출발 5일 · 2026년 12월 20일 출발 · 2명'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('상품과 인원은 바꿀 수 없습니다.')).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: /^그랜드/ })).toBeChecked()
    expect(await within(dialog).findByRole('radio', { name: /^리무진/ })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /^커피/ })).not.toBeChecked()
    // 가격 요약은 할인 "확인" 단추 없이 보인다
    expect(within(dialog).getByText('가격 요약')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '확인' })).not.toBeInTheDocument()
    expect(bodiesOf(QUOTE)).toEqual([{ level: 'GRAND', optionIds: [22] }])
    expect(countOf(CHANGE)).toBe(0)
  })

  it('등급을 바꾸면 가격 계산을 불러 바뀐 가격을 보인다', async () => {
    const user = userEvent.setup()
    const { dialog } = await openChange(user)

    await user.click(within(dialog).getByRole('radio', { name: /^프리미엄/ }))

    expect(await within(dialog).findByText('최종 가격 4,100,000원')).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: /^프리미엄/ })).toBeChecked()
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ level: 'PREMIUM', optionIds: [22] })
    expect(await within(dialog).findByText('프리미엄 등급은 샴페인이 기본으로 포함됩니다.')).toBeInTheDocument()
  })

  it('옵션을 바꾸면 가격 계산을 불러 바뀐 가격을 보인다', async () => {
    const user = userEvent.setup()
    const { dialog } = await openChange(user)

    await user.click(await within(dialog).findByRole('checkbox', { name: /^커피/ }))

    expect(await within(dialog).findByText('최종 가격 3,110,000원')).toBeInTheDocument()
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ level: 'GRAND', optionIds: [22, 42] })
  })

  it('저장하면 바꿀 내용을 보내고, 창을 닫고, 목록의 그 줄을 응답으로 바꾸고 알린다', async () => {
    const user = userEvent.setup()
    const { dialog } = await openChange(user)
    await user.click(within(dialog).getByRole('radio', { name: /^프리미엄/ }))
    await within(dialog).findByText('최종 가격 4,100,000원')

    await user.click(saveButton(dialog))

    await waitClosed()
    expect(bodiesOf(CHANGE)).toEqual([{ level: 'PREMIUM', optionIds: [22] }])
    const [first, second] = screen.getAllByRole('listitem')
    expect(within(first).getByText('2026년 12월 20일 출발 · 프리미엄 · 2명')).toBeInTheDocument()
    expect(within(first).getByText('4,100,000원')).toBeInTheDocument()
    expect(within(second).getByText('1,350,000원')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('신청 내용을 바꿨습니다.')
    // 목록은 다시 부르지 않는다
    expect(countOf(BOOKINGS)).toBe(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('그만두기를 누르면 저장하지 않고 창을 닫는다', async () => {
    const user = userEvent.setup()
    const { dialog } = await openChange(user)
    await user.click(within(dialog).getByRole('radio', { name: /^프리미엄/ }))
    await within(dialog).findByText('최종 가격 4,100,000원')

    await user.click(within(dialog).getByRole('button', { name: '그만두기' }))

    await waitClosed()
    expect(countOf(CHANGE)).toBe(0)
    expect(within(screen.getAllByRole('listitem')[0]).getByText('3,000,000원')).toBeInTheDocument()
  })

  it('다시 열면 지금 신청 내용에서 시작한다', async () => {
    const user = userEvent.setup()
    const { dialog } = await openChange(user)
    await user.click(within(dialog).getByRole('radio', { name: /^프리미엄/ }))
    await within(dialog).findByText('최종 가격 4,100,000원')
    await user.click(within(dialog).getByRole('button', { name: '그만두기' }))
    await waitClosed()

    await user.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: '바꾸기' }))
    const reopened = await screen.findByRole('dialog', { name: '신청 바꾸기' })

    expect(await within(reopened).findByText('최종 가격 3,100,000원')).toBeInTheDocument()
    expect(within(reopened).getByRole('radio', { name: /^그랜드/ })).toBeChecked()
  })

  describe('400(고를 수 없는 등급·옵션)', () => {
    it('옵션을 바꾼 가격 계산이면 창 안에 문구를 보이고 마지막으로 가격이 나온 옵션으로 되돌린다', async () => {
      const user = userEvent.setup()
      const { dialog } = await openChange(user)
      replyOnce(QUOTE, failWith(400, NOT_THIS_TOUR))

      await user.click(await within(dialog).findByRole('checkbox', { name: /^커피/ }))

      expect(await within(dialog).findByText(NOT_THIS_TOUR)).toBeInTheDocument()
      expect(within(dialog).getByRole('checkbox', { name: /^커피/ })).not.toBeChecked()
      expect(within(dialog).getByText('최종 가격 3,100,000원')).toBeInTheDocument()
      expect(saveButton(dialog)).toBeEnabled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('등급을 바꾼 가격 계산이면 마지막으로 가격이 나온 등급과 옵션으로 되돌린다', async () => {
      const user = userEvent.setup()
      const { dialog } = await openChange(user)
      await user.click(await within(dialog).findByRole('checkbox', { name: /^커피/ }))
      await within(dialog).findByText('최종 가격 3,110,000원')
      replyOnce(QUOTE, failWith(400, '허니문는 그랜드와 프리미엄만 고를 수 있습니다.'))

      await user.click(within(dialog).getByRole('radio', { name: /^프리미엄/ }))

      expect(await within(dialog).findByText('허니문는 그랜드와 프리미엄만 고를 수 있습니다.')).toBeInTheDocument()
      expect(within(dialog).getByRole('radio', { name: /^그랜드/ })).toBeChecked()
      expect(await within(dialog).findByRole('checkbox', { name: /^커피/ })).toBeChecked()
      expect(within(dialog).getByText('최종 가격 3,110,000원')).toBeInTheDocument()
    })

    it('다시 바꾸면 문구를 지운다', async () => {
      const user = userEvent.setup()
      const { dialog } = await openChange(user)
      replyOnce(QUOTE, failWith(400, NOT_THIS_TOUR))
      await user.click(await within(dialog).findByRole('checkbox', { name: /^커피/ }))
      await within(dialog).findByText(NOT_THIS_TOUR)

      await user.click(within(dialog).getByRole('checkbox', { name: /^샴페인/ }))

      expect(await within(dialog).findByText('최종 가격 3,180,000원')).toBeInTheDocument()
      expect(within(dialog).queryByText(NOT_THIS_TOUR)).not.toBeInTheDocument()
    })

    it('창을 열 때의 가격 계산이면 창을 닫지 않고 문구를 보인다', async () => {
      replyOnce(QUOTE, failWith(400, NOT_THIS_TOUR))
      await clickChange(userEvent.setup())
      const dialog = await screen.findByRole('dialog', { name: '신청 바꾸기' })

      expect(await within(dialog).findByText(NOT_THIS_TOUR)).toBeInTheDocument()
      expect(within(dialog).getByRole('radio', { name: /^그랜드/ })).toBeChecked()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('저장이면 창 안에 문구를 보이고 창을 닫지 않는다', async () => {
      const user = userEvent.setup()
      const { dialog } = await openChange(user)
      replyOnce(CHANGE, failWith(400, NOT_THIS_TOUR))

      await user.click(saveButton(dialog))

      expect(await within(dialog).findByText(NOT_THIS_TOUR)).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(saveButton(dialog)).toBeEnabled()
      expect(countOf(BOOKINGS)).toBe(1)
      expect(toast.success).not.toHaveBeenCalled()
    })
  })

  describe('409(출발했거나 취소된 여행)·404(없는 신청)', () => {
    it.each([
      [409, CANNOT_CHANGE],
      [404, NOT_FOUND],
    ])('가격 계산이 %s면 문구를 알리고 창을 닫고 목록을 다시 부른다', async (status, message) => {
      const user = userEvent.setup()
      const { dialog } = await openChange(user)
      replyOnce(QUOTE, failWith(status, message))

      await user.click(await within(dialog).findByRole('checkbox', { name: /^커피/ }))

      await waitClosed()
      expect(toast.error).toHaveBeenCalledWith(message)
      await waitFor(() => expect(countOf(BOOKINGS)).toBe(2))
      expect(await screen.findAllByRole('listitem')).toHaveLength(2)
    })

    it('창을 열 때의 가격 계산이 409여도 창을 닫고 목록을 다시 부른다', async () => {
      replyOnce(QUOTE, failWith(409, CANNOT_CHANGE))
      await clickChange(userEvent.setup())

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(CANNOT_CHANGE))
      await waitClosed()
      await waitFor(() => expect(countOf(BOOKINGS)).toBe(2))
    })

    it.each([
      [409, CANNOT_CHANGE],
      [404, NOT_FOUND],
    ])('저장이 %s면 문구를 알리고 창을 닫고 목록을 다시 부른다', async (status, message) => {
      const user = userEvent.setup()
      const { dialog } = await openChange(user)
      replyOnce(CHANGE, failWith(status, message))

      await user.click(saveButton(dialog))

      await waitClosed()
      expect(toast.error).toHaveBeenCalledWith(message)
      await waitFor(() => expect(countOf(BOOKINGS)).toBe(2))
      expect(toast.success).not.toHaveBeenCalled()
    })
  })

  describe('그 밖의 실패', () => {
    it.each([
      ['투어 등급 불러오기가 실패하면', LEVELS, () => failWith(500, SERVER_ERROR)],
      ['투어 등급 응답이 등급 목록이 아니면', LEVELS, () => jsonResponse(200, { message: '잘못된 응답' })],
      ['처음 가격 계산이 실패하면', QUOTE, () => failWith(500, SERVER_ERROR)],
    ])('창을 열 때 %s 공용 알림을 띄우고 창을 닫는다', async (_, key, reply) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      replyOnce(key, reply())
      await clickChange(userEvent.setup())

      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
      await waitClosed()
      expect(countOf(LEVELS)).toBe(1)
      // 신청은 그대로라 목록을 다시 부르지 않는다
      expect(countOf(BOOKINGS)).toBe(1)
    })

    it.each([
      ['서버 오류', () => failWith(500, SERVER_ERROR)],
      ['가격이 아닌 응답', () => jsonResponse(200, { totalPrice: 1 })],
    ])('바꾼 내용의 가격 계산이 %s면 공용 알림을 띄우고 마지막으로 가격이 나온 내용으로 되돌린다', async (_, reply) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const user = userEvent.setup()
      const { dialog } = await openChange(user)
      replyOnce(QUOTE, reply())

      await user.click(within(dialog).getByRole('radio', { name: /^프리미엄/ }))

      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
      expect(await within(dialog).findByText('최종 가격 3,100,000원')).toBeInTheDocument()
      expect(within(dialog).getByRole('radio', { name: /^그랜드/ })).toBeChecked()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it.each([
      ['서버 오류', () => failWith(500, SERVER_ERROR)],
      ['연결 끊김', () => Promise.reject(new TypeError('Failed to fetch'))],
      ['신청이 아닌 응답', () => jsonResponse(200, { bookingId: 21 })],
    ])('저장이 %s면 바뀌었을 수 있어 공용 알림을 띄우고 창을 닫고 목록을 다시 부른다', async (_, reply) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const user = userEvent.setup()
      const { dialog } = await openChange(user)
      replyOnce(CHANGE, reply)

      await user.click(saveButton(dialog))

      await waitClosed()
      await waitFor(() => expect(countOf(BOOKINGS)).toBe(2))
      expect(toast.error).toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
    })
  })

  it('가격을 계산하거나 저장하는 동안 "바꾸기 저장"과 고르기를 막는다', async () => {
    const user = userEvent.setup()
    const { dialog } = await openChange(user)
    const quote = deferred()
    replyOnce(QUOTE, quote.reply)

    await user.click(await within(dialog).findByRole('checkbox', { name: /^커피/ }))

    expect(saveButton(dialog)).toBeDisabled()
    expect(within(dialog).getByRole('radio', { name: /^프리미엄/ })).toBeDisabled()
    expect(within(dialog).getByRole('checkbox', { name: /^샴페인/ })).toBeDisabled()
    // 계산 중에는 그만둘 수 있다
    expect(within(dialog).getByRole('button', { name: '그만두기' })).toBeEnabled()
    await act(async () => quote.resolve(jsonResponse(200, quoteFor({ level: 'GRAND', optionIds: [22, 42] }))))
    expect(await within(dialog).findByText('최종 가격 3,110,000원')).toBeInTheDocument()
    expect(saveButton(dialog)).toBeEnabled()

    const save = deferred()
    replyOnce(CHANGE, save.reply)
    await user.click(saveButton(dialog))

    expect(saveButton(dialog)).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '그만두기' })).toBeDisabled()
    expect(within(dialog).getByRole('radio', { name: /^프리미엄/ })).toBeDisabled()
    // Esc로도 닫히지 않는다
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => save.resolve(jsonResponse(200, changedFor({ level: 'GRAND', optionIds: [22, 42] }))))
    await waitClosed()
    expect(countOf(CHANGE)).toBe(1)
  })

  it('가격을 계산하는 중에 창을 닫으면 늦게 온 응답을 버린다', async () => {
    const user = userEvent.setup()
    const { dialog } = await openChange(user)
    const quote = deferred()
    replyOnce(QUOTE, quote.reply)
    await user.click(await within(dialog).findByRole('checkbox', { name: /^커피/ }))

    await user.click(within(dialog).getByRole('button', { name: '그만두기' }))
    await waitClosed()
    await act(async () => {
      quote.resolve(failWith(409, CANNOT_CHANGE))
      await sleep(20)
    })

    expect(toast.error).not.toHaveBeenCalled()
    expect(countOf(BOOKINGS)).toBe(1)
  })

  it('저장하는 중에 다른 화면으로 가면 늦게 온 실패를 알리지 않는다', async () => {
    const user = userEvent.setup()
    const { dialog, router } = await openChange(user)
    const save = deferred()
    replyOnce(CHANGE, save.reply)
    await user.click(saveButton(dialog))

    // 화면을 떠나는 것은 막지 않는다(뒤로 가기 등)
    await act(async () => {
      await router.navigate('/')
    })
    expect(await screen.findByRole('heading', { name: '고객 메뉴' })).toBeInTheDocument()
    await act(async () => {
      save.resolve(failWith(500, SERVER_ERROR))
      await sleep(20)
    })

    expect(toast.error).not.toHaveBeenCalled()
  })
})
