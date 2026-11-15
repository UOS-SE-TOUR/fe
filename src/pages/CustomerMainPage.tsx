import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { PreviousToursPopup } from '@/components/PreviousToursPopup'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { clearFromLogin, isFromLogin } from '@/lib/fromLogin'
import { themes } from '@/lib/labels'
import { useLogOut } from '@/lib/logOut'
import { pagePaths } from '@/lib/pages'
import { themeLooks } from '@/lib/themeLook'
import type { PreviousTourResponse } from '@/lib/tours'
import { cn } from '@/lib/utils'
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
  // StrictMode가 effect를 다시 돌려도 ref는 남아 같은 요청을 기다린다. 다른 화면에서 돌아오면 비어 있어 다시 부르지 않는다
  const previousToursRequest = useRef<Promise<unknown> | null>(null)

  useEffect(() => {
    // 로그인 직후에만 한 번 읽고, 부르면서 그 표시를 지운다
    function loadPreviousTours(): Promise<unknown> | null {
      if (!previousToursRequest.current && isFromLogin()) {
        clearFromLogin()
        previousToursRequest.current = ApiClient.get<unknown>('/api/v1/bookings/previous')
      }
      return previousToursRequest.current
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
        setPreviousTours(tours)
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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      {/* 인사말이 두 줄이 되거나 좁은 화면에서 폭이 넓어져도 그림의 산과 겹치지 않게 띠 높이를 잡는다 */}
      <header className="hero-scene flex min-h-[max(14rem,40vw)] items-start justify-between gap-4 overflow-hidden rounded-2xl bg-bottom p-6 text-primary-foreground shadow-sm sm:min-h-64 sm:p-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">고객 메뉴</h1>
          {member && <p className="mt-1 text-primary-foreground/90">{member.name}님, 안녕하세요.</p>}
        </div>
        <Button variant="secondary" onClick={() => void logOut()} disabled={loggingOut}>
          로그아웃
        </Button>
      </header>
      <nav className="grid gap-4">
        <Link
          to={pagePaths.TourSelectPage}
          className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Card className="h-full transition-shadow group-hover:shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-4 text-lg">
                여행 상품 선택
                <ArrowRight className="size-5 text-primary transition-transform group-hover:translate-x-1" />
              </CardTitle>
              <CardDescription>테마 여행 상품을 고르고 신청합니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {themes.map((theme) => {
                  const look = themeLooks[theme.value]
                  return (
                    <li key={theme.value} className="flex flex-col items-center gap-2 text-center">
                      <span className={cn('flex size-10 items-center justify-center rounded-full', look.tint)}>
                        <look.icon className="size-5" />
                      </span>
                      <span className="text-sm font-medium">{theme.label}</span>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        </Link>
      </nav>
      {previousTours.length > 0 && <PreviousToursPopup tours={previousTours} />}
    </main>
  )
}
