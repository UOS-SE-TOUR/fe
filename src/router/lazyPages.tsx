import { lazy } from 'react'

// 로그인한 뒤 화면은 처음 열 때 그 화면 파일을 받는다. 로그인·회원가입 화면은 처음 들어온 사람이 바로 보는 화면이라 routes.tsx가 함께 싣는다
export const CustomerMainPage = lazy(() =>
  import('@/pages/CustomerMainPage').then((m) => ({ default: m.CustomerMainPage })),
)
export const StaffMainPage = lazy(() => import('@/pages/StaffMainPage').then((m) => ({ default: m.StaffMainPage })))
export const TourPlanPage = lazy(() => import('@/pages/TourPlanPage').then((m) => ({ default: m.TourPlanPage })))
export const WarehousePage = lazy(() => import('@/pages/WarehousePage').then((m) => ({ default: m.WarehousePage })))
// 상품 선택 화면은 음성 입력 부품과 함께 받는다
export const TourSelectPage = lazy(() =>
  Promise.all([import('@/pages/TourSelectPage'), import('@/components/VoiceInputPanel')]).then(([page, voice]) => ({
    default: () => <page.TourSelectPage voiceInput={voice.VoiceInputPanel} />,
  })),
)
