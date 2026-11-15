import { HeartHandshake, LandPlot, MountainSnow, Sparkles, type LucideIcon } from 'lucide-react'
import type { Theme } from '@/lib/labels'

interface ThemeLook {
  icon: LucideIcon
  tint: string
}

// 테마마다 화면에 쓰는 그림과 색. 색 값은 src/index.css의 --theme-* 변수다
export const themeLooks: Record<Theme, ThemeLook> = {
  HONEYMOON: { icon: Sparkles, tint: 'bg-theme-honeymoon/10 text-theme-honeymoon' },
  PARENTS: { icon: HeartHandshake, tint: 'bg-theme-parents/10 text-theme-parents' },
  GOLF: { icon: LandPlot, tint: 'bg-theme-golf/10 text-theme-golf' },
  TREKKING: { icon: MountainSnow, tint: 'bg-theme-trekking/10 text-theme-trekking' },
}

// 서버가 준 테마 값의 그림과 색. 모르는 값이면 undefined
export function themeLookOf(value: string): ThemeLook | undefined {
  return Object.hasOwn(themeLooks, value) ? themeLooks[value as Theme] : undefined
}
