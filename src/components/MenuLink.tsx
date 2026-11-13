import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

interface MenuLinkProps {
  to: string
  label: string
  // 두 번 처리되면 안 되는 요청을 보내는 동안. 링크 대신 막힌 단추를 보인다
  disabled: boolean
}

// 화면 머리말에서 고객·직원 메뉴로 돌아가는 링크
export function MenuLink({ to, label, disabled }: MenuLinkProps) {
  if (disabled) {
    return (
      <Button variant="outline" disabled>
        {label}
      </Button>
    )
  }
  return (
    <Button variant="outline" asChild>
      <Link to={to}>{label}</Link>
    </Button>
  )
}
