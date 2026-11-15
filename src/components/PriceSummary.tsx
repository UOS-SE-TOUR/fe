import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, formatWon } from '@/lib/format'
import type { PriceQuote } from '@/lib/tours'

interface PriceSummaryProps {
  quote: PriceQuote
  // 단골 할인을 아직 확인받지 않았다(상품을 고른 뒤 할인이 든 가격이 처음 나왔을 때. 한 상품에서 한 번만 확인받는다)
  confirming: boolean
  onConfirmPrice(): void
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? 'text-base font-semibold' : undefined}>{value}</dd>
    </div>
  )
}

// 할인은 서버가 계산한 값을 그대로 보여 준다. 확인할 때 서버를 다시 부르지 않는다
export function PriceSummary({ quote, confirming, onConfirmPrice }: PriceSummaryProps) {
  if (confirming) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>단골 할인이 적용됩니다</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <Row label="할인 전 총 가격" value={formatWon(quote.totalPrice)} />
            <Row label="할인 금액" value={`−${formatWon(quote.discount)}`} />
            <Row label="최종 가격" value={formatWon(quote.finalPrice)} strong />
          </dl>
        </CardContent>
        <CardFooter>
          <Button onClick={onConfirmPrice}>확인</Button>
        </CardFooter>
      </Card>
    )
  }

  const { summary } = quote
  const options = summary.options.length > 0 ? summary.options.map((option) => option.name).join(', ') : '기본 제공'
  return (
    <Card>
      <CardHeader>
        <CardTitle>가격 요약</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          <Row label="상품" value={summary.title} />
          <Row label="출발일" value={`${formatDate(summary.departureDate)} · ${summary.duration}일`} />
          <Row label="투어 등급" value={summary.levelName} />
          <Row label="인원" value={`${summary.headcount}명`} />
          <Row label="옵션" value={options} />
          <Row label="할인 전 총 가격" value={formatWon(quote.totalPrice)} />
          <Row label="할인 금액" value={quote.discount > 0 ? `−${formatWon(quote.discount)}` : '없음'} />
          <Row label="최종 가격" value={formatWon(quote.finalPrice)} strong />
        </dl>
      </CardContent>
    </Card>
  )
}
