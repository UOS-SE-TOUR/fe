import { Suspense, type ReactNode } from 'react'
import type { RouteObject } from 'react-router'
import { pagePaths, type PageName } from '@/lib/pages'
import { LoginPage } from '@/pages/LoginPage'
import { SignUpPage } from '@/pages/SignUpPage'
import { CustomerMainPage, StaffMainPage, TourPlanPage, TourSelectPage, WarehousePage } from '@/router/memberPages'
import { GoHome, PageGate } from '@/router/PageGate'
import { PageLoadError } from '@/router/PageLoadError'

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
    errorElement: <PageLoadError />,
    element: (
      <PageGate page={page}>
        <Suspense fallback={null}>{pageElements[page]}</Suspense>
      </PageGate>
    ),
  })),
  { path: '*', element: <GoHome />, errorElement: <PageLoadError /> },
]
