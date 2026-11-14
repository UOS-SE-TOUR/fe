import { useEffect, useRef, useState, type ComponentType } from 'react'
import { toast } from 'sonner'
import { MenuLink } from '@/components/MenuLink'
import { OptionPanel } from '@/components/OptionPanel'
import { PriceSummary } from '@/components/PriceSummary'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { formatDate, formatWon } from '@/lib/format'
import { themeLabel, themes, tourStatusLabel, type Theme, type TourLevel } from '@/lib/labels'
import { pagePaths } from '@/lib/pages'
import { useBlockLeaving } from '@/lib/useBlockLeaving'
import {
  canApply,
  getTours,
  HEADCOUNT_MESSAGE,
  parseHeadcount,
  SEAT_SHORTAGE_MESSAGE,
  tourSummaryLine,
  type ApplyTourResponse,
  type PriceQuote,
  type QuoteRequest,
  type TourLevelsResponse,
  type ToursState,
  type TourSummary,
} from '@/lib/tours'
import { ApiClient, ApiError, hasStatus, showError } from '@/modules/ApiClient'

// 음성(VoiceInputPanel)이 채운 내용
export interface VoiceSelection {
  theme: Theme
  tourId: number
  level: TourLevel
  headcount: number
}

// applySelection 직후의 가격 계산 결과. rejected(400·409, 또는 화면에서 고를 때처럼 상품에 없는 등급·정수가 아닌 인원)는
// VoiceInputPanel이 문구를 보여 주고 다시 말하게 한다. failed는 그 밖의 실패로, 이 화면이 이미 알렸다
export type ApplySelectionResult = { status: 'priced' } | { status: 'rejected'; error: ApiError } | { status: 'failed' }
export type ApplySelection = (selection: VoiceSelection) => Promise<ApplySelectionResult>

const CANNOT_APPLY_MESSAGE = '더는 신청할 수 없는 상품입니다. 다른 상품을 골라 주세요.'
const LEVEL_MESSAGE = '투어 등급을 골라 주세요.'
const APPLYING_MESSAGE = '신청을 처리하는 중입니다. 신청이 끝난 뒤 다시 시도해 주세요.'
const CHECK_RESULT_FIRST_MESSAGE = '신청 결과를 확인한 뒤 다시 시도해 주세요.'
// 인원을 치다가 이만큼 멈추면 가격을 계산한다(글자마다 서버를 부르지 않게)
export const HEADCOUNT_DELAY_MS = 500

interface PricedSelection {
  level: TourLevel
  headcount: number
}

// 보내는 신청. 신청 키는 신청하기를 누를 때마다 새로 만든다
interface ApplyRequest {
  idempotencyKey: string
  request: QuoteRequest
}

// 결과를 모르는 신청과 그 문구. "결과 확인"은 같은 신청 키로 같은 내용을 다시 보낸다
interface UnknownApply extends ApplyRequest {
  message: string
}

// 새 신청 키(UUID v4). crypto.randomUUID가 없는 브라우저(Safari 15.4 이전)에서는 getRandomValues로 같은 모양을 만든다.
// randomUUID가 없는 http 주소(https·localhost 밖)는 로그인 쿠키가 Secure라 로그인부터 되지 않는다(be README)
function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// 고른 상품 하나의 상태. 상품을 다시 고르면 새로 만들어, 고른 옵션과 지난 가격이 함께 비워진다
interface Detail {
  tourId: number
  levels: TourLevelsResponse | null
  levelInput: TourLevel | null
  headcountInput: string
  // 가격이 나왔거나 400을 받은 마지막 투어 등급·인원. 옵션을 바꾸면 이것으로 가격을 계산한다.
  // 응답을 받은 뒤에만 바꾼다(그 밖의 실패면 지난 가격의 것이 남아 바꾼 입력으로는 신청할 수 없다)
  submitted: PricedSelection | null
  optionIds: number[]
  // 이 상품에서 마지막으로 나온 가격. 신청은 이 고른 내용으로 보낸다
  quote: PriceQuote | null
  // quote가 마지막으로 보낸 투어 등급·인원·옵션의 가격이다. 400으로 투어 등급·인원을 다시 받는 동안은 false
  priced: boolean
  // 마지막으로 보낸 가격 계산을 기다리는 중
  quoting: boolean
  // 투어 등급·인원의 가격 계산이 400·409 밖의 이유로 실패했다(다시 계산 단추를 보인다). 옵션을 바꾼 계산으로는 꺼지지 않는다
  quoteFailed: boolean
  discountConfirmed: boolean
  optionPanelOpen: boolean
  levelMessage: string | null
  optionMessage: string | null
  applyResult: ApplyTourResponse | null
  // 결과를 모르는 신청(설계 3.1 idempotencyKey). 있으면 고른 내용과 음성 입력을 막는다
  unknownApply: UnknownApply | null
}

// levels·apply는 입력까지 막고, seats(400 뒤 남은 자리를 다시 불러오는 중)는 옵션·신청만 막는다
type Pending = 'levels' | 'seats' | 'apply' | null

function newDetail(tourId: number): Detail {
  return {
    tourId,
    levels: null,
    levelInput: null,
    headcountInput: '',
    submitted: null,
    optionIds: [],
    quote: null,
    priced: false,
    quoting: false,
    quoteFailed: false,
    discountConfirmed: false,
    optionPanelOpen: false,
    levelMessage: null,
    optionMessage: null,
    applyResult: null,
    unknownApply: null,
  }
}

// 투어 등급·인원 입력을 가격 계산에 보낼 수 있는지 본다. 화면 문구(아직 덜 골랐으면 null)나 보낼 내용을 돌려준다.
// 화면에서 고를 때와 음성으로 채울 때가 같은 규칙을 쓴다
function checkSelection(
  levels: TourLevelsResponse | null,
  level: TourLevel | null,
  headcountInput: string,
): { selection: PricedSelection } | { message: string | null } {
  const text = headcountInput.trim()
  const headcount = parseHeadcount(text)
  if (text !== '' && headcount === null) return { message: HEADCOUNT_MESSAGE }
  // 음성이 이 상품에 없는 등급(허니문의 클래식 등)을 채웠으면 화면에 고른 등급이 없다
  if (level && !levels?.levels.some((item) => item.level === level)) return { message: text ? LEVEL_MESSAGE : null }
  if (!level || headcount === null) return { message: null }
  return { selection: { level, headcount } }
}

function getLevels(tourId: number): Promise<TourLevelsResponse> {
  return ApiClient.get<TourLevelsResponse>(`/api/v1/tours/${tourId}/levels`)
}

function quote(tourId: number, selection: PricedSelection, optionIds: number[]): Promise<PriceQuote> {
  const request: QuoteRequest = { tourId, level: selection.level, headcount: selection.headcount, optionIds }
  return ApiClient.post<PriceQuote>('/api/v1/bookings/quote', request)
}

function TourList({ tours, onSelect }: { tours: TourSummary[]; onSelect(tourId: number): void }) {
  if (tours.length === 0) {
    return <p className="text-sm text-muted-foreground">이 테마에는 지금 신청할 수 있는 상품이 없습니다.</p>
  }
  return (
    <ul className="space-y-2">
      {tours.map((tour) => (
        <li key={tour.tourId}>
          <Button
            variant="outline"
            className="h-auto w-full justify-between gap-4 py-3 text-left whitespace-normal"
            disabled={!canApply(tour)}
            onClick={() => onSelect(tour.tourId)}
          >
            <span className="space-y-1">
              <span className="block font-medium">{tour.title}</span>
              <span className="block text-muted-foreground">{tourSummaryLine(tour)}</span>
            </span>
            <Badge variant={canApply(tour) ? 'secondary' : 'outline'}>{tourStatusLabel(tour.status)}</Badge>
          </Button>
        </li>
      ))}
    </ul>
  )
}

// 음성 입력 부품이 받는 것. disabled면 신청 결과를 확인하기 전이라 쓸 수 없다
export interface VoiceInputProps {
  applySelection: ApplySelection
  disabled: boolean
}

interface TourSelectPageProps {
  // 음성 입력 부품(VoiceInputPanel, #7)을 넣을 자리
  voiceInput?: ComponentType<VoiceInputProps>
}

export function TourSelectPage({ voiceInput: VoiceInput }: TourSelectPageProps = {}) {
  const [theme, setTheme] = useState<Theme | null>(null)
  // null이면 아직 테마를 고르지 않았다
  const [tours, setTours] = useState<ToursState | null>(null)
  const [listMessage, setListMessage] = useState<string | null>(null)
  // null이면 상품 목록을 보여 준다
  const [detail, setDetail] = useState<Detail | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  // 테마·상품을 다시 고르거나 목록으로 돌아가면 올린다. 그 전에 보낸 요청의 응답은 버린다
  const context = useRef(0)
  // 신청 단추를 빠르게 두 번 눌러도 신청은 한 번만 나간다
  const applying = useRef(false)
  // 목록 요청이 겹치면 마지막에 보낸 것만 보인다(먼저 보낸 응답이 늦게 와 새 남은 자리를 덮지 않게)
  const toursRequest = useRef(0)
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 고른 상품의 최신 상태. 화면(detail)과 함께 바꿔, 이벤트·타이머·응답이 다시 그리기 전에도 최신 값을 읽는다
  const detailRef = useRef<Detail | null>(null)
  // 가격 계산 중에 고친 입력이 있다. 그 계산이 끝나는 자리에서 그때의 입력으로 다시 계산한다
  const requote = useRef(false)
  const tourList = tours?.status === 'loaded' ? tours.list : undefined

  useEffect(() => {
    const timer = quoteTimer
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  function clearQuoteTimer() {
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    quoteTimer.current = null
  }

  function newContext(): number {
    clearQuoteTimer()
    requote.current = false
    context.current += 1
    return context.current
  }

  function isCurrent(seq: number): boolean {
    return seq === context.current
  }

  function writeDetail(next: Detail | null) {
    detailRef.current = next
    setDetail(next)
  }

  function updateDetail(patch: Partial<Detail>) {
    if (detailRef.current) writeDetail({ ...detailRef.current, ...patch })
  }

  // 받은 상품 목록을 화면 상태에 넣는다. 상품 목록 화면으로 돌아가는 것은 아래 showTourList다
  function showTours(list: TourSummary[]) {
    setTours({ status: 'loaded', list })
  }

  function showLevels(levels: TourLevelsResponse) {
    updateDetail({ levels })
  }

  function showApplyResult(result: ApplyTourResponse) {
    updateDetail({ applyResult: result, unknownApply: null, optionPanelOpen: false })
  }

  function requestCustomize() {
    updateDetail({ optionPanelOpen: true, optionMessage: null })
  }

  // 실패하면 받아 둔 목록은 그대로 두고(다시 받는 중 남은 자리 표시용), 불러오는 중이었으면 실패로 보인다.
  // quiet면 실패를 알리지 않는다(이미 다른 실패를 보이고 있을 때)
  async function loadTours(forTheme: Theme, seq: number, { quiet = false } = {}): Promise<TourSummary[] | null> {
    const request = ++toursRequest.current
    const latest = () => isCurrent(seq) && request === toursRequest.current
    try {
      const list = await getTours(forTheme)
      if (latest()) showTours(list)
      return list
    } catch (error) {
      if (latest()) {
        if (!quiet) showError(error)
        setTours((current) => (current?.status === 'loaded' ? current : { status: 'failed' }))
      }
      return null
    }
  }

  // 테마를 고르거나, 목록으로 돌아가거나, 음성으로 채운 내용을 받을 때. 목록은 받은 것이 없으면 새로 불러온다
  function resetTo(next: { theme: Theme; detail: Detail | null; message?: string | null; list?: TourSummary[] }) {
    const seq = newContext()
    setTheme(next.theme)
    writeDetail(next.detail)
    setListMessage(next.message ?? null)
    setPending(null)
    if (next.list) {
      showTours(next.list)
    } else {
      setTours({ status: 'loading' })
      void loadTours(next.theme, seq)
    }
    return seq
  }

  // 상품 목록으로 돌아가 목록을 새로 보여 준다(처음 받은 목록이면 방금 마감된 상품을 또 고를 수 있다)
  function showTourList(message: string | null, list?: TourSummary[]) {
    if (theme) resetTo({ theme, detail: null, message, list })
  }

  function selectTheme(next: Theme) {
    resetTo({ theme: next, detail: null })
  }

  async function selectTour(tourId: number) {
    const seq = newContext()
    setListMessage(null)
    writeDetail(newDetail(tourId))
    setPending('levels')
    try {
      const levels = await getLevels(tourId)
      if (isCurrent(seq)) showLevels(levels)
    } catch (error) {
      if (!isCurrent(seq)) return
      showError(error)
      // 없어진 상품(404)이면 목록을 다시 불러오고, 그 밖의 실패면 받아 둔 목록으로 돌아간다
      showTourList(null, hasStatus(error, 404) ? undefined : tourList)
    } finally {
      if (isCurrent(seq)) setPending(null)
    }
  }

  // 옵션 패널의 문구는 옵션을 다시 바꾸거나 패널을 열고 닫을 때만 지운다(되돌린 까닭이라 뒤이은 가격 계산이 지우지 않게)
  function priceArrived(result: PriceQuote, submitted: PricedSelection, optionIds: number[]) {
    updateDetail({ quote: result, submitted, optionIds, priced: true, levelMessage: null })
  }

  // 400을 받아 투어 등급과 인원을 다시 받는다. 고른 옵션은 그대로 두고, 줄어든 남은 자리를 보이려고 목록을 다시 불러온다
  async function askLevelAgain(message: string, tourId: number, seq: number) {
    updateDetail({ levelMessage: message, priced: false, optionPanelOpen: false, optionMessage: null })
    if (!theme) return
    setPending('seats')
    try {
      const list = await loadTours(theme, seq)
      if (!isCurrent(seq) || !list) return
      const tour = list.find((item) => item.tourId === tourId)
      if (!tour || !canApply(tour)) showTourList(CANNOT_APPLY_MESSAGE, list)
    } finally {
      if (isCurrent(seq)) setPending((current) => (current === 'seats' ? null : current))
    }
  }

  // 가격 계산은 하나씩 보낸다(부르는 쪽이 quoting으로 막는다). 409(더는 신청할 수 없음)는 늘 상품 목록으로 돌아간다
  async function runQuote(
    tourId: number,
    selection: PricedSelection,
    optionIds: number[],
    failure: { onBadRequest(error: ApiError, seq: number): Promise<void> | void; onOtherFailure(error: unknown): void },
  ) {
    const seq = context.current
    updateDetail({ quoting: true })
    try {
      const result = await quote(tourId, selection, optionIds)
      if (isCurrent(seq)) priceArrived(result, selection, optionIds)
    } catch (error) {
      if (!isCurrent(seq)) return
      if (hasStatus(error, 409)) showTourList(error.message)
      else if (hasStatus(error, 400)) await failure.onBadRequest(error, seq)
      else failure.onOtherFailure(error)
    } finally {
      if (isCurrent(seq)) {
        updateDetail({ quoting: false })
        if (requote.current) {
          requote.current = false
          if (detailRef.current) void selectLevel(detailRef.current)
        }
      }
    }
  }

  // 투어 등급·인원으로 가격을 계산한다(설계 5.4 selectLevel). 등급을 고르거나 인원을 치다 멈추면 부른다
  async function selectLevel(current: Detail) {
    if (applying.current || current.applyResult || current.unknownApply) return
    // 가격 계산은 하나씩 보낸다. 계산 중에 고친 입력은 그 계산이 끝난 뒤 그때의 입력으로 계산한다
    // (겹쳐 보내면 먼저 보낸 계산의 되돌리기·문구가 섞인다)
    if (current.quoting) {
      requote.current = true
      return
    }
    // 보낼 수 없는 입력의 문구는 화면이 입력에서 바로 보인다(늦게 온 응답이 지우지 못하게 저장하지 않는다).
    // 덜 고친 입력이면 지난 계산의 서버 문구·실패 표시는 지금 입력과 맞지 않아 지운다
    const check = checkSelection(current.levels, current.levelInput, current.headcountInput)
    if (!('selection' in check)) {
      updateDetail({ levelMessage: null, quoteFailed: false })
      return
    }
    const { selection } = check
    const { submitted, tourId, optionIds } = current
    if (current.priced && submitted?.level === selection.level && submitted.headcount === selection.headcount) {
      // 지난 가격의 내용으로 되돌렸다. 고친 내용의 계산 실패 표시는 지운다
      updateDetail({ quoteFailed: false })
      return
    }
    updateDetail({ levelMessage: null, quoteFailed: false })
    await runQuote(tourId, selection, optionIds, {
      onBadRequest: async (error, seq) => {
        // 옵션을 바꾸면 방금 다시 받은 이 투어 등급·인원으로 계산한다(설계 3.1)
        updateDetail({ submitted: selection })
        await askLevelAgain(error.message, tourId, seq)
      },
      // 보낸 등급·인원은 지난 가격의 것으로 남아, 바꾼 입력으로는 신청할 수 없다
      onOtherFailure: (error) => {
        showError(error)
        updateDetail({ quoteFailed: true })
      },
    })
  }

  // 인원을 치다 멈추면 그때의 입력·옵션으로 계산한다
  function scheduleQuote() {
    clearQuoteTimer()
    quoteTimer.current = setTimeout(() => {
      quoteTimer.current = null
      if (detailRef.current) void selectLevel(detailRef.current)
    }, HEADCOUNT_DELAY_MS)
  }

  function changeLevel(level: TourLevel) {
    clearQuoteTimer()
    updateDetail({ levelInput: level })
    if (detailRef.current) void selectLevel(detailRef.current)
  }

  function changeHeadcount(headcountInput: string) {
    updateDetail({ headcountInput })
    scheduleQuote()
  }

  // 인원 칸의 Enter와 다시 계산 단추. 기다리지 않고 계산한다
  function quoteNow() {
    clearQuoteTimer()
    if (detailRef.current) void selectLevel(detailRef.current)
  }

  function changeOptions(optionIds: number[]) {
    const current = detailRef.current
    if (!current?.submitted || pending || current.quoting || current.unknownApply) return
    // 가격이 나와 있으면 마지막으로 가격이 나온 옵션, 다시 받는 중이면 남겨 둔 옵션이다
    const { tourId, submitted, optionIds: previousIds } = current
    updateDetail({ optionIds, optionMessage: null })
    void runQuote(tourId, submitted, optionIds, {
      onBadRequest: async (error, seq) => {
        if (error.message === SEAT_SHORTAGE_MESSAGE) await askLevelAgain(error.message, tourId, seq)
        else updateDetail({ optionIds: previousIds, optionMessage: error.message })
      },
      onOtherFailure: (error) => {
        updateDetail({ optionIds: previousIds })
        showError(error)
      },
    })
  }

  // 신청하기와 결과 확인(설계 3.1 applyTour). 결과 확인은 들고 있던 신청을 그대로 다시 보낸다
  async function applyTour() {
    const current = detailRef.current
    if (!current || current.applyResult || current.quoting || pending || applying.current) return
    let apply: ApplyRequest
    if (current.unknownApply) {
      apply = current.unknownApply
    } else {
      if (!current.quote || !current.priced) return
      const { summary } = current.quote
      apply = {
        idempotencyKey: newIdempotencyKey(),
        request: {
          tourId: summary.tourId,
          level: summary.level,
          headcount: summary.headcount,
          optionIds: summary.options.map((option) => option.optionId),
        },
      }
    }
    applying.current = true
    const seq = context.current
    setPending('apply')
    const outcome = await ApiClient.post<ApplyTourResponse>('/api/v1/bookings', apply.request, {
      unsafeToRetry: true,
      idempotencyKey: apply.idempotencyKey,
    }).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    // 신청 요청은 끝났다. 아래에서 목록을 다시 불러오는 동안 음성 입력을 막지 않는다
    applying.current = false
    if (!isCurrent(seq)) return
    try {
      if (outcome.ok) {
        showApplyResult(outcome.result)
        // 신청 인원을 더한 남은 자리를 보인다
        if (theme) void loadTours(theme, seq)
        return
      }
      const { error } = outcome
      if (error instanceof ApiError && error.resultUnknown) {
        // 신청이 됐을 수 있어 신청하기를 다시 열지 않는다. 줄었을 남은 자리는 알림 없이 다시 불러온다
        updateDetail({ unknownApply: { ...apply, message: error.message }, optionPanelOpen: false })
        if (theme) void loadTours(theme, seq, { quiet: true })
      } else if (hasStatus(error, 400)) {
        updateDetail({ unknownApply: null })
        await askLevelAgain(error.message, apply.request.tourId, seq)
      } else if (hasStatus(error, 409)) {
        showTourList(error.message)
      } else if (hasStatus(error, 404)) {
        // 상품이 없어 신청은 되지 않았다
        showError(error)
        showTourList(null)
      } else {
        // 결과 확인이 거부됐으면(403 등) 앞 신청의 결과는 아직 모르니 신청 키를 둔다
        showError(error)
      }
    } finally {
      if (isCurrent(seq)) setPending(null)
    }
  }

  // 음성으로 채운 내용을 받아 칸을 채우고 가격을 계산한다. 이 가격 계산의 400·409는 부른 쪽에 넘긴다
  const applySelection: ApplySelection = async (selection) => {
    if (applying.current) {
      toast.error(APPLYING_MESSAGE)
      return { status: 'failed' }
    }
    // 음성 입력이 막히기 전에 누른 확인도 받지 않는다
    if (detailRef.current?.unknownApply) {
      toast.error(CHECK_RESULT_FIRST_MESSAGE)
      return { status: 'failed' }
    }
    const seq = resetTo({
      theme: selection.theme,
      detail: {
        ...newDetail(selection.tourId),
        levelInput: selection.level,
        headcountInput: String(selection.headcount),
      },
      // 같은 테마면 받아 둔 목록을 그대로 쓴다
      list: selection.theme === theme ? tourList : undefined,
    })
    setPending('levels')
    try {
      let levels: TourLevelsResponse
      try {
        levels = await getLevels(selection.tourId)
      } catch (error) {
        if (!isCurrent(seq)) return { status: 'failed' }
        showError(error)
        // 없어진 상품(404)이면 목록을 다시 불러온다(화면에서 고를 때와 같다)
        if (hasStatus(error, 404)) resetTo({ theme: selection.theme, detail: null })
        else writeDetail(null)
        return { status: 'failed' }
      }
      if (!isCurrent(seq)) return { status: 'failed' }
      showLevels(levels)
      const check = checkSelection(levels, selection.level, String(selection.headcount))
      if (!('selection' in check)) {
        return { status: 'rejected', error: new ApiError(check.message ?? LEVEL_MESSAGE, 400) }
      }
      // 이 가격 계산이 끝날 때까지 입력을 막아 둔다(pending 'levels')
      const priced = check.selection
      try {
        const result = await quote(selection.tourId, priced, [])
        if (!isCurrent(seq)) return { status: 'failed' }
        priceArrived(result, priced, [])
        return { status: 'priced' }
      } catch (error) {
        if (!isCurrent(seq)) return { status: 'failed' }
        if (hasStatus(error, 400) || hasStatus(error, 409)) return { status: 'rejected', error }
        showError(error)
        // 화면에서 다시 계산할 수 있게 한다
        updateDetail({ quoteFailed: true })
        return { status: 'failed' }
      }
    } finally {
      if (isCurrent(seq)) setPending(null)
    }
  }

  const applyBusy = pending === 'apply'
  useBlockLeaving(applyBusy, '신청이 끝날 때까지 이 화면에 있어 주세요.')

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">여행 상품 선택</h1>
        {/* 신청하는 동안 떠나면 결과를 못 보고 다시 신청할 수 있어, 화면 안의 "다른 상품 고르기"처럼 막는다 */}
        <MenuLink to={pagePaths.CustomerMainPage} label="고객 메뉴" disabled={applyBusy} />
      </header>

      {VoiceInput && <VoiceInput applySelection={applySelection} disabled={Boolean(detail?.unknownApply)} />}

      <section aria-label="테마" className="flex flex-wrap gap-2">
        {themes.map((item) => (
          <Button
            key={item.value}
            variant={theme === item.value ? 'default' : 'outline'}
            aria-pressed={theme === item.value}
            disabled={applyBusy}
            onClick={() => selectTheme(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </section>

      {!detail && (
        <section aria-label="상품 목록" className="space-y-3">
          {listMessage && (
            <Alert variant="destructive">
              <AlertDescription>{listMessage}</AlertDescription>
            </Alert>
          )}
          {!theme && <p className="text-sm text-muted-foreground">테마를 고르면 상품 목록이 나옵니다.</p>}
          {tours?.status === 'loading' && (
            <p className="text-sm text-muted-foreground">상품 목록을 불러오는 중입니다.</p>
          )}
          {tours?.status === 'failed' && (
            <div className="flex items-center gap-4">
              <p className="text-sm text-muted-foreground">상품 목록을 불러오지 못했습니다.</p>
              <Button variant="outline" onClick={() => showTourList(listMessage)}>
                다시 불러오기
              </Button>
            </div>
          )}
          {tourList && <TourList tours={tourList} onSelect={(tourId) => void selectTour(tourId)} />}
        </section>
      )}

      {detail && (
        <TourDetail
          detail={detail}
          tour={tourList?.find((item) => item.tourId === detail.tourId)}
          theme={theme}
          pending={pending}
          onBack={() => showTourList(null)}
          onChangeLevel={changeLevel}
          onChangeHeadcount={changeHeadcount}
          onQuoteNow={quoteNow}
          onConfirmPrice={() => updateDetail({ discountConfirmed: true })}
          onOpenOptions={requestCustomize}
          onChangeOptions={changeOptions}
          onFinishOptions={() => updateDetail({ optionPanelOpen: false, optionMessage: null })}
          onApply={() => void applyTour()}
        />
      )}
    </main>
  )
}

interface TourDetailProps {
  detail: Detail
  tour: TourSummary | undefined
  theme: Theme | null
  pending: Pending
  onBack(): void
  onChangeLevel(level: TourLevel): void
  onChangeHeadcount(headcount: string): void
  onQuoteNow(): void
  onConfirmPrice(): void
  onOpenOptions(): void
  onChangeOptions(optionIds: number[]): void
  onFinishOptions(): void
  onApply(): void
}

function TourDetail(props: TourDetailProps) {
  const { detail, tour, theme, pending } = props
  const { levels, quote: priceQuote, submitted, applyResult, unknownApply } = detail
  // 투어 등급·인원은 가격을 계산하는 동안에도 고칠 수 있다(막으면 치던 칸에서 커서가 빠진다)
  // 결과를 모르는 신청이 있으면 고른 내용을 바꾸지 못한다
  const locked = pending === 'levels' || pending === 'apply' || applyResult !== null || unknownApply !== null
  const busy = pending !== null || detail.quoting
  const confirming = detail.priced && priceQuote !== null && priceQuote.discount > 0 && !detail.discountConfirmed
  const headcountNow = parseHeadcount(detail.headcountInput)
  // 고친 투어 등급·인원의 가격이 아직 나오지 않았다
  const edited = submitted !== null && (detail.levelInput !== submitted.level || headcountNow !== submitted.headcount)
  const check = checkSelection(levels, detail.levelInput, detail.headcountInput)
  // 입력 검사 문구가 먼저고, 없으면 서버의 400 문구다
  const levelMessage = ('message' in check ? check.message : null) ?? detail.levelMessage
  const title = tour?.title ?? priceQuote?.summary.title ?? (theme ? themeLabel(theme) : '고른 상품')

  return (
    <section aria-label="고른 상품" className="space-y-4">
      <Button variant="ghost" onClick={props.onBack} disabled={pending === 'apply'}>
        다른 상품 고르기
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {tour && (
            <p className="text-sm text-muted-foreground">
              {formatDate(tour.departureDate)} 출발 · {tour.duration}일
            </p>
          )}
        </CardHeader>
        <CardContent>
          {!levels && <p className="text-sm text-muted-foreground">투어 등급을 불러오는 중입니다.</p>}
          {levels && (
            <form className="space-y-4" onSubmit={(event) => event.preventDefault()} noValidate>
              <p className="text-sm text-muted-foreground">
                모든 등급에 포함: {levels.service} · {levels.souvenir} · {levels.vehicle}
              </p>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">투어 등급</legend>
                <RadioGroup
                  value={detail.levelInput ?? ''}
                  onValueChange={(value) => props.onChangeLevel(value as TourLevel)}
                  disabled={locked}
                >
                  {levels.levels.map((item) => (
                    <div key={item.level} className="flex items-start gap-2">
                      <RadioGroupItem id={`level-${item.level}`} value={item.level} className="mt-0.5" />
                      <Label htmlFor={`level-${item.level}`} className="flex flex-col items-start gap-1">
                        <span>
                          {item.name} · 1인 {formatWon(item.price)}
                        </span>
                        <span className="text-muted-foreground">
                          {item.hotelGrade}등급 호텔 · {item.meal} · 샴페인 {item.includesChampagne ? '포함' : '없음'}
                        </span>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="headcount">인원</Label>
                <Input
                  id="headcount"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={detail.headcountInput}
                  onChange={(event) => props.onChangeHeadcount(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    props.onQuoteNow()
                  }}
                  disabled={locked}
                  className="w-32"
                />
                {tour && <p className="text-sm text-muted-foreground">남은 자리 {tour.remainingSeats}명</p>}
              </div>
              {levelMessage && (
                <Alert variant="destructive">
                  <AlertDescription>{levelMessage}</AlertDescription>
                </Alert>
              )}
              {detail.quoting && <p className="text-sm text-muted-foreground">가격을 계산하는 중입니다.</p>}
              {!detail.quoting && detail.quoteFailed && (
                <div className="flex items-center gap-4">
                  <p className="text-sm text-muted-foreground">고친 투어 등급·인원으로 가격을 계산하지 못했습니다.</p>
                  <Button type="button" variant="outline" onClick={props.onQuoteNow} disabled={locked}>
                    다시 계산
                  </Button>
                </div>
              )}
              {!detail.quoting && !detail.quoteFailed && !detail.priced && !levelMessage && (
                <p className="text-sm text-muted-foreground">투어 등급과 인원을 고르면 가격이 나옵니다.</p>
              )}
            </form>
          )}
        </CardContent>
      </Card>

      {detail.priced && priceQuote && (
        <PriceSummary quote={priceQuote} confirming={confirming} onConfirmPrice={props.onConfirmPrice} />
      )}

      {submitted && !confirming && !applyResult && !unknownApply && !detail.optionPanelOpen && (
        <Button variant="outline" onClick={props.onOpenOptions} disabled={busy}>
          옵션 바꾸기
        </Button>
      )}

      {/* 단골 할인을 확인받는 동안은 옵션을 바꾸지 않는다 */}
      {submitted && detail.optionPanelOpen && !applyResult && !confirming && (
        <OptionPanel
          key={`${detail.tourId}:${submitted.level}`}
          tourId={detail.tourId}
          level={submitted.level}
          levelDetail={levels?.levels.find((item) => item.level === submitted.level)}
          optionIds={detail.optionIds}
          price={detail.priced && priceQuote ? priceQuote.finalPrice : null}
          message={detail.optionMessage}
          disabled={busy}
          onChangeOptions={props.onChangeOptions}
          onFinish={props.onFinishOptions}
        />
      )}

      {applyResult && (
        <Alert>
          <AlertDescription>
            신청했습니다. 지금 상품 상태는 ‘{tourStatusLabel(applyResult.status)}’입니다.
          </AlertDescription>
        </Alert>
      )}

      {unknownApply && (
        <div className="space-y-2">
          <Alert variant="destructive">
            <AlertDescription>{unknownApply.message}</AlertDescription>
          </Alert>
          <Button onClick={props.onApply} disabled={pending !== null}>
            {pending === 'apply' ? '결과를 확인하는 중' : '결과 확인'}
          </Button>
        </div>
      )}

      {!unknownApply && detail.priced && priceQuote && !confirming && !applyResult && (
        <div className="space-y-2">
          <Button onClick={props.onApply} disabled={busy || edited}>
            {pending === 'apply' ? '신청하는 중' : '신청하기'}
          </Button>
        </div>
      )}
    </section>
  )
}
