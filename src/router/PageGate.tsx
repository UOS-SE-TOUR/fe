import { useEffect, type ReactNode } from 'react'
import { Navigate } from 'react-router'
import { canOpenPage, homePath, landingPath, pageAccess, pagePaths, type PageName } from '@/lib/pages'
import { notifyForbidden } from '@/modules/ApiClient'
import { useAuthState } from '@/modules/AuthStore'

function Restoring() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">로그인 상태를 확인하는 중입니다.</p>
    </main>
  )
}

function Forbidden({ to }: { to: string }) {
  useEffect(() => {
    notifyForbidden()
  }, [])
  return <Navigate to={to} replace />
}

// 그 화면을 열 수 없는 사람이면 로그인 화면이나 자기 첫 화면으로 보낸다
export function PageGate({ page, children }: { page: PageName; children: ReactNode }) {
  const { member, restoring } = useAuthState()
  if (restoring && !member) return <Restoring />
  if (canOpenPage(page, member?.memberType ?? null)) return children
  if (!member) return <Navigate to={pagePaths.LoginPage} replace />
  // 사이트 첫 주소(/)는 누구나 여는 주소라 다른 회원 구분이어도 알리지 않는다
  if (pageAccess[page] === 'GUEST' || pagePaths[page] === '/') return <Navigate to={homePath(member.memberType)} replace />
  return <Forbidden to={homePath(member.memberType)} />
}

// 없는 주소면 자기 첫 화면으로(로그인하지 않았으면 로그인 화면으로) 보낸다
export function GoHome() {
  const { member, restoring } = useAuthState()
  if (restoring && !member) return <Restoring />
  return <Navigate to={landingPath(member?.memberType ?? null)} replace />
}
