import { LogOut, Plane } from 'lucide-react'
import { toast } from 'sonner'
import { Link, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { useLogOut } from '@/lib/logOut'
import { landingPath, pagePaths } from '@/lib/pages'
import { getBlockingMessage } from '@/lib/useBlockLeaving'
import { useAuthState } from '@/modules/AuthStore'

// 모든 화면에 공통으로 표시한다. 인증은 기존 AuthStore와 서버의 HttpOnly 쿠키를 그대로 사용한다.
export function SiteHeader() {
  const { member, restoring } = useAuthState()
  const { pathname } = useLocation()
  const { logOut, loggingOut } = useLogOut()

  function handleLogOut() {
    // 예약 신청·상품 등록·재고 추가가 처리 중이면 서버 로그아웃 요청도 보내지 않는다.
    const blockedMessage = getBlockingMessage()
    if (blockedMessage) {
      toast.info(blockedMessage, { id: 'leave-blocked' })
      return
    }
    void logOut()
  }

  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex min-h-14 w-full max-w-5xl items-center gap-3 px-4 py-2 sm:px-6">
        <Link
          to={landingPath(member?.memberType ?? null)}
          className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="미스터 월드 테마 여행 홈"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Plane className="size-4" aria-hidden="true" />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight sm:text-base">미스터 월드 테마 여행</span>
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {member ? (
            <>
              <span className="hidden max-w-36 truncate text-sm text-muted-foreground sm:block" title={member.name}>
                {member.name}님 · {member.memberType === 'STAFF' ? '직원' : '고객'}
              </span>
              <Button variant="outline" size="sm" onClick={handleLogOut} disabled={loggingOut}>
                <LogOut className="size-4" aria-hidden="true" />
                로그아웃
              </Button>
            </>
          ) : !restoring ? (
            pathname === pagePaths.LoginPage ? (
              <Button asChild variant="outline" size="sm">
                <Link to={pagePaths.SignUpPage}>새 계정 만들기</Link>
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link to={pagePaths.LoginPage}>로그인하기</Link>
              </Button>
            )
          ) : null}
        </div>
      </div>
    </header>
  )
}
