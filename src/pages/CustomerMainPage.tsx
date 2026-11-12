import { useEffect, useRef, useState } from 'react'
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
  // 이 화면을 연 동안 이전 여행을 부른 요청. 개발 서버(StrictMode)는 같은 화면에서 effect만 다시 돌리므로 ref가 남아
  // 그 요청을 다시 기다린다. 다른 화면에 갔다 돌아오면 새 화면이라 비어 있고, 표시도 이미 지워져 다시 부르지 않는다
  const previousToursRequest = useRef<Promise<unknown> | null>(null)

  useEffect(() => {
    // 로그인 직후에만 한 번 읽는다(설계 loadPreviousTours). 부르면서 "로그인 직후" 표시를 지운다
    function loadPreviousTours(): Promise<unknown> | null {
      if (!previousToursRequest.current && isFromLogin()) {
        clearFromLogin()
        previousToursRequest.current = ApiClient.get<unknown>('/api/v1/bookings/previous')
      }
      return previousToursRequest.current
    }

    function showPreviousTours(tours: PreviousTourResponse[]) {
      setPreviousTours(tours)
      setPopupOpen(tours.length > 0)
    }

    const request = loadPreviousTours()
    if (!request) return
    let active = true
    request.then(
      (tours) => {
        if (!active) return
        if (!Array.isArray(tours) || !tours.every(isPreviousTour)) {
          showError(new Error('이전 여행 응답이 이전 여행 배열이 아니다'))
          return
        }
        showPreviousTours(tours)
      },
      (error: unknown) => {
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
