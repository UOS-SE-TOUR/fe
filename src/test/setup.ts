import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom에는 matchMedia가 없다. 공용 알림(Sonner)이 시스템 다크 모드를 볼 때 부른다
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

// jsdom에는 ResizeObserver도 없다. shadcn/ui의 라디오·체크박스(Radix)가 크기를 잴 때 부른다
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// Vitest 전역(globals)을 끈 채라 Testing Library가 테스트마다 화면을 스스로 비우지 않는다
afterEach(() => {
  cleanup()
})
