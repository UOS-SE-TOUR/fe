import { useCallback, useEffect, useRef, useState } from 'react'
import { MenuLink } from '@/components/MenuLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatWon } from '@/lib/format'
import { tourStatusLabel } from '@/lib/labels'
import { pagePaths } from '@/lib/pages'
import { isMyBooking, type MyBookingResponse } from '@/lib/tours'
import { ApiClient, showError } from '@/modules/ApiClient'

type MyBookingsState =
  { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; bookings: MyBookingResponse[] }

// 모집 중일 때만 보인다
function toConfirmLine(booking: MyBookingResponse): string | null {
  if (booking.status !== 'RECRUITING' || booking.headcountToConfirm <= 0) return null
  return `확정까지 ${booking.headcountToConfirm}명`
}

// 기간은 상품 이름("… 11/30 출발 1일")에 들어 있어 따로 보이지 않는다
export function MyBookingsPage() {
  const [bookingsState, setBookingsState] = useState<MyBookingsState>({ status: 'loading' })
  const loadSeq = useRef(0)

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
    }
  }, [loadMyBookings])

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
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
                  </div>
                  <p className="shrink-0 font-semibold">{formatWon(booking.finalPrice)}</p>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}
