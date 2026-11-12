import { useRef, useState, type ComponentType, type FormEvent } from 'react'
import { Link } from 'react-router'
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
import {
  canApply,
  type ApplyTourResponse,
  type PriceQuote,
  type QuoteRequest,
  type TourLevelsResponse,
  type TourSummary,
} from '@/lib/tours'
import { ApiClient, ApiError, showError } from '@/modules/ApiClient'

// 음성(VoiceInputPanel)이 채운 내용
export interface VoiceSelection {
  theme: Theme
  tourId: number
  level: TourLevel
  headcount: number
}

// applySelection 직후의 가격 계산 결과. rejected(400·409)는 VoiceInputPanel이 문구를 보여 주고 다시 말하게 한다.
// failed는 그 밖의 실패로, 이 화면이 이미 알렸다
export type ApplySelectionResult = { status: 'priced' } | { status: 'rejected'; error: ApiError } | { status: 'failed' }
export type ApplySelection = (selection: VoiceSelection) => Promise<ApplySelectionResult>

// 서버(be Tour.checkSeats)의 문구. 옵션을 바꿀 때 이 400이면 투어 등급과 인원을 다시 받는다(설계 5.6)
const SEAT_SHORTAGE_MESSAGE = '남은 자리보다 인원이 많습니다.'
const CANNOT_APPLY_MESSAGE = '더는 신청할 수 없는 상품입니다. 다른 상품을 골라 주세요.'
const HEADCOUNT_MESSAGE = '인원은 1 이상의 정수로 입력해 주세요.'
const LEVEL_MESSAGE = '투어 등급을 골라 주세요.'
// be가 받는 인원(Integer)의 최댓값
const MAX_HEADCOUNT = 2_147_483_647

interface PricedSelection {
  level: TourLevel
  headcount: number
}

// 고른 상품 하나의 상태. 상품을 다시 고르면 새로 만들어, 고른 옵션과 지난 가격이 함께 비워진다
interface Detail {
  tourId: number
  levels: TourLevelsResponse | null
  levelInput: TourLevel | null
  headcountInput: string
  // 마지막으로 가격 계산에 보낸 투어 등급·인원. 옵션을 바꾸면 이것으로 가격을 계산한다
  submitted: PricedSelection | null
  optionIds: number[]
  // 이 상품에서 마지막으로 나온 가격. 신청은 이 고른 내용으로 보낸다
  quote: PriceQuote | null
  // quote가 지금 고른 투어 등급·인원·옵션의 가격이다(다시 받는 중이면 false)
  priced: boolean
  discountConfirmed: boolean
  optionPanelOpen: boolean
  levelMessage: string | null
  optionMessage: string | null
  applyResult: ApplyTourResponse | null
}

type Pending = 'levels' | 'quote' | 'seats' | 'apply' | null

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
    discountConfirmed: false,
    optionPanelOpen: false,
    levelMessage: null,
    optionMessage: null,
    applyResult: null,
  }
}

function parseHeadcount(input: string): number | null {
  const trimmed = input.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value >= 1 && value <= MAX_HEADCOUNT ? value : null
}

function hasStatus(error: unknown, status: number): error is ApiError {
  return error instanceof ApiError && error.status === status
}

function getTours(theme: Theme): Promise<TourSummary[]> {
  return ApiClient.get<TourSummary[]>(`/api/v1/tours?theme=${theme}`)
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
              <span className="block text-muted-foreground">
                {formatDate(tour.departureDate)} 출발 · {tour.duration}일 · 남은 자리 {tour.remainingSeats}명
              </span>
            </span>
            <Badge variant={canApply(tour) ? 'secondary' : 'outline'}>{tourStatusLabel(tour.status)}</Badge>
          </Button>
        </li>
      ))}
    </ul>
  )
}

interface TourSelectPageProps {
  // 음성 입력 부품(VoiceInputPanel, #7)을 넣을 자리. applySelection을 넘겨받는다
  voiceInput?: ComponentType<{ applySelection: ApplySelection }>
}

export function TourSelectPage({ voiceInput: VoiceInput }: TourSelectPageProps = {}) {
  const [theme, setTheme] = useState<Theme | null>(null)
  // null이면 불러오는 중이다
  const [tours, setTours] = useState<TourSummary[] | null>(null)
  const [listMessage, setListMessage] = useState<string | null>(null)
  // null이면 상품 목록을 보여 준다
  const [detail, setDetail] = useState<Detail | null>(null)
  // 고른 상품 안의 요청은 하나씩만 보낸다. 그동안 입력을 막는다
  const [pending, setPending] = useState<Pending>(null)
  // 테마·상품을 다시 고르거나 목록으로 돌아가면 올린다. 그 전에 보낸 요청의 응답은 버린다
  const context = useRef(0)
  // 신청 단추를 빠르게 두 번 눌러도 신청은 한 번만 나간다
  const applying = useRef(false)

  function newContext(): number {
    context.current += 1
    return context.current
  }

  function isCurrent(seq: number): boolean {
    return seq === context.current
  }

  function updateDetail(patch: Partial<Detail>) {
    setDetail((current) => (current ? { ...current, ...patch } : current))
  }

  async function loadTours(forTheme: Theme, seq: number): Promise<TourSummary[] | null> {
    try {
      const list = await getTours(forTheme)
      if (isCurrent(seq)) setTours(list)
      return list
    } catch (error) {
      if (isCurrent(seq)) showError(error)
      return null
    }
  }

  // 상품 목록으로 돌아가 목록을 새로 보여 준다(처음 받은 목록이면 방금 마감된 상품을 또 고를 수 있다)
  function showTourList(message: string | null, list?: TourSummary[]) {
    const seq = newContext()
    setDetail(null)
    setListMessage(message)
    setPending(null)
    if (list) {
      setTours(list)
    } else if (theme) {
      setTours(null)
      void loadTours(theme, seq)
    }
  }

  function selectTheme(next: Theme) {
    const seq = newContext()
    setTheme(next)
    setTours(null)
    setListMessage(null)
    setDetail(null)
    setPending(null)
    void loadTours(next, seq)
  }

  async function selectTour(tourId: number) {
    const seq = newContext()
    setListMessage(null)
    setDetail(newDetail(tourId))
    setPending('levels')
    try {
      const levels = await getLevels(tourId)
      if (isCurrent(seq)) updateDetail({ levels })
    } catch (error) {
      if (!isCurrent(seq)) return
      showError(error)
      showTourList(null)
    } finally {
      if (isCurrent(seq)) setPending(null)
    }
  }

  function priceArrived(result: PriceQuote, optionIds: number[]) {
    updateDetail({ quote: result, optionIds, priced: true, levelMessage: null, optionMessage: null })
  }

  // 400을 받아 투어 등급과 인원을 다시 받는다. 고른 옵션은 그대로 두고, 줄어든 남은 자리를 보이려고 목록을 다시 불러온다
  async function askLevelAgain(message: string, tourId: number, seq: number) {
    updateDetail({ levelMessage: message, priced: false, optionPanelOpen: false, optionMessage: null })
    if (!theme) return
    setPending('seats')
    const list = await loadTours(theme, seq)
    if (!isCurrent(seq) || !list) return
    const tour = list.find((item) => item.tourId === tourId)
    if (!tour || !canApply(tour)) showTourList(CANNOT_APPLY_MESSAGE, list)
  }

  async function selectLevel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail || pending) return
    if (!detail.levelInput) {
      updateDetail({ levelMessage: LEVEL_MESSAGE })
      return
    }
    const headcount = parseHeadcount(detail.headcountInput)
    if (headcount === null) {
      updateDetail({ levelMessage: HEADCOUNT_MESSAGE })
      return
    }
    const seq = context.current
    const selection = { level: detail.levelInput, headcount }
    const { tourId, optionIds } = detail
    updateDetail({ submitted: selection, levelMessage: null })
    setPending('quote')
    try {
      const result = await quote(tourId, selection, optionIds)
      if (isCurrent(seq)) priceArrived(result, optionIds)
    } catch (error) {
      if (!isCurrent(seq)) return
      if (hasStatus(error, 400)) await askLevelAgain(error.message, tourId, seq)
      else if (hasStatus(error, 409)) showTourList(error.message)
      else showError(error)
    } finally {
      if (isCurrent(seq)) setPending(null)
    }
  }

  async function changeOptions(optionIds: number[]) {
    if (!detail?.submitted || pending) return
    const seq = context.current
    const { tourId, submitted } = detail
    const lastPricedIds = detail.quote?.summary.options.map((option) => option.optionId) ?? []
    updateDetail({ optionIds, optionMessage: null })
    setPending('quote')
    try {
      const result = await quote(tourId, submitted, optionIds)
      if (isCurrent(seq)) priceArrived(result, optionIds)
    } catch (error) {
      if (!isCurrent(seq)) return
      if (hasStatus(error, 400) && error.message === SEAT_SHORTAGE_MESSAGE) {
        await askLevelAgain(error.message, tourId, seq)
      } else if (hasStatus(error, 409)) {
        showTourList(error.message)
      } else {
        updateDetail({ optionIds: lastPricedIds, optionMessage: hasStatus(error, 400) ? error.message : null })
        if (!hasStatus(error, 400)) showError(error)
      }
    } finally {
      if (isCurrent(seq)) setPending(null)
    }
  }

  async function applyTour() {
    if (!detail?.quote || !detail.priced || pending || applying.current) return
    applying.current = true
    const seq = context.current
    const { summary } = detail.quote
    setPending('apply')
    try {
      const result = await ApiClient.post<ApplyTourResponse>(
        '/api/v1/bookings',
        {
          tourId: summary.tourId,
          level: summary.level,
          headcount: summary.headcount,
          optionIds: summary.options.map((option) => option.optionId),
        } satisfies QuoteRequest,
        { unsafeToRetry: true },
      )
      if (isCurrent(seq)) updateDetail({ applyResult: result, optionPanelOpen: false })
    } catch (error) {
      if (!isCurrent(seq)) return
      // 신청이 이미 됐을 수 있어 단추를 다시 열지 않는다
      if (error instanceof ApiError && error.resultUnknown) showTourList(error.message)
      else if (hasStatus(error, 400)) await askLevelAgain(error.message, summary.tourId, seq)
      else if (hasStatus(error, 409)) showTourList(error.message)
      else showError(error)
    } finally {
      applying.current = false
      if (isCurrent(seq)) setPending(null)
    }
  }

  // 음성으로 채운 내용을 받아 칸을 채우고 가격을 계산한다. 이 가격 계산의 400·409는 부른 쪽에 넘긴다
  const applySelection: ApplySelection = async (selection) => {
    if (applying.current) return { status: 'failed' }
    const seq = newContext()
    setTheme(selection.theme)
    setTours(null)
    setListMessage(null)
    setDetail({
      ...newDetail(selection.tourId),
      levelInput: selection.level,
      headcountInput: String(selection.headcount),
    })
    setPending('levels')
    try {
      let loaded: [TourSummary[], TourLevelsResponse]
      try {
        loaded = await Promise.all([getTours(selection.theme), getLevels(selection.tourId)])
      } catch (error) {
        if (!isCurrent(seq)) return { status: 'failed' }
        showError(error)
        setDetail(null)
        return { status: 'failed' }
      }
      if (!isCurrent(seq)) return { status: 'failed' }
      const [list, levels] = loaded
      const priced = { level: selection.level, headcount: selection.headcount }
      setTours(list)
      updateDetail({ levels, submitted: priced })
      setPending('quote')
      try {
        const result = await quote(selection.tourId, priced, [])
        if (!isCurrent(seq)) return { status: 'failed' }
        priceArrived(result, [])
        return { status: 'priced' }
      } catch (error) {
        if (!isCurrent(seq)) return { status: 'failed' }
        if (hasStatus(error, 400) || hasStatus(error, 409)) return { status: 'rejected', error }
        showError(error)
        return { status: 'failed' }
      }
    } finally {
      if (isCurrent(seq)) setPending(null)
    }
  }

  const applyBusy = pending === 'apply'

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">여행 상품 선택</h1>
        <Button variant="ghost" asChild>
          <Link to={pagePaths.CustomerMainPage}>고객 첫 화면</Link>
        </Button>
      </header>

      {VoiceInput && <VoiceInput applySelection={applySelection} />}

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
          {theme && !tours && <p className="text-sm text-muted-foreground">상품 목록을 불러오는 중입니다.</p>}
          {theme && tours && <TourList tours={tours} onSelect={(tourId) => void selectTour(tourId)} />}
        </section>
      )}

      {detail && (
        <TourDetail
          detail={detail}
          tour={tours?.find((item) => item.tourId === detail.tourId)}
          theme={theme}
          pending={pending}
          onBack={() => showTourList(null)}
          onLevelInput={(levelInput) => updateDetail({ levelInput })}
          onHeadcountInput={(headcountInput) => updateDetail({ headcountInput })}
          onSelectLevel={(event) => void selectLevel(event)}
          onConfirmPrice={() => updateDetail({ discountConfirmed: true })}
          onOpenOptions={() => updateDetail({ optionPanelOpen: true, optionMessage: null })}
          onChangeOptions={(optionIds) => void changeOptions(optionIds)}
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
  onLevelInput(level: TourLevel): void
  onHeadcountInput(headcount: string): void
  onSelectLevel(event: FormEvent<HTMLFormElement>): void
  onConfirmPrice(): void
  onOpenOptions(): void
  onChangeOptions(optionIds: number[]): void
  onFinishOptions(): void
  onApply(): void
}

function TourDetail(props: TourDetailProps) {
  const { detail, tour, theme, pending } = props
  const { levels, quote: priceQuote, submitted, applyResult } = detail
  const locked = pending !== null || applyResult !== null
  const confirming = detail.priced && priceQuote !== null && priceQuote.discount > 0 && !detail.discountConfirmed
  const headcountNow = parseHeadcount(detail.headcountInput)
  // 고친 투어 등급·인원의 가격을 아직 보지 않았다
  const edited = submitted !== null && (detail.levelInput !== submitted.level || headcountNow !== submitted.headcount)
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
              {formatDate(tour.departureDate)} 출발 · {tour.duration}일 · 남은 자리 {tour.remainingSeats}명
            </p>
          )}
        </CardHeader>
        <CardContent>
          {!levels && <p className="text-sm text-muted-foreground">투어 등급을 불러오는 중입니다.</p>}
          {levels && (
            <form className="space-y-4" onSubmit={props.onSelectLevel} noValidate>
              <p className="text-sm text-muted-foreground">
                모든 등급에 포함: {levels.service} · {levels.souvenir} · {levels.vehicle}
              </p>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">투어 등급</legend>
                <RadioGroup
                  value={detail.levelInput ?? ''}
                  onValueChange={(value) => props.onLevelInput(value as TourLevel)}
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
                  onChange={(event) => props.onHeadcountInput(event.target.value)}
                  disabled={locked}
                  className="w-32"
                />
                {tour && <p className="text-sm text-muted-foreground">남은 자리 {tour.remainingSeats}명</p>}
              </div>
              {detail.levelMessage && (
                <Alert variant="destructive">
                  <AlertDescription>{detail.levelMessage}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={locked}>
                가격 보기
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {detail.priced && priceQuote && (
        <PriceSummary quote={priceQuote} confirming={confirming} onConfirmPrice={props.onConfirmPrice} />
      )}

      {submitted && !confirming && !applyResult && !detail.optionPanelOpen && (
        <Button variant="outline" onClick={props.onOpenOptions} disabled={pending !== null}>
          옵션 바꾸기
        </Button>
      )}

      {submitted && detail.optionPanelOpen && !applyResult && (
        <OptionPanel
          tourId={detail.tourId}
          level={submitted.level}
          levelDetail={levels?.levels.find((item) => item.level === submitted.level)}
          optionIds={detail.optionIds}
          price={detail.priced && priceQuote ? priceQuote.finalPrice : null}
          message={detail.optionMessage}
          disabled={pending !== null}
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

      {detail.priced && priceQuote && !confirming && !applyResult && (
        <div className="space-y-2">
          {edited && <p className="text-sm text-muted-foreground">바꾼 투어 등급·인원으로 가격을 다시 봐 주세요.</p>}
          <Button onClick={props.onApply} disabled={pending !== null || edited}>
            {pending === 'apply' ? '신청하는 중' : '신청하기'}
          </Button>
        </div>
      )}
    </section>
  )
}
