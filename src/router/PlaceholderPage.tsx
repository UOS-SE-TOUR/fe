import { useAuthState } from '@/modules/AuthStore'

// 아직 만들지 않은 화면의 자리. 화면 이슈(#4~#9)가 실제 화면으로 바꾼다
export function PlaceholderPage({ title }: { title: string }) {
  const { member } = useAuthState()
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">아직 만들지 않은 화면입니다.</p>
      {member && <p className="text-sm text-muted-foreground">{member.name}님으로 로그인했습니다.</p>}
    </main>
  )
}
