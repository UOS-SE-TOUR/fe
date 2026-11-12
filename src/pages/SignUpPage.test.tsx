import { fireEvent, screen } from '@testing-library/react'
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

  it('입력을 바꾸면(회원 구분도) 앞의 실패 문구를 지운다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: '직원 코드가 맞지 않아 직원으로 가입할 수 없습니다.' }))
    renderAt('/signup')

    await fillForm()
    await user.click(screen.getByRole('radio', { name: '직원' }))
    await user.type(screen.getByLabelText('직원 코드'), 'wrong-code')
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('직원 코드가 맞지 않아 직원으로 가입할 수 없습니다.')

    await user.click(screen.getByRole('radio', { name: '고객' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('연락처 칸이 받지 않은 입력으로는 실패 문구를 지우지 않는다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: '연락처는 휴대폰 번호로 입력해 주세요(예: 010-1234-5678).' }))
    renderAt('/signup')

    await fillForm()
    await submit()
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.type(screen.getByLabelText('연락처'), '9')
    expect(screen.getByLabelText('연락처')).toHaveValue('010-1234-5678')
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.type(screen.getByLabelText('연락처'), '{Backspace}')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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

  it('연락처를 숫자만 쳐도 하이픈을 붙여 보이고, 보이는 꼴 그대로 보낸다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { memberId: 4 }))
    renderAt('/signup')

    await fillForm()
    const phone = screen.getByLabelText('연락처')
    await user.clear(phone)
    await user.type(phone, '010')
    expect(phone).toHaveValue('010')
    await user.type(phone, '1')
    expect(phone).toHaveValue('010-1')
    await user.type(phone, '23456789')
    expect(phone).toHaveValue('010-1234-5678')
    await submit()

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(sentRequest(fetchMock).body).toEqual({ ...customer, memberType: 'CUSTOMER' })
  })

  it('+82 번호를 붙여 넣으면 국내 번호로 바꿔 보인다', async () => {
    renderAt('/signup')
    const phone = screen.getByLabelText('연락처')

    await user.click(phone)
    await user.paste('+82 10-1234-5678')

    expect(phone).toHaveValue('010-1234-5678')
  })

  it('가운데 숫자를 고쳐도 커서가 고친 자리에 남는다', async () => {
    renderAt('/signup')
    const phone = screen.getByLabelText<HTMLInputElement>('연락처')
    await user.type(phone, '01012345678')

    // 010-12|34-5678에서 2를 지우고 9를 친다
    await user.type(phone, '{Backspace}', { initialSelectionStart: 6, initialSelectionEnd: 6 })
    expect(phone).toHaveValue('010-1345-678')
    expect(phone.selectionStart).toBe(5)
    await user.type(phone, '9', { skipClick: true })

    expect(phone).toHaveValue('010-1934-5678')
    expect(phone.selectionStart).toBe(6)
  })

  it('꽉 찬 연락처 가운데에 더 쳐도 값과 커서가 그대로다', async () => {
    renderAt('/signup')
    const phone = screen.getByLabelText<HTMLInputElement>('연락처')
    await user.type(phone, '01012345678')

    // 010-12|34-5678
    await user.type(phone, '9', { initialSelectionStart: 6, initialSelectionEnd: 6 })

    expect(phone).toHaveValue('010-1234-5678')
    expect(phone.selectionStart).toBe(6)
  })

  it('값이 그대로인 입력 뒤의 자동 완성은 그 앞 입력의 고른 범위를 쓰지 않는다', async () => {
    renderAt('/signup')
    const phone = screen.getByLabelText<HTMLInputElement>('연락처')
    await user.type(phone, '01012345678')

    // 010-1234-[5]678의 5를 5로 바꿨다. 값이 그대로라 onChange가 오지 않는다
    await user.type(phone, '5', { initialSelectionStart: 9, initialSelectionEnd: 10 })
    expect(phone).toHaveValue('010-1234-5678')

    // beforeinput 없이 들어온 11자리 넘는 자동 완성은 받지 않고, 커서는 넣은 글자 수로 되짚은 자리에 둔다
    fireEvent.input(phone, { target: { value: '010-1234-56789' } })
    expect(phone).toHaveValue('010-1234-5678')
    expect([phone.selectionStart, phone.selectionEnd]).toEqual([13, 13])
  })

  it('하이픈 바로 뒤에서 Backspace를 누르면 하이픈 앞의 숫자를 지운다', async () => {
    renderAt('/signup')
    const phone = screen.getByLabelText<HTMLInputElement>('연락처')
    await user.type(phone, '01012345678')

    // 010-1234-|5678
    await user.type(phone, '{Backspace}', { initialSelectionStart: 9, initialSelectionEnd: 9 })

    expect(phone).toHaveValue('010-1235-678')
    expect(phone.selectionStart).toBe(7)
  })

  it('하이픈 하나만 골라 지우면 번호가 그대로다', async () => {
    renderAt('/signup')
    const phone = screen.getByLabelText<HTMLInputElement>('연락처')
    await user.type(phone, '01012345678')

    // 010-1234[-]5678
    await user.type(phone, '{Backspace}', { initialSelectionStart: 8, initialSelectionEnd: 9 })
    expect(phone).toHaveValue('010-1234-5678')

    // 고른 뒤에 커서만 두고 지우면 다시 하이픈 앞의 숫자를 지운다
    await user.type(phone, '{Backspace}', { initialSelectionStart: 9, initialSelectionEnd: 9 })
    expect(phone).toHaveValue('010-1235-678')
  })

  it('하이픈 바로 앞에서 Delete를 누르면 하이픈 뒤의 숫자를 지운다', async () => {
    renderAt('/signup')
    const phone = screen.getByLabelText<HTMLInputElement>('연락처')
    await user.type(phone, '01012345678')

    // 010-1234|-5678
    await user.type(phone, '{Delete}', { initialSelectionStart: 8, initialSelectionEnd: 8 })

    expect(phone).toHaveValue('010-1234-678')
    expect(phone.selectionStart).toBe(8)
  })

  it('로그인 링크로 로그인 화면에 간다', async () => {
    const router = renderAt('/signup')

    await user.click(screen.getByRole('link', { name: '로그인' }))

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})
