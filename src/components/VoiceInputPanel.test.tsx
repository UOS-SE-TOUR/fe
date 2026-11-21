import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceInputPanel } from '@/components/VoiceInputPanel'
import { tourLevelLabel } from '@/lib/labels'
import {
  EMPTY_VOICE_DRAFT,
  type OptionCategory,
  type PriceQuote,
  type QuoteRequest,
  type TourLevelsResponse,
  type TourSummary,
  type VoiceChatRequest,
  type VoiceChatResponse,
  type VoiceDraft,
  type VoiceNext,
} from '@/lib/tours'
import { AuthStore } from '@/modules/AuthStore'
import type { RecognitionFailure, Recognizer } from '@/modules/SpeechRecognizer'
import type { Synthesizer } from '@/modules/SpeechSynthesizer'
import { TourSelectPage, type VoiceInputProps } from '@/pages/TourSelectPage'
import { jsonResponse, stubFetch } from '@/test/http'

const CHAT = 'POST /api/v1/voice/chat'
const GOLF_TOURS = 'GET /api/v1/tours?theme=GOLF'
const QUOTE = 'POST /api/v1/bookings/quote'
const APPLY = 'POST /api/v1/bookings'

const GREETING = '안녕하세요, 김고객 고객님. 어떤 여행을 찾으세요?'
const INTRO = '묻는 말에 답하면 여행을 고르고 신청까지 해 드립니다.'
const LISTENING = '듣고 있습니다. 말씀해 주세요.'
const DISABLED = '신청 결과를 확인하기 전에는 음성으로 고를 수 없습니다.'
const SEAT_SHORTAGE = '남은 자리보다 인원이 많습니다.'
const CLOSED = '마감된 상품입니다.'
const SERVER_ERROR = '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'
const APPLIED = '신청했습니다. 지금 상품 상태는 ‘확정’입니다.'

const golf27: TourSummary = {
  tourId: 4,
  title: '골프 챌린지 투어 12/27 출발 4일',
  departureDate: '2026-12-27',
  duration: 4,
  remainingSeats: 8,
  status: 'RECRUITING',
}

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

const options: Record<number, { name: string; category: OptionCategory; priceDiff: number }> = {
  41: { name: '샴페인', category: 'EXTRA', priceDiff: 40_000 },
  42: { name: '커피', category: 'EXTRA', priceDiff: 5_000 },
}

function quoteFor(request: QuoteRequest): PriceQuote {
  const selected = request.optionIds.map((optionId) => ({ optionId, ...options[optionId] }))
  const perPerson =
    levels.levels.find((item) => item.level === request.level)!.price +
    selected.reduce((sum, item) => sum + item.priceDiff, 0)
  const totalPrice = perPerson * request.headcount
  return {
    summary: {
      tourId: golf27.tourId,
      title: golf27.title,
      departureDate: golf27.departureDate,
      duration: golf27.duration,
      level: request.level,
      levelName: tourLevelLabel(request.level),
      headcount: request.headcount,
      options: selected,
    },
    totalPrice,
    discount: 0,
    finalPrice: totalPrice,
  }
}

// 12/27 골프 그랜드 2명
function golfDraft(patch: Partial<VoiceDraft> = {}): VoiceDraft {
  return { theme: 'GOLF', tourId: 4, level: 'GRAND', headcount: 2, optionIds: [], ...patch }
}

function chat(reply: string, draft: Partial<VoiceDraft> = {}, next: VoiceNext = 'TALK'): VoiceChatResponse {
  return { reply, draft: { ...EMPTY_VOICE_DRAFT, ...draft }, next }
}

// 듣기·읽기·서버 요청이 일어난 차례
let events: string[]

// 브라우저 음성인식 대신 쓴다. 테스트가 말한 글자나 실패를 직접 돌려준다
class FakeRecognizer implements Recognizer {
  supported = true
  started = 0
  aborted = 0
  onresult: (text: string) => void = () => {}
  onerror: (reason: RecognitionFailure) => void = () => {}

  isSupported() {
    return this.supported
  }

  recognize() {
    this.started += 1
    events.push('listen')
  }

  abort() {
    this.aborted += 1
  }

  say(text: string) {
    act(() => this.onresult(text))
  }

  fail(reason: RecognitionFailure) {
    act(() => this.onerror(reason))
  }
}

// 브라우저 읽어 주기 대신 쓴다. hold면 finishSpeaking을 부를 때까지 읽기가 끝나지 않는다
class FakeSynthesizer implements Synthesizer {
  spoken: string[] = []
  cancelled = 0
  hold = false
  private finish: (() => void) | null = null

  isSupported() {
    return true
  }

  speak(text: string) {
    this.spoken.push(text)
    events.push(`speak: ${text}`)
    if (!this.hold) return Promise.resolve()
    return new Promise<void>((resolve) => (this.finish = resolve))
  }

  cancel() {
    this.cancelled += 1
    const finish = this.finish
    this.finish = null
    finish?.()
  }
}

type Reply = Response | ((body: unknown) => Response | Promise<Response>)

let fetchMock: ReturnType<typeof stubFetch>
let once: Map<string, Reply[]>
let always: Map<string, Reply>
let unexpected: string[]
let recognizer: FakeRecognizer
let synthesizer: FakeSynthesizer

function requestKey(input: RequestInfo | URL, init: RequestInit | undefined): string {
  return `${init?.method ?? 'GET'} ${String(input)}`
}

function replyOnce(key: string, ...replies: Reply[]) {
  once.set(key, [...(once.get(key) ?? []), ...replies])
}

function bodiesOf<T = unknown>(key: string): T[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => requestKey(input, init) === key)
    .map(([, init]) => JSON.parse(String(init?.body)) as T)
}

function countOf(key: string): number {
  return fetchMock.mock.calls.filter(([input, init]) => requestKey(input, init) === key).length
}

function failWith(status: number, message: string): Response {
  return jsonResponse(status, { message })
}

// 응답을 테스트가 정한 때에 보낸다
function deferred(): { reply: Reply; resolve(response: Response): void } {
  let resolve: (response: Response) => void = () => {}
  const promise = new Promise<Response>((done) => (resolve = done))
  return { reply: () => promise, resolve: (response) => resolve(response) }
}

beforeEach(() => {
  events = []
  recognizer = new FakeRecognizer()
  synthesizer = new FakeSynthesizer()
  fetchMock = stubFetch()
  once = new Map()
  unexpected = []
  always = new Map<string, Reply>([
    [GOLF_TOURS, () => jsonResponse(200, [golf27])],
    ['GET /api/v1/tours/4/levels', () => jsonResponse(200, levels)],
    [QUOTE, (body) => jsonResponse(200, quoteFor(body as QuoteRequest))],
    [APPLY, () => jsonResponse(201, { bookingId: 7, status: 'CONFIRMED' })],
  ])
  fetchMock.mockImplementation(async (input, init) => {
    const key = requestKey(input, init)
    if (init?.method === 'POST') events.push(key)
    const reply = once.get(key)?.shift() ?? always.get(key)
    if (!reply) {
      unexpected.push(key)
      return failWith(500, `예상하지 않은 요청: ${key}`)
    }
    if (reply instanceof Response) return reply
    return reply(init?.body ? JSON.parse(String(init.body)) : undefined)
  })
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
  AuthStore.setMember('CUSTOMER', '김고객')
})

afterEach(() => {
  expect(unexpected).toEqual([])
  AuthStore.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function VoiceInput(props: VoiceInputProps) {
  return <VoiceInputPanel {...props} createRecognizer={() => recognizer} createSynthesizer={() => synthesizer} />
}

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/tours', element: <TourSelectPage voiceInput={VoiceInput} /> },
      { path: '/', element: <h1>고객 메뉴</h1> },
    ],
    { initialEntries: ['/tours'] },
  )
  render(<RouterProvider router={router} />)
  return userEvent.setup()
}

function panel() {
  return within(screen.getByRole('region', { name: '음성으로 고르기' }))
}

function startButton() {
  return panel().queryByRole('button', { name: '음성으로 신청하기' })
}

// 패널의 대화 줄을 "말한 쪽: 말"로 읽는다
function lines(): string[] {
  const log = panel().queryByRole('list', { name: '대화' })
  if (!log) return []
  return within(log)
    .getAllByRole('listitem')
    .map((item) => `${item.firstElementChild?.textContent}: ${item.lastElementChild?.textContent}`)
}

function system(text: string) {
  return { speaker: 'SYSTEM', text }
}

function customer(text: string) {
  return { speaker: 'CUSTOMER', text }
}

// 다시 듣기 시작하거나 대화가 끝날 때까지 기다린다
async function settle(listened: number) {
  await waitFor(() => expect(recognizer.started > listened || startButton() !== null).toBe(true))
}

async function start(user: ReturnType<typeof userEvent.setup>) {
  await user.click(startButton()!)
  await settle(0)
}

// 고객이 말하고 서버가 답한다
async function talk(text: string, response: VoiceChatResponse | Response) {
  replyOnce(CHAT, response instanceof Response ? response : jsonResponse(200, response))
  const listened = recognizer.started
  recognizer.say(text)
  await settle(listened)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('대화', () => {
  it('인사를 보이고 읽은 뒤 듣고, 알아들은 말은 대화 전체·고른 내용과 함께 보내며, 답을 읽고 다시 듣는다', async () => {
    const user = renderPage()
    expect(panel().getByText(INTRO)).toBeInTheDocument()

    await start(user)
    expect(lines()).toEqual([`시스템: ${GREETING}`])
    expect(panel().getByText(LISTENING)).toBeInTheDocument()
    expect(panel().getByRole('button', { name: '그만두기' })).toBeInTheDocument()

    await talk('추천해 주세요', chat('무슨 날인지, 누구와 가시는지 알려 주세요.', { theme: 'PARENTS' }))
    await talk('부모님 결혼기념일이에요', chat('효도 투어는 어떠세요?', { theme: 'PARENTS' }))

    expect(bodiesOf<VoiceChatRequest>(CHAT)).toEqual([
      { messages: [system(GREETING), customer('추천해 주세요')], draft: EMPTY_VOICE_DRAFT },
      {
        messages: [
          system(GREETING),
          customer('추천해 주세요'),
          system('무슨 날인지, 누구와 가시는지 알려 주세요.'),
          customer('부모님 결혼기념일이에요'),
        ],
        draft: { ...EMPTY_VOICE_DRAFT, theme: 'PARENTS' },
      },
    ])
    expect(lines()).toEqual([
      `시스템: ${GREETING}`,
      '고객: 추천해 주세요',
      '시스템: 무슨 날인지, 누구와 가시는지 알려 주세요.',
      '고객: 부모님 결혼기념일이에요',
      '시스템: 효도 투어는 어떠세요?',
    ])
    expect(events).toEqual([
      `speak: ${GREETING}`,
      'listen',
      CHAT,
      'speak: 무슨 날인지, 누구와 가시는지 알려 주세요.',
      'listen',
      CHAT,
      'speak: 효도 투어는 어떠세요?',
      'listen',
    ])
  })

  it('로그인한 회원의 이름을 아직 모르면 이름 없이 인사한다', async () => {
    AuthStore.clear()
    const user = renderPage()
    await start(user)
    expect(synthesizer.spoken).toEqual(['안녕하세요, 고객님. 어떤 여행을 찾으세요?'])
  })

  it('상품·투어 등급·인원이 다 정해지면 답을 읽기 전에 옵션까지 넣어 화면의 칸을 채우고 가격을 계산한다', async () => {
    const user = renderPage()
    await start(user)
    await talk(
      '12월 27일 골프 그랜드로 둘이요, 샴페인도',
      chat('정리하면 이렇습니다. 맞으세요?', golfDraft({ optionIds: [41] })),
    )

    expect(bodiesOf(QUOTE)).toEqual([{ tourId: 4, level: 'GRAND', headcount: 2, optionIds: [41] }])
    expect(events.slice(-4)).toEqual([CHAT, QUOTE, 'speak: 정리하면 이렇습니다. 맞으세요?', 'listen'])
    expect(screen.getByText('가격 요약')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '골프 챌린지 투어' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('고른 내용이 그대로면 다시 채우지 않고, 옵션이 바뀌면 다시 채운다', async () => {
    const user = renderPage()
    await start(user)
    await talk('그랜드로 둘이요, 샴페인이랑 커피도', chat('맞으세요?', golfDraft({ optionIds: [41, 42] })))
    await talk('가격은요?', chat('화면의 가격을 봐 주세요.', golfDraft({ optionIds: [42, 41] })))
    expect(countOf(QUOTE)).toBe(1)

    await talk('커피는 빼 주세요', chat('커피를 뺐습니다.', golfDraft({ optionIds: [41] })))
    expect(countOf(QUOTE)).toBe(2)
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 4, level: 'GRAND', headcount: 2, optionIds: [41] })
  })

  it('칸을 채운 가격 계산이 거부되면 답 뒤에 그 문구를 이어 읽고 다시 들으며, 그 문구는 다음 요청의 대화에 들어간다', async () => {
    const user = renderPage()
    await start(user)
    replyOnce(QUOTE, failWith(400, SEAT_SHORTAGE))
    await talk('그랜드로 둘이요', chat('맞으세요?', golfDraft()))
    expect(events.slice(-4)).toEqual([QUOTE, 'speak: 맞으세요?', `speak: ${SEAT_SHORTAGE}`, 'listen'])
    expect(toast.error).not.toHaveBeenCalled()

    await talk('한 명으로 할게요', chat('한 명으로 바꿨습니다.', golfDraft({ headcount: 1 })))
    expect(bodiesOf<VoiceChatRequest>(CHAT)[1].messages.slice(-3)).toEqual([
      system('맞으세요?'),
      system(SEAT_SHORTAGE),
      customer('한 명으로 할게요'),
    ])
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 4, level: 'GRAND', headcount: 1, optionIds: [] })
  })

  it('칸 채우기가 그 밖의 이유로 실패하면 답을 읽지 않고 대화를 끝낸다(화면이 알렸다)', async () => {
    const user = renderPage()
    await start(user)
    replyOnce(QUOTE, failWith(500, SERVER_ERROR))
    await talk('그랜드로 둘이요', chat('맞으세요?', golfDraft()))

    expect(toast.error).toHaveBeenCalledWith(SERVER_ERROR)
    expect(synthesizer.spoken).toEqual([GREETING])
    expect(startButton()).toBeEnabled()
    expect(recognizer.started).toBe(1)
  })
})

describe('신청', () => {
  it('APPLY면 답을 읽은 뒤 대화의 내용으로 화면을 다시 맞춰 신청하고, 결과를 읽고 대화를 끝낸다', async () => {
    const user = renderPage()
    await start(user)
    await talk('그랜드로 둘이요, 샴페인도', chat('맞으세요?', golfDraft({ optionIds: [41] })))

    // 대화하는 동안 화면에서 인원을 고쳐도, 신청 직전에 대화의 내용으로 다시 맞춘다
    const headcount = within(screen.getByRole('region', { name: '고른 상품' })).getByLabelText('인원')
    await user.clear(headcount)
    await user.type(headcount, '5{Enter}')
    await waitFor(() => expect(bodiesOf(QUOTE).at(-1)).toMatchObject({ headcount: 5 }))

    await talk('네, 그대로 신청해 주세요', chat('신청하겠습니다.', golfDraft({ optionIds: [41] }), 'APPLY'))
    expect(events.slice(-5)).toEqual([CHAT, 'speak: 신청하겠습니다.', QUOTE, APPLY, `speak: ${APPLIED}`])
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 4, level: 'GRAND', headcount: 2, optionIds: [41] })
    expect(bodiesOf(APPLY)).toEqual([{ tourId: 4, level: 'GRAND', headcount: 2, optionIds: [41] }])
    expect(lines().at(-1)).toBe(`시스템: ${APPLIED}`)
    expect(within(screen.getByRole('region', { name: '고른 상품' })).getByText(APPLIED)).toBeInTheDocument()
    expect(startButton()).toBeEnabled()
    expect(recognizer.started).toBe(2)
  })

  it('APPLY에서 가격 계산이 거부되면 신청하지 않고 그 문구를 읽은 뒤 대화를 이어 간다', async () => {
    const user = renderPage()
    await start(user)
    replyOnce(QUOTE, failWith(409, CLOSED))
    await talk('그대로 신청해 주세요', chat('신청하겠습니다.', golfDraft(), 'APPLY'))

    expect(countOf(APPLY)).toBe(0)
    expect(events.slice(-4)).toEqual(['speak: 신청하겠습니다.', QUOTE, `speak: ${CLOSED}`, 'listen'])
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    [400, SEAT_SHORTAGE, '고른 상품'],
    [409, CLOSED, '상품 목록'],
  ])('신청이 %i로 거부되면 그 문구를 읽고 대화를 이어 가고, 화면은 %s을 보인다', async (status, message, region) => {
    const user = renderPage()
    await start(user)
    replyOnce(APPLY, failWith(status, message))
    await talk('그대로 신청해 주세요', chat('신청하겠습니다.', golfDraft(), 'APPLY'))

    expect(events.slice(-3)).toEqual([APPLY, `speak: ${message}`, 'listen'])
    expect(lines().at(-1)).toBe(`시스템: ${message}`)
    expect(await screen.findByRole('region', { name: region })).toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('신청 결과를 모르면 대화를 끝내고, 화면이 결과를 확인할 때까지 패널을 막는다', async () => {
    const user = renderPage()
    await start(user)
    replyOnce(APPLY, failWith(500, SERVER_ERROR))
    await talk('그대로 신청해 주세요', chat('신청하겠습니다.', golfDraft(), 'APPLY'))

    expect(await screen.findByRole('button', { name: '결과 확인' })).toBeInTheDocument()
    expect(panel().getByText(DISABLED)).toBeInTheDocument()
    expect(startButton()).toBeDisabled()
    expect(synthesizer.spoken.at(-1)).toBe('신청하겠습니다.')
    expect(recognizer.started).toBe(1)

    replyOnce(APPLY, jsonResponse(201, { bookingId: 7, status: 'CONFIRMED' }))
    await user.click(screen.getByRole('button', { name: '결과 확인' }))
    expect(await within(screen.getByRole('region', { name: '고른 상품' })).findByText(APPLIED)).toBeInTheDocument()
    expect(panel().queryByText(DISABLED)).not.toBeInTheDocument()
    expect(startButton()).toBeEnabled()
  })

  it('신청이 그 밖의 이유로 실패하면 대화를 끝낸다(화면이 알렸다)', async () => {
    const user = renderPage()
    await start(user)
    replyOnce(APPLY, failWith(404, '여행 상품을 찾을 수 없습니다.'))
    await talk('그대로 신청해 주세요', chat('신청하겠습니다.', golfDraft(), 'APPLY'))

    expect(toast.error).toHaveBeenCalledWith('여행 상품을 찾을 수 없습니다.')
    expect(startButton()).toBeEnabled()
    expect(recognizer.started).toBe(1)
  })

  it('신청을 기다리는 동안 그만두어도 보낸 신청은 되돌리지 않고, 그 결과는 읽지 않는다', async () => {
    const user = renderPage()
    await start(user)
    const slow = deferred()
    replyOnce(APPLY, slow.reply)
    replyOnce(CHAT, jsonResponse(200, chat('신청하겠습니다.', golfDraft(), 'APPLY')))
    recognizer.say('그대로 신청해 주세요')
    await waitFor(() => expect(countOf(APPLY)).toBe(1))

    await user.click(panel().getByRole('button', { name: '그만두기' }))
    slow.resolve(jsonResponse(201, { bookingId: 7, status: 'CONFIRMED' }))
    expect(await within(screen.getByRole('region', { name: '고른 상품' })).findByText(APPLIED)).toBeInTheDocument()
    expect(synthesizer.spoken).not.toContain(APPLIED)
    expect(lines()).not.toContain(`시스템: ${APPLIED}`)
  })
})

describe('끝내기와 실패', () => {
  it('STOP이면 답을 읽고 대화를 끝낸다', async () => {
    const user = renderPage()
    await start(user)
    await talk('그만할게요', chat('알겠습니다. 다음에 또 찾아 주세요.', {}, 'STOP'))

    expect(synthesizer.spoken.at(-1)).toBe('알겠습니다. 다음에 또 찾아 주세요.')
    expect(startButton()).toBeEnabled()
    expect(recognizer.started).toBe(1)
    expect(panel().queryByRole('button', { name: '그만두기' })).not.toBeInTheDocument()
  })

  it('서버를 기다리는 동안 그만두면 대화를 끝내고, 그 뒤에 온 답은 버린다', async () => {
    const user = renderPage()
    await start(user)
    const slow = deferred()
    replyOnce(CHAT, slow.reply)
    recognizer.say('추천해 주세요')
    expect(await panel().findByText('답을 기다리는 중입니다.')).toBeInTheDocument()

    await user.click(panel().getByRole('button', { name: '그만두기' }))
    slow.resolve(jsonResponse(200, chat('무슨 날인가요?')))
    await act(() => sleep(0))
    expect(synthesizer.spoken).toEqual([GREETING])
    expect(recognizer.started).toBe(1)
    expect(lines()).toEqual([`시스템: ${GREETING}`, '고객: 추천해 주세요'])
    expect(startButton()).toBeEnabled()
  })

  it('읽는 중에 그만두면 읽기를 멈추고 듣지 않으며, 다시 시작하면 대화를 새로 한다', async () => {
    synthesizer.hold = true
    const user = renderPage()
    await user.click(startButton()!)
    expect(panel().getByText('말하는 중입니다.')).toBeInTheDocument()

    await user.click(panel().getByRole('button', { name: '그만두기' }))
    await act(() => sleep(0))
    expect(synthesizer.cancelled).toBeGreaterThan(0)
    expect(recognizer.started).toBe(0)

    synthesizer.hold = false
    await start(user)
    expect(lines()).toEqual([`시스템: ${GREETING}`])
    await talk('골프요', chat('골프 투어를 고르셨습니다.', { theme: 'GOLF' }))
    expect(bodiesOf<VoiceChatRequest>(CHAT)[0].messages).toEqual([system(GREETING), customer('골프요')])
  })

  it('voice/chat이 503이면 서버 문구 없이 직접 고르라고 안내하고 대화를 끝낸다', async () => {
    const user = renderPage()
    await start(user)
    await talk('골프요', failWith(503, '음성으로 고르기를 지금 쓸 수 없습니다.'))

    expect(panel().getByText('지금은 음성으로 고를 수 없습니다. 아래에서 직접 골라 주세요.')).toBeInTheDocument()
    expect(screen.queryByText('음성으로 고르기를 지금 쓸 수 없습니다.')).not.toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
    expect(startButton()).toBeEnabled()
  })

  it.each(['대화가 너무 길어졌습니다. 아래에서 직접 골라 주세요.', '말이 너무 깁니다. 아래에서 직접 골라 주세요.'])(
    'voice/chat이 400(%s)이면 서버 문구를 보이고 대화를 끝낸다',
    async (message) => {
      const user = renderPage()
      await start(user)
      await talk('골프요', failWith(400, message))

      expect(panel().getByText(message)).toBeInTheDocument()
      expect(toast.error).not.toHaveBeenCalled()
      expect(startButton()).toBeEnabled()
      expect(recognizer.started).toBe(1)
    },
  )

  it('voice/chat의 그 밖의 실패는 공용 알림으로 알리고 대화를 끝낸다', async () => {
    const user = renderPage()
    await start(user)
    await talk('골프요', failWith(500, SERVER_ERROR))

    expect(toast.error).toHaveBeenCalledWith(SERVER_ERROR)
    expect(startButton()).toBeEnabled()
  })

  it.each([
    ['답이 빈 글자', { reply: ' ', draft: EMPTY_VOICE_DRAFT, next: 'TALK' }],
    ['모르는 next', { reply: '네', draft: EMPTY_VOICE_DRAFT, next: 'WAIT' }],
    ['draft 없음', { reply: '네', next: 'TALK' }],
    ['옵션이 목록이 아님', { reply: '네', draft: { ...EMPTY_VOICE_DRAFT, optionIds: null }, next: 'TALK' }],
    ['고르지 않은 칸이 있는 APPLY', { reply: '신청하겠습니다.', draft: golfDraft({ level: null }), next: 'APPLY' }],
  ])('voice/chat 응답 모양이 다르면(%s) 공용 알림으로 알리고 대화를 끝낸다', async (_, body) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = renderPage()
    await start(user)
    await talk('골프요', jsonResponse(200, body))

    expect(toast.error).toHaveBeenCalledWith('문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.')
    expect(startButton()).toBeEnabled()
    expect(countOf(QUOTE)).toBe(0)
    expect(countOf(APPLY)).toBe(0)
  })

  it('마이크 권한이 거부되면 문구를 보이고 대화를 끝낸다', async () => {
    const user = renderPage()
    await start(user)
    recognizer.fail('not-allowed')

    expect(
      panel().getByText('마이크 권한이 없어 음성 입력을 쓸 수 없습니다. 아래에서 직접 골라 주세요.'),
    ).toBeInTheDocument()
    expect(startButton()).toBeEnabled()
    expect(panel().queryByRole('button', { name: '다시 말하기' })).not.toBeInTheDocument()
  })

  it.each([
    ['no-speech', '말소리를 듣지 못했습니다. 다시 말해 주세요.'],
    ['other', '음성을 인식하지 못했습니다. 아래에서 직접 골라 주세요.'],
  ] as const)(
    '인식이 %s로 실패하면 문구와 다시 말하기를 보이고, 다시 말하면 인사 없이 듣고 대화를 이어 간다',
    async (reason, message) => {
      const user = renderPage()
      await start(user)
      await talk('추천해 주세요', chat('무슨 날인가요?'))
      recognizer.fail(reason)
      expect(panel().getByText(message)).toBeInTheDocument()
      expect(panel().getByRole('button', { name: '그만두기' })).toBeInTheDocument()

      await user.click(panel().getByRole('button', { name: '다시 말하기' }))
      expect(panel().queryByText(message)).not.toBeInTheDocument()
      expect(recognizer.started).toBe(3)
      expect(synthesizer.spoken).toEqual([GREETING, '무슨 날인가요?'])

      await talk('결혼기념일이에요', chat('효도 투어는 어떠세요?'))
      expect(bodiesOf<VoiceChatRequest>(CHAT)[1].messages).toEqual([
        system(GREETING),
        customer('추천해 주세요'),
        system('무슨 날인가요?'),
        customer('결혼기념일이에요'),
      ])
    },
  )

  it('화면을 떠나면 듣기와 읽기를 멈춘다', async () => {
    const user = renderPage()
    await start(user)
    const cancelled = synthesizer.cancelled
    await user.click(screen.getByRole('link', { name: '고객 메뉴' }))

    expect(await screen.findByRole('heading', { name: '고객 메뉴' })).toBeInTheDocument()
    expect(recognizer.aborted).toBeGreaterThan(0)
    expect(synthesizer.cancelled).toBeGreaterThan(cancelled)
  })

  it('크롬이 아니거나 음성인식 기능이 없으면 시작 단추 없이 직접 고르라고 안내한다', () => {
    recognizer.supported = false
    renderPage()

    expect(
      panel().getByText('이 브라우저에서는 음성 입력을 쓸 수 없습니다. 크롬에서 열거나, 아래에서 직접 골라 주세요.'),
    ).toBeInTheDocument()
    expect(startButton()).not.toBeInTheDocument()
  })
})

describe('신청 결과를 모를 때', () => {
  it('듣는 중에 화면의 신청 결과를 모르게 되면 대화를 끝내고, 그 뒤에 들은 말은 보내지 않는다', async () => {
    const user = renderPage()
    await start(user)
    await talk('그랜드로 둘이요', chat('맞으세요?', golfDraft()))
    const aborted = recognizer.aborted
    const cancelled = synthesizer.cancelled

    replyOnce(APPLY, failWith(500, SERVER_ERROR))
    await user.click(screen.getByRole('button', { name: '신청하기' }))
    expect(await panel().findByText(DISABLED)).toBeInTheDocument()
    expect(recognizer.aborted).toBeGreaterThan(aborted)
    expect(synthesizer.cancelled).toBeGreaterThan(cancelled)
    expect(panel().queryByRole('button', { name: '그만두기' })).not.toBeInTheDocument()

    recognizer.say('막힌 뒤에 들린 말')
    await act(() => sleep(0))
    expect(countOf(CHAT)).toBe(1)
  })

  it('막혀 있으면 시작할 수 없다', () => {
    render(
      <VoiceInputPanel
        applySelection={vi.fn()}
        applyTour={vi.fn()}
        disabled
        createRecognizer={() => recognizer}
        createSynthesizer={() => synthesizer}
      />,
    )
    expect(panel().getByText(DISABLED)).toBeInTheDocument()
    expect(startButton()).toBeDisabled()
    expect(recognizer.started).toBe(0)
  })
})
