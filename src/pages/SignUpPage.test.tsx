import { screen } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTION_FAILED_MESSAGE } from '@/modules/ApiClient'
import { AuthStore } from '@/modules/AuthStore'
import { jsonResponse, stubFetch } from '@/test/http'
import { renderAt, sentRequest } from '@/test/router'

let fetchMock: ReturnType<typeof stubFetch>
let user: UserEvent

beforeEach(() => {
  fetchMock = stubFetch()
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
  vi.spyOn(toast, 'success').mockImplementation(() => 'toast')
  user = userEvent.setup()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  AuthStore.clear()
})

const customer = {
  loginId: 'hong',
  password: 'password1',
  name: '홍길동',
  address: '서울시 동대문구 서울시립대로 163',
  phone: '010-1234-5678',
}

async function fillForm() {
  await user.type(screen.getByLabelText('아이디'), customer.loginId)
  await user.type(screen.getByLabelText('비밀번호'), customer.password)
  await user.type(screen.getByLabelText('성명'), customer.name)
  await user.type(screen.getByLabelText('주소'), customer.address)
  await user.type(screen.getByLabelText('연락처'), customer.phone)
}

function submit() {
  return user.click(screen.getByRole('button', { name: '가입하기' }))
}

describe('SignUpPage', () => {
  it('직원 코드 칸은 직원을 골랐을 때만 보인다', async () => {
    renderAt('/signup')

    expect(screen.getByRole('radio', { name: '고객' })).toBeChecked()
    expect(screen.queryByLabelText('직원 코드')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: '직원' }))
    expect(screen.getByLabelText('직원 코드')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: '고객' }))
    expect(screen.queryByLabelText('직원 코드')).not.toBeInTheDocument()
  })

  it('고객으로 가입하면 직원 코드 없이 보내고, 가입했다고 알린 뒤 로그인 화면으로 보낸다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { memberId: 1 }))
    const router = renderAt('/signup')

    await fillForm()
    await submit()

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(sentRequest(fetchMock)).toEqual({
      path: '/api/v1/members/signup',
      method: 'POST',
      body: { ...customer, memberType: 'CUSTOMER' },
    })
    expect(toast.success).toHaveBeenCalledWith('가입했습니다. 로그인해 주세요.')
  })

  it('직원으로 가입하면 입력한 직원 코드를 함께 보낸다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { memberId: 2 }))
    renderAt('/signup')

    await fillForm()
    await user.click(screen.getByRole('radio', { name: '직원' }))
    await user.type(screen.getByLabelText('직원 코드'), 'staff-code-1234')
    await submit()

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(sentRequest(fetchMock).body).toEqual({ ...customer, memberType: 'STAFF', staffCode: 'staff-code-1234' })
  })

  it('직원 코드를 넣었다가 고객으로 되돌리면 직원 코드를 보내지 않는다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { memberId: 3 }))
    renderAt('/signup')

    await fillForm()
    await user.click(screen.getByRole('radio', { name: '직원' }))
    await user.type(screen.getByLabelText('직원 코드'), 'staff-code-1234')
    await user.click(screen.getByRole('radio', { name: '고객' }))
    await submit()

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(sentRequest(fetchMock).body).toEqual({ ...customer, memberType: 'CUSTOMER' })
  })

  it('가입 실패(400)면 서버 문구를 화면에 보이고 입력한 내용을 그대로 둔다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: '이미 쓰는 아이디입니다.' }))
    const router = renderAt('/signup')

    await fillForm()
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent('이미 쓰는 아이디입니다.')
    expect(router.state.location.pathname).toBe('/signup')
    expect(screen.getByLabelText('아이디')).toHaveValue(customer.loginId)
    expect(screen.getByLabelText('주소')).toHaveValue(customer.address)
    expect(screen.getByRole('button', { name: '가입하기' })).toBeEnabled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('400이 아닌 실패는 공용 알림으로 보인다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const router = renderAt('/signup')

    await fillForm()
    await submit()

    expect(toast.error).toHaveBeenCalledWith(CONNECTION_FAILED_MESSAGE)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/signup')
  })

  it('로그인 링크로 로그인 화면에 간다', async () => {
    const router = renderAt('/signup')

    await user.click(screen.getByRole('link', { name: '로그인' }))

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})
