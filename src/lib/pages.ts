import type { MemberType } from '@/modules/AuthStore'

// 설계 3장의 «Page» 이름
export type PageName =
  | 'LoginPage'
  | 'SignUpPage'
  | 'CustomerMainPage'
  | 'TourSelectPage'
  | 'StaffMainPage'
  | 'TourPlanPage'
  | 'WarehousePage'

export const pagePaths: Record<PageName, string> = {
  LoginPage: '/login',
  SignUpPage: '/signup',
  CustomerMainPage: '/',
  TourSelectPage: '/tours',
  StaffMainPage: '/staff',
  TourPlanPage: '/staff/tours/new',
  WarehousePage: '/staff/items',
}

// 화면을 열 수 있는 사람. GUEST는 로그인하지 않은 사람이다(로그인한 회원은 로그인·회원가입 화면을 열지 않는다)
export const pageAccess: Record<PageName, 'GUEST' | MemberType> = {
  LoginPage: 'GUEST',
  SignUpPage: 'GUEST',
  CustomerMainPage: 'CUSTOMER',
  TourSelectPage: 'CUSTOMER',
  StaffMainPage: 'STAFF',
  TourPlanPage: 'STAFF',
  WarehousePage: 'STAFF',
}

export function homePage(memberType: MemberType): PageName {
  return memberType === 'STAFF' ? 'StaffMainPage' : 'CustomerMainPage'
}
