import { useCallback, useEffect, useRef, useState } from 'react'
import { MenuLink } from '@/components/MenuLink'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { themeLabel } from '@/lib/labels'
import { pagePaths } from '@/lib/pages'
import { cn } from '@/lib/utils'
import { ApiClient, showError } from '@/modules/ApiClient'

const HISTORY_PATH = '/api/v1/staff/items/history'

// be의 ItemHistoryResponse
interface ItemHistory {
  id: number
  itemName: string
  theme: string
  reason: string
  tourTitle: string | null
  changeAmount: number
  quantityAfter: number
  // UTC ISO 8601
  createdAt: string
}

type HistoryState = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; histories: ItemHistory[] }

// be의 ItemHistoryReason
const reasonLabels: Record<string, string> = {
  REGISTER: '등록',
  ADD: '수량 더하기',
  TAKE_OUT: '확정된 신청만큼 줄임',
  PUT_BACK: '취소로 되돌림',
}

const timeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function isItemHistory(value: unknown): value is ItemHistory {
  if (typeof value !== 'object' || value === null) return false
  const { id, itemName, theme, reason, tourTitle, changeAmount, quantityAfter, createdAt } =
    value as Partial<ItemHistory>
  return (
    typeof id === 'number' &&
    typeof itemName === 'string' &&
    typeof theme === 'string' &&
    typeof reason === 'string' &&
    (typeof tourTitle === 'string' || tourTitle === null) &&
    typeof changeAmount === 'number' &&
    typeof quantityAfter === 'number' &&
    typeof createdAt === 'string'
  )
}

// 날짜로 읽지 못하면 받은 그대로 보인다(format이 던지면 화면 전체가 오류 화면이 된다)
function formatTime(isoTime: string): string {
  const time = new Date(isoTime)
  return Number.isNaN(time.getTime()) ? isoTime : timeFormat.format(time)
}

function formatCount(count: number): string {
  return count.toLocaleString('ko-KR')
}

function formatChange(change: number): string {
  return change > 0 ? `+${formatCount(change)}개` : `−${formatCount(-change)}개`
}

export function ItemHistoryPage() {
  const [historyState, setHistoryState] = useState<HistoryState>({ status: 'loading' })
  const loadSeq = useRef(0)

  const loadHistory = useCallback(() => {
    const seq = ++loadSeq.current
    ApiClient.get<unknown>(HISTORY_PATH).then(
      (histories) => {
        if (seq !== loadSeq.current) return
        if (!Array.isArray(histories) || !histories.every(isItemHistory)) {
          setHistoryState({ status: 'failed' })
          showError(new Error('창고 수량 기록 응답이 기록 배열이 아니다'))
          return
        }
        setHistoryState({ status: 'loaded', histories })
      },
      (error: unknown) => {
        if (seq !== loadSeq.current) return
        setHistoryState({ status: 'failed' })
        showError(error)
      },
    )
  }, [])

  function reload() {
    setHistoryState({ status: 'loading' })
    loadHistory()
  }

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">입출고 기록</h1>
        <MenuLink to={pagePaths.WarehousePage} label="창고" disabled={false} />
      </header>

      <section className="panel flex flex-col gap-4" aria-labelledby="history-heading">
        <div className="flex items-center justify-between gap-4">
          <h2 id="history-heading" className="text-lg font-semibold">
            최근 기록
          </h2>
          <Button variant="outline" size="sm" disabled={historyState.status === 'loading'} onClick={reload}>
            새로 고침
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          창고 물품 수량이 바뀐 기록을 최근 것부터 200개까지 보여 줍니다. 상품이 확정되면 그때까지의 신청 인원만큼,
          확정된 상품에 더 신청하면 그 인원만큼 줄고, 늦게 취소한 상품은 줄였던 만큼 돌아옵니다.
        </p>
        {historyState.status === 'loading' && (
          <p className="text-sm text-muted-foreground">기록을 불러오는 중입니다.</p>
        )}
        {historyState.status === 'failed' && (
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">기록을 불러오지 못했습니다.</p>
            <Button variant="outline" size="sm" onClick={reload}>
              다시 불러오기
            </Button>
          </div>
        )}
        {historyState.status === 'loaded' && historyState.histories.length === 0 && (
          <p className="text-sm text-muted-foreground">아직 기록이 없습니다.</p>
        )}
        {historyState.status === 'loaded' && historyState.histories.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>때</TableHead>
                <TableHead>물품</TableHead>
                <TableHead>내용</TableHead>
                <TableHead className="text-right">바뀐 수량</TableHead>
                <TableHead className="text-right">바뀐 뒤 수량</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyState.histories.map((history) => (
                <TableRow key={history.id}>
                  <TableCell>{formatTime(history.createdAt)}</TableCell>
                  <TableCell className="whitespace-normal">
                    {history.itemName} · {themeLabel(history.theme)}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {reasonLabels[history.reason] ?? history.reason}
                    {history.tourTitle && ` · ${history.tourTitle}`}
                  </TableCell>
                  <TableCell className={cn('text-right font-medium', history.changeAmount < 0 && 'text-destructive')}>
                    {formatChange(history.changeAmount)}
                  </TableCell>
                  <TableCell className="text-right">
                    {history.quantityAfter < 0
                      ? `부족 ${formatCount(-history.quantityAfter)}개`
                      : `${formatCount(history.quantityAfter)}개`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </main>
  )
}
