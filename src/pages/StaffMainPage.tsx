import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useLogOut } from '@/lib/logOut'
import { pagePaths } from '@/lib/pages'
import { useAuthState } from '@/modules/AuthStore'

// 설계의 requestPlanTour·requestAddItem은 상품 기획·창고 화면으로 가는 링크다
const menus = [
  { to: pagePaths.TourPlanPage, title: '상품 기획', description: '새 여행 상품을 등록합니다.' },
  { to: pagePaths.WarehousePage, title: '창고', description: '창고 물품을 보고 수량을 더합니다.' },
]

export function StaffMainPage() {
  const { member } = useAuthState()
  const { logOut, loggingOut } = useLogOut()

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">직원 메뉴</h1>
          {member && <p className="text-sm text-muted-foreground">{member.name}님, 안녕하세요.</p>}
        </div>
        <Button variant="outline" onClick={() => void logOut()} disabled={loggingOut}>
          로그아웃
        </Button>
      </header>
      <nav className="grid gap-4 sm:grid-cols-2">
        {menus.map((menu) => (
          <Link
            key={menu.to}
            to={menu.to}
            className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Card className="h-full transition-colors hover:bg-muted">
              <CardHeader>
                <CardTitle>{menu.title}</CardTitle>
                <CardDescription>{menu.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </nav>
    </main>
  )
}
