import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostcodeData } from '@/modules/AddressSearch'

// 카카오의 Postcode 대신 쓴다. 테스트가 주소 고르기(oncomplete)를 직접 부른다
class FakePostcode {
  static instances: FakePostcode[] = []
  embeddedIn: HTMLElement | null = null
  options: { oncomplete: (data: PostcodeData) => void; width: string; height: string }

  constructor(options: FakePostcode['options']) {
    this.options = options
    FakePostcode.instances.push(this)
  }

  embed(element: HTMLElement) {
    this.embeddedIn = element
  }
}

type Module = typeof import('@/modules/AddressSearch')
let module: Module

// 불러 둔 스크립트(받는 중인 약속)를 테스트마다 비우려고 모듈을 새로 읽는다
beforeEach(async () => {
  vi.resetModules()
  module = await import('@/modules/AddressSearch')
  FakePostcode.instances = []
})

afterEach(() => {
  vi.useRealTimers()
  document.head.querySelectorAll('script').forEach((script) => script.remove())
  delete (window as { kakao?: unknown }).kakao
})

function postcodeScripts(): HTMLScriptElement[] {
  return [...document.head.querySelectorAll<HTMLScriptElement>('script')].filter(
    (script) => script.src === module.POSTCODE_SCRIPT_URL,
  )
}

// jsdom은 외부 스크립트를 돌리지 않는다. 카카오 스크립트가 돈 것처럼 kakao.Postcode를 두고 load를 보낸다
function finishLoading(script: HTMLScriptElement) {
  ;(window as { kakao?: unknown }).kakao = { Postcode: FakePostcode }
  script.dispatchEvent(new Event('load'))
}

async function loadedSearch() {
  const loading = module.AddressSearch.load()
  finishLoading(postcodeScripts()[0])
  await loading
  return module.AddressSearch
}

function choose(data: Partial<PostcodeData>) {
  const postcode = FakePostcode.instances.at(-1)
  if (!postcode) throw new Error('Postcode를 만들지 않았다')
  postcode.options.oncomplete({
    zonecode: '02504',
    roadAddress: '서울 동대문구 서울시립대로 163',
    jibunAddress: '서울 동대문구 전농동 90',
    autoRoadAddress: '',
    autoJibunAddress: '',
    userSelectedType: 'R',
    ...data,
  })
}

describe('AddressSearch.load', () => {
  it('처음 부를 때 스크립트를 한 번만 붙이고, 함께 부른 쪽도 같이 끝난다', async () => {
    const first = module.AddressSearch.load()
    const second = module.AddressSearch.load()

    expect(postcodeScripts()).toHaveLength(1)
    expect(postcodeScripts()[0].async).toBe(true)

    finishLoading(postcodeScripts()[0])
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()

    await module.AddressSearch.load()
    expect(postcodeScripts()).toHaveLength(1)
  })

  it('스크립트를 받지 못하면 거절하고, 다음에 부르면 다시 받는다', async () => {
    const failed = module.AddressSearch.load()
    postcodeScripts()[0].dispatchEvent(new Event('error'))

    await expect(failed).rejects.toThrow()
    expect(postcodeScripts()).toHaveLength(0)

    const retried = module.AddressSearch.load()
    expect(postcodeScripts()).toHaveLength(1)
    finishLoading(postcodeScripts()[0])
    await expect(retried).resolves.toBeUndefined()
  })

  it('스크립트가 돌았는데 kakao.Postcode가 없으면 거절한다', async () => {
    const loading = module.AddressSearch.load()
    postcodeScripts()[0].dispatchEvent(new Event('load'))

    await expect(loading).rejects.toThrow()
    expect(postcodeScripts()).toHaveLength(0)
  })

  it('정한 시간 안에 받지 못하면 그 스크립트를 버리고 거절하며, 다시 부르면 새로 붙인다', async () => {
    vi.useFakeTimers()
    const loading = module.AddressSearch.load()
    const rejected = expect(loading).rejects.toThrow()

    vi.advanceTimersByTime(module.POSTCODE_LOAD_TIMEOUT_MS - 1)
    const stalled = postcodeScripts()[0]
    expect(stalled.isConnected).toBe(true)
    vi.advanceTimersByTime(1)
    await rejected
    expect(stalled.isConnected).toBe(false)

    const retried = module.AddressSearch.load()
    expect(postcodeScripts()).toHaveLength(1)
    expect(postcodeScripts()[0]).not.toBe(stalled)
    finishLoading(postcodeScripts()[0])
    await expect(retried).resolves.toBeUndefined()
  })

  it('버린 스크립트가 늦게 돌면, 다음에 부를 때 새로 붙이지 않고 바로 끝난다', async () => {
    vi.useFakeTimers()
    const loading = module.AddressSearch.load()
    const rejected = expect(loading).rejects.toThrow()
    const stalled = postcodeScripts()[0]
    vi.advanceTimersByTime(module.POSTCODE_LOAD_TIMEOUT_MS)
    await rejected

    finishLoading(stalled)

    await expect(module.AddressSearch.load()).resolves.toBeUndefined()
    expect(postcodeScripts()).toHaveLength(0)
  })
})

describe('AddressSearch.embed', () => {
  it('받은 자리에 검색 화면을 꽉 차게 띄운다', async () => {
    const search = await loadedSearch()
    const element = document.createElement('div')

    search.embed(element, () => {})

    const postcode = FakePostcode.instances.at(-1)
    expect(postcode?.embeddedIn).toBe(element)
    expect(postcode?.options).toMatchObject({ width: '100%', height: '100%' })
  })

  it('도로명 주소를 고르면 우편번호와 도로명 주소를 준다', async () => {
    const search = await loadedSearch()
    const onselect = vi.fn()
    search.embed(document.createElement('div'), onselect)

    choose({ userSelectedType: 'R' })

    expect(onselect).toHaveBeenCalledWith('(02504) 서울 동대문구 서울시립대로 163')
  })

  it('지번 주소를 고르면 우편번호와 지번 주소를 준다', async () => {
    const search = await loadedSearch()
    const onselect = vi.fn()
    search.embed(document.createElement('div'), onselect)

    choose({ userSelectedType: 'J' })

    expect(onselect).toHaveBeenCalledWith('(02504) 서울 동대문구 전농동 90')
  })

  it('고른 종류의 주소가 비었으면 같은 종류의 auto 주소를 준다', async () => {
    const search = await loadedSearch()
    const onselect = vi.fn()
    search.embed(document.createElement('div'), onselect)

    choose({ userSelectedType: 'J', jibunAddress: '', autoJibunAddress: '서울 동대문구 전농동 90-1' })
    choose({ userSelectedType: 'R', roadAddress: '', autoRoadAddress: '서울 동대문구 서울시립대로 165' })

    expect(onselect).toHaveBeenNthCalledWith(1, '(02504) 서울 동대문구 전농동 90-1')
    expect(onselect).toHaveBeenNthCalledWith(2, '(02504) 서울 동대문구 서울시립대로 165')
  })

  it('고른 종류의 주소가 auto 칸까지 비었으면 다른 종류의 주소를 준다', async () => {
    const search = await loadedSearch()
    const onselect = vi.fn()
    search.embed(document.createElement('div'), onselect)

    choose({ userSelectedType: 'J', jibunAddress: '' })

    expect(onselect).toHaveBeenCalledWith('(02504) 서울 동대문구 서울시립대로 163')
  })

  it('불러오기 전에 부르면 오류를 낸다', () => {
    expect(() => module.AddressSearch.embed(document.createElement('div'), () => {})).toThrow()
  })
})
