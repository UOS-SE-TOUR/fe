// 회원 구분(be의 MemberType과 같은 값)
export const memberTypes = ['CUSTOMER', 'STAFF'] as const
export type MemberType = (typeof memberTypes)[number]

export function isMemberType(value: unknown): value is MemberType {
  return (memberTypes as readonly unknown[]).includes(value)
}

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

// 회원 구분마다 로그인하면 처음 보는 화면
export const homePages: Record<MemberType, PageName> = {
  CUSTOMER: 'CustomerMainPage',
  STAFF: 'StaffMainPage',
}

export function homePath(memberType: MemberType): string {
  return pagePaths[homePages[memberType]]
}

// 로그인했으면 자기 첫 화면, 아니면 로그인 화면의 주소
export function landingPath(memberType: MemberType | null): string {
  return memberType ? homePath(memberType) : pagePaths.LoginPage
}
