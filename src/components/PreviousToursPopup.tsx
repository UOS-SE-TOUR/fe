import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatDate, formatWon } from '@/lib/format'
import type { PreviousTourResponse } from '@/lib/tours'

interface PreviousToursPopupProps {
  tours: PreviousTourResponse[]
}

// 상품 이름의 날짜엔 연도가 없어 출발일을 따로 보인다
export function PreviousToursPopup({ tours }: PreviousToursPopupProps) {
  const [open, setOpen] = useState(true)

  function closePopup() {
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closePopup()}>
      <DialogContent showCloseButton={false} className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>이전 여행</DialogTitle>
          <DialogDescription>지금까지 다녀온 여행 {tours.length}건입니다.</DialogDescription>
        </DialogHeader>
        <ul className="-mx-6 min-h-0 divide-y overflow-y-auto px-6">
          {tours.map((tour) => (
            <li key={tour.bookingId} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{tour.title}</p>
                <p className="text-muted-foreground">
                  {formatDate(tour.departureDate)} 출발 · {tour.duration}일 · {tour.levelName} · {tour.headcount}명
                </p>
              </div>
              <p className="shrink-0 font-medium">{formatWon(tour.finalPrice)}</p>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button>닫기</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
