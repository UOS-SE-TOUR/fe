# MWT Web Client

미스터 월드 테마 여행 서비스(MWT)의 화면입니다. 소프트웨어공학(26-2) 팀 최백문 과제입니다.

- 서버: [UOS-SE-TOUR/be](https://github.com/UOS-SE-TOUR/be) — API 문서는 운영 서버의 [Swagger](https://uos-mwt.duckdns.org/api/swagger-ui.html)
- 설계·분석 산출물: [UOS-SE-TOUR/docs](https://github.com/UOS-SE-TOUR/docs) — 화면 클래스는 설계산출물 3장, 서버 API 표는 4.9

React 19 · TypeScript · Vite · Tailwind CSS 4 · [shadcn/ui](https://ui.shadcn.com) · 글꼴 [Pretendard](https://github.com/orioncactus/pretendard)

## 실행

Node.js 22.22.2 이상의 22.x(시험한 버전은 `.nvmrc`의 22.23.2)와 npm이 필요합니다. nvm을 쓰면 `nvm install`로 `.nvmrc`의 버전을 받습니다.

```bash
npm ci
npm run dev
```

Chrome에서 http://localhost:5173 으로 엽니다. 로그인 쿠키는 HTTPS에서만 저장되는데 `localhost`만 예외라서, `--host`로 띄워 `http://192.168.…` 같은 IP 주소로 열면 로그인한 뒤의 요청이 401이 됩니다.

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버(고친 코드가 바로 반영됩니다) |
| `npm run lint` | ESLint 검사 |
| `npm test` | 테스트(Vitest) 한 번 실행 |
| `npm run build` | 타입 검사 뒤 `dist/`에 배포용 파일 만들기 |
| `npm run preview` | 만든 `dist/`를 띄워 보기 |

## 서버 연결

화면 코드는 서버 주소 없이 `/api/v1/tours`처럼 경로만 씁니다. 서버에 CORS 설정이 없어서, 화면을 띄운 쪽의 프록시가 `/api`로 시작하는 요청을 서버로 넘깁니다. 이때 `/api`를 떼지 않고 그대로 넘깁니다(떼면 서버가 404를 냅니다).

- **로컬:** 개발 서버가 `/api` 요청을 `http://localhost:8080`(내 컴퓨터에서 띄운 be)으로 넘깁니다. be를 띄우는 법은 be README의 "실행"을 봅니다.
- **운영 서버에 붙이기:** 테스트 서버가 따로 없어서, 운영 서버에 붙이면 가입·신청한 데이터가 운영 DB에 그대로 남습니다. 신청하면 실제 확정 문자가 나갈 수도 있습니다. 그래도 붙이려면 `.env.local`을 만들고 `API_PROXY_TARGET`에 운영 서버 주소를 넣은 뒤 개발 서버를 다시 띄웁니다.

  ```bash
  cp .env.example .env.local
  ```

  ```
  API_PROXY_TARGET=https://uos-mwt.duckdns.org
  ```

- **배포:** Vercel에 올리면 `vercel.json`이 `/api` 요청을 운영 서버로 넘기고, `/tours` 같은 화면 주소에서 새로고침해도 `index.html`을 돌려줍니다(빌드 파일이 든 `/assets/`만 빼고). 두 규칙의 순서는 바꾸지 않습니다. Node 버전은 `package.json`의 `engines`를 따릅니다.

  PR마다 생기는 프리뷰 배포도 같은 규칙으로 운영 서버에 붙습니다. 프리뷰에서도 가입·신청은 시험하지 않습니다.

서버 쪽 규칙(오류 응답 `{"message": "…"}`, 로그인과 권한)은 be README의 [화면과 연결](https://github.com/UOS-SE-TOUR/be#화면과-연결)·[오류 응답](https://github.com/UOS-SE-TOUR/be#오류-응답)·[로그인과 권한](https://github.com/UOS-SE-TOUR/be#로그인과-권한)에 있습니다.

## 폴더

| 위치 | 담는 것 |
| --- | --- |
| `src/pages/` | 화면(설계의 «Page») — `LoginPage.tsx` 등 |
| `src/components/` | 화면 안의 부품(설계의 «Component») — `OptionPanel.tsx` 등 |
| `src/modules/` | 화면들이 함께 쓰는 코드(설계의 «Module») — `ApiClient.ts` 등 |
| `src/router/` | 화면 주소와 막기(로그인하지 않았거나 다른 회원 구분의 화면이면 다른 화면으로 보내기) |
| `src/lib/` | 설계 클래스가 아닌 공용 코드 — 화면 주소(`pages.ts`), 테마·등급·상태의 화면 이름(`labels.ts`), 로그인 직후 표시(`fromLogin.ts`), 고객·직원 첫 화면의 로그아웃(`logOut.ts`) |
| `src/components/ui/`, `src/hooks/`, `src/lib/utils.ts` | shadcn/ui가 만든 기본 부품(버튼·입력칸·팝업 등). 설계 클래스도에는 그리지 않습니다 |

shadcn/ui 부품은 명령으로 더합니다(예: 팝업).

```bash
npx shadcn add dialog
```

색·모서리 같은 모양은 `src/index.css`의 CSS 변수에서 바꿉니다.
