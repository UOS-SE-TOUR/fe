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
import { ApiClient, hasStatus, showError } from '@/modules/ApiClient'

const TOURS_PATH = '/api/v1/staff/tours'

// be의 StaffTourSummary
interface StaffTour {
  tourId: number
  title: string
  capacity: number
  appliedCount: number
  status: string
}

type ToursState = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; tours: StaffTour[] }

type Action = 'confirm' | 'cancel'

const actionLabels: Record<Action, string> = { confirm: '확정 처리', cancel: '취소 처리' }

function isStaffTour(value: unknown): value is StaffTour {
  if (typeof value !== 'object' || value === null) return false
  const { tourId, title, capacity, appliedCount, status } = value as Partial<StaffTour>
  return (
    typeof tourId === 'number' &&
    typeof title === 'string' &&
    typeof capacity === 'number' &&
    typeof appliedCount === 'number' &&
    typeof status === 'string'
  )
}

// 그 상품에 할 수 있는 처리(be의 Tour.confirmByStaff·cancelByStaff와 같다)
function actionOf(tour: StaffTour): Action | null {
  if (tour.status === 'RECRUITING' && tour.appliedCount > 0) return 'confirm'
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
  const [dialogError, setDialogError] = useState<string | null>(null)
  const sendingRef = useRef(false)
  const loadSeq = useRef(0)

  // 늦게 온 앞선 응답은 버린다(바꾼 뒤 다시 읽은 목록을 덮지 않게)
  const loadTours = useCallback(() => {
    const seq = ++loadSeq.current
    ApiClient.get<unknown>(TOURS_PATH).then(
      (tours) => {
        if (seq !== loadSeq.current) return
        if (!Array.isArray(tours) || !tours.every(isStaffTour)) {
          setToursState({ status: 'failed' })
          showError(new Error('상품 현황 응답이 상품 배열이 아니다'))
          return
        }
        setToursState({ status: 'loaded', tours })
      },
      (error: unknown) => {
        if (seq !== loadSeq.current) return
        setToursState({ status: 'failed' })
        showError(error)
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
    setDialog({ action, tour })
    setDialogError(null)
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
      const changed = await ApiClient.post<unknown>(`${TOURS_PATH}/${tour.tourId}/${action}`)
      if (!isStaffTour(changed)) throw new Error('확정·취소 처리 응답이 상품이 아니다')
      setDialogOpen(false)
      setResult(`${changed.title}을 ${actionLabels[action]}했습니다(지금 상태: ${tourStatusLabel(changed.status)})`)
      setToursState((prev) =>
        prev.status === 'loaded'
          ? { ...prev, tours: prev.tours.map((row) => (row.tourId === changed.tourId ? changed : row)) }
          : prev,
      )
    } catch (error) {
      // 다른 사람이 먼저 바꿨거나 상품이 없어졌다
      if (hasStatus(error, 404) || hasStatus(error, 409)) setDialogError(error.message)
      else {
        setDialogOpen(false)
        showError(error)
      }
    } finally {
      sendingRef.current = false
      setSending(false)
    }
    loadTours()
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">상품 현황</h1>
        <MenuLink to={pagePaths.StaffMainPage} label="직원 메뉴" disabled={false} />
      </header>

      <section className="panel flex flex-col gap-4" aria-labelledby="tours-heading">
        <h2 id="tours-heading" className="text-lg font-semibold">
          상품 목록
        </h2>
        <p className="text-sm text-muted-foreground">
          신청이 3명이 안 된 모집 중 상품도 직접 확정할 수 있습니다. 확정하면 신청 인원만큼 창고 물품이 줄고 신청자에게
          확정 문자가 갑니다. 출발했지만 여행이 진행되지 않은 진행 중·완료 상품은 뒤늦게 취소할 수 있고, 그때 줄였던
          물품이 창고로 돌아갑니다. 출발과 완료는 날짜에 따라 자동으로 바뀝니다.
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
                const action = actionOf(tour)
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
                  <p>신청 {dialog.tour.appliedCount}명 몫만큼 창고 물품이 줄고, 신청자 모두에게 확정 문자가 갑니다.</p>
                ) : (
                  <p className="text-destructive">
                    여행이 진행되지 않았을 때만 취소해 주세요. 이 상품 때문에 줄였던 창고 물품을 되돌립니다.
                  </p>
                )}
                {dialogError && (
                  <p role="alert" className="text-destructive">
                    {dialogError}
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
