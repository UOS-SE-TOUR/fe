import { lazy, type ComponentType } from 'react'
import { markChunkLoaded, recoverFromStaleChunk } from '@/lib/staleChunk'

// 화면 부품을 처음 그릴 때 불러오고, 못 받으면 새로고침하거나 오류 화면으로 넘긴다
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>, reload?: () => void) {
  return lazy(() =>
    load().then(
      (component) => {
        markChunkLoaded()
        return { default: component }
      },
      (error: unknown) => recoverFromStaleChunk(error, reload),
    ),
  )
}
