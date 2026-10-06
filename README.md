# 오월 · 우리의 결혼 준비

결혼 준비 엑셀의 일정·예산·업체 비교를 웹에서 관리하는 한국어 반응형 플랫폼입니다. GitHub Pages용 정적 웹앱이며 개인 기록은 배포 소스와 분리됩니다.

## 사용 기능

- 결혼식 날짜 기준 일정, 담당자, 완료 체크, 월별 달력, ICS 캘린더 내보내기
- 예상 비용·계약 금액·기납부액·잔금, 신랑/신부 부담 비율, 웨딩홀 견적 계산기
- 신혼집 자금 계획: 월초 자금, 수입·지출·대출·상환, 예정/완료별 월말 잔액
- 업체 견적·선호도·계약 상태 비교, 업체별 웨딩홀 투어 체크리스트
- 동반인 포함 하객 수, 참석 여부, 청첩장 전달 체크
- 준비 노트, 상견례 내용·청첩장 문구 편집 및 비공개 미리보기
- 원본 결혼 준비 XLSX 가져오기, JSON 백업/복원, 편집 가능한 Excel 내보내기
- 선택형 Supabase 공동 공간: 이메일 인증, 2인 초대, 버전 충돌 보호

## 시작하기

Node.js 22 이상, pnpm 11을 사용합니다.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

```sh
pnpm test
pnpm build
pnpm preview
```

첫 실행 시 기본 예산 3,000만 원과 일반 준비 일정만 표시됩니다. 실제 이름·날짜·금액은 **설정**에서 입력하거나 **엑셀 가져오기**로 읽어오세요. 원본 엑셀은 변경하지 않습니다. 원본의 월별 납부 예정액은 결제 완료로 판단하지 않으며, 확인할 내용은 가져오기 화면에 표시됩니다.

## 배포

저장소 Settings → Pages → Source를 **GitHub Actions**로 설정합니다. `main` 브랜치 push 시 테스트와 빌드를 통과한 `dist`만 배포합니다. 상대 경로 asset과 hash navigation으로 `/wed-plan/` 하위 경로 및 새로고침을 지원합니다.

예정 주소: https://2080fresh.github.io/wed-plan/

공식 참고: [GitHub Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Vite 정적 배포](https://vite.dev/guide/static-deploy.html).

## 두 사람이 함께 사용하기

**GitHub Pages 배포만으로 기기 간 데이터가 공유되지는 않습니다.** [공동 저장 설정 안내](docs/SHARED-SETUP.md)를 따라 Supabase 프로젝트를 만들고 SQL을 실행한 뒤 두 기기에 연결합니다. 로그인 링크 발송에는 Supabase의 이메일 발송 설정이 필요합니다.

기기에 자동 저장되지만 공동 공간은 **명시적인 가져오기 / 저장** 방식입니다. 상대방이 먼저 저장하면 덮어쓰기를 거부합니다. 충돌 시 내 기록을 백업하고 최신 내용을 가져와 수정 사항을 반영하세요. 실시간 자동 병합은 제공하지 않습니다.

## 데이터 보관

- 원본 XLSX, `.analysis`, `output`, `node_modules`, 환경 파일은 Git에서 제외됩니다. `dist`에는 개인 엑셀이나 개인 기록을 포함하지 않습니다.
- 브라우저 저장은 해당 기기·브라우저·사이트 주소에 한정됩니다. 데이터를 삭제하면 로컬 기록도 사라지므로 정기적으로 JSON 백업을 보관하세요.
- 기존 기록을 바꾸는 가져오기 작업은 적용 전 백업 파일을 내려받습니다.
- Supabase에는 공개 키만 입력할 수 있으며 RLS로 참여자만 데이터를 읽습니다. 서비스 비밀 키를 입력하지 마세요.
- 현재 상견례·청첩장 기능은 저장된 글의 미리보기 단계입니다. 공개 청첩장 URL, 사진, 지도, RSVP는 향후 확장 범위입니다.
- 드레스 도안의 원본 삽입 이미지는 가져오지 않습니다. 비정형 원본 메모는 준비 노트로 보관합니다.

## 구조

`src/model.ts`: 데이터/계산/백업 검증 · `src/excel.ts`: 엑셀 어댑터 · `src/cloud.ts`: 인증/공유 API · `supabase/setup.sql`: 권한 및 버전 관리 · `src/CashflowView.tsx`: 자금 계획 · `src/App.tsx`: 준비 화면
