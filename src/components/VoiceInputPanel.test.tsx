import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceInputPanel, type TourSelection } from '@/components/VoiceInputPanel'
import { tourLevelLabel } from '@/lib/labels'
import type { PriceQuote, QuoteRequest, TourLevelsResponse, TourSummary } from '@/lib/tours'
import type { RecognitionFailure, Recognizer } from '@/modules/SpeechRecognizer'
import { TourSelectPage, type VoiceInputProps } from '@/pages/TourSelectPage'
import { jsonResponse, stubFetch } from '@/test/http'

const PARSE = 'POST /api/v1/voice/parse'
const GOLF_TOURS = 'GET /api/v1/tours?theme=GOLF'
const TREKKING_TOURS = 'GET /api/v1/tours?theme=TREKKING'
const QUOTE = 'POST /api/v1/bookings/quote'

const SPEAK_AGAIN = '내용을 고치거나 다시 말해 주세요.'
const MISSING = '알아듣지 못한 칸이 있습니다. 빈 칸을 채우거나 다시 말해 주세요.'
const NO_CANDIDATE = '그 테마와 출발일에 고를 수 있는 상품이 없습니다. 테마나 출발일을 고치거나 다시 말해 주세요.'
const CHOOSE = '출발일이 같은 상품이 여럿입니다. 하나를 골라 주세요.'
const PRICED = '말한 내용으로 가격을 계산했습니다. 아래에서 확인해 주세요.'
const CLOSED = '마감된 상품입니다.'
const DISABLED = '신청 결과를 확인하기 전에는 음성으로 고를 수 없습니다.'
const APPLY = 'POST /api/v1/bookings'

function tour(tourId: number, departureDate: string, duration: number, status: TourSummary['status'], seats: number) {
  const [, month, day] = departureDate.split('-').map(Number)
  return {
    tourId,
    title: `골프 챌린지 투어 ${month}/${day} 출발 ${duration}일`,
    departureDate,
    duration,
    remainingSeats: seats,
    status,
  } satisfies TourSummary
}

const golf20Long = tour(1, '2026-12-20', 5, 'RECRUITING', 10)
const golf20Full = tour(2, '2026-12-20', 3, 'FULL', 0)
const golf20Short = tour(3, '2026-12-20', 4, 'CONFIRMED', 6)
const golf27 = tour(4, '2026-12-27', 4, 'RECRUITING', 8)
const golfTours = [golf20Long, golf20Full, golf20Short, golf27]
const trekking20: TourSummary = { ...tour(5, '2026-12-20', 3, 'RECRUITING', 12), title: '아웃도어 트레킹 투어 12/20 출발 3일' }

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

// 12/27 골프 그랜드 2명. 테마와 출발일이 같은 상품은 하나다
const heardAll: TourSelection = { theme: 'GOLF', departureDate: '2026-12-27', level: 'GRAND', headcount: 2, candidates: [golf27] }

function quoteFor(request: QuoteRequest): PriceQuote {
  const found = [...golfTours, trekking20].find((item) => item.tourId === request.tourId)!
  const totalPrice = levels.levels.find((item) => item.level === request.level)!.price * request.headcount
  return {
    summary: {
      tourId: found.tourId,
      title: found.title,
      departureDate: found.departureDate,
      duration: found.duration,
      level: request.level,
      levelName: tourLevelLabel(request.level),
      headcount: request.headcount,
      options: [],
    },
    totalPrice,
    discount: 0,
    finalPrice: totalPrice,
  }
}

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

type Reply = Response | ((body: unknown) => Response | Promise<Response>)

let fetchMock: ReturnType<typeof stubFetch>
let once: Map<string, Reply[]>
let always: Map<string, Reply>
let unexpected: string[]
let recognizer: FakeRecognizer

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

// 응답을 테스트가 정한 때에 보낸다
function deferred(): { reply: Reply; resolve(response: Response): void } {
  let resolve: (response: Response) => void = () => {}
  const promise = new Promise<Response>((done) => (resolve = done))
  return { reply: () => promise, resolve: (response) => resolve(response) }
}

beforeEach(() => {
  recognizer = new FakeRecognizer()
  fetchMock = stubFetch()
  once = new Map()
  unexpected = []
  always = new Map<string, Reply>([
    [GOLF_TOURS, () => jsonResponse(200, golfTours)],
    [TREKKING_TOURS, () => jsonResponse(200, [trekking20])],
    ...[1, 3, 4, 5].map((id): [string, Reply] => [`GET /api/v1/tours/${id}/levels`, () => jsonResponse(200, levels)]),
    [QUOTE, (body) => jsonResponse(200, quoteFor(body as QuoteRequest))],
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

function VoiceInput({ applySelection, disabled }: VoiceInputProps) {
  return <VoiceInputPanel applySelection={applySelection} disabled={disabled} createRecognizer={() => recognizer} />
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

// 말하기를 눌러 그 말을 하고, 서버가 selection을 돌려준다
async function speak(user: ReturnType<typeof userEvent.setup>, selection: TourSelection, text = '골프 투어 말하기') {
  replyOnce(PARSE, jsonResponse(200, selection))
  await user.click(panel().getByRole('button', { name: /말하기/ }))
  recognizer.say(text)
  await panel().findByText(`알아들은 말: “${text}”`)
  await waitFor(() => expect(panel().queryByText('말한 내용을 읽는 중입니다.')).not.toBeInTheDocument())
}

function confirmButton() {
  return panel().getByRole('button', { name: '확인' })
}

describe('말해서 고르기', () => {
  it('말한 내용을 화면 이름으로 채우고, 확인하면 상품 선택 화면이 그 내용으로 가격을 계산한다', async () => {
    const user = renderPage()
    expect(panel().getByText(/말하기를 누르고/)).toBeInTheDocument()

    replyOnce(PARSE, jsonResponse(200, heardAll))
    await user.click(panel().getByRole('button', { name: '말하기' }))
    expect(recognizer.started).toBe(1)
    expect(panel().getByText('듣고 있습니다. 테마, 출발일, 투어 등급, 인원을 말해 주세요.')).toBeInTheDocument()
    expect(panel().queryByRole('button', { name: '말하기' })).not.toBeInTheDocument()

    recognizer.say('12월 27일 골프 투어 그랜드로 두 명')
    expect(await panel().findByLabelText('테마')).toHaveDisplayValue('골프 챌린지 투어')
    expect(bodiesOf(PARSE)).toEqual([{ text: '12월 27일 골프 투어 그랜드로 두 명' }])
    expect(panel().getByLabelText('출발일')).toHaveValue('2026-12-27')
    expect(panel().getByLabelText('투어 등급')).toHaveDisplayValue('그랜드')
    expect(panel().getByLabelText('인원')).toHaveValue(2)
    expect(panel().getByRole('radio', { name: /12\/27 출발 4일/ })).toBeChecked()

    await user.click(confirmButton())
    expect(await screen.findByText('가격 요약')).toBeInTheDocument()
    expect(bodiesOf(QUOTE)).toEqual([{ tourId: 4, level: 'GRAND', headcount: 2, optionIds: [] }])
    expect(screen.getByRole('button', { name: '골프 챌린지 투어' })).toHaveAttribute('aria-pressed', 'true')
    expect(panel().getByText(PRICED)).toBeInTheDocument()
    expect(panel().queryByLabelText('테마')).not.toBeInTheDocument()
    expect(countOf(GOLF_TOURS)).toBe(1)
  })

  it('가격이 나온 뒤에는 화면에서 고를 때와 같다(인원을 바꾼 계산의 409는 상품 목록으로 돌아간다)', async () => {
    const user = renderPage()
    await speak(user, heardAll)
    await user.click(confirmButton())
    await screen.findByText('가격 요약')

    replyOnce(QUOTE, failWith(409, CLOSED))
    const headcount = within(screen.getByRole('region', { name: '고른 상품' })).getByLabelText('인원')
    await user.clear(headcount)
    await user.type(headcount, '3{Enter}')
    expect(await screen.findByText(CLOSED)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /12\/27 출발 4일/ })).toBeInTheDocument()
    expect(panel().queryByText(SPEAK_AGAIN)).not.toBeInTheDocument()
  })

  it('듣는 중에 그만 듣기를 누르면 듣기를 끊고, 그 뒤에 온 말은 버린다', async () => {
    const user = renderPage()
    await user.click(panel().getByRole('button', { name: '말하기' }))
    await user.click(panel().getByRole('button', { name: '그만 듣기' }))

    expect(recognizer.aborted).toBe(1)
    expect(panel().getByRole('button', { name: '말하기' })).toBeEnabled()
    recognizer.say('늦게 온 말')
    expect(countOf(PARSE)).toBe(0)
  })

  it('다시 말하다 그만두거나 알아듣지 못하면 고치던 칸을 다시 보인다', async () => {
    const user = renderPage()
    await speak(user, heardAll)
    await user.clear(panel().getByLabelText('인원'))
    await user.type(panel().getByLabelText('인원'), '4')

    await user.click(panel().getByRole('button', { name: '다시 말하기' }))
    expect(panel().queryByLabelText('인원')).not.toBeInTheDocument()
    await user.click(panel().getByRole('button', { name: '그만 듣기' }))
    expect(panel().getByLabelText('인원')).toHaveValue(4)

    await user.click(panel().getByRole('button', { name: '다시 말하기' }))
    recognizer.fail('no-speech')
    expect(panel().getByText('말소리를 듣지 못했습니다. 다시 말해 주세요.')).toBeInTheDocument()
    expect(panel().getByLabelText('인원')).toHaveValue(4)
  })

  it('말을 푸는 동안 그만두면 늦게 온 응답은 버리고 고치던 칸을 다시 보인다', async () => {
    const user = renderPage()
    await speak(user, heardAll)
    const slow = deferred()
    replyOnce(PARSE, slow.reply)
    await user.click(panel().getByRole('button', { name: '다시 말하기' }))
    recognizer.say('트레킹으로 바꿔 줘')
    await user.click(await panel().findByRole('button', { name: '그만두기' }))

    expect(panel().getByLabelText('테마')).toHaveDisplayValue('골프 챌린지 투어')
    slow.resolve(jsonResponse(200, { ...heardAll, theme: 'TREKKING', candidates: [trekking20] }))
    await act(() => sleep(0))
    expect(panel().getByLabelText('테마')).toHaveDisplayValue('골프 챌린지 투어')
  })

  it('화면을 떠나면 듣기를 그만둔다', async () => {
    const user = renderPage()
    await user.click(panel().getByRole('button', { name: '말하기' }))
    await user.click(screen.getByRole('link', { name: '고객 메뉴' }))
    expect(await screen.findByRole('heading', { name: '고객 메뉴' })).toBeInTheDocument()
    expect(recognizer.aborted).toBe(1)
  })
})

describe('후보 상품 가르기', () => {
  it('고를 수 있는 후보가 둘 이상이면 목록에서 고르게 하고, 마감 후보는 마감으로 보이며 고를 수 없다', async () => {
    const user = renderPage()
    await speak(user, { ...heardAll, departureDate: '2026-12-20', candidates: [golf20Long, golf20Full, golf20Short] })

    const full = panel().getByRole('radio', { name: /12\/20 출발 3일/ })
    expect(full).toBeDisabled()
    expect(within(full.parentElement!).getByText('마감')).toBeInTheDocument()
    expect(panel().getByText(CHOOSE)).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()

    await user.click(panel().getByRole('radio', { name: /12\/20 출발 4일/ }))
    expect(panel().queryByText(CHOOSE)).not.toBeInTheDocument()
    await user.click(confirmButton())
    await screen.findByText('가격 요약')
    expect(bodiesOf(QUOTE)).toEqual([{ tourId: 3, level: 'GRAND', headcount: 2, optionIds: [] }])
  })

  it('고를 수 있는 후보가 하나면 마감 후보가 섞여 있어도 그 상품을 쓴다', async () => {
    const user = renderPage()
    await speak(user, { ...heardAll, departureDate: '2026-12-20', candidates: [golf20Long, golf20Full] })

    expect(panel().getByRole('radio', { name: /12\/20 출발 5일/ })).toBeChecked()
    expect(panel().queryByText(CHOOSE)).not.toBeInTheDocument()
    expect(confirmButton()).toBeEnabled()
  })

  it.each([
    ['마감 후보뿐', [golf20Full]],
    ['후보가 없음', []],
  ])('고를 수 있는 후보가 없으면(%s) 다시 말해 달라고 안내한다', async (_, candidates) => {
    const user = renderPage()
    await speak(user, { ...heardAll, departureDate: '2026-12-20', candidates })

    expect(panel().getByText(NO_CANDIDATE)).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
    expect(panel().getByRole('button', { name: '다시 말하기' })).toBeEnabled()
  })

  it('뽑지 못한 칸은 비워 두고 다시 말해 달라고 하며, 고객이 채우면 다시 말하지 않아도 확인할 수 있다', async () => {
    const user = renderPage()
    await speak(user, { ...heardAll, level: null, headcount: null })

    expect(panel().getByLabelText('투어 등급')).toHaveValue('')
    expect(panel().getByLabelText('인원')).toHaveValue(null)
    expect(panel().getByText(MISSING)).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()

    await user.selectOptions(panel().getByLabelText('투어 등급'), 'PREMIUM')
    await user.type(panel().getByLabelText('인원'), '3')
    expect(panel().queryByText(MISSING)).not.toBeInTheDocument()
    await user.click(confirmButton())
    await screen.findByText('가격 요약')
    expect(bodiesOf(QUOTE)).toEqual([{ tourId: 4, level: 'PREMIUM', headcount: 3, optionIds: [] }])
    expect(countOf(PARSE)).toBe(1)
  })

  it('응답에 칸이 빠져 있어도 뽑지 못한 칸으로 비워 둔다', async () => {
    const user = renderPage()
    const withoutHeadcount: Partial<TourSelection> = { ...heardAll }
    delete withoutHeadcount.headcount
    await speak(user, withoutHeadcount as TourSelection)

    expect(panel().getByLabelText('인원')).toHaveValue(null)
    expect(panel().getByText(MISSING)).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
  })

  it('테마·출발일을 뽑지 못했으면 고객이 채운 테마의 상품 목록에서 출발일이 같은 상품을 후보로 쓴다', async () => {
    const user = renderPage()
    await speak(user, { ...heardAll, theme: null, departureDate: null, candidates: [] })
    expect(panel().getByText(MISSING)).toBeInTheDocument()

    await user.selectOptions(panel().getByLabelText('테마'), 'GOLF')
    expect(countOf(GOLF_TOURS)).toBe(0)
    fireEvent.change(panel().getByLabelText('출발일'), { target: { value: '2026-12-27' } })

    expect(await panel().findByRole('radio', { name: /12\/27 출발 4일/ })).toBeChecked()
    expect(countOf(GOLF_TOURS)).toBe(1)
    expect(panel().queryByText(MISSING)).not.toBeInTheDocument()
    expect(confirmButton()).toBeEnabled()
  })
})

describe('테마나 출발일을 고치면', () => {
  it('받은 후보 대신 그 테마의 상품 목록에서 출발일이 같은 상품으로 후보를 다시 정한다', async () => {
    const user = renderPage()
    await speak(user, heardAll)

    fireEvent.change(panel().getByLabelText('출발일'), { target: { value: '2026-12-20' } })
    expect(await panel().findByRole('radio', { name: /12\/20 출발 5일/ })).not.toBeChecked()
    expect(panel().queryByRole('radio', { name: /12\/27/ })).not.toBeInTheDocument()
    expect(panel().getByText(CHOOSE)).toBeInTheDocument()
    expect(countOf(GOLF_TOURS)).toBe(1)

    // 출발일만 고치면 받아 둔 그 테마의 목록을 다시 쓴다(날짜 칸은 칠 때마다 바뀐다)
    fireEvent.change(panel().getByLabelText('출발일'), { target: { value: '0202-12-27' } })
    expect(panel().getByText(NO_CANDIDATE)).toBeInTheDocument()
    fireEvent.change(panel().getByLabelText('출발일'), { target: { value: '2026-12-27' } })
    expect(panel().getByRole('radio', { name: /12\/27 출발 4일/ })).toBeChecked()
    expect(countOf(GOLF_TOURS)).toBe(1)

    fireEvent.change(panel().getByLabelText('출발일'), { target: { value: '2026-12-20' } })
    await user.selectOptions(panel().getByLabelText('테마'), 'TREKKING')
    expect(await panel().findByRole('radio', { name: /트레킹 투어 12\/20/ })).toBeChecked()
    await user.click(confirmButton())
    await screen.findByText('가격 요약')
    expect(bodiesOf(QUOTE)).toEqual([{ tourId: 5, level: 'GRAND', headcount: 2, optionIds: [] }])
    expect(screen.getByRole('button', { name: '아웃도어 트레킹 투어' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('그 테마의 목록을 받는 중에 출발일을 고치면 같은 요청의 답을 기다린다', async () => {
    const user = renderPage()
    await speak(user, heardAll)
    const slow = deferred()
    replyOnce(TREKKING_TOURS, slow.reply)
    await user.selectOptions(panel().getByLabelText('테마'), 'TREKKING')
    fireEvent.change(panel().getByLabelText('출발일'), { target: { value: '0202-12-20' } })
    fireEvent.change(panel().getByLabelText('출발일'), { target: { value: '2026-12-20' } })
    expect(countOf(TREKKING_TOURS)).toBe(1)

    slow.resolve(jsonResponse(200, [trekking20]))
    expect(await panel().findByRole('radio', { name: /트레킹 투어 12\/20/ })).toBeChecked()
    expect(countOf(TREKKING_TOURS)).toBe(1)
  })

  it('늦게 온 앞선 목록은 버린다', async () => {
    const user = renderPage()
    await speak(user, heardAll)

    const slow = deferred()
    replyOnce(GOLF_TOURS, slow.reply)
    fireEvent.change(panel().getByLabelText('출발일'), { target: { value: '2026-12-20' } })
    expect(panel().getByText('후보 상품을 찾는 중입니다.')).toBeInTheDocument()
    await user.selectOptions(panel().getByLabelText('테마'), 'TREKKING')
    expect(await panel().findByRole('radio', { name: /트레킹 투어 12\/20/ })).toBeChecked()

    slow.resolve(jsonResponse(200, golfTours))
    await act(() => sleep(0))
    expect(panel().queryByRole('radio', { name: /골프/ })).not.toBeInTheDocument()
  })

  it('후보 상품을 불러오지 못하면 알리고 다시 찾을 수 있다', async () => {
    const user = renderPage()
    await speak(user, heardAll)

    replyOnce(GOLF_TOURS, failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    fireEvent.change(panel().getByLabelText('출발일'), { target: { value: '2026-12-20' } })
    expect(await panel().findByText('후보 상품을 불러오지 못했습니다.')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.')
    expect(confirmButton()).toBeDisabled()

    await user.click(panel().getByRole('button', { name: '다시 찾기' }))
    expect(await panel().findByRole('radio', { name: /12\/20 출발 5일/ })).toBeInTheDocument()
  })
})

describe('오류', () => {
  it.each(['음성에서 알아들은 글자가 없습니다. 다시 말해 주세요.', '말이 너무 깁니다. 300자 안으로 다시 말해 주세요.'])(
    'voice/parse가 400(%s)이면 서버 문구를 보여 주고 다시 말하게 한다',
    async (message) => {
      const user = renderPage()
      replyOnce(PARSE, failWith(400, message))
      await user.click(panel().getByRole('button', { name: '말하기' }))
      recognizer.say('아')

      expect(await panel().findByText(message)).toBeInTheDocument()
      expect(toast.error).not.toHaveBeenCalled()
      await user.click(panel().getByRole('button', { name: '말하기' }))
      expect(recognizer.started).toBe(2)
      expect(panel().queryByText(message)).not.toBeInTheDocument()
    },
  )

  it.each([
    [400, '남은 자리보다 인원이 많습니다.'],
    [409, CLOSED],
  ])('확인한 내용의 가격 계산이 %i면 서버 문구를 보여 준 뒤 다시 말해 달라고 하고, 상품 목록으로 돌아가지 않는다', async (status, message) => {
    const user = renderPage()
    await speak(user, heardAll)
    replyOnce(QUOTE, failWith(status, message))
    await user.click(confirmButton())

    expect(await panel().findByText(message)).toBeInTheDocument()
    expect(panel().getByText(SPEAK_AGAIN)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다른 상품 고르기' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '상품 목록' })).not.toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()

    // 고쳐서 다시 확인할 수 있다
    await user.clear(panel().getByLabelText('인원'))
    expect(panel().queryByText(message)).not.toBeInTheDocument()
    await user.type(panel().getByLabelText('인원'), '1')
    await user.click(confirmButton())
    expect(await screen.findByText('가격 요약')).toBeInTheDocument()
    expect(bodiesOf(QUOTE).at(-1)).toEqual({ tourId: 4, level: 'GRAND', headcount: 1, optionIds: [] })
  })

  it('확인한 상품이 그사이 마감됐으면(409) 후보를 새로 받아 마감으로 보이고 확인을 막는다', async () => {
    const user = renderPage()
    await speak(user, heardAll)
    const closed = { ...golf27, status: 'FULL' as const, remainingSeats: 0 }
    // 앞의 것은 상품 선택 화면이, 뒤의 것은 거부 뒤 음성 패널이 받는다
    replyOnce(GOLF_TOURS, jsonResponse(200, golfTours), jsonResponse(200, [golf20Long, golf20Full, golf20Short, closed]))
    replyOnce(QUOTE, failWith(409, CLOSED))
    await user.click(confirmButton())

    expect(await panel().findByText(CLOSED)).toBeInTheDocument()
    const radio = await panel().findByRole('radio', { name: /12\/27 출발 4일/ })
    expect(radio).toBeDisabled()
    expect(within(radio.parentElement!).getByText('마감')).toBeInTheDocument()
    expect(panel().getByText(NO_CANDIDATE)).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
    expect(countOf(GOLF_TOURS)).toBe(2)
  })

  it('남은 자리가 모자라다는 400이면 후보를 새로 받아 지금 남은 자리를 보이고, 고객이 고른 상품은 둔다', async () => {
    const user = renderPage()
    await speak(user, { ...heardAll, departureDate: '2026-12-20', candidates: [golf20Long, golf20Full, golf20Short] })
    await user.click(panel().getByRole('radio', { name: /12\/20 출발 4일/ }))
    const fewer = { ...golf20Short, remainingSeats: 1 }
    replyOnce(GOLF_TOURS, jsonResponse(200, golfTours), jsonResponse(200, [golf20Long, golf20Full, fewer, golf27]))
    replyOnce(QUOTE, failWith(400, '남은 자리보다 인원이 많습니다.'))
    await user.click(confirmButton())

    expect(await panel().findByText('남은 자리보다 인원이 많습니다.')).toBeInTheDocument()
    expect(await panel().findByText(/12월 20일 출발 · 4일 · 남은 자리 1명/)).toBeInTheDocument()
    expect(panel().getByRole('radio', { name: /12\/20 출발 4일/ })).toBeChecked()
    expect(panel().queryByText(CHOOSE)).not.toBeInTheDocument()
    expect(countOf(GOLF_TOURS)).toBe(2)
  })

  it('고른 상품이 409로 마감되면 남은 후보가 하나여도 대신 고르지 않는다', async () => {
    const user = renderPage()
    await speak(user, { ...heardAll, departureDate: '2026-12-20', candidates: [golf20Long, golf20Full, golf20Short] })
    await user.click(panel().getByRole('radio', { name: /12\/20 출발 4일/ }))
    const closed = { ...golf20Short, status: 'FULL' as const, remainingSeats: 0 }
    replyOnce(GOLF_TOURS, jsonResponse(200, golfTours), jsonResponse(200, [golf20Long, golf20Full, closed, golf27]))
    replyOnce(QUOTE, failWith(409, CLOSED))
    await user.click(confirmButton())

    expect(await panel().findByRole('radio', { name: /12\/20 출발 4일/ })).toBeDisabled()
    expect(panel().getByRole('radio', { name: /12\/20 출발 5일/ })).not.toBeChecked()
    expect(panel().getByText('후보 상품을 골라 주세요.')).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
  })

  it('확인하면 앞서 알린 것(말소리 없음 등)을 지운다', async () => {
    const user = renderPage()
    await speak(user, heardAll)
    await user.click(panel().getByRole('button', { name: '다시 말하기' }))
    recognizer.fail('no-speech')
    expect(panel().getByText('말소리를 듣지 못했습니다. 다시 말해 주세요.')).toBeInTheDocument()

    replyOnce(QUOTE, failWith(400, '골프 챌린지 투어는 2명만 신청할 수 있습니다.'))
    await user.click(confirmButton())
    expect(await panel().findByText('골프 챌린지 투어는 2명만 신청할 수 있습니다.')).toBeInTheDocument()
    expect(panel().queryByText('말소리를 듣지 못했습니다. 다시 말해 주세요.')).not.toBeInTheDocument()

    // 다시 확인해 다른 이유로 실패하면 지난 거부 문구는 남지 않는다
    replyOnce(QUOTE, failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    await user.click(confirmButton())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    expect(panel().queryByText('골프 챌린지 투어는 2명만 신청할 수 있습니다.')).not.toBeInTheDocument()
  })

  it('그 밖의 400은 고를 수 있는 후보를 바꾸지 않아 후보를 다시 받지 않는다', async () => {
    const user = renderPage()
    await speak(user, heardAll)
    replyOnce(QUOTE, failWith(400, '골프 챌린지 투어는 2명만 신청할 수 있습니다.'))
    await user.click(confirmButton())

    expect(await panel().findByText('골프 챌린지 투어는 2명만 신청할 수 있습니다.')).toBeInTheDocument()
    expect(panel().getByRole('radio', { name: /12\/27 출발 4일/ })).toBeChecked()
    // 상품 선택 화면이 받은 한 번뿐이다
    expect(countOf(GOLF_TOURS)).toBe(1)
  })

  it('409 뒤 후보를 받지 못하면 받아 두었던 낡은 목록을 다시 쓰지 않는다', async () => {
    const user = renderPage()
    await speak(user, heardAll)
    fireEvent.change(panel().getByLabelText('출발일'), { target: { value: '2026-12-20' } })
    fireEvent.change(panel().getByLabelText('출발일'), { target: { value: '2026-12-27' } })
    expect(await panel().findByRole('radio', { name: /12\/27 출발 4일/ })).toBeChecked()
    expect(countOf(GOLF_TOURS)).toBe(1)

    replyOnce(GOLF_TOURS, jsonResponse(200, golfTours), failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    replyOnce(QUOTE, failWith(409, CLOSED))
    await user.click(confirmButton())
    expect(await panel().findByText('후보 상품을 불러오지 못했습니다.')).toBeInTheDocument()

    fireEvent.change(panel().getByLabelText('출발일'), { target: { value: '2026-12-20' } })
    await panel().findByRole('radio', { name: /12\/20 출발 5일/ })
    expect(countOf(GOLF_TOURS)).toBe(4)
  })

  it('409 뒤 후보를 받지 못해 다시 찾아도 고객이 고른 상품은 아직 고를 수 있으면 둔다', async () => {
    const user = renderPage()
    await speak(user, { ...heardAll, departureDate: '2026-12-20', candidates: [golf20Long, golf20Full, golf20Short] })
    await user.click(panel().getByRole('radio', { name: /12\/20 출발 4일/ }))
    replyOnce(GOLF_TOURS, jsonResponse(200, golfTours), failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    replyOnce(QUOTE, failWith(409, '출발일이 지난 상품입니다.'))
    await user.click(confirmButton())

    expect(await panel().findByText('후보 상품을 불러오지 못했습니다.')).toBeInTheDocument()
    await user.click(panel().getByRole('button', { name: '다시 찾기' }))
    expect(await panel().findByRole('radio', { name: /12\/20 출발 4일/ })).toBeChecked()
    expect(confirmButton()).toBeEnabled()
  })

  it.each(['1e1', '0', '1.5'])(
    '인원이 숫자만 쓴 1 이상의 정수가 아니면(%s) 상품 선택 화면에서 칠 때와 같은 문구를 보이고 확인을 막는다',
    async (headcount) => {
      const user = renderPage()
      await speak(user, { ...heardAll, headcount: null })
      await user.type(panel().getByLabelText('인원'), headcount)

      expect(panel().getByText('인원은 1 이상의 정수로 입력해 주세요.')).toBeInTheDocument()
      expect(confirmButton()).toBeDisabled()
      expect(screen.queryByRole('region', { name: '고른 상품' })).not.toBeInTheDocument()
    },
  )

  it('아무 말도 하지 않아 인식이 끝나면 다시 말하게 한다', async () => {
    const user = renderPage()
    await user.click(panel().getByRole('button', { name: '말하기' }))
    recognizer.fail('no-speech')

    expect(panel().getByText('말소리를 듣지 못했습니다. 다시 말해 주세요.')).toBeInTheDocument()
    expect(panel().getByRole('button', { name: '말하기' })).toBeEnabled()
    expect(countOf(PARSE)).toBe(0)
  })

  it.each([
    ['not-allowed', '마이크 권한이 없어 음성 입력을 쓸 수 없습니다. 아래에서 직접 골라 주세요.'],
    ['other', '음성을 인식하지 못했습니다. 아래에서 직접 골라 주세요.'],
  ] as const)('인식이 %s로 실패하면 화면에서 직접 고르라고 안내한다', async (reason, message) => {
    const user = renderPage()
    await user.click(panel().getByRole('button', { name: '말하기' }))
    recognizer.fail(reason)

    expect(panel().getByText(message)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '골프 챌린지 투어' })).toBeEnabled()
  })

  it('크롬이 아니거나 음성인식 기능이 없으면 말하기 단추 없이 직접 고르라고 안내한다', () => {
    recognizer.supported = false
    renderPage()

    expect(
      panel().getByText('이 브라우저에서는 음성 입력을 쓸 수 없습니다. 크롬에서 열거나, 아래에서 직접 골라 주세요.'),
    ).toBeInTheDocument()
    expect(panel().queryByRole('button', { name: '말하기' })).not.toBeInTheDocument()
    expect(recognizer.started).toBe(0)
  })

  it('voice/parse가 503이면 서버 문구 없이 직접 고르라고 안내한다', async () => {
    const user = renderPage()
    replyOnce(PARSE, failWith(503, '음성으로 고르기를 지금 쓸 수 없습니다.'))
    await user.click(panel().getByRole('button', { name: '말하기' }))
    recognizer.say('골프')

    expect(await panel().findByText('지금은 음성으로 고를 수 없습니다. 아래에서 직접 골라 주세요.')).toBeInTheDocument()
    expect(screen.queryByText('음성으로 고르기를 지금 쓸 수 없습니다.')).not.toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('voice/parse의 그 밖의 실패는 공용 알림으로 알리고 다시 말할 수 있다', async () => {
    const user = renderPage()
    replyOnce(PARSE, failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    await user.click(panel().getByRole('button', { name: '말하기' }))
    recognizer.say('골프')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    expect(panel().getByRole('button', { name: '말하기' })).toBeEnabled()
  })

  it('가격을 계산하는 동안은 칸과 다시 말하기를 막는다', async () => {
    const user = renderPage()
    await speak(user, heardAll)
    const slow = deferred()
    replyOnce(QUOTE, slow.reply)
    await user.click(confirmButton())

    expect(panel().getByRole('button', { name: '가격을 계산하는 중' })).toBeDisabled()
    expect(panel().getByRole('button', { name: '다시 말하기' })).toBeDisabled()
    expect(panel().getByLabelText('인원')).toBeDisabled()

    slow.resolve(jsonResponse(200, quoteFor({ tourId: 4, level: 'GRAND', headcount: 2, optionIds: [] })))
    expect(await panel().findByText(PRICED)).toBeInTheDocument()
  })
})

describe('신청 결과를 모를 때', () => {
  it('상품 선택 화면이 결과를 확인할 때까지 말하기·칸·확인을 막고 까닭을 알린 뒤, 결과를 받으면 풀어 준다', async () => {
    const user = renderPage()
    await speak(user, heardAll)
    await user.click(confirmButton())
    await screen.findByText('가격 요약')
    await speak(user, heardAll, '다시 말한 골프 투어')
    expect(confirmButton()).toBeEnabled()

    replyOnce(APPLY, failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    await user.click(screen.getByRole('button', { name: '신청하기' }))
    await screen.findByRole('button', { name: '결과 확인' })

    expect(panel().getByText(DISABLED)).toBeInTheDocument()
    expect(panel().getByRole('button', { name: '다시 말하기' })).toBeDisabled()
    expect(confirmButton()).toBeDisabled()
    expect(panel().getByLabelText('테마')).toBeDisabled()
    expect(panel().getByLabelText('인원')).toBeDisabled()
    expect(panel().getByRole('radio', { name: /12\/27 출발 4일/ })).toBeDisabled()

    replyOnce(APPLY, jsonResponse(201, { bookingId: 7, status: 'CONFIRMED' }))
    await user.click(screen.getByRole('button', { name: '결과 확인' }))
    expect(await screen.findByText(/신청했습니다/)).toBeInTheDocument()
    expect(panel().queryByText(DISABLED)).not.toBeInTheDocument()
    expect(panel().getByRole('button', { name: '다시 말하기' })).toBeEnabled()
    expect(confirmButton()).toBeEnabled()
  })

  it('막힌 동안은 지난 알림(가격을 계산했다)을 숨긴다', async () => {
    const user = renderPage()
    await speak(user, heardAll)
    await user.click(confirmButton())
    expect(await panel().findByText(PRICED)).toBeInTheDocument()

    replyOnce(APPLY, failWith(500, '서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.'))
    await user.click(screen.getByRole('button', { name: '신청하기' }))
    expect(await panel().findByText(DISABLED)).toBeInTheDocument()
    expect(panel().queryByText(PRICED)).not.toBeInTheDocument()
  })

  it('막혀 있으면 말하기를 누를 수 없다', () => {
    render(<VoiceInputPanel applySelection={vi.fn()} disabled createRecognizer={() => recognizer} />)
    expect(panel().getByText(DISABLED)).toBeInTheDocument()
    expect(panel().getByRole('button', { name: '말하기' })).toBeDisabled()
    expect(recognizer.started).toBe(0)
  })
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
