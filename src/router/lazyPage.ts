import { lazy, type ComponentType } from 'react'
import { recoverFromStaleChunk } from '@/lib/staleChunk'

// 화면 부품을 처음 그릴 때 불러온다. 못 받으면 새로고침해 새 버전을 받거나, 오류를 넘겨 라우터의 오류 화면을 보인다
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>, reload?: () => void) {
  return lazy(() =>
    load().then(
      (component) => ({ default: component }),
      (error: unknown) => recoverFromStaleChunk(error, reload),
    ),
  )
}
