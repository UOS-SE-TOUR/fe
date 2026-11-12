import { useEffect } from 'react'
import { useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'

// 화면을 그리지 못했을 때(화면 파일을 못 받음 등) 라우터의 영어 개발자 오류 화면 대신 보인다
export function PageLoadError() {
  const error = useRouteError()

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm text-muted-foreground">화면을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 불러와 주세요.</p>
      <Button onClick={() => window.location.reload()}>다시 불러오기</Button>
    </main>
  )
}
