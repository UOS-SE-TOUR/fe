import type { ReactNode } from 'react'
import type { RouteObject } from 'react-router'
import { pagePaths, type PageName } from '@/lib/pages'
import { CustomerMainPage } from '@/pages/CustomerMainPage'
import { LoginPage } from '@/pages/LoginPage'
import { SignUpPage } from '@/pages/SignUpPage'
import { StaffMainPage } from '@/pages/StaffMainPage'
import { TourPlanPage } from '@/pages/TourPlanPage'
import { TourSelectPage } from '@/pages/TourSelectPage'
import { WarehousePage } from '@/pages/WarehousePage'
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
    element: <PageGate page={page}>{pageElements[page]}</PageGate>,
  })),
  { path: '*', element: <GoHome /> },
]
