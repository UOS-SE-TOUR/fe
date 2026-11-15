import { describe, expect, it } from 'vitest'
import { themes } from '@/lib/labels'
import { themeLookOf, themeLooks } from '@/lib/themeLook'

describe('테마의 그림과 색', () => {
  it('테마마다 그림과 색이 있다', () => {
    for (const theme of themes) {
      expect(themeLookOf(theme.value)).toBe(themeLooks[theme.value])
    }
  })

  it('모르는 값이면 그림과 색을 주지 않는다', () => {
    expect(themeLookOf('SKI')).toBeUndefined()
    expect(themeLookOf('toString')).toBeUndefined()
  })
})
