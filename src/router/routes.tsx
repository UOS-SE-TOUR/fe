import { Suspense, type ReactNode } from 'react'
import type { RouteObject } from 'react-router'
import { SiteHeader } from '@/components/SiteHeader'
import { pagePaths, type PageName } from '@/lib/pages'
import { LoginPage } from '@/pages/LoginPage'
import { SignUpPage } from '@/pages/SignUpPage'
import {
  CustomerMainPage,
  ItemHistoryPage,
  MyBookingsPage,
  StaffMainPage,
  TourPlanPage,
  TourSelectPage,
  TourStatusPage,
  WarehousePage,
} from '@/router/memberPages'
import { GoHome, PageGate } from '@/router/PageGate'
import { PageLoadError } from '@/router/PageLoadError'

// 화면마다 보여 줄 것. 주소는 pagePaths, 열 수 있는 사람은 pageAccess가 정한다
const pageElements: Record<PageName, ReactNode> = {
  LoginPage: <LoginPage />,
  SignUpPage: <SignUpPage />,
  CustomerMainPage: <CustomerMainPage />,
  TourSelectPage: <TourSelectPage />,
  MyBookingsPage: <MyBookingsPage />,
  StaffMainPage: <StaffMainPage />,
  TourPlanPage: <TourPlanPage />,
  WarehousePage: <WarehousePage />,
  TourStatusPage: <TourStatusPage />,
  ItemHistoryPage: <ItemHistoryPage />,
}

export const routes: RouteObject[] = [
  ...(Object.keys(pageElements) as PageName[]).map((page) => ({
    path: pagePaths[page],
    errorElement: <PageLoadError />,
    element: (
      <>
        <SiteHeader />
        <PageGate page={page}>
          <Suspense fallback={null}>{pageElements[page]}</Suspense>
        </PageGate>
      </>
    ),
  })),
  {
    path: '*',
    element: (
      <>
        <SiteHeader />
        <GoHome />
      </>
    ),
    errorElement: <PageLoadError />,
  },
]
