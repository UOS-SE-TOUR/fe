import { describe, expect, it } from 'vitest'
import { themes } from '@/lib/labels'
import { themeLookOf } from '@/lib/themeLook'

describe('테마의 아이콘과 색', () => {
  it('테마마다 아이콘과 색이 있다', () => {
    for (const theme of themes) {
      const look = themeLookOf(theme.value)
      expect(look?.icon).toBeDefined()
      expect(look?.tint).toMatch(/^bg-theme-\S+ text-theme-\S+$/)
    }
  })

  it('모르는 값이면 아이콘과 색을 주지 않는다', () => {
    expect(themeLookOf('SKI')).toBeUndefined()
    expect(themeLookOf('toString')).toBeUndefined()
  })
})
