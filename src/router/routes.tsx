import { Suspense, type ReactNode } from 'react'
import type { RouteObject } from 'react-router'
import { pagePaths, type PageName } from '@/lib/pages'
import { LoginPage } from '@/pages/LoginPage'
import { SignUpPage } from '@/pages/SignUpPage'
import {
  CustomerMainPage,
  StaffMainPage,
  TourPlanPage,
  TourSelectPage,
  WarehousePage,
} from '@/router/lazyPages'
import { GoHome, PageGate } from '@/router/PageGate'

// 화면마다 보여 줄 것. 주소는 pagePaths, 열 수 있는 사람은 pageAccess가 정한다
const pageElements: Record<PageName, ReactNode> = {
  LoginPage: <LoginPage />,
  SignUpPage: <SignUpPage />,
  CustomerMainPage: <CustomerMainPage />,
  TourSelectPage: <TourSelectPage />,
  StaffMainPage: <StaffMainPage />,
  TourPlanPage: <TourPlanPage />,
  WarehousePage: <WarehousePage />,
}

export const routes: RouteObject[] = [
  ...(Object.keys(pageElements) as PageName[]).map((page) => ({
    path: pagePaths[page],
    // 화면 파일은 작아 보통 순간에 받으므로, 받는 동안 문구를 띄우면 깜빡이기만 한다
    element: (
      <PageGate page={page}>
        <Suspense fallback={null}>{pageElements[page]}</Suspense>
      </PageGate>
    ),
  })),
  { path: '*', element: <GoHome /> },
]
