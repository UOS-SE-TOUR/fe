import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest 전역(globals)을 끈 채라 Testing Library가 테스트마다 화면을 스스로 비우지 않는다
afterEach(() => {
  cleanup()
})
