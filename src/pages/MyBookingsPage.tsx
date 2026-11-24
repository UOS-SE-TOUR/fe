import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { MenuLink } from '@/components/MenuLink'
import { OptionPanel } from '@/components/OptionPanel'
import { PriceSummary } from '@/components/PriceSummary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { formatDate, formatWon } from '@/lib/format'
import { tourStatusLabel, type TourLevel } from '@/lib/labels'
import { pagePaths } from '@/lib/pages'
import {
  hasBookingDetails,
  isMyBooking,
  isPriceQuote,
  type BookingDetails,
  type LevelDetail,
  type MyBookingResponse,
  type OptionCategory,
  type PriceQuote,
  type TourLevelsResponse,
} from '@/lib/tours'
import { ApiClient, ApiError, hasStatus, showError } from '@/modules/ApiClient'

type MyBookingsState =
  { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; bookings: MyBookingResponse[] }

// 바꿀 내용. be ChangeBookingRequest와 같은 모양이다
interface ChangeChoice {
  level: TourLevel
  optionIds: number[]
}

// 바꾸기 창 하나의 상태. 창을 열 때마다 새로 만든다
interface ChangeState {
  booking: MyBookingResponse
  // 그 상품에서 고를 수 있는 투어 등급. 불러오는 동안 null
  levels: LevelDetail[] | null
  // 창에 골라 둔 내용. 가격을 계산하는 동안은 보낸 내용이다
  choice: ChangeChoice
  // 마지막으로 가격이 나온 내용(처음에는 창을 열 때의 내용). 가격 계산·저장이 실패하면 이것으로 되돌린다
  priced: ChangeChoice
  quote: PriceQuote | null
  // 400 문구
  message: string | null
  // 기다리는 요청. 있으면 고른 내용을 바꾸지 못한다
  sending: 'levels' | 'quote' | 'save' | null
}

type Outcome = { ok: true; body: unknown } | { ok: false; error: unknown }

function send(request: Promise<unknown>): Promise<Outcome> {
  return request.then(
    (body) => ({ ok: true, body }),
    (error: unknown) => ({ ok: false, error }),
  )
}

function hasLevels(value: unknown): value is TourLevelsResponse {
  return typeof value === 'object' && value !== null && Array.isArray((value as Partial<TourLevelsResponse>).levels)
}

const categoryLabels: [OptionCategory, string][] = [
  ['HOTEL', '호텔'],
  ['TRANSPORT', '교통'],
  ['MEAL', '식사'],
  ['EXTRA', '추가 옵션'],
]

const appliedTimeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

// 신청 한 줄을 펼쳐 보는 상세 내용. 고르지 않아 등급이 기본으로 주는 옵션은 "(기본 제공)"을 붙인다
function BookingDetailList({ booking }: { booking: BookingDetails }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">자세히 보기</summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">신청한 때</dt>
        <dd>{appliedTimeFormat.format(new Date(booking.appliedAt))}</dd>
        {categoryLabels.map(([category, label]) => {
          const names = booking.options
            .filter((option) => option.category === category)
            .map((option) => (option.chosen ? option.name : `${option.name}(기본 제공)`))
          if (names.length === 0) return null
          return (
            <Fragment key={category}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{names.join(', ')}</dd>
            </Fragment>
          )
        })}
        <dt className="text-muted-foreground">가격</dt>
        <dd>
          {booking.discount > 0
            ? `${formatWon(booking.totalPrice)} − 할인 ${formatWon(booking.discount)} = ${formatWon(booking.finalPrice)}`
            : formatWon(booking.finalPrice)}
        </dd>
      </dl>
    </details>
  )
}

// 모집 중일 때만 보인다
function toConfirmLine(booking: MyBookingResponse): string | null {
  if (booking.status !== 'RECRUITING' || booking.headcountToConfirm <= 0) return null
  return `확정까지 ${booking.headcountToConfirm}명`
}

// 기간은 상품 이름("… 11/30 출발 1일")에 들어 있어 따로 보이지 않는다
export function MyBookingsPage() {
  const [bookingsState, setBookingsState] = useState<MyBookingsState>({ status: 'loading' })
  const loadSeq = useRef(0)
  // 닫을 때 내용이 먼저 사라지지 않게, 연 신청은 닫아도 남겨 둔다
  const [change, setChange] = useState<ChangeState | null>(null)
  const [changeOpen, setChangeOpen] = useState(false)
  // 바꾸기 창의 최신 상태. 응답을 받는 자리에서 다시 그리기 전에도 최신 값을 읽는다
  const changeRef = useRef<ChangeState | null>(null)
  // 창을 닫거나 다시 열거나 화면을 떠나면 올린다. 그 전에 보낸 요청의 응답은 버린다
  const changeSeq = useRef(0)

  // 늦게 온 앞선 응답은 버린다(다시 불러온 목록을 덮지 않게)
  const loadMyBookings = useCallback(() => {
    const seq = ++loadSeq.current
    ApiClient.get<unknown>('/api/v1/bookings').then(
      (bookings) => {
        if (seq !== loadSeq.current) return
        // 성공 응답인데 본문이 목록이 아니면(빈 본문 등) 못 읽은 것으로 다룬다
        if (!Array.isArray(bookings) || !bookings.every(isMyBooking)) {
          setBookingsState({ status: 'failed' })
          showError(new Error('내 신청 응답이 신청 배열이 아니다'))
          return
        }
        setBookingsState({ status: 'loaded', bookings })
      },
      (error: unknown) => {
        if (seq !== loadSeq.current) return
        setBookingsState({ status: 'failed' })
        showError(error)
      },
    )
  }, [])

  function reload() {
    setBookingsState({ status: 'loading' })
    loadMyBookings()
  }

  useEffect(() => {
    loadMyBookings()
    // 화면을 떠난 뒤 온 응답은 버린다(다른 화면에 실패 알림이 뜨지 않게)
    return () => {
      loadSeq.current += 1
      changeSeq.current += 1
    }
  }, [loadMyBookings])

  function writeChange(next: ChangeState) {
    changeRef.current = next
    setChange(next)
  }

  function updateChange(seq: number, patch: Partial<ChangeState>) {
    if (seq === changeSeq.current && changeRef.current) writeChange({ ...changeRef.current, ...patch })
  }

  function closeChange() {
    changeSeq.current += 1
    setChangeOpen(false)
  }

  // 창을 닫고 목록을 다시 불러온다. 409·404는 바꿀 수 없게 된 신청이고, 저장의 그 밖의 실패는 실제로는 바뀌었을 수 있다
  function closeAndReload(error: unknown) {
    showError(error)
    closeChange()
    // 401·403은 ApiClient가 이미 알렸고, 다시 불러와도 같은 실패다
    if (!(error instanceof ApiError && error.handled)) reload()
  }

  // 창을 열고 고를 수 있는 투어 등급을 불러온 뒤, 지금 내용으로 가격을 계산한다
  async function openChange(booking: MyBookingResponse) {
    const seq = ++changeSeq.current
    const choice: ChangeChoice = { level: booking.level, optionIds: booking.optionIds }
    writeChange({ booking, levels: null, choice, priced: choice, quote: null, message: null, sending: 'levels' })
    setChangeOpen(true)
    const outcome = await send(ApiClient.get<unknown>(`/api/v1/tours/${booking.tourId}/levels`))
    if (seq !== changeSeq.current) return
    if (!outcome.ok || !hasLevels(outcome.body)) {
      showError(outcome.ok ? new Error('투어 등급 응답이 등급 목록이 아니다') : outcome.error)
      closeChange()
      return
    }
    updateChange(seq, { levels: outcome.body.levels, sending: null })
    await quoteChange(choice, { opening: true })
  }

  // 바꿀 내용으로 가격을 계산한다. 저장하지 않는다
  async function quoteChange(choice: ChangeChoice, { opening = false }: { opening?: boolean } = {}) {
    const current = changeRef.current
    if (!current || current.sending) return
    const seq = changeSeq.current
    const { booking, priced } = current
    updateChange(seq, { choice, message: null, sending: 'quote' })
    const outcome = await send(ApiClient.post<unknown>(`/api/v1/bookings/${booking.bookingId}/quote`, choice))
    if (seq !== changeSeq.current) return
    if (outcome.ok && isPriceQuote(outcome.body)) {
      updateChange(seq, { quote: outcome.body, priced: choice, sending: null })
      return
    }
    const error = outcome.ok ? new Error('신청 바꾸기 가격 계산 응답이 가격이 아니다') : outcome.error
    if (hasStatus(error, 409) || hasStatus(error, 404)) {
      closeAndReload(error)
    } else if (hasStatus(error, 400)) {
      updateChange(seq, { choice: priced, message: error.message, sending: null })
    } else {
      showError(error)
      if (opening) closeChange()
      else updateChange(seq, { choice: priced, sending: null })
    }
  }

  // 창에 골라 둔 내용으로 신청을 바꾼다. 같은 내용을 다시 보내도 결과가 같아 신청 키를 쓰지 않는다
  async function saveChange() {
    const current = changeRef.current
    if (!current || current.sending) return
    const seq = changeSeq.current
    const { booking, choice, priced } = current
    updateChange(seq, { message: null, sending: 'save' })
    const outcome = await send(ApiClient.post<unknown>(`/api/v1/bookings/${booking.bookingId}/change`, choice))
    if (seq !== changeSeq.current) return
    if (outcome.ok && isMyBooking(outcome.body)) {
      const changed = outcome.body
      closeChange()
      setBookingsState((prev) =>
        prev.status === 'loaded'
          ? { ...prev, bookings: prev.bookings.map((row) => (row.bookingId === changed.bookingId ? changed : row)) }
          : prev,
      )
      toast.success('신청 내용을 바꿨습니다.')
      return
    }
    const error = outcome.ok ? new Error('신청 바꾸기 응답이 신청이 아니다') : outcome.error
    if (hasStatus(error, 400)) updateChange(seq, { choice: priced, message: error.message, sending: null })
    else closeAndReload(error)
  }

  // 저장하는 동안에는 닫지 않는다(Esc·바깥 누르기)
  function handleChangeOpenChange(open: boolean) {
    if (!open && changeRef.current?.sending !== 'save') closeChange()
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">내 신청</h1>
        <MenuLink to={pagePaths.CustomerMainPage} label="고객 메뉴" disabled={false} />
      </header>

      <section className="panel flex flex-col gap-4" aria-label="신청 목록">
        {bookingsState.status === 'loading' && (
          <p className="text-sm text-muted-foreground">내 신청을 불러오는 중입니다.</p>
        )}
        {bookingsState.status === 'failed' && (
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">내 신청을 불러오지 못했습니다.</p>
            <Button variant="outline" size="sm" onClick={reload}>
              다시 불러오기
            </Button>
          </div>
        )}
        {bookingsState.status === 'loaded' && bookingsState.bookings.length === 0 && (
          <p className="text-sm text-muted-foreground">신청한 여행이 없습니다.</p>
        )}
        {bookingsState.status === 'loaded' && bookingsState.bookings.length > 0 && (
          <ul className="divide-y">
            {bookingsState.bookings.map((booking) => {
              const toConfirm = toConfirmLine(booking)
              return (
                <li
                  key={booking.bookingId}
                  className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold">{booking.title}</p>
                    <p className="text-muted-foreground">
                      {formatDate(booking.departureDate)} 출발 · {booking.levelName} · {booking.headcount}명
                    </p>
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge variant={booking.status === 'CONFIRMED' ? 'default' : 'secondary'}>
                        {tourStatusLabel(booking.status)}
                      </Badge>
                      {toConfirm && <span className="text-sm text-muted-foreground">{toConfirm}</span>}
                    </p>
                    {hasBookingDetails(booking) && <BookingDetailList booking={booking} />}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <p className="font-semibold">{formatWon(booking.finalPrice)}</p>
                    {booking.changeable && (
                      <Button variant="outline" size="sm" onClick={() => void openChange(booking)}>
                        바꾸기
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Dialog open={changeOpen} onOpenChange={handleChangeOpenChange}>
        <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          {change && (
            <ChangeDialogBody
              change={change}
              onChangeLevel={(level) => void quoteChange({ level, optionIds: change.choice.optionIds })}
              onChangeOptions={(optionIds) => void quoteChange({ level: change.choice.level, optionIds })}
              onSave={() => void saveChange()}
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  )
}

interface ChangeDialogBodyProps {
  change: ChangeState
  onChangeLevel(level: TourLevel): void
  onChangeOptions(optionIds: number[]): void
  onSave(): void
}

function ChangeDialogBody({ change, onChangeLevel, onChangeOptions, onSave }: ChangeDialogBodyProps) {
  const { booking, levels, choice, quote, sending } = change
  return (
    <>
      <DialogHeader>
        <DialogTitle>신청 바꾸기</DialogTitle>
        <DialogDescription>
          {booking.title} · {formatDate(booking.departureDate)} 출발 · {booking.headcount}명
        </DialogDescription>
        <p className="text-sm text-muted-foreground">상품과 인원은 바꿀 수 없습니다.</p>
      </DialogHeader>

      {!levels && <p className="text-sm text-muted-foreground">투어 등급을 불러오는 중입니다.</p>}
      {levels && (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">투어 등급</legend>
            <RadioGroup
              value={choice.level}
              onValueChange={(value) => onChangeLevel(value as TourLevel)}
              disabled={sending !== null}
            >
              {levels.map((item) => (
                <div key={item.level} className="flex items-start gap-3">
                  <RadioGroupItem id={`change-level-${item.level}`} value={item.level} className="mt-0.5" />
                  <Label htmlFor={`change-level-${item.level}`} className="flex flex-col items-start gap-1">
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

          {/* 이 창에서는 단골 할인을 따로 확인받지 않는다 */}
          {quote && <PriceSummary quote={quote} confirming={false} onConfirmPrice={() => {}} />}

          <OptionPanel
            key={`${booking.bookingId}:${choice.level}`}
            tourId={booking.tourId}
            level={choice.level}
            levelDetail={levels.find((item) => item.level === choice.level)}
            optionIds={choice.optionIds}
            price={quote?.finalPrice ?? null}
            message={change.message}
            disabled={sending !== null}
            onChangeOptions={onChangeOptions}
            onFinish={onSave}
            finishLabel="바꾸기 저장"
          />
        </>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={sending === 'save'}>
            그만두기
          </Button>
        </DialogClose>
      </DialogFooter>
    </>
  )
}
