import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddressSearch } from '@/modules/AddressSearch'
import { CONNECTION_FAILED_MESSAGE } from '@/modules/ApiClient'
import { AuthStore } from '@/modules/AuthStore'
import { jsonResponse, stubFetch } from '@/test/http'
import { renderAt, sentRequest } from '@/test/router'

let fetchMock: ReturnType<typeof stubFetch>
let user: UserEvent
// 가짜 검색 화면을 띄운 자리와, 거기서 주소를 고르는 함수
let searchTarget: HTMLElement | null
let selectAddress: ((address: string) => void) | null

beforeEach(() => {
  fetchMock = stubFetch()
  vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
  vi.spyOn(toast, 'success').mockImplementation(() => 'toast')
  vi.spyOn(toast, 'info').mockImplementation(() => 'toast')
  searchTarget = null
  selectAddress = null
  vi.spyOn(AddressSearch, 'load').mockResolvedValue()
  // 카카오 검색 화면처럼 받은 자리에 무언가를 붙인다
  vi.spyOn(AddressSearch, 'embed').mockImplementation((element, onselect) => {
    element.append(document.createElement('iframe'))
    searchTarget = element
    selectAddress = onselect
  })
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
  address: '(02504) 서울 동대문구 서울시립대로 163',
  phone: '010-1234-5678',
}

const ADDRESS_SEARCH_FAILED = '주소 검색을 불러오지 못했습니다. 주소를 직접 입력해 주세요.'

// 화면 낭독기 알림 자리에 들어가고, 주소 칸의 설명으로도 보인다
async function expectAddressSearchFailed() {
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(ADDRESS_SEARCH_FAILED))
  expect(screen.getByLabelText('주소')).toHaveAccessibleDescription(ADDRESS_SEARCH_FAILED)
}

async function openAddressSearch() {
  await user.click(screen.getByRole('button', { name: '주소 검색' }))
  return screen.findByRole('dialog', { name: '주소 검색' })
}

async function chooseAddress(address: string) {
  await openAddressSearch()
  act(() => selectAddress?.(address))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

async function fillForm({ address = customer.address }: { address?: string | null } = {}) {
  await user.type(screen.getByLabelText('아이디'), customer.loginId)
  await user.type(screen.getByLabelText('비밀번호'), customer.password)
  await user.type(screen.getByLabelText('성명'), customer.name)
  if (address !== null) await chooseAddress(address)
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
    await user.type(phone, '2345678')
    expect(phone).toHaveValue('010-1234-5678')
    expect(toast.info).not.toHaveBeenCalled()
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
    expect(toast.info).toHaveBeenCalledWith('휴대폰 번호는 11자리까지 입력할 수 있습니다.', {
      id: 'signup-phone-max-digits',
    })
  })

  it('쓰던 번호에 번호 전체를 붙여 넣으면 받지 않고 11자리까지라고 알린다', async () => {
    renderAt('/signup')
    const phone = screen.getByLabelText<HTMLInputElement>('연락처')
    await user.type(phone, '01012')

    await user.paste('01099998888')

    expect(phone).toHaveValue('010-12')
    expect([phone.selectionStart, phone.selectionEnd]).toEqual([6, 6])
    expect(toast.info).toHaveBeenCalledWith('휴대폰 번호는 11자리까지 입력할 수 있습니다.', {
      id: 'signup-phone-max-digits',
    })
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

  it('주소 칸은 직접 고칠 수 없고, 주소 검색 팝업에서 고른 주소가 들어간 뒤 상세 주소 칸으로 간다', async () => {
    renderAt('/signup')
    const address = screen.getByLabelText('주소')

    expect(address).toHaveAttribute('readonly')
    await user.type(address, '아무 글자')
    expect(address).toHaveValue('')

    const dialog = await openAddressSearch()
    expect(dialog).toContainElement(searchTarget)
    expect(AddressSearch.embed).toHaveBeenCalledTimes(1)

    act(() => selectAddress?.(customer.address))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(address).toHaveValue(customer.address)
    expect(screen.getByLabelText('상세 주소')).toHaveFocus()
  })

  it('다시 검색하면 고른 주소로 바뀌고, 그냥 닫으면 주소가 그대로다', async () => {
    renderAt('/signup')
    await chooseAddress(customer.address)

    await chooseAddress('(01234) 서울 종로구 세종대로 1')
    expect(screen.getByLabelText('주소')).toHaveValue('(01234) 서울 종로구 세종대로 1')

    await openAddressSearch()
    await user.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('주소')).toHaveValue('(01234) 서울 종로구 세종대로 1')
    expect(screen.getByRole('button', { name: '주소 검색' })).toHaveFocus()
  })

  it('고른 주소와 상세 주소를 한 칸 띄워 한 줄로 보낸다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { memberId: 5 }))
    renderAt('/signup')

    await fillForm()
    await user.type(screen.getByLabelText('상세 주소'), '  21세기관 101호 ')
    await submit()

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(sentRequest(fetchMock).body).toEqual({
      ...customer,
      address: '(02504) 서울 동대문구 서울시립대로 163 21세기관 101호',
      memberType: 'CUSTOMER',
    })
  })

  it('주소를 검색하지 않으면 상세 주소가 있어도 빈 주소를 보내고, 서버 문구를 보인다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: '주소를 입력해 주세요.' }))
    renderAt('/signup')

    await fillForm({ address: null })
    await user.type(screen.getByLabelText('상세 주소'), '101호')
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent('주소를 입력해 주세요.')
    expect(sentRequest(fetchMock).body).toEqual({ ...customer, address: '', memberType: 'CUSTOMER' })
  })

  it('검색 화면을 불러오는 동안에는 주소 검색 단추를 막는다', async () => {
    let finishLoading: () => void = () => {}
    vi.mocked(AddressSearch.load).mockReturnValue(new Promise((resolve) => (finishLoading = resolve)))
    renderAt('/signup')

    await user.click(screen.getByRole('button', { name: '주소 검색' }))
    expect(screen.getByRole('button', { name: '주소 검색' })).toBeDisabled()

    act(() => finishLoading())
    expect(await screen.findByRole('dialog', { name: '주소 검색' })).toBeInTheDocument()
    expect(AddressSearch.load).toHaveBeenCalledTimes(1)
  })

  it('우편번호 서비스를 불러오지 못하면 알리고, 주소를 직접 입력해 가입할 수 있다', async () => {
    vi.mocked(AddressSearch.load).mockRejectedValue(new Error('blocked'))
    fetchMock.mockResolvedValue(jsonResponse(201, { memberId: 6 }))
    renderAt('/signup')

    await fillForm({ address: null })
    await user.click(screen.getByRole('button', { name: '주소 검색' }))

    await expectAddressSearchFailed()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const address = screen.getByLabelText('주소')
    expect(address).not.toHaveAttribute('readonly')
    expect(address).toHaveFocus()

    await user.type(address, '서울시 동대문구 서울시립대로 163')
    await user.type(screen.getByLabelText('상세 주소'), '21세기관 101호')
    await submit()

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(sentRequest(fetchMock).body).toEqual({
      ...customer,
      address: '서울시 동대문구 서울시립대로 163 21세기관 101호',
      memberType: 'CUSTOMER',
    })
    expect(AddressSearch.embed).not.toHaveBeenCalled()
  })

  it('불러오기를 기다리는 사이 다른 칸으로 옮겼으면, 실패해도 초점을 빼앗지 않는다', async () => {
    let failLoading: () => void = () => {}
    vi.mocked(AddressSearch.load).mockReturnValue(new Promise((_, reject) => (failLoading = () => reject(new Error('timeout')))))
    renderAt('/signup')

    await user.click(screen.getByRole('button', { name: '주소 검색' }))
    const phone = screen.getByLabelText('연락처')
    await user.click(phone)
    act(() => failLoading())

    await expectAddressSearchFailed()
    expect(phone).toHaveFocus()
  })

  it('불러오지 못한 뒤 다시 눌러 불러오면 알림을 지우고 검색 팝업을 연다', async () => {
    vi.mocked(AddressSearch.load).mockRejectedValueOnce(new Error('offline'))
    renderAt('/signup')

    await user.click(screen.getByRole('button', { name: '주소 검색' }))
    await expectAddressSearchFailed()

    await chooseAddress(customer.address)
    expect(screen.queryByText(ADDRESS_SEARCH_FAILED)).not.toBeInTheDocument()
    expect(screen.getByLabelText('주소')).toHaveValue(customer.address)
    expect(screen.getByLabelText('주소')).toHaveAttribute('readonly')
  })

  it('불러오지 못해 직접 친 주소는, 다시 불러온 검색을 고르지 않고 닫아도 계속 고칠 수 있다', async () => {
    vi.mocked(AddressSearch.load).mockRejectedValueOnce(new Error('offline'))
    renderAt('/signup')

    await user.click(screen.getByRole('button', { name: '주소 검색' }))
    const address = screen.getByLabelText('주소')
    await user.type(address, '서울시 동대문구')

    await openAddressSearch()
    await user.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(screen.queryByText(ADDRESS_SEARCH_FAILED)).not.toBeInTheDocument()
    expect(address).not.toHaveAttribute('readonly')
    await user.type(address, ' 서울시립대로 163')
    expect(address).toHaveValue('서울시 동대문구 서울시립대로 163')
  })

  it('StrictMode로 띄워도 검색 화면은 한 번만 띄운다', async () => {
    renderAt('/signup', { strict: true })

    await openAddressSearch()

    expect(AddressSearch.embed).toHaveBeenCalledTimes(1)
    expect(searchTarget?.childElementCount).toBe(1)
  })

  it('로그인 링크로 로그인 화면에 간다', async () => {
    const router = renderAt('/signup')

    await user.click(screen.getByRole('link', { name: '로그인' }))

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})
