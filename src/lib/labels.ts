import type { MemberType } from '@/lib/pages'

// 회원 구분의 화면 이름
export const memberTypeLabels: Record<MemberType, string> = {
  CUSTOMER: '고객',
  STAFF: '직원',
}

// 서버가 영문 값으로 주는 테마·투어 등급·상품 상태의 화면 이름(be의 Theme·TourLevel·TourStatus와 같은 값). 목록 순서가 화면에 보이는 순서다
export const themes = [
  { value: 'HONEYMOON', label: '허니문 낭만 투어' },
  { value: 'PARENTS', label: '효도 힐링 투어' },
  { value: 'GOLF', label: '골프 챌린지 투어' },
  { value: 'TREKKING', label: '아웃도어 트레킹 투어' },
] as const

export const tourLevels = [
  { value: 'CLASSIC', label: '클래식' },
  { value: 'GRAND', label: '그랜드' },
  { value: 'PREMIUM', label: '프리미엄' },
] as const

export const tourStatuses = [
  { value: 'RECRUITING', label: '모집 중' },
  { value: 'CONFIRMED', label: '확정' },
  { value: 'FULL', label: '마감' },
  { value: 'CANCELLED', label: '취소' },
  { value: 'IN_PROGRESS', label: '진행 중' },
  { value: 'COMPLETED', label: '완료' },
] as const

export type Theme = (typeof themes)[number]['value']
export type TourLevel = (typeof tourLevels)[number]['value']
export type TourStatus = (typeof tourStatuses)[number]['value']

type Labeled = readonly { value: string; label: string }[]

// 모르는 값은 받은 그대로 보여 준다
function labelOf(list: Labeled, value: string): string {
  return list.find((item) => item.value === value)?.label ?? value
}

export function themeLabel(value: string): string {
  return labelOf(themes, value)
}

export function tourLevelLabel(value: string): string {
  return labelOf(tourLevels, value)
}

export function tourStatusLabel(value: string): string {
  return labelOf(tourStatuses, value)
}
