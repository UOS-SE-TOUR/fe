import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { useState, type ComponentType } from 'react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tourLevelLabel } from '@/lib/labels'
import type {
  OptionCategory,
  PriceQuote,
  QuoteRequest,
  TourLevelsResponse,
  TourOptionsResponse,
  TourSummary,
} from '@/lib/tours'
import { CONNECTION_FAILED_MESSAGE, GATEWAY_TIMEOUT_MESSAGE, UNKNOWN_RESULT_MESSAGE } from '@/modules/ApiClient'
import {
  HEADCOUNT_DELAY_MS,
  TourSelectPage,
  type VoiceInputProps,
  type VoiceSelection,
} from '@/pages/TourSelectPage'
import { jsonResponse, stubFetch } from '@/test/http'
import { leaveBlocked, waitUntilLeaveAllowed } from '@/test/leave'

const SEAT_SHORTAGE = '남은 자리보다 인원이 많습니다.'
const NEGATIVE_PRICE = '고른 옵션으로는 가격을 계산할 수 없습니다. 다른 옵션을 골라 주세요.'
const CLOSED = '마감된 상품입니다.'
const CANNOT_APPLY = '더는 신청할 수 없는 상품입니다. 다른 상품을 골라 주세요.'

const TOURS = 'GET /api/v1/tours?theme=GOLF'
const QUOTE = 'POST /api/v1/bookings/quote'
const APPLY = 'POST /api/v1/bookings'

const golfTours: TourSummary[] = [
  {
    tourId: 1,
    title: '골프 챌린지 투어 12/20 출발 5일',
    departureDate: '2026-12-20',
    duration: 5,
    remainingSeats: 10,
    status: 'RECRUITING',
  },
  {
    tourId: 2,
    title: '골프 챌린지 투어 12/27 출발 4일',
    departureDate: '2026-12-27',
    duration: 4,
    remainingSeats: 0,
    status: 'FULL',
  },
  {
    tourId: 3,
    title: '골프 챌린지 투어 1/3 출발 3일',
    departureDate: '2027-01-03',
    duration: 3,
    remainingSeats: 6,
    status: 'CONFIRMED',
  },
]

const levels: TourLevelsResponse = {
  service: '라운딩 2회',
  souvenir: '골프공 세트',
  vehicle: '골프백 전용 차량',
  levels: [
    { level: 'CLASSIC', name: '클래식', price: 1_000_000, hotelGrade: 3, meal: '도시락', includesChampagne: false },
    { level: 'GRAND', name: '그랜드', price: 1_500_000, hotelGrade: 4, meal: '한식', includesChampagne: false },
    { level: 'PREMIUM', name: '프리미엄', price: 2_000_000, hotelGrade: 5, meal: '코스 요리', includesChampagne: true },
  ],
}

const grandOptions: TourOptionsResponse = {
  hotels: [
    { optionId: 11, name: '3등급 호텔', priceDiff: -100_000 },
    { optionId: 12, name: '4등급 호텔', priceDiff: 0 },
    { optionId: 13, name: '5등급 호텔', priceDiff: 200_000 },
  ],
  transports: [
    { optionId: 21, name: '기본 교통', priceDiff: 0 },
    { optionId: 22, name: '리무진', priceDiff: 50_000 },
  ],
  meals: [
    { optionId: 31, name: '도시락', priceDiff: -30_000 },
    { optionId: 32, name: '한식', priceDiff: 0 },
  ],
  extras: [
    { optionId: 41, name: '샴페인', priceDiff: 40_000 },
    { optionId: 42, name: '커피', priceDiff: 5_000 },
  ],
}

const premiumOptions: TourOptionsResponse = {
  ...grandOptions,
  hotels: [
    { optionId: 11, name: '3등급 호텔', priceDiff: -300_000 },
    { optionId: 12, name: '4등급 호텔', priceDiff: -200_000 },
    { optionId: 13, name: '5등급 호텔', priceDiff: 0 },
  ],
  extras: [
    { optionId: 41, name: '샴페인', priceDiff: 0 },
    { optionId: 42, name: '커피', priceDiff: 5_000 },
  ],
}

const categories: [keyof TourOptionsResponse, OptionCategory][] = [
  ['hotels', 'HOTEL'],
  ['transports', 'TRANSPORT'],
  ['meals', 'MEAL'],
  ['extras', 'EXTRA'],
]

// 서버처럼 고른 내용으로 가격을 계산한다(등급 가격 + 옵션 요금 차이) × 인원
function quoteFor(request: QuoteRequest, discount = 0): PriceQuote {
  const tour = golfTours.find((item) => item.tourId === request.tourId)!
  const catalog = request.level === 'PREMIUM' ? premiumOptions : grandOptions
  const options = categories.flatMap(([key, category]) =>
    catalog[key].filter((item) => request.optionIds.includes(item.optionId)).map((item) => ({ ...item, category })),
  )
  const perPerson =
    levels.levels.find((item) => item.level === request.level)!.price +
    options.reduce((sum, item) => sum + item.priceDiff, 0)
  const totalPrice = perPerson * request.headcount
  return {
    summary: {
      tourId: tour.tourId,
      title: tour.title,
      departureDate: tour.departureDate,
      duration: tour.duration,
      level: request.level,
      levelName: tourLevelLabel(request.level),
      headcount: request.headcount,
      options,
    },
    totalPrice,
    discount,
    finalPrice: totalPrice - discount,
  }
}

type Reply = Response | ((body: unknown) => Response | Promise<Response>)

let fetchMock: ReturnType<typeof stubFetch>
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

// 요청마다 실어 보낸 신청 키(요청 머리 Idempotency-Key)
function idempotencyKeysOf(key: string): (string | undefined)[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => requestKey(input, init) === key)
    .map(([, init]) => (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'])
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function failWith(status: number, message: string): Response {
  return jsonResponse(status, { message })
}

beforeEach(() => {
  fetchMock = stubFetch()
  once = new Map()
  unexpected = []
  always = new Map<string, Reply>([
    [TOURS, () => jsonResponse(200, golfTours)],
    ['GET /api/v1/tours/1/levels', () => jsonResponse(200, levels)],
    ['GET /api/v1/tours/3/levels', () => jsonResponse(200, levels)],
    ['GET /api/v1/tours/1/options?level=GRAND', () => jsonResponse(200, grandOptions)],
    ['GET /api/v1/tours/1/options?level=PREMIUM', () => jsonResponse(200, premiumOptions)],
    ['GET /api/v1/tours/3/options?level=GRAND', () => jsonResponse(200, grandOptions)],
    [QUOTE, (body) => jsonResponse(200, quoteFor(body as QuoteRequest))],
    [APPLY, () => jsonResponse(201, { bookingId: 100, status: 'CONFIRMED' })],
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
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
})

afterEach(() => {
  expect(unexpected).toEqual([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// 고객 메뉴에서 들어온 것처럼 띄운다(뒤로 가기가 고객 메뉴로 간다)
function renderWithRouter(voiceInput?: ComponentType<VoiceInputProps>) {
  const router = createMemoryRouter(
    [
      { path: '/tours', element: <TourSelectPage voiceInput={voiceInput} /> },
      { path: '/', element: <h1>고객 메뉴</h1> },
    ],
    { initialEntries: ['/', '/tours'], initialIndex: 1 },
  )
  render(<RouterProvider router={router} />)
  return { user: userEvent.setup(), router }
}

function renderPage(voiceInput?: ComponentType<VoiceInputProps>) {
  return renderWithRouter(voiceInput).user
}

async function openTour(user: UserEvent, title: RegExp = /12\/20 출발 5일/) {
  await user.click(screen.getByRole('button', { name: '골프 챌린지 투어' }))
  await user.click(await screen.findByRole('button', { name: title }))
  await screen.findByRole('radio', { name: /^그랜드/ })
}

// 인원을 친 뒤 등급을 고른다. 등급이 바뀌면 바로, 그대로면 인원을 멈춘 뒤(HEADCOUNT_DELAY_MS) 한 번 계산한다
async function priceWith(user: UserEvent, level: RegExp, headcount: string) {
  const input = screen.getByLabelText('인원')
  await user.clear(input)
  await user.type(input, headcount)
  const radio = screen.getByRole('radio', { name: level })
  if (radio.getAttribute('aria-checked') !== 'true') await user.click(radio)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function openOptions(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: '옵션 바꾸기' }))
  return screen.findByRole('radio', { name: /^5등급 호텔/ })
}

function finalPrice(): HTMLElement {
  return within(screen.getByText('가격 요약').closest('[data-slot=card]') as HTMLElement).getByText(/원$/, {
    selector: 'dd.font-semibold',
  })
}

describe('테마 → 상품 → 투어 등급·인원 → 옵션 → 가격 → 신청', () => {
  it('한 번에 지나가고, 신청은 마지막으로 가격이 나온 내용으로 보낸다', async () => {
    const user = renderPage()
    expect(screen.getByRole('heading', { name: '여행 상품 선택' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '골프 챌린지 투어' }))
    const closed = await screen.findByRole('button', { name: /12\/27 출발 4일/ })
    expect(closed).toBeDisabled()
    expect(within(closed).getByText('마감')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1\/3 출발 3일/ })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /12\/20 출발 5일/ }))
    expect(await screen.findByRole('radio', { name: /^그랜드 · 1인 1,500,000원/ })).toBeInTheDocument()
    expect(screen.getByText('5등급 호텔 · 코스 요리 · 샴페인 포함')).toBeInTheDocument()
    expect(screen.getByText('모든 등급에 포함: 라운딩 2회 · 골프공 세트 · 골프백 전용 차량')).toBeInTheDocument()
    expect(screen.getAllByText('남은 자리 10명').length).toBeGreaterThan(0)

    await priceWith(user, /^그랜드/, '2')
    expect(await screen.findByText('가격 요약')).toBeInTheDocument()
    expect(bodiesOf(QUOTE)).toEqual([{ tourId: 1, level: 'GRAND', headcount: 2, optionIds: [] }])
    expect(finalPrice()).toHaveTextContent('3,000,000원')

    await openOptions(user)
    expect(screen.getByRole('radio', { name: '기본 제공(4등급 호텔)' })).toBeChecked()
    expect(screen.getByRole('radio', { name: /^3등급 호텔1인 −100,000원/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^4등급 호텔추가 요금 없음/ })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /^5등급 호텔1인 \+200,000원/ }))
    expect(await screen.findByText('최종 가격 3,400,000원')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /^커피/ }))
    expect(await screen.findByText('최종 가격 3,410,000원')).toBeInTheDocument()
    expect(bodiesOf(QUOTE).slice(1)).toEqual([
      { tourId: 1, level: 'GRAND', headcount: 2, optionIds: [13] },
      { tourId: 1, level: 'GRAND', headcount: 2, optionIds: [13, 42] },
    ])

    await user.click(screen.getByRole('button', { name: '옵션 고르기 끝' }))
    expect(screen.queryByRole('button', { name: '옵션 고르기 끝' })).not.toBeInTheDocument()
    expect(screen.getByText('5등급 호텔, 커피')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '신청하기' }))
    expect(await screen.findByText('신청했습니다. 지금 상품 상태는 ‘확정’입니다.')).toBeInTheDocument()
    expect(bodiesOf(APPLY)).toEqual([{ tourId: 1, level: 'GRAND', headcount: 2, optionIds: [13, 42] }])
    expect(screen.queryByRole('button', { name: '신청하기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '옵션 바꾸기' })).not.toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each(['1.5', '0', '-1'])('인원 "%s"는 서버에 보내지 않고 정수를 입력하라고 한다', async (headcount) => {
    const user = renderPage()
    await openTour(user)

    await user.click(screen.getByRole('radio', { name: /^그랜드/ }))
    await user.type(screen.getByLabelText('인원'), headcount)

    expect(await screen.findByText('인원은 1 이상의 정수로 입력해 주세요.')).toBeInTheDocument()
    expect(countOf(QUOTE)).toBe(0)
  })

  it('투어 등급만 골랐으면 계산하지 않고 인원을 기다린다', async () => {
    const user = renderPage()
    await openTour(user)

    await user.click(screen.getByRole('radio', { name: /^그랜드/ }))
    expect(screen.getByText('투어 등급과 인원을 고르면 가격이 나옵니다.')).toBeInTheDocument()
    expect(countOf(QUOTE)).toBe(0)
  })

  it('투어 등급을 고르면 바로 계산한다', async () => {
    const user = renderPage()
    await openTour(user)
    await user.type(screen.getByLabelText('인원'), '2')

    await user.click(screen.getByRole('radio', { name: /^그랜드/ }))
    expect(countOf(QUOTE)).toBe(1)
    expect(await screen.findByText('가격 요약')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /^프리미엄/ }))
    expect(countOf(QUOTE)).toBe(2)
    await waitFor(() => expect(finalPrice()).toHaveTextContent('4,000,000원'))
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 1, level: 'PREMIUM', headcount: 2, optionIds: [] })
  })

  it('인원을 치는 동안은 계산하지 않고, 멈추면 한 번 계산한다', async () => {
    const user = renderPage()
    await openTour(user)
    await user.click(screen.getByRole('radio', { name: /^그랜드/ }))

    await user.type(screen.getByLabelText('인원'), '12')
    expect(countOf(QUOTE)).toBe(0)
    await waitFor(() => expect(countOf(QUOTE)).toBe(1))
    expect(bodiesOf(QUOTE)).toEqual([{ tourId: 1, level: 'GRAND', headcount: 12, optionIds: [] }])
  })

  it('인원 칸에서 Enter를 누르면 기다리지 않고 한 번 계산한다', async () => {
    const user = renderPage()
    await openTour(user)
    await user.click(screen.getByRole('radio', { name: /^그랜드/ }))

    await user.type(screen.getByLabelText('인원'), '3{Enter}')
    expect(countOf(QUOTE)).toBe(1)
    await sleep(HEADCOUNT_DELAY_MS + 100)
    expect(countOf(QUOTE)).toBe(1)
  })

  it('가격을 계산하는 동안에도 인원을 고칠 수 있고, 고친 인원은 그 계산이 끝난 뒤 계산한다', async () => {
    let finish: (response: Response) => void = () => {}
    replyOnce(QUOTE, () => new Promise<Response>((resolve) => (finish = resolve)))
    const user = renderPage()
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')

    expect(screen.getByLabelText('인원')).toBeEnabled()
    expect(screen.getByText('가격을 계산하는 중입니다.')).toBeInTheDocument()
    await priceWith(user, /^그랜드/, '3')
    await sleep(HEADCOUNT_DELAY_MS + 100)
    expect(countOf(QUOTE)).toBe(1)

    finish(jsonResponse(200, quoteFor({ tourId: 1, level: 'GRAND', headcount: 2, optionIds: [] })))
    await waitFor(() => expect(countOf(QUOTE)).toBe(2))
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 1, level: 'GRAND', headcount: 3, optionIds: [] })
    expect(await screen.findByText('3명')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '신청하기' })).toBeEnabled())
  })

  it('옵션 계산 중에 인원을 고치면, 옵션 계산이 400으로 되돌린 옵션과 고친 인원으로 계산한다', async () => {
    const user = renderPage()
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    await openOptions(user)

    let finish: (response: Response) => void = () => {}
    replyOnce(QUOTE, () => new Promise<Response>((resolve) => (finish = resolve)))
    await user.click(screen.getByRole('radio', { name: /^3등급 호텔/ }))
    await priceWith(user, /^그랜드/, '3')
    await sleep(HEADCOUNT_DELAY_MS + 100)
    expect(countOf(QUOTE)).toBe(2)

    finish(failWith(400, NEGATIVE_PRICE))
    expect(await screen.findByText(NEGATIVE_PRICE)).toBeInTheDocument()
    await waitFor(() => expect(countOf(QUOTE)).toBe(3))
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 1, level: 'GRAND', headcount: 3, optionIds: [] })
    expect(screen.getByRole('radio', { name: '기본 제공(4등급 호텔)' })).toBeChecked()
  })

  it('늦게 온 응답이 지금 입력의 검사 문구를 지우지 않는다', async () => {
    let finish: (response: Response) => void = () => {}
    replyOnce(QUOTE, () => new Promise<Response>((resolve) => (finish = resolve)))
    const user = renderPage()
    await openTour(user)
    await priceWith(user, /^그랜드/, '5')

    await priceWith(user, /^그랜드/, '0')
    expect(screen.getByText('인원은 1 이상의 정수로 입력해 주세요.')).toBeInTheDocument()
    finish(jsonResponse(200, quoteFor({ tourId: 1, level: 'GRAND', headcount: 5, optionIds: [] })))
    expect(await screen.findByText('가격 요약')).toBeInTheDocument()
    expect(screen.getByText('인원은 1 이상의 정수로 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '신청하기' })).toBeDisabled()
  })

  it('400 문구나 계산 실패 표시는 인원을 비우면 지운다(지금 입력과 맞지 않는다)', async () => {
    const user = renderPage()
    await openTour(user)
    replyOnce(QUOTE, failWith(400, SEAT_SHORTAGE))
    await priceWith(user, /^그랜드/, '50')
    expect(await screen.findByText(SEAT_SHORTAGE)).toBeInTheDocument()

    await user.clear(screen.getByLabelText('인원'))
    await waitFor(() => expect(screen.queryByText(SEAT_SHORTAGE)).not.toBeInTheDocument())
    expect(screen.getByText('투어 등급과 인원을 고르면 가격이 나옵니다.')).toBeInTheDocument()

    replyOnce(QUOTE, failWith(503, '서버 응답이 없습니다.'))
    await user.type(screen.getByLabelText('인원'), '3')
    expect(await screen.findByRole('button', { name: '다시 계산' })).toBeInTheDocument()
    await user.clear(screen.getByLabelText('인원'))
    await waitFor(() => expect(screen.queryByRole('button', { name: '다시 계산' })).not.toBeInTheDocument())
  })

  it('계산하지 못한 뒤 지난 가격의 인원으로 되돌리면 실패 표시를 지우고 신청할 수 있다', async () => {
    const user = renderPage()
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    await screen.findByText('가격 요약')

    replyOnce(QUOTE, failWith(503, '서버 응답이 없습니다.'))
    await priceWith(user, /^그랜드/, '3')
    expect(await screen.findByText('고친 투어 등급·인원으로 가격을 계산하지 못했습니다.')).toBeInTheDocument()

    await priceWith(user, /^그랜드/, '2')
    await waitFor(() =>
      expect(screen.queryByText('고친 투어 등급·인원으로 가격을 계산하지 못했습니다.')).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: '신청하기' })).toBeEnabled()
    expect(countOf(QUOTE)).toBe(2)
  })

  it('고친 투어 등급·인원의 가격이 나오기 전에는 신청할 수 없다', async () => {
    const user = renderPage()
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    await screen.findByText('가격 요약')

    await user.type(screen.getByLabelText('인원'), '0')
    expect(screen.getByRole('button', { name: '신청하기' })).toBeDisabled()
    await waitFor(() => expect(countOf(QUOTE)).toBe(2))
    await waitFor(() => expect(screen.getByRole('button', { name: '신청하기' })).toBeEnabled())
    expect(screen.getByText('20명')).toBeInTheDocument()
  })

  it('상품을 다시 고르면 고른 옵션과 지난 가격을 비운다', async () => {
    const user = renderPage()
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    await openOptions(user)
    await user.click(screen.getByRole('radio', { name: /^5등급 호텔/ }))
    await screen.findByText('최종 가격 3,400,000원')

    await user.click(screen.getByRole('button', { name: '다른 상품 고르기' }))
    await user.click(await screen.findByRole('button', { name: /1\/3 출발 3일/ }))
    await screen.findByRole('radio', { name: /^그랜드/ })
    expect(screen.queryByText('가격 요약')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '옵션 바꾸기' })).not.toBeInTheDocument()

    await priceWith(user, /^그랜드/, '2')
    await screen.findByText('가격 요약')
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 3, level: 'GRAND', headcount: 2, optionIds: [] })
  })
})

describe('단골 할인', () => {
  it('상품을 고른 뒤 처음 나온 가격의 할인은 따로 보여 주고 한 번 확인받는다', async () => {
    always.set(QUOTE, (body) => jsonResponse(200, quoteFor(body as QuoteRequest, 300_000)))
    const user = renderPage()
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')

    expect(await screen.findByText('단골 할인이 적용됩니다')).toBeInTheDocument()
    expect(screen.getByText('−300,000원')).toBeInTheDocument()
    expect(screen.getByText('2,700,000원')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '신청하기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '옵션 바꾸기' })).not.toBeInTheDocument()

    const requests = fetchMock.mock.calls.length
    await user.click(screen.getByRole('button', { name: '확인' }))
    expect(fetchMock.mock.calls.length).toBe(requests)
    expect(screen.getByText('가격 요약')).toBeInTheDocument()
    expect(finalPrice()).toHaveTextContent('2,700,000원')

    await openOptions(user)
    await user.click(screen.getByRole('radio', { name: /^5등급 호텔/ }))
    expect(await screen.findByText('최종 가격 3,100,000원')).toBeInTheDocument()
    expect(screen.queryByText('단골 할인이 적용됩니다')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '신청하기' })).toBeEnabled()
  })

  it('처음 나온 가격이 옵션을 바꿀 때 나왔어도, 확인받는 동안은 옵션 패널을 닫아 둔다', async () => {
    const user = renderPage()
    await openTour(user)
    replyOnce(QUOTE, failWith(400, NEGATIVE_PRICE))
    await priceWith(user, /^그랜드/, '2')
    await screen.findByText(NEGATIVE_PRICE)

    always.set(QUOTE, (body) => jsonResponse(200, quoteFor(body as QuoteRequest, 300_000)))
    await openOptions(user)
    await user.click(screen.getByRole('radio', { name: /^5등급 호텔/ }))

    expect(await screen.findByText('단골 할인이 적용됩니다')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '옵션 고르기 끝' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '확인' }))
    expect(screen.getByRole('button', { name: '옵션 고르기 끝' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^5등급 호텔/ })).toBeChecked()
  })
})

describe('투어 등급·인원을 고른 뒤의 가격 계산', () => {
  it('400이면 문구를 보여 주고, 고른 옵션은 남긴 채 줄어든 남은 자리와 함께 다시 받는다', async () => {
    const user = renderPage()
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    await openOptions(user)
    await user.click(screen.getByRole('radio', { name: /^5등급 호텔/ }))
    await screen.findByText('최종 가격 3,400,000원')

    replyOnce(QUOTE, failWith(400, SEAT_SHORTAGE))
    replyOnce(TOURS, jsonResponse(200, [{ ...golfTours[0], remainingSeats: 5 }, ...golfTours.slice(1)]))
    await priceWith(user, /^그랜드/, '9')

    expect(await screen.findByText(SEAT_SHORTAGE)).toBeInTheDocument()
    expect((await screen.findAllByText('남은 자리 5명')).length).toBeGreaterThan(0)
    expect(screen.queryByText('가격 요약')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '옵션 고르기 끝' })).not.toBeInTheDocument()
    expect(countOf(TOURS)).toBe(2)

    await priceWith(user, /^그랜드/, '3')
    await screen.findByText('가격 요약')
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 1, level: 'GRAND', headcount: 3, optionIds: [13] })
  })

  it('400 뒤 다시 불러온 목록에서 그 상품이 마감이면 상품 목록으로 돌아간다', async () => {
    const user = renderPage()
    await openTour(user)

    replyOnce(QUOTE, failWith(400, SEAT_SHORTAGE))
    replyOnce(TOURS, jsonResponse(200, [{ ...golfTours[0], remainingSeats: 0, status: 'FULL' }, ...golfTours.slice(1)]))
    await priceWith(user, /^그랜드/, '2')

    expect(await screen.findByText(CANNOT_APPLY)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /12\/20 출발 5일/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '다른 상품 고르기' })).not.toBeInTheDocument()
  })

  it('400 뒤 다시 불러온 목록에 그 상품이 없으면 상품 목록으로 돌아간다', async () => {
    const user = renderPage()
    await openTour(user)

    replyOnce(QUOTE, failWith(400, NEGATIVE_PRICE))
    replyOnce(TOURS, jsonResponse(200, golfTours.slice(1)))
    await priceWith(user, /^그랜드/, '2')

    expect(await screen.findByText(CANNOT_APPLY)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /12\/20 출발 5일/ })).not.toBeInTheDocument()
  })

  it('409면 문구를 보여 주고 그 테마의 상품 목록을 다시 불러온다', async () => {
    const user = renderPage()
    await openTour(user)

    replyOnce(QUOTE, failWith(409, CLOSED))
    replyOnce(TOURS, jsonResponse(200, [{ ...golfTours[0], remainingSeats: 0, status: 'FULL' }, ...golfTours.slice(1)]))
    await priceWith(user, /^그랜드/, '2')

    expect(await screen.findByText(CLOSED)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /12\/20 출발 5일/ })).toBeDisabled())
    expect(countOf(TOURS)).toBe(2)
  })
})

describe('옵션을 바꿀 때의 가격 계산', () => {
  async function pricedWithOptionsOpen(user: UserEvent) {
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    await openOptions(user)
  }

  it('400 "남은 자리보다 인원이 많습니다."면 옵션 패널을 닫고, 방금 고른 옵션까지 남긴 채 투어 등급과 인원을 다시 받는다', async () => {
    const user = renderPage()
    await pricedWithOptionsOpen(user)

    replyOnce(QUOTE, failWith(400, SEAT_SHORTAGE))
    replyOnce(TOURS, jsonResponse(200, [{ ...golfTours[0], remainingSeats: 1 }, ...golfTours.slice(1)]))
    await user.click(screen.getByRole('radio', { name: /^5등급 호텔/ }))

    expect(await screen.findByText(SEAT_SHORTAGE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '옵션 고르기 끝' })).not.toBeInTheDocument()
    expect(screen.queryByText('가격 요약')).not.toBeInTheDocument()
    expect((await screen.findAllByText('남은 자리 1명')).length).toBeGreaterThan(0)

    await priceWith(user, /^프리미엄/, '1')
    await screen.findByText('가격 요약')
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 1, level: 'PREMIUM', headcount: 1, optionIds: [13] })

    // 다시 열면 새 투어 등급으로 옵션 목록을 다시 불러온다
    await openOptions(user)
    expect(countOf('GET /api/v1/tours/1/options?level=PREMIUM')).toBe(1)
    expect(screen.getByText('프리미엄 등급은 샴페인이 기본으로 포함됩니다.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^5등급 호텔추가 요금 없음/ })).toBeChecked()
  })

  it('남겨 둔 옵션으로 다시 받은 등급·인원의 가격 계산이 400이면 그 문구로 다시 받고, 옵션은 바꾼 등급·인원으로 계산한다', async () => {
    const user = renderPage()
    await pricedWithOptionsOpen(user)
    replyOnce(QUOTE, failWith(400, SEAT_SHORTAGE))
    await user.click(screen.getByRole('radio', { name: /^3등급 호텔/ }))
    await screen.findByText(SEAT_SHORTAGE)

    replyOnce(QUOTE, failWith(400, NEGATIVE_PRICE))
    await priceWith(user, /^그랜드/, '1')
    expect(await screen.findByText(NEGATIVE_PRICE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '옵션 고르기 끝' })).not.toBeInTheDocument()
    expect(countOf(TOURS)).toBe(3)

    await openOptions(user)
    await user.click(screen.getByRole('radio', { name: '기본 제공(4등급 호텔)' }))
    await screen.findByText('가격 요약')
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 1, level: 'GRAND', headcount: 1, optionIds: [] })
  })

  it('다시 받는 중에 그 밖의 400을 받아도 남겨 둔 옵션은 지우지 않는다', async () => {
    const user = renderPage()
    await pricedWithOptionsOpen(user)
    await user.click(screen.getByRole('radio', { name: /^5등급 호텔/ }))
    await screen.findByText('최종 가격 3,400,000원')
    replyOnce(QUOTE, failWith(400, SEAT_SHORTAGE))
    await user.click(screen.getByRole('checkbox', { name: /^커피/ }))
    await screen.findByText(SEAT_SHORTAGE)

    await openOptions(user)
    replyOnce(QUOTE, failWith(400, NEGATIVE_PRICE))
    await user.click(screen.getByRole('radio', { name: /^도시락/ }))
    expect(await screen.findByText(NEGATIVE_PRICE)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^커피/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /^5등급 호텔/ })).toBeChecked()

    await priceWith(user, /^그랜드/, '1')
    await screen.findByText('가격 요약')
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 1, level: 'GRAND', headcount: 1, optionIds: [13, 42] })
  })

  it('그 밖의 400이면 옵션 패널에 문구를 보여 주고 마지막으로 가격이 나온 옵션으로 되돌린다', async () => {
    const user = renderPage()
    await pricedWithOptionsOpen(user)

    replyOnce(QUOTE, failWith(400, NEGATIVE_PRICE))
    await user.click(screen.getByRole('radio', { name: /^3등급 호텔/ }))

    expect(await screen.findByText(NEGATIVE_PRICE)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '기본 제공(4등급 호텔)' })).toBeChecked()
    expect(screen.getByRole('radio', { name: /^3등급 호텔/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '옵션 고르기 끝' })).toBeInTheDocument()
    expect(countOf(TOURS)).toBe(1)

    await user.click(screen.getByRole('button', { name: '신청하기' }))
    await screen.findByText(/신청했습니다/)
    expect(bodiesOf(APPLY)).toEqual([{ tourId: 1, level: 'GRAND', headcount: 2, optionIds: [] }])
  })

  it('가격을 다시 계산하는 동안은 옵션 패널을 닫지 못한다(그 결과의 문구를 놓치지 않게)', async () => {
    const user = renderPage()
    await pricedWithOptionsOpen(user)
    let finish: (response: Response) => void = () => {}
    replyOnce(QUOTE, () => new Promise<Response>((resolve) => (finish = resolve)))
    await user.click(screen.getByRole('radio', { name: /^3등급 호텔/ }))

    expect(screen.getByRole('button', { name: '옵션 고르기 끝' })).toBeDisabled()
    expect(screen.getByText('가격을 다시 계산하는 중입니다.')).toBeInTheDocument()
    finish(failWith(400, NEGATIVE_PRICE))
    expect(await screen.findByText(NEGATIVE_PRICE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '옵션 고르기 끝' })).toBeEnabled()
  })

  it('409면 문구를 보여 주고 그 테마의 상품 목록을 다시 불러온다', async () => {
    const user = renderPage()
    await pricedWithOptionsOpen(user)

    replyOnce(QUOTE, failWith(409, CLOSED))
    await user.click(screen.getByRole('checkbox', { name: /^커피/ }))

    expect(await screen.findByText(CLOSED)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /12\/20 출발 5일/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '옵션 고르기 끝' })).not.toBeInTheDocument()
    expect(countOf(TOURS)).toBe(2)
  })
})

describe('신청', () => {
  async function priced(user: UserEvent) {
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    await screen.findByText('가격 요약')
  }

  it('400이면 문구를 보여 주고 줄어든 남은 자리와 함께 투어 등급과 인원을 다시 받는다', async () => {
    const user = renderPage()
    await priced(user)

    replyOnce(APPLY, failWith(400, SEAT_SHORTAGE))
    replyOnce(TOURS, jsonResponse(200, [{ ...golfTours[0], remainingSeats: 1 }, ...golfTours.slice(1)]))
    await user.click(screen.getByRole('button', { name: '신청하기' }))

    expect(await screen.findByText(SEAT_SHORTAGE)).toBeInTheDocument()
    expect((await screen.findAllByText('남은 자리 1명')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '신청하기' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('인원')).toBeEnabled()
    await waitUntilLeaveAllowed()
  })

  it('409면 문구를 보여 주고 그 테마의 상품 목록을 다시 불러온다', async () => {
    const user = renderPage()
    await priced(user)

    replyOnce(APPLY, failWith(409, '출발일이 오늘이거나 지난 상품은 신청할 수 없습니다.'))
    await user.click(screen.getByRole('button', { name: '신청하기' }))

    expect(await screen.findByText('출발일이 오늘이거나 지난 상품은 신청할 수 없습니다.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /12\/20 출발 5일/ })).toBeInTheDocument()
    expect(countOf(TOURS)).toBe(2)
    await waitUntilLeaveAllowed()
  })

  it('404면(상품이 없어짐) 알리고 상품 목록을 다시 불러온다', async () => {
    const user = renderPage()
    await priced(user)

    replyOnce(APPLY, failWith(404, '여행 상품을 찾을 수 없습니다.'))
    replyOnce(TOURS, jsonResponse(200, golfTours.slice(1)))
    await user.click(screen.getByRole('button', { name: '신청하기' }))

    expect(await screen.findByRole('button', { name: /1\/3 출발 3일/ })).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('여행 상품을 찾을 수 없습니다.')
    expect(screen.queryByRole('button', { name: /12\/20 출발 5일/ })).not.toBeInTheDocument()
    expect(countOf(TOURS)).toBe(2)
    await waitUntilLeaveAllowed()
  })

  it('신청하면 신청 인원을 더한 남은 자리를 다시 불러와 보인다', async () => {
    const user = renderPage()
    await priced(user)

    replyOnce(TOURS, jsonResponse(200, [{ ...golfTours[0], remainingSeats: 8 }, ...golfTours.slice(1)]))
    await user.click(screen.getByRole('button', { name: '신청하기' }))
    expect(await screen.findByText(/신청했습니다/)).toBeInTheDocument()
    expect(await screen.findByText('남은 자리 8명')).toBeInTheDocument()
    expect(idempotencyKeysOf(APPLY)).toEqual([expect.stringMatching(UUID)])
  })

  it('신청하기를 누를 때마다 새 신청 키를 만든다', async () => {
    const user = renderPage()
    await priced(user)
    replyOnce(APPLY, failWith(400, SEAT_SHORTAGE))
    await user.click(screen.getByRole('button', { name: '신청하기' }))
    await screen.findByText(SEAT_SHORTAGE)

    await priceWith(user, /^그랜드/, '1')
    await user.click(await screen.findByRole('button', { name: '신청하기' }))
    expect(await screen.findByText(/신청했습니다/)).toBeInTheDocument()

    const [first, second] = idempotencyKeysOf(APPLY)
    expect(first).toMatch(UUID)
    expect(second).toMatch(UUID)
    expect(second).not.toBe(first)
  })

  it('crypto.randomUUID가 없는 곳(https·localhost가 아닌 주소)에서도 UUID 모양의 신청 키를 만든다', async () => {
    const { getRandomValues } = crypto
    vi.stubGlobal('crypto', { getRandomValues: getRandomValues.bind(crypto) })
    const user = renderPage()
    await priced(user)
    replyOnce(APPLY, failWith(400, SEAT_SHORTAGE))
    await user.click(screen.getByRole('button', { name: '신청하기' }))
    await screen.findByText(SEAT_SHORTAGE)
    await priceWith(user, /^그랜드/, '1')
    await user.click(await screen.findByRole('button', { name: '신청하기' }))
    expect(await screen.findByText(/신청했습니다/)).toBeInTheDocument()

    const [first, second] = idempotencyKeysOf(APPLY)
    expect(first).toMatch(UUID)
    expect(second).toMatch(UUID)
    expect(second).not.toBe(first)
  })

  it('요청이 끝날 때까지 단추를 막아 두 번 눌러도 한 번만 신청한다', async () => {
    let finish: (response: Response) => void = () => {}
    replyOnce(APPLY, () => new Promise<Response>((resolve) => (finish = resolve)))
    const user = renderPage()
    await priced(user)

    const button = screen.getByRole('button', { name: '신청하기' })
    await user.click(button)
    await user.click(button)
    expect(screen.getByRole('button', { name: '신청하는 중' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '다른 상품 고르기' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: '고객 메뉴' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '고객 메뉴' })).toBeDisabled()
    expect(countOf(APPLY)).toBe(1)

    finish(jsonResponse(201, { bookingId: 7, status: 'RECRUITING' }))
    expect(await screen.findByText('신청했습니다. 지금 상품 상태는 ‘모집 중’입니다.')).toBeInTheDocument()
    expect(countOf(APPLY)).toBe(1)
    expect(screen.getByRole('link', { name: '고객 메뉴' })).toBeInTheDocument()
  })

  it('신청하는 동안은 뒤로 가기 같은 화면 이동과 탭 닫기를 막고, 응답을 받으면 풀어 준다', async () => {
    let finish: (response: Response) => void = () => {}
    replyOnce(APPLY, () => new Promise<Response>((resolve) => (finish = resolve)))
    const { user, router } = renderWithRouter()
    await priced(user)
    await user.click(screen.getByRole('button', { name: '신청하기' }))

    const info = vi.spyOn(toast, 'info').mockImplementation(() => 'toast')
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/tours')
    expect(info).toHaveBeenCalledWith('신청이 끝날 때까지 이 화면에 있어 주세요.', expect.anything())
    expect(leaveBlocked()).toBe(true)

    finish(jsonResponse(201, { bookingId: 7, status: 'RECRUITING' }))
    expect(await screen.findByText(/신청했습니다/)).toBeInTheDocument()
    await waitUntilLeaveAllowed()
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('신청 결과를 모를 때', () => {
  const unknownResults: [string, () => Response | Promise<Response>, string][] = [
    ['500', () => failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'), UNKNOWN_RESULT_MESSAGE],
    ['본문이 빈 성공 응답', () => new Response('', { status: 201 }), UNKNOWN_RESULT_MESSAGE],
    ['504', () => new Response('', { status: 504 }), GATEWAY_TIMEOUT_MESSAGE],
    ['연결 끊김', () => Promise.reject(new TypeError('Failed to fetch')), UNKNOWN_RESULT_MESSAGE],
  ]

  // 그랜드 2명·5등급 호텔로 가격을 받아 신청하고, 그 신청의 결과를 모르게 한다
  async function applyUnknown(user: UserEvent) {
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    await openOptions(user)
    await user.click(screen.getByRole('radio', { name: /^5등급 호텔/ }))
    await screen.findByText('최종 가격 3,400,000원')
    replyOnce(APPLY, failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    await user.click(screen.getByRole('button', { name: '신청하기' }))
    await screen.findByRole('button', { name: '결과 확인' })
  }

  it.each(unknownResults)(
    '%s면 상품 화면에 머물러 문구와 결과 확인을 보이고, 결과를 알 때까지 고른 내용을 바꾸지 못하게 막는다',
    async (_, response, message) => {
      const user = renderPage()
      await openTour(user)
      await priceWith(user, /^그랜드/, '2')
      await screen.findByText('가격 요약')

      replyOnce(APPLY, response)
      replyOnce(TOURS, jsonResponse(200, [{ ...golfTours[0], remainingSeats: 8 }, ...golfTours.slice(1)]))
      await user.click(screen.getByRole('button', { name: '신청하기' }))

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '결과 확인' })).toBeEnabled()
      expect(screen.queryByRole('button', { name: '신청하기' })).not.toBeInTheDocument()
      expect(screen.getByText('가격 요약')).toBeInTheDocument()
      for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
      expect(screen.getByLabelText('인원')).toBeDisabled()
      expect(screen.getByRole('button', { name: '옵션 바꾸기' })).toBeDisabled()
      expect(screen.getByRole('button', { name: '다른 상품 고르기' })).toBeEnabled()
      // 신청이 됐으면 줄었을 남은 자리를 다시 불러와 보인다
      expect(await screen.findByText('남은 자리 8명')).toBeInTheDocument()
      expect(countOf(TOURS)).toBe(2)
      expect(countOf(APPLY)).toBe(1)
      await waitUntilLeaveAllowed()
    },
  )

  it('남은 자리를 다시 불러오지 못해도 따로 알리지 않는다(결과를 모른다는 문구 하나만 둔다)', async () => {
    const user = renderPage()
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    await screen.findByText('가격 요약')

    replyOnce(APPLY, () => Promise.reject(new TypeError('Failed to fetch')))
    replyOnce(TOURS, () => Promise.reject(new TypeError('Failed to fetch')))
    await user.click(screen.getByRole('button', { name: '신청하기' }))

    expect(await screen.findByText(UNKNOWN_RESULT_MESSAGE)).toBeInTheDocument()
    await waitFor(() => expect(countOf(TOURS)).toBe(2))
    await sleep(0)
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByText('남은 자리 10명')).toBeInTheDocument()
  })

  it('옵션 패널을 연 채 신청했으면 패널을 닫는다', async () => {
    const user = renderPage()
    await applyUnknown(user)
    expect(screen.queryByRole('button', { name: '옵션 고르기 끝' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '옵션 바꾸기' })).toBeDisabled()
  })

  it('결과 확인은 같은 신청 키로 같은 내용을 다시 보내고, 받은 상품 상태를 그대로 보인다', async () => {
    const user = renderPage()
    await applyUnknown(user)

    replyOnce(APPLY, jsonResponse(201, { bookingId: 7, status: 'CANCELLED' }))
    replyOnce(TOURS, jsonResponse(200, [{ ...golfTours[0], remainingSeats: 8 }, ...golfTours.slice(1)]))
    await user.click(screen.getByRole('button', { name: '결과 확인' }))

    expect(await screen.findByText('신청했습니다. 지금 상품 상태는 ‘취소’입니다.')).toBeInTheDocument()
    expect(await screen.findByText('남은 자리 8명')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '결과 확인' })).not.toBeInTheDocument()
    expect(screen.queryByText(UNKNOWN_RESULT_MESSAGE)).not.toBeInTheDocument()
    const sent = { tourId: 1, level: 'GRAND', headcount: 2, optionIds: [13] }
    expect(bodiesOf(APPLY)).toEqual([sent, sent])
    const [first, second] = idempotencyKeysOf(APPLY)
    expect(first).toMatch(UUID)
    expect(second).toBe(first)
  })

  it('결과를 확인하는 동안은 단추를 막고 화면 이동과 탭 닫기도 막는다', async () => {
    let finish: (response: Response) => void = () => {}
    const { user, router } = renderWithRouter()
    await applyUnknown(user)

    replyOnce(APPLY, () => new Promise<Response>((resolve) => (finish = resolve)))
    await user.click(screen.getByRole('button', { name: '결과 확인' }))
    expect(screen.getByRole('button', { name: '결과를 확인하는 중' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '다른 상품 고르기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '골프 챌린지 투어' })).toBeDisabled()
    vi.spyOn(toast, 'info').mockImplementation(() => 'toast')
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe('/tours')
    expect(leaveBlocked()).toBe(true)

    finish(jsonResponse(201, { bookingId: 7, status: 'RECRUITING' }))
    expect(await screen.findByText(/신청했습니다/)).toBeInTheDocument()
    await waitUntilLeaveAllowed()
    expect(countOf(APPLY)).toBe(2)
  })

  it('결과 확인도 결과를 모르면 같은 안내와 단추를 다시 보이고, 다음 결과 확인도 같은 신청 키를 쓴다', async () => {
    const user = renderPage()
    await applyUnknown(user)

    replyOnce(APPLY, new Response('', { status: 504 }))
    await user.click(screen.getByRole('button', { name: '결과 확인' }))
    expect(await screen.findByText(GATEWAY_TIMEOUT_MESSAGE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '결과 확인' })).toBeEnabled()
    expect(screen.getByLabelText('인원')).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '결과 확인' }))
    expect(await screen.findByText(/신청했습니다/)).toBeInTheDocument()
    const keys = idempotencyKeysOf(APPLY)
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(1)
  })

  it('결과 확인이 400이면 문구를 보여 주고 투어 등급과 인원을 다시 받으며, 다시 신청하면 새 신청 키를 쓴다', async () => {
    const user = renderPage()
    await applyUnknown(user)

    replyOnce(APPLY, failWith(400, SEAT_SHORTAGE))
    replyOnce(TOURS, jsonResponse(200, [{ ...golfTours[0], remainingSeats: 1 }, ...golfTours.slice(1)]))
    await user.click(screen.getByRole('button', { name: '결과 확인' }))

    expect(await screen.findByText(SEAT_SHORTAGE)).toBeInTheDocument()
    expect((await screen.findAllByText('남은 자리 1명')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '결과 확인' })).not.toBeInTheDocument()
    expect(screen.queryByText(UNKNOWN_RESULT_MESSAGE)).not.toBeInTheDocument()
    expect(screen.getByLabelText('인원')).toBeEnabled()

    await priceWith(user, /^그랜드/, '1')
    await user.click(await screen.findByRole('button', { name: '신청하기' }))
    expect(await screen.findByText(/신청했습니다/)).toBeInTheDocument()
    const [first, check, again] = idempotencyKeysOf(APPLY)
    expect(check).toBe(first)
    expect(again).toMatch(UUID)
    expect(again).not.toBe(first)
  })

  it('결과 확인이 409면 문구를 보여 주고 그 테마의 상품 목록을 다시 불러온다', async () => {
    const user = renderPage()
    await applyUnknown(user)

    replyOnce(APPLY, failWith(409, CLOSED))
    await user.click(screen.getByRole('button', { name: '결과 확인' }))

    expect(await screen.findByText(CLOSED)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /12\/20 출발 5일/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '결과 확인' })).not.toBeInTheDocument()
    expect(countOf(TOURS)).toBe(3)
  })

  it('결과 확인이 404면(상품이 없어져 신청이 되지 않음) 알리고 상품 목록을 다시 불러온다', async () => {
    const user = renderPage()
    await applyUnknown(user)

    replyOnce(APPLY, failWith(404, '여행 상품을 찾을 수 없습니다.'))
    replyOnce(TOURS, jsonResponse(200, golfTours.slice(1)))
    await user.click(screen.getByRole('button', { name: '결과 확인' }))

    expect(await screen.findByRole('button', { name: /1\/3 출발 3일/ })).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('여행 상품을 찾을 수 없습니다.')
    expect(screen.queryByRole('button', { name: /12\/20 출발 5일/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '결과 확인' })).not.toBeInTheDocument()
    expect(countOf(TOURS)).toBe(3)
  })

  it('결과 확인이 나가지 못했으면(오프라인) 알리고, 들고 있던 신청 키로 다시 확인할 수 있다', async () => {
    const user = renderPage()
    await applyUnknown(user)

    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    replyOnce(APPLY, () => Promise.reject(new TypeError('Failed to fetch')))
    await user.click(screen.getByRole('button', { name: '결과 확인' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(CONNECTION_FAILED_MESSAGE))
    expect(await screen.findByRole('button', { name: '결과 확인' })).toBeEnabled()
    expect(screen.getByText(UNKNOWN_RESULT_MESSAGE)).toBeInTheDocument()
    expect(screen.getByLabelText('인원')).toBeDisabled()

    online.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: '결과 확인' }))
    expect(await screen.findByText(/신청했습니다/)).toBeInTheDocument()
    const keys = idempotencyKeysOf(APPLY)
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(1)
  })

  it('다른 상품 고르기를 누르면 들고 있던 신청 키를 버리고, 다시 신청하면 새 신청 키를 쓴다', async () => {
    const user = renderPage()
    await applyUnknown(user)

    await user.click(screen.getByRole('button', { name: '다른 상품 고르기' }))
    await user.click(await screen.findByRole('button', { name: /12\/20 출발 5일/ }))
    await screen.findByRole('radio', { name: /^그랜드/ })
    expect(screen.getByLabelText('인원')).toBeEnabled()
    expect(screen.queryByRole('button', { name: '결과 확인' })).not.toBeInTheDocument()

    await priceWith(user, /^그랜드/, '2')
    await user.click(await screen.findByRole('button', { name: '신청하기' }))
    expect(await screen.findByText(/신청했습니다/)).toBeInTheDocument()
    const [first, second] = idempotencyKeysOf(APPLY)
    expect(second).toMatch(UUID)
    expect(second).not.toBe(first)
    expect(bodiesOf(APPLY).at(-1)).toEqual({ tourId: 1, level: 'GRAND', headcount: 2, optionIds: [] })
  })
})

describe('applySelection(음성으로 채운 내용)', () => {
  const selection: VoiceSelection = { theme: 'GOLF', tourId: 1, level: 'GRAND', headcount: 2 }

  // VoiceInputPanel(#7) 대신 applySelection을 부르고 결과를 보여 준다
  function FakeVoiceInput({ applySelection, disabled }: VoiceInputProps) {
    const [result, setResult] = useState('')
    async function apply(next: VoiceSelection) {
      const outcome = await applySelection(next)
      setResult(outcome.status === 'rejected' ? `rejected: ${outcome.error.message}` : outcome.status)
    }
    return (
      <div>
        <button onClick={() => void apply(selection)}>음성 결과 쓰기</button>
        <button onClick={() => void apply({ ...selection, tourId: 3 })}>음성 결과 쓰기(다른 상품)</button>
        <button onClick={() => void apply({ ...selection, level: 'CLASSIC' })}>음성 결과 쓰기(클래식)</button>
        <button onClick={() => void apply({ ...selection, headcount: 0 })}>음성 결과 쓰기(0명)</button>
        <output aria-label="음성 결과">{result}</output>
        <output aria-label="음성 입력 막힘">{String(disabled)}</output>
      </div>
    )
  }

  it('받은 테마·상품으로 목록과 투어 등급을 불러 칸을 채운 뒤 가격을 계산한다', async () => {
    const user = renderPage(FakeVoiceInput)
    await user.click(screen.getByRole('button', { name: '음성 결과 쓰기' }))

    expect(await screen.findByRole('status', { name: '음성 결과' })).toHaveTextContent('priced')
    expect(screen.getByRole('button', { name: '골프 챌린지 투어' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('radio', { name: /^그랜드/ })).toBeChecked()
    expect(screen.getByLabelText('인원')).toHaveValue(2)
    expect(screen.getByText('가격 요약')).toBeInTheDocument()
    expect(bodiesOf(QUOTE)).toEqual([{ tourId: 1, level: 'GRAND', headcount: 2, optionIds: [] }])
  })

  it.each([
    [400, '골프 챌린지 투어는 2명만 신청할 수 있습니다.'],
    [409, CLOSED],
  ])('직후의 가격 계산이 %i면 부른 쪽에 넘기고, 상품 목록으로 돌아가지 않는다', async (status, message) => {
    const user = renderPage(FakeVoiceInput)
    replyOnce(QUOTE, failWith(status, message))
    await user.click(screen.getByRole('button', { name: '음성 결과 쓰기' }))

    expect(await screen.findByRole('status', { name: '음성 결과' })).toHaveTextContent(`rejected: ${message}`)
    expect(screen.queryByText(message)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다른 상품 고르기' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^그랜드/ })).toBeChecked()
    expect(countOf(TOURS)).toBe(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('다른 상품을 받으면 고른 옵션과 지난 가격을 비운다', async () => {
    const user = renderPage(FakeVoiceInput)
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    await openOptions(user)
    await user.click(screen.getByRole('radio', { name: /^5등급 호텔/ }))
    await screen.findByText('최종 가격 3,400,000원')

    await user.click(screen.getByRole('button', { name: '음성 결과 쓰기(다른 상품)' }))
    expect(await screen.findByRole('status', { name: '음성 결과' })).toHaveTextContent('priced')
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 3, level: 'GRAND', headcount: 2, optionIds: [] })
    expect(screen.queryByRole('button', { name: '옵션 고르기 끝' })).not.toBeInTheDocument()
  })

  it('가격이 나온 뒤 옵션을 바꾸다 받은 409는 상품 목록으로 돌아간다', async () => {
    const user = renderPage(FakeVoiceInput)
    await user.click(screen.getByRole('button', { name: '음성 결과 쓰기' }))
    await screen.findByText('가격 요약')

    await openOptions(user)
    replyOnce(QUOTE, failWith(409, CLOSED))
    await user.click(screen.getByRole('radio', { name: /^5등급 호텔/ }))

    expect(await screen.findByText(CLOSED)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /12\/20 출발 5일/ })).toBeInTheDocument()
  })

  it('상품이 없어졌으면(투어 등급 404) 상품 목록을 다시 불러온다', async () => {
    replyOnce('GET /api/v1/tours/1/levels', failWith(404, '여행 상품을 찾을 수 없습니다.'))
    replyOnce(TOURS, jsonResponse(200, golfTours), jsonResponse(200, golfTours.slice(1)))
    const user = renderPage(FakeVoiceInput)
    await user.click(screen.getByRole('button', { name: '음성 결과 쓰기' }))

    expect(await screen.findByRole('status', { name: '음성 결과' })).toHaveTextContent('failed')
    expect(await screen.findByRole('button', { name: /1\/3 출발 3일/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /12\/20 출발 5일/ })).not.toBeInTheDocument()
    expect(countOf(TOURS)).toBe(2)
  })

  it('투어 등급을 불러오지 못하면 알리고 상품 목록을 보여 준다', async () => {
    const user = renderPage(FakeVoiceInput)
    replyOnce('GET /api/v1/tours/1/levels', failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    await user.click(screen.getByRole('button', { name: '음성 결과 쓰기' }))

    expect(await screen.findByRole('status', { name: '음성 결과' })).toHaveTextContent('failed')
    expect(toast.error).toHaveBeenCalledWith('서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.')
    expect(await screen.findByRole('button', { name: /12\/20 출발 5일/ })).toBeInTheDocument()
    expect(screen.queryByText('상품 목록을 불러오는 중입니다.')).not.toBeInTheDocument()
  })

  it('직후의 가격 계산이 400·409 밖의 실패면 알리고, 옵션 바꾸기 대신 다시 계산을 둔다', async () => {
    const user = renderPage(FakeVoiceInput)
    replyOnce(QUOTE, failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    await user.click(screen.getByRole('button', { name: '음성 결과 쓰기' }))

    expect(await screen.findByRole('status', { name: '음성 결과' })).toHaveTextContent('failed')
    expect(toast.error).toHaveBeenCalledWith('서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.')
    expect(screen.queryByRole('button', { name: '옵션 바꾸기' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '다시 계산' }))
    expect(await screen.findByText('가격 요약')).toBeInTheDocument()
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 1, level: 'GRAND', headcount: 2, optionIds: [] })
  })

  it('이 상품에 없는 투어 등급을 채웠으면 가격을 계산하지 않고 부른 쪽에 넘기고, 그 뒤에도 등급을 고르라고 한다', async () => {
    replyOnce('GET /api/v1/tours/1/levels', jsonResponse(200, { ...levels, levels: levels.levels.slice(1) }))
    const user = renderPage(FakeVoiceInput)
    await user.click(screen.getByRole('button', { name: '음성 결과 쓰기(클래식)' }))
    expect(await screen.findByRole('status', { name: '음성 결과' })).toHaveTextContent(
      'rejected: 투어 등급을 골라 주세요.',
    )
    expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('인원'), '{Enter}')
    expect(screen.getByText('투어 등급을 골라 주세요.')).toBeInTheDocument()
    expect(countOf(QUOTE)).toBe(0)
    expect(screen.queryByRole('button', { name: '옵션 바꾸기' })).not.toBeInTheDocument()
  })

  it('정수가 아닌 인원을 채웠으면 가격을 계산하지 않고 부른 쪽에 넘긴다', async () => {
    const user = renderPage(FakeVoiceInput)
    await user.click(screen.getByRole('button', { name: '음성 결과 쓰기(0명)' }))
    expect(await screen.findByRole('status', { name: '음성 결과' })).toHaveTextContent(
      'rejected: 인원은 1 이상의 정수로 입력해 주세요.',
    )
    expect(countOf(QUOTE)).toBe(0)
  })

  it('같은 테마면 받아 둔 상품 목록을 그대로 쓴다', async () => {
    const user = renderPage(FakeVoiceInput)
    await user.click(screen.getByRole('button', { name: '골프 챌린지 투어' }))
    await screen.findByRole('button', { name: /12\/20 출발 5일/ })

    await user.click(screen.getByRole('button', { name: '음성 결과 쓰기' }))
    expect(await screen.findByRole('status', { name: '음성 결과' })).toHaveTextContent('priced')
    expect(screen.getByText('남은 자리 10명')).toBeInTheDocument()
    expect(countOf(TOURS)).toBe(1)
  })

  it('신청을 처리하는 중이면 알리고 아무것도 바꾸지 않는다', async () => {
    let finish: (response: Response) => void = () => {}
    replyOnce(APPLY, () => new Promise<Response>((resolve) => (finish = resolve)))
    const user = renderPage(FakeVoiceInput)
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    await user.click(await screen.findByRole('button', { name: '신청하기' }))

    await user.click(screen.getByRole('button', { name: '음성 결과 쓰기(다른 상품)' }))
    expect(await screen.findByRole('status', { name: '음성 결과' })).toHaveTextContent('failed')
    expect(toast.error).toHaveBeenCalledWith('신청을 처리하는 중입니다. 신청이 끝난 뒤 다시 시도해 주세요.')
    expect(countOf('GET /api/v1/tours/3/levels')).toBe(0)

    finish(jsonResponse(201, { bookingId: 7, status: 'CONFIRMED' }))
    expect(await screen.findByText(/신청했습니다/)).toBeInTheDocument()
  })

  it('신청 결과를 모르는 동안은 음성 입력을 막고, 채운 내용을 보내도 받지 않는다', async () => {
    const user = renderPage(FakeVoiceInput)
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    expect(screen.getByRole('status', { name: '음성 입력 막힘' })).toHaveTextContent('false')
    replyOnce(APPLY, failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    await user.click(await screen.findByRole('button', { name: '신청하기' }))
    await screen.findByRole('button', { name: '결과 확인' })
    expect(screen.getByRole('status', { name: '음성 입력 막힘' })).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: '음성 결과 쓰기(다른 상품)' }))
    expect(await screen.findByRole('status', { name: '음성 결과' })).toHaveTextContent('failed')
    expect(toast.error).toHaveBeenCalledWith('신청 결과를 확인한 뒤 다시 시도해 주세요.')
    expect(countOf('GET /api/v1/tours/3/levels')).toBe(0)
    expect(screen.getByRole('button', { name: '결과 확인' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '결과 확인' }))
    expect(await screen.findByText(/신청했습니다/)).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '음성 입력 막힘' })).toHaveTextContent('false')
  })

  it('다른 상품 고르기로 신청 키를 버리면 음성 입력을 다시 쓸 수 있다', async () => {
    const user = renderPage(FakeVoiceInput)
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    replyOnce(APPLY, failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    await user.click(await screen.findByRole('button', { name: '신청하기' }))
    await screen.findByRole('button', { name: '결과 확인' })

    await user.click(screen.getByRole('button', { name: '다른 상품 고르기' }))
    expect(screen.getByRole('status', { name: '음성 입력 막힘' })).toHaveTextContent('false')
    await user.click(screen.getByRole('button', { name: '음성 결과 쓰기(다른 상품)' }))
    expect(await screen.findByRole('status', { name: '음성 결과' })).toHaveTextContent('priced')
  })
})

describe('그 밖의 실패', () => {
  it('상품의 투어 등급을 불러오지 못하면 알리고, 받아 둔 상품 목록으로 돌아간다', async () => {
    replyOnce('GET /api/v1/tours/1/levels', failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: '골프 챌린지 투어' }))
    await user.click(await screen.findByRole('button', { name: /12\/20 출발 5일/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    expect(await screen.findByRole('button', { name: /12\/20 출발 5일/ })).toBeInTheDocument()
    expect(countOf(TOURS)).toBe(1)
  })

  it('상품이 없어졌으면(투어 등급 404) 상품 목록을 다시 불러온다', async () => {
    replyOnce('GET /api/v1/tours/1/levels', failWith(404, '여행 상품을 찾을 수 없습니다.'))
    replyOnce(TOURS, jsonResponse(200, golfTours), jsonResponse(200, golfTours.slice(1)))
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: '골프 챌린지 투어' }))
    await user.click(await screen.findByRole('button', { name: /12\/20 출발 5일/ }))

    expect(await screen.findByRole('button', { name: /1\/3 출발 3일/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /12\/20 출발 5일/ })).not.toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('여행 상품을 찾을 수 없습니다.')
    expect(countOf(TOURS)).toBe(2)
  })

  it('옵션 목록을 불러오지 못하면 패널에서 다시 불러올 수 있다', async () => {
    const user = renderPage()
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    await screen.findByText('가격 요약')

    replyOnce('GET /api/v1/tours/1/options?level=GRAND', new Response('', { status: 502 }))
    await user.click(screen.getByRole('button', { name: '옵션 바꾸기' }))
    expect(await screen.findByText('옵션을 불러오지 못했습니다.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(await screen.findByRole('radio', { name: /^5등급 호텔/ })).toBeInTheDocument()
    expect(countOf('GET /api/v1/tours/1/options?level=GRAND')).toBe(2)
  })

  it('상품 목록을 불러오지 못하면 알리고 다시 불러올 수 있다', async () => {
    replyOnce(TOURS, new Response('', { status: 502 }))
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: '골프 챌린지 투어' }))

    expect(await screen.findByText('상품 목록을 불러오지 못했습니다.')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(await screen.findByRole('button', { name: /12\/20 출발 5일/ })).toBeInTheDocument()
  })

  it('투어 등급·인원을 바꾼 가격 계산이 400·409 밖의 실패면, 지난 가격으로 신청하지 못하게 한다', async () => {
    const user = renderPage()
    await openTour(user)
    await priceWith(user, /^그랜드/, '2')
    await screen.findByText('가격 요약')

    replyOnce(QUOTE, failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    await priceWith(user, /^그랜드/, '3')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    expect(screen.getByRole('button', { name: '신청하기' })).toBeDisabled()
    expect(screen.getByText('고친 투어 등급·인원으로 가격을 계산하지 못했습니다.')).toBeInTheDocument()

    // 옵션을 바꾸면 지난 가격의 투어 등급·인원(2명)으로 계산한다
    await openOptions(user)
    await user.click(screen.getByRole('radio', { name: /^5등급 호텔/ }))
    await screen.findByText('최종 가격 3,400,000원')
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 1, level: 'GRAND', headcount: 2, optionIds: [13] })
    expect(screen.getByRole('button', { name: '신청하기' })).toBeDisabled()

    // 다시 계산하면 고친 인원(3명)으로 계산하고 신청할 수 있다
    await user.click(screen.getByRole('button', { name: '다시 계산' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '신청하기' })).toBeEnabled())
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 1, level: 'GRAND', headcount: 3, optionIds: [13] })
  })
})
