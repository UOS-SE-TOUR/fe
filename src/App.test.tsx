import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '@/App'

describe('App', () => {
  it('서비스 이름을 보여 준다', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '미스터 월드 테마 여행' })).toBeInTheDocument()
  })
})
