export function formatWon(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}원`
}

// 서버의 날짜(YYYY-MM-DD)를 시간대와 상관없이 그대로 읽는다
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  return `${year}년 ${Number(month)}월 ${Number(day)}일`
}
