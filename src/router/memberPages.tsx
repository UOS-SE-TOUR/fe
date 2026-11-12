import { lazyPage } from '@/router/lazyPage'

// 로그인한 뒤 화면은 처음 열 때 그 화면 파일을 받는다. 로그인·회원가입 화면은 처음 들어온 사람이 바로 보는 화면이라 routes.tsx가 함께 싣는다
export const CustomerMainPage = lazyPage(() => import('@/pages/CustomerMainPage').then((m) => m.CustomerMainPage))
export const StaffMainPage = lazyPage(() => import('@/pages/StaffMainPage').then((m) => m.StaffMainPage))
export const TourPlanPage = lazyPage(() => import('@/pages/TourPlanPage').then((m) => m.TourPlanPage))
export const WarehousePage = lazyPage(() => import('@/pages/WarehousePage').then((m) => m.WarehousePage))
// 상품 선택 화면은 음성 입력 부품과 함께 받는다
export const TourSelectPage = lazyPage(() =>
  Promise.all([import('@/pages/TourSelectPage'), import('@/components/VoiceInputPanel')]).then(
    ([{ TourSelectPage: Page }, { VoiceInputPanel }]) =>
      function TourSelectWithVoice() {
        return <Page voiceInput={VoiceInputPanel} />
      },
  ),
)
