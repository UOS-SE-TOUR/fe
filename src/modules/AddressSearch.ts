// 카카오 우편번호 서비스(가이드 https://postcode.map.kakao.com/guide). 주소에 ?파라미터를 붙이면 스크립트가 스스로 멈춘다
export const POSTCODE_SCRIPT_URL = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
// 막힌 네트워크는 오류 없이 오래 걸리기도 해서 이만큼 기다린 뒤 실패로 본다
export const POSTCODE_LOAD_TIMEOUT_MS = 10_000

// 고른 주소에서 쓰는 값만 적는다. userSelectedType은 R이면 도로명, J면 지번 주소를 고른 것이다
export interface PostcodeData {
  zonecode: string
  roadAddress: string
  jibunAddress: string
  userSelectedType: 'R' | 'J'
}

interface PostcodeOptions {
  oncomplete: (data: PostcodeData) => void
  width: string
  height: string
}

interface Postcode {
  embed(element: HTMLElement): void
}

type PostcodeConstructor = new (options: PostcodeOptions) => Postcode

interface WithKakaoPostcode {
  kakao?: { Postcode?: PostcodeConstructor }
}

function postcodeClass(): PostcodeConstructor | null {
  return (window as Window & WithKakaoPostcode).kakao?.Postcode ?? null
}

function loadScript(): Promise<PostcodeConstructor> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const fail = () => {
      window.clearTimeout(timer)
      script.remove()
      reject(new Error('카카오 우편번호 서비스를 불러오지 못했다'))
    }
    const timer = window.setTimeout(fail, POSTCODE_LOAD_TIMEOUT_MS)
    script.src = POSTCODE_SCRIPT_URL
    script.async = true
    script.onload = () => {
      const Constructor = postcodeClass()
      if (!Constructor) return fail()
      window.clearTimeout(timer)
      resolve(Constructor)
    }
    script.onerror = fail
    document.head.append(script)
  })
}

// 고른 종류의 주소가 비었으면 다른 종류로 채운다
function formatAddress(data: PostcodeData): string {
  const selected = data.userSelectedType === 'J' ? data.jibunAddress : data.roadAddress
  return `(${data.zonecode}) ${selected || data.roadAddress || data.jibunAddress}`
}

let loading: Promise<PostcodeConstructor> | null = null

// 카카오 우편번호 서비스를 감싼다(설계 3장의 외부 서비스 어댑터). load()로 받은 뒤 embed()로 검색 화면을 띄운다
export const AddressSearch = {
  // 처음 부를 때 한 번만 스크립트를 받는다. 받지 못하면 거절하고, 다음에 부르면 다시 받는다
  async load(): Promise<void> {
    if (postcodeClass()) return
    loading ??= loadScript().finally(() => {
      loading = null
    })
    await loading
  },

  // element 안에 검색 화면을 띄운다. 주소를 고르면 검색 화면은 스스로 닫히고, onselect로 `(우편번호) 주소`를 준다
  embed(element: HTMLElement, onselect: (address: string) => void) {
    const Constructor = postcodeClass()
    if (!Constructor) throw new Error('AddressSearch.load()가 끝난 뒤에 부른다')
    new Constructor({
      oncomplete: (data) => onselect(formatAddress(data)),
      width: '100%',
      height: '100%',
    }).embed(element)
  },
}
