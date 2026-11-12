import type { ReactNode } from 'react'
import type { RouteObject } from 'react-router'
import { pagePaths, type PageName } from '@/lib/pages'
import { LoginPage } from '@/pages/LoginPage'
import { SignUpPage } from '@/pages/SignUpPage'
import { StaffMainPage } from '@/pages/StaffMainPage'
import { TourPlanPage } from '@/pages/TourPlanPage'
import { TourSelectPage } from '@/pages/TourSelectPage'
import { GoHome, PageGate } from '@/router/PageGate'
import { PlaceholderPage } from '@/router/PlaceholderPage'

// 화면마다 보여 줄 것. 주소는 pagePaths, 열 수 있는 사람은 pageAccess가 정한다. 화면 이슈(#4~#9)가 자리표시자를 실제 화면으로 바꾼다
const pageElements: Record<PageName, ReactNode> = {
  LoginPage: <LoginPage />,
  SignUpPage: <SignUpPage />,
  CustomerMainPage: <PlaceholderPage title="고객 첫 화면" />,
  TourSelectPage: <TourSelectPage />,
  StaffMainPage: <StaffMainPage />,
  TourPlanPage: <TourPlanPage />,
  WarehousePage: <PlaceholderPage title="창고" />,
}

export const routes: RouteObject[] = [
  ...(Object.keys(pageElements) as PageName[]).map((page) => ({
    path: pagePaths[page],
    element: <PageGate page={page}>{pageElements[page]}</PageGate>,
  })),
  { path: '*', element: <GoHome /> },
]
