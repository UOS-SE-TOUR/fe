// 카카오 우편번호 서비스(가이드 https://postcode.map.kakao.com/guide). 주소에 ?파라미터를 붙이면 스크립트가 스스로 멈춘다
export const POSTCODE_SCRIPT_URL = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
// 막힌 네트워크는 오류 없이 오래 걸리기도 해서 이만큼 기다린 뒤 실패로 본다
export const POSTCODE_LOAD_TIMEOUT_MS = 10_000

// 고른 주소에서 쓰는 값만 적는다. userSelectedType은 R이면 도로명, J면 지번 주소를 고른 것이다.
// 도로명과 지번이 1:N이면 주소 칸이 비고, auto 칸에 이어진 첫 주소가 들 수 있다(값이 없으면 빈 글자)
export interface PostcodeData {
  zonecode: string
  roadAddress: string
  jibunAddress: string
  autoRoadAddress: string
  autoJibunAddress: string
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

// 붙인 스크립트 하나를 받는 동안의 약속. 받지 못하면 스크립트를 떼고 비워, 다음에 부르면 새로 붙인다
let scriptLoading: Promise<void> | null = null

function loadScript(): Promise<void> {
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    const fail = () => {
      script.remove()
      scriptLoading = null
      reject(new Error('카카오 우편번호 서비스를 불러오지 못했다'))
    }
    script.src = POSTCODE_SCRIPT_URL
    script.async = true
    script.onload = () => (postcodeClass() ? resolve() : fail())
    script.onerror = fail
    document.head.append(script)
  })
  return scriptLoading
}

// 정한 시간이 지나면 실패로 본다. 받는 중인 스크립트는 떼어도 받아서 돌 수 있으니 그대로 두고,
// 다시 부르면 새로 붙이지 않고 그것을 다시 기다린다
function withinTimeout(loading: Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('카카오 우편번호 서비스가 늦어 기다리지 않았다')),
      POSTCODE_LOAD_TIMEOUT_MS,
    )
    void loading.then(resolve, reject).finally(() => window.clearTimeout(timer))
  })
}

// 고른 종류의 주소가 비면 같은 종류의 auto 칸을, 그것도 비면 다른 종류의 주소를 쓴다
function formatAddress(data: PostcodeData): string {
  const selected =
    data.userSelectedType === 'J'
      ? data.jibunAddress || data.autoJibunAddress
      : data.roadAddress || data.autoRoadAddress
  return `(${data.zonecode}) ${selected || data.roadAddress || data.jibunAddress}`
}

// 카카오 우편번호 서비스를 감싼다(설계 3장의 외부 서비스 어댑터). load()로 받은 뒤 embed()로 검색 화면을 띄운다
export const AddressSearch = {
  // 처음 부를 때 한 번만 스크립트를 받는다. 받지 못하면 거절하고, 다음에 부르면 다시 받는다
  async load(): Promise<void> {
    if (postcodeClass()) return
    await withinTimeout(loadScript())
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
