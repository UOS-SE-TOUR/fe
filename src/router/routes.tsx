import type { RouteObject } from 'react-router'
import { pagePaths } from '@/lib/pages'
import { GoHome, PageGate } from '@/router/PageGate'
import { PlaceholderPage } from '@/router/PlaceholderPage'

export const routes: RouteObject[] = [
  {
    path: pagePaths.LoginPage,
    element: (
      <PageGate page="LoginPage">
        <PlaceholderPage title="로그인" />
      </PageGate>
    ),
  },
  {
    path: pagePaths.SignUpPage,
    element: (
      <PageGate page="SignUpPage">
        <PlaceholderPage title="회원가입" />
      </PageGate>
    ),
  },
  {
    path: pagePaths.CustomerMainPage,
    element: (
      <PageGate page="CustomerMainPage">
        <PlaceholderPage title="고객 첫 화면" />
      </PageGate>
    ),
  },
  {
    path: pagePaths.TourSelectPage,
    element: (
      <PageGate page="TourSelectPage">
        <PlaceholderPage title="여행 상품 선택" />
      </PageGate>
    ),
  },
  {
    path: pagePaths.StaffMainPage,
    element: (
      <PageGate page="StaffMainPage">
        <PlaceholderPage title="직원 첫 화면" />
      </PageGate>
    ),
  },
  {
    path: pagePaths.TourPlanPage,
    element: (
      <PageGate page="TourPlanPage">
        <PlaceholderPage title="상품 기획" />
      </PageGate>
    ),
  },
  {
    path: pagePaths.WarehousePage,
    element: (
      <PageGate page="WarehousePage">
        <PlaceholderPage title="창고" />
      </PageGate>
    ),
  },
  { path: '*', element: <GoHome /> },
]
