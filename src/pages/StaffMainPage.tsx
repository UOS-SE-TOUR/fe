import { ArrowRight, ClipboardList, Package } from 'lucide-react'
import { Link } from 'react-router'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pagePaths } from '@/lib/pages'
import { useAuthState } from '@/modules/AuthStore'

const menus = [
  { to: pagePaths.TourPlanPage, title: '상품 기획', description: '새 여행 상품을 등록합니다.', icon: ClipboardList },
  {
    to: pagePaths.WarehousePage,
    title: '창고',
    description: '창고 물품을 등록하고, 수량을 더하거나 1인당 개수를 바꿉니다.',
    icon: Package,
  },
]

export function StaffMainPage() {
  const { member } = useAuthState()

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-start justify-between gap-4 rounded-2xl bg-primary p-6 text-primary-foreground shadow-sm sm:p-8">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">직원 메뉴</h1>
          {member && <p className="mt-1 wrap-anywhere text-primary-foreground/90">{member.name}님, 안녕하세요.</p>}
        </div>
      </header>
      <nav className="grid gap-4 sm:grid-cols-2">
        {menus.map((menu) => (
          <Link
            key={menu.to}
            to={menu.to}
            className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Card className="h-full transition-shadow group-hover:shadow-md">
              <CardHeader>
                <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <menu.icon className="size-5" />
                </span>
                <CardTitle className="flex items-center justify-between gap-4 text-lg">
                  {menu.title}
                  <ArrowRight className="size-5 text-primary transition-transform group-hover:translate-x-1" />
                </CardTitle>
                <CardDescription>{menu.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </nav>
    </main>
  )
}
