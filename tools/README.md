# 도구

모두 저장소 루트에서 실행한다. Node.js 18 이상, Python 3 필요. 브라우저 캡처만 Playwright 가 필요하다.

## 시뮬레이션 (`tools/sim`)
화면 없이 게임 코드를 Node 에서 그대로 돌린다. `index.html` 을 고칠 때마다 먼저 `extract.py` 로 다시 뽑을 것.

| 파일 | 하는 일 |
|---|---|
| `extract.py` | `index.html` → `build/game.js`(원본), `build/game_i.js`(계측판: 피격 훅, 시간·딜 기록 노출) |
| `harness.js` | 가짜 캔버스·DOM·키 입력·rAF. `require('./harness')('game.js')` → `{M, fire, step, T}` |
| `smoke.js` | 2분 회귀 점검. 무기 8종 최대 + 진화 4개, 최악·평균 프레임 시간 출력 |
| `bot.js` | 봇으로 한 판. 모드 `ram`(돌진형: 작게 가속 → 충돌 직전 커짐, 에너지 낮으면 회복), `kite`(회피형), `noweap`(무기 카드 기피) |
| `matrix.sh` | 무기 8 단독 + 진화 28 을 후반 모의(적 체력 30배, 무적 봇, 2분×시드 2개)로 돌려 8×8 표 |
| `agg.py` | `matrix.sh` 결과 폴더 → 8×8 표 출력 |
| `screenshot.py` | 실제 Chrome 으로 장면 캡처 (`pip install playwright && playwright install chromium`) |

### `bot.js` 환경 변수
| 변수 | 의미 |
|---|---|
| `W=무기키` | 그 무기만 들고 시작 (`LV=1` 이면 1레벨, 없으면 최대) |
| `EVK=a+b` | 그 진화 + 재료 무기 최대로 시작 |
| `LATE=1 HM=30` | 무적 + 적 체력 HM배 + 10초마다 60마리 투입 — 강한 조합끼리도 차이가 나는 측정 |
| `DUMMY=1` | 무적 + 죽지 않는 표적 150마리 — 잠재 화력 (밀집 범위 공격이 과대평가됨) |

출력(W/EVK 모드) 첫 줄 JSON: `wdps`(무기·진화 초당 피해), `share`(무기 몫 %), `core`(몸통 충돌+당구+체렌코프 %), `surv`(생존 분), `dead`, `kills`.

### 측정 시 주의
- 랜덤 봇이라 같은 조건도 ±15~20% 흔들린다. 시드 2개 이상, 차이가 작으면 결론 내지 말 것.
- 적이 금방 다 죽는 조건에서는 강한 조합끼리 수치가 천장에 막힌다 → `LATE=1 HM=30` 사용.
- 봇은 사람처럼 포위를 읽지 못하므로 **생존 시간은 실제보다 짧다.** 피해 비중 비교용으로 쓸 것.

## 문서 생성
`node tools/gen_docs.js` — `index.html` 의 카드·진화·특수 능력을 읽어 `docs/CONTENT.md` 를 다시 만든다 (먼저 `extract.py`).
