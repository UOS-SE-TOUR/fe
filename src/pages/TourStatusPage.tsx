import { useCallback, useEffect, useRef, useState } from 'react'
import { MenuLink } from '@/components/MenuLink'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { tourStatusLabel } from '@/lib/labels'
import { pagePaths } from '@/lib/pages'
import { useBlockLeaving } from '@/lib/useBlockLeaving'
import { ApiClient, ApiError, showError, unknownResult } from '@/modules/ApiClient'

const TOURS_PATH = '/api/v1/staff/tours'

const seoulDateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// 서울 날짜를 서버의 출발일과 같은 꼴(YYYY-MM-DD)로 만든다. 로캘 기본 꼴에 기대지 않고 연·월·일을 뽑아 잇는다
function seoulToday(): string {
  const parts = seoulDateParts.formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

// be의 StaffTourSummary
interface StaffTour {
  tourId: number
  title: string
  // YYYY-MM-DD
  departureDate: string
  capacity: number
  appliedCount: number
  status: string
}

type ToursState = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; tours: StaffTour[] }

type Action = 'confirm' | 'cancel'

const actionLabels: Record<Action, string> = { confirm: '확정 처리', cancel: '취소 처리' }

function isStaffTour(value: unknown): value is StaffTour {
  if (typeof value !== 'object' || value === null) return false
  const { tourId, title, departureDate, capacity, appliedCount, status } = value as Partial<StaffTour>
  return (
    typeof tourId === 'number' &&
    typeof title === 'string' &&
    typeof departureDate === 'string' &&
    typeof capacity === 'number' &&
    typeof appliedCount === 'number' &&
    typeof status === 'string'
  )
}

// 그 상품에 할 수 있는 처리(be의 Tour.confirmByStaff·cancelByStaff와 같다). today는 서울 날짜(YYYY-MM-DD)
function actionOf(tour: StaffTour, today: string): Action | null {
  if (tour.status === 'RECRUITING' && tour.appliedCount > 0 && tour.departureDate > today) return 'confirm'
  if (tour.status === 'IN_PROGRESS' || tour.status === 'COMPLETED') return 'cancel'
  return null
}

const nextStatus: Record<Action, string> = { confirm: 'CONFIRMED', cancel: 'CANCELLED' }

export function TourStatusPage() {
  const [toursState, setToursState] = useState<ToursState>({ status: 'loading' })
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  // 닫을 때 내용이 먼저 사라지지 않게, 연 상품은 닫아도 남겨 둔다
  const [dialog, setDialog] = useState<{ action: Action; tour: StaffTour } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const sendingRef = useRef(false)
  const loadSeq = useRef(0)
  // 확정은 창고 물품을 줄이고 문자를 보내므로, 결과를 받기 전에 떠나지 못하게 한다
  useBlockLeaving(sending, '처리가 끝날 때까지 이 화면에 있어 주세요.')

  // 늦게 온 앞선 응답은 버린다(바꾼 뒤 다시 읽은 목록을 덮지 않게).
  // keepTable이면 처리한 뒤 다시 읽는 것이라, 실패해도 이미 고친 표는 그대로 두고 알리기만 한다
  const loadTours = useCallback((keepTable = false) => {
    const seq = ++loadSeq.current
    const fail = (error: unknown) => {
      setToursState((prev) => (keepTable && prev.status === 'loaded' ? prev : { status: 'failed' }))
      showError(error)
    }
    ApiClient.get<unknown>(TOURS_PATH).then(
      (tours) => {
        if (seq !== loadSeq.current) return
        if (!Array.isArray(tours) || !tours.every(isStaffTour)) {
          fail(new Error('상품 현황 응답이 상품 배열이 아니다'))
          return
        }
        setToursState({ status: 'loaded', tours })
      },
      (error: unknown) => {
        if (seq !== loadSeq.current) return
        fail(error)
      },
    )
  }, [])

  function reload() {
    setToursState({ status: 'loading' })
    loadTours()
  }

  useEffect(() => {
    loadTours()
  }, [loadTours])

  function openDialog(action: Action, tour: StaffTour) {
    // 화면을 연 채 자정을 넘겼으면 단추가 남아 있을 수 있다. 서버가 막을 확정은 창을 열지 않고 목록을 다시 읽는다
    if (action === 'confirm' && tour.departureDate <= seoulToday()) {
      showError(new ApiError('출발일이 오늘이거나 지난 상품은 확정할 수 없습니다.', null))
      reload()
      return
    }
    setDialog({ action, tour })
    setDialogOpen(true)
  }

  // 보내는 동안에는 닫지 않는다(Esc·바깥 누르기)
  function handleDialogOpenChange(open: boolean) {
    if (!open && !sendingRef.current) setDialogOpen(false)
  }

  async function runAction() {
    if (sendingRef.current || dialog === null) return
    const { action, tour } = dialog
    sendingRef.current = true
    setSending(true)
    setResult(null)
    try {
      // 서버가 처리한 뒤 5xx·연결 끊김이 오면 "처리됐는지 알 수 없음"으로 받는다(다시 시도를 권하지 않게)
      const changed = await ApiClient.post<unknown>(`${TOURS_PATH}/${tour.tourId}/${action}`, undefined, {
        unsafeToRetry: true,
      })
      // 성공 응답인데 상품 모양이 아니면 처리됐는지 알 수 없다(이미 확정돼 물품이 줄고 문자가 나갔을 수 있다)
      if (!isStaffTour(changed)) throw unknownResult(200)
      setDialogOpen(false)
      setResult(`${changed.title}을 ${actionLabels[action]}했습니다(지금 상태: ${tourStatusLabel(changed.status)})`)
      setToursState((prev) =>
        prev.status === 'loaded'
          ? { ...prev, tours: prev.tours.map((row) => (row.tourId === changed.tourId ? changed : row)) }
          : prev,
      )
    } catch (error) {
      // 409·404(다른 사람이 먼저 바꿨거나 상품이 없어짐)도 창을 닫고 알린다. 창에 처음 연 때의 상태가 남지 않게,
      // 다시 읽은 목록에서 다시 고르게 한다
      setDialogOpen(false)
      showError(error)
      // 401·403은 ApiClient가 이미 알리고 로그인 상태를 다시 본다
      if (error instanceof ApiError && error.handled) return
      // 처리됐을 수 있다(결과를 모름). 옛 표를 내리고 다시 읽어, 다 읽을 때까지 처리 단추를 보이지 않는다
      reload()
      return
    } finally {
      sendingRef.current = false
      setSending(false)
    }
    // 성공했으면 이미 고친 표를 두고 다시 읽는다
    loadTours(true)
  }

  const today = seoulToday()

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">상품 현황</h1>
        <MenuLink to={pagePaths.StaffMainPage} label="직원 메뉴" disabled={sending} />
      </header>

      <section className="panel flex flex-col gap-4" aria-labelledby="tours-heading">
        <div className="flex items-center justify-between gap-4">
          <h2 id="tours-heading" className="text-lg font-semibold">
            상품 목록
          </h2>
          <Button variant="outline" size="sm" disabled={toursState.status === 'loading' || sending} onClick={reload}>
            새로 고침
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          신청이 3명이 안 된 모집 중 상품도 출발일 전이면 직접 확정할 수 있습니다. 확정하면 신청 인원 × 1인당 개수만큼
          창고 물품이 줄고 신청자에게 확정 문자가 갑니다. 출발했지만 여행이 진행되지 않은 진행 중·완료 상품은 뒤늦게
          취소할 수 있고, 그때 줄였던 물품이 입출고 기록대로 창고로 돌아갑니다(기록이 생기기 전에 확정한 상품은 물품이
          돌아오지 않습니다). 출발과 완료는 날짜에 따라 자동으로 바뀝니다.
        </p>
        {/* 화면 읽기 프로그램이 바뀐 글을 읽게 영역은 늘 둔다. 비어 있을 땐 칸 아래 여백이 늘지 않게 사이 간격을 지운다 */}
        <p role="status" className="text-sm empty:-mt-4">
          {result}
        </p>
        {toursState.status === 'loading' && (
          <p className="text-sm text-muted-foreground">상품 목록을 불러오는 중입니다.</p>
        )}
        {toursState.status === 'failed' && (
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">상품 목록을 불러오지 못했습니다.</p>
            <Button variant="outline" size="sm" onClick={reload}>
              다시 불러오기
            </Button>
          </div>
        )}
        {toursState.status === 'loaded' && toursState.tours.length === 0 && (
          <p className="text-sm text-muted-foreground">등록된 상품이 없습니다.</p>
        )}
        {toursState.status === 'loaded' && toursState.tours.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>상품</TableHead>
                <TableHead className="text-right">신청 인원</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>
                  <span className="sr-only">처리</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {toursState.tours.map((tour) => {
                const action = actionOf(tour, today)
                return (
                  <TableRow key={tour.tourId}>
                    <TableCell className="whitespace-normal">{tour.title}</TableCell>
                    <TableCell className="text-right">
                      {tour.appliedCount}/{tour.capacity}명
                    </TableCell>
                    <TableCell>{tourStatusLabel(tour.status)}</TableCell>
                    <TableCell className="text-right">
                      {action && (
                        <Button variant="outline" size="sm" disabled={sending} onClick={() => openDialog(action, tour)}>
                          {actionLabels[action]}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent showCloseButton={false}>
          {dialog && (
            <div className="grid gap-6">
              <DialogHeader>
                <DialogTitle>{actionLabels[dialog.action]}</DialogTitle>
                <DialogDescription>
                  {dialog.tour.title} · 신청 {dialog.tour.appliedCount}명
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  지금 상태: {tourStatusLabel(dialog.tour.status)} → 바뀔 상태:{' '}
                  <span className="font-semibold">{tourStatusLabel(nextStatus[dialog.action])}</span>
                </p>
                <p>되돌릴 수 없습니다.</p>
                {dialog.action === 'confirm' ? (
                  <p>
                    확정하는 때의 신청 인원(지금 {dialog.tour.appliedCount}명) 몫만큼 창고 물품이 줄고, 그때의 신청자
                    모두에게 확정 문자가 갑니다.
                  </p>
                ) : (
                  <p className="text-destructive">
                    여행이 진행되지 않았을 때만 취소해 주세요. 이 상품 때문에 줄였던 창고 물품을 입출고 기록대로
                    되돌립니다. 기록이 생기기 전에 확정한 상품은 물품이 돌아오지 않습니다.
                  </p>
                )}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={sending}>
                    닫기
                  </Button>
                </DialogClose>
                <Button type="button" disabled={sending} onClick={() => void runAction()}>
                  {sending ? '처리하는 중' : actionLabels[dialog.action]}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  )
}
