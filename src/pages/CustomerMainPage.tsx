import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { PreviousToursPopup } from '@/components/PreviousToursPopup'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { clearFromLogin, isFromLogin } from '@/lib/fromLogin'
import { useLogOut } from '@/lib/logOut'
import { pagePaths } from '@/lib/pages'
import type { PreviousTourResponse } from '@/lib/tours'
import { ApiClient, showError } from '@/modules/ApiClient'
import { useAuthState } from '@/modules/AuthStore'

function isPreviousTour(value: unknown): value is PreviousTourResponse {
  if (typeof value !== 'object' || value === null) return false
  const tour = value as Partial<PreviousTourResponse>
  return (
    typeof tour.bookingId === 'number' &&
    typeof tour.tourId === 'number' &&
    typeof tour.title === 'string' &&
    typeof tour.departureDate === 'string' &&
    typeof tour.duration === 'number' &&
    typeof tour.level === 'string' &&
    typeof tour.levelName === 'string' &&
    typeof tour.headcount === 'number' &&
    typeof tour.finalPrice === 'number'
  )
}

export function CustomerMainPage() {
  const { member } = useAuthState()
  const { logOut, loggingOut } = useLogOut()
  const [previousTours, setPreviousTours] = useState<PreviousTourResponse[]>([])
  const [popupOpen, setPopupOpen] = useState(false)

  // 로그인 직후에만 이전 여행을 읽는다(설계 loadPreviousTours). "로그인 직후" 표시는 응답을 받은 뒤 지운다 —
  // 부르는 순간 지우면 개발 서버(StrictMode)가 effect를 두 번 돌릴 때 두 번째가 표시를 못 봐 팝업이 뜨지 않는다
  useEffect(() => {
    if (!isFromLogin()) return
    let active = true
    ApiClient.get<unknown>('/api/v1/bookings/previous').then(
      (tours) => {
        clearFromLogin()
        if (!active) return
        if (!Array.isArray(tours) || !tours.every(isPreviousTour)) {
          showError(new Error('이전 여행 응답이 이전 여행 배열이 아니다'))
          return
        }
        setPreviousTours(tours)
        setPopupOpen(tours.length > 0)
      },
      (error: unknown) => {
        clearFromLogin()
        if (active) showError(error)
      },
    )
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">고객 메뉴</h1>
          {member && <p className="text-sm text-muted-foreground">{member.name}님, 안녕하세요.</p>}
        </div>
        <Button variant="outline" onClick={() => void logOut()} disabled={loggingOut}>
          로그아웃
        </Button>
      </header>
      <nav className="grid gap-4">
        <Link
          to={pagePaths.TourSelectPage}
          className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Card className="h-full transition-colors hover:bg-muted">
            <CardHeader>
              <CardTitle>여행 상품 선택</CardTitle>
              <CardDescription>테마 여행 상품을 고르고 신청합니다.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </nav>
      <PreviousToursPopup tours={previousTours} open={popupOpen} onClosePopup={() => setPopupOpen(false)} />
    </main>
  )
}
