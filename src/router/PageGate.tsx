import { useEffect, type ReactNode } from 'react'
import { Navigate } from 'react-router'
import { homePath, pageAccess, pagePaths, type PageName } from '@/lib/pages'
import { notifyForbidden } from '@/modules/ApiClient'
import { AuthStore, useAuthState } from '@/modules/AuthStore'

function Forbidden({ to }: { to: string }) {
  useEffect(() => {
    notifyForbidden()
  }, [])
  return <Navigate to={to} replace />
}

// 그 화면을 열 수 없는 사람이면 로그인 화면이나 자기 첫 화면으로 보낸다
export function PageGate({ page, children }: { page: PageName; children: ReactNode }) {
  const { member, restoring } = useAuthState()
  if (restoring && !member) return null
  if (AuthStore.canOpen(page)) return children
  if (!member) return <Navigate to={pagePaths.LoginPage} replace />
  if (pageAccess[page] === 'GUEST') return <Navigate to={homePath(member.memberType)} replace />
  return <Forbidden to={homePath(member.memberType)} />
}

// 없는 주소면 자기 첫 화면으로(로그인하지 않았으면 로그인 화면으로) 보낸다
export function GoHome() {
  const { member, restoring } = useAuthState()
  if (restoring && !member) return null
  return <Navigate to={member ? homePath(member.memberType) : pagePaths.LoginPage} replace />
}
