import { formatDate } from '@/lib/format'
import type { Theme, TourLevel, TourStatus } from '@/lib/labels'
import { ApiClient } from '@/modules/ApiClient'

// 상품 조회·가격 계산·신청 API의 본문 모양. 이름은 be record·Swagger 스키마와 같다

export interface TourSummary {
  tourId: number
  title: string
  // YYYY-MM-DD
  departureDate: string
  duration: number
  remainingSeats: number
  status: TourStatus
}

export interface LevelDetail {
  level: TourLevel
  name: string
  price: number
  hotelGrade: number
  meal: string
  includesChampagne: boolean
}

export interface TourLevelsResponse {
  service: string
  souvenir: string
  vehicle: string
  levels: LevelDetail[]
}

export interface TourOptionItem {
  optionId: number
  name: string
  // 받은 투어 등급을 기준으로 한 1인 요금 차이(원). 더 싼 호텔·식사면 음수
  priceDiff: number
}

export interface TourOptionsResponse {
  hotels: TourOptionItem[]
  transports: TourOptionItem[]
  meals: TourOptionItem[]
  extras: TourOptionItem[]
}

export type OptionCategory = 'HOTEL' | 'TRANSPORT' | 'MEAL' | 'EXTRA'

export interface QuoteRequest {
  tourId: number
  level: TourLevel
  headcount: number
  optionIds: number[]
}

export interface SelectedOption {
  optionId: number
  category: OptionCategory
  name: string
  priceDiff: number
}

export interface QuoteSummary {
  tourId: number
  title: string
  departureDate: string
  duration: number
  level: TourLevel
  levelName: string
  headcount: number
  options: SelectedOption[]
}

export interface PriceQuote {
  summary: QuoteSummary
  totalPrice: number
  discount: number
  finalPrice: number
}

export interface ApplyTourResponse {
  bookingId: number
  status: TourStatus
}

// 지금 신청할 수 있는 상품인지. 아니면 목록에 상태(마감 등)로 보이고 고를 수 없다
export function canApply(tour: TourSummary): boolean {
  return (tour.status === 'RECRUITING' || tour.status === 'CONFIRMED') && tour.remainingSeats > 0
}

// 상품 목록 한 줄에 제목과 함께 보이는 설명
export function tourSummaryLine(tour: TourSummary): string {
  return `${formatDate(tour.departureDate)} 출발 · ${tour.duration}일 · 남은 자리 ${tour.remainingSeats}명`
}

// 그 테마의 상품 목록. 출발일이 오늘보다 뒤인 상품을 마감 상품까지 출발일 순으로 준다
export function getTours(theme: Theme): Promise<TourSummary[]> {
  return ApiClient.get<TourSummary[]>(`/api/v1/tours?theme=${theme}`)
}
