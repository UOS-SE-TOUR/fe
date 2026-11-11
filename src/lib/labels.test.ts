import { describe, expect, it } from 'vitest'
import { themeLabel, tourLevelLabel, tourStatusLabel } from '@/lib/labels'

describe('화면 이름', () => {
  it('서버의 영문 값을 화면 이름으로 바꾼다', () => {
    expect(themeLabel('GOLF')).toBe('골프 챌린지 투어')
    expect(tourLevelLabel('PREMIUM')).toBe('프리미엄')
    expect(tourStatusLabel('RECRUITING')).toBe('모집 중')
  })

  it('모르는 값은 받은 그대로 보여 준다', () => {
    expect(themeLabel('SKI')).toBe('SKI')
    expect(tourStatusLabel('COMPLETED')).toBe('COMPLETED')
  })
})
