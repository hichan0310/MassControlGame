# CLAUDE.md — 이 저장소에서 일하는 Claude 를 위한 안내

## 프로젝트 한 줄 요약
크기(질량)를 조작해 운동량으로 적 무리를 들이받는 2D 생존 액션. **`index.html` 단일 파일**(약 2,200줄, Canvas 2D + Web Audio, 외부 의존성 없음)에 게임 전체가 들어 있다.

## 디자이너(사용자)와 일하는 방식 — 꼭 지킬 것
- **응답은 한국어.** 코드 주석도 한국어로 쓴다.
- **핵심 재미는 "작게 가속 → 부딪히기 직전 커져서 무리를 뚫는 손맛".** 무기·스킬이 이걸 가리면 안 된다. 충돌로 발동하는 무기는 충돌 세기(충격량 J)에 비례하게 만드는 것이 원칙(연쇄 번개, 추가 탄환이 그렇게 되어 있음).
- **물리적으로 창발하는 메커니즘을 선호.** 예: 체렌코프(소닉붐) 원뿔은 그림으로 그린 게 아니라 실제 파면의 교차선으로 계산되고, 판정도 그 선과 같다. "그럴듯한 연출로 흉내" 내지 말 것.
- **화면 텍스트 남발 금지.** "싹쓸이", "음속 돌파", "WAVE", "준비됨" 같은 문구를 사용자가 모두 지우게 했다. 새 기능에 글자 배너를 붙이지 말 것. 슬로모션도 금지.
- 사용자가 지정한 사양은 **문자 그대로** 구현한다. 해석이 갈리면 확인하고, 임의로 "비슷한 것"을 만들지 말 것 (예: "탄환 대신 블랙홀이 탄환처럼 나간다"는 탄환을 없애라는 뜻이었다).
- **박는 쪽이 피하는 쪽보다 이득이어야 한다.** 회복(충돌 회복)·경험치(관통 배율)도 들이받기에 묶여 있다. 새 기능이 피해 다니는 플레이를 더 이롭게 만들지 않는지 `stance.sh` 로 확인.
- 밸런스 원칙: **강한 건 강해도 되지만, 약한 게 너무 약하면 안 된다.** 저절로 발동하는 무기(미사일·지뢰·자기장·위성)는 일부러 0.6배(`PAS`)로 낮춰 두었다.
- 바꾼 뒤에는 실제로 돌려서 확인한다(아래 테스트). 확인 못 한 건 확인 못 했다고 말한다.

> 다른 컴퓨터(노트북)에서 강화학습을 돕거나 이어받는 세션이라면 먼저 `tools/rl/REMOTE.md` 를 읽을 것.

## 실행·테스트
```bash
# 게임: 브라우저로 index.html 열기
python3 tools/sim/extract.py      # index.html → tools/sim/build/game.js, game_i.js(계측판)
node tools/sim/smoke.js           # 2분 회귀 점검 (오류·프레임 시간)
node tools/sim/bot.js ram 7 5     # 돌진형 봇 5분 (딜 출처·생존 출력)
sh tools/sim/matrix.sh            # 무기 8 + 진화 28 의 8×8 밸런스 표 (10~15분)
# 봇 관전: 브라우저로 index.html#bot=pro&speed=2 열기 (tools/sim/pro.js 를 불러와 대신 플레이), #bot=rl&model=이름 은 강화학습 모델
.venv/bin/python tools/rl/py/train.py --name run1   # 순수 강화학습 (PyTorch, 보상=생존 시간). 준비·옵션은 tools/README.md
.venv/bin/python tools/rl/py/eval.py run1           # 강화학습 모델 평가 (숙련 돌진형 봇: 평균 12.3분)
node tools/sim/bot.js pro 201 15  # 숙련 돌진형 봇 한 판 (사람처럼 충전↔돌격, 대부분 10분 이상 생존)
SEEDS="$(seq -s ' ' 201 224)" sh tools/sim/stance.sh 15   # 숙련 돌진형 vs 숙련 회피형 (박는 쪽이 이득인지, 약 8분)
python3 tools/sim/screenshot.py shot.png chain+aura   # 실제 브라우저 캡처 (Playwright 필요)
node tools/gen_docs.js            # docs/CONTENT.md 재생성 (카드·진화를 바꿨다면 실행)
```
- `extract.py` 의 계측판 생성은 `index.html` 의 특정 문자열을 치환한다. 해당 코드를 바꾸면 `extract.py` 의 치환 문자열도 같이 고칠 것.
- 강화학습 관측(`tools/rl/features.js`)은 `window.__mass` 의 게임 상태와 스킬 타이머(`MACH, VTof, mass, auraR, chainCd, missileT, mineT, holeCd, P_sp, novaT` 등)를 읽는다. 이 이름이나 스킬 발동 조건을 바꾸면 `features.js` 의 `selfList` 도 고칠 것. 카드·적 종류·`U` 수치가 바뀌면 모델은 새로 학습해야 한다.
- 테스트 훅: `window.__mass` 가 게임 내부 상태(P, U, enemies, EVOS, UPS, levelUp, pick, initGame, endTutorial, die, setDmgLog …)를 노출한다. 하네스와 개발자 모드가 이것을 쓴다.

## 코드 지도 (`index.html` 의 `<script>` 안, 위에서 아래 순서)
| 구역 | 주요 이름 | 내용 |
|---|---|---|
| 기본 상수 | `W,H`(960×600 논리 화면), `Z=.6`(줌), `WW,WH`(5600×3600 맵), `mass(r)`, `VTof(r)`(최고 속도), `REST,DV_DMG` | 물리 기본값 |
| 설정 | `S`(볼륨·흔들림·번쩍임·키), `DEF_KEYS`, `act(a)`, `saveSettings` | Esc 메뉴, localStorage `mass-settings` |
| 오디오 | `voice(kind,dur)`, `SFX_MAX`, `sfx/sfxBoom/sfxCherenkov/sfxHurt/sfxOrb/sfxZap` | 합성음, 종류별 동시 재생 상한 |
| 세계 상수 | `MACH=1150`(성운 속 빛), `C_LIGHT`, `WAVE_DT,WAVE_MAXR`, `SHAKE_MAX` | 체렌코프·카메라 |
| 진화 정의 | `EVO_W, EVO_DESC, EVO_NAME, EVOS` | 28종 (키는 `a+b`, `EVO_W` 순서) |
| 카드 | `UPS`(일반·무기·진화·특수 카드 전부), `SPS`, `MAX_WEAPONS=4`, `MAX_SP=2`, `inEvo`, `evoReady`, `weaponCount` | 레벨업 선택지 |
| 적 | `ET`(종류별 r/hp/spd), `mkEnemy`(시간에 따른 체력 배율 `1+.3m+.05m²`), `pickType`(시간에 따라 단단한 적 비중↑) | |
| 게임 흐름 | `initGame, levelUp, pick, die, horde`(스폰·물량 공세·엘리트·중장갑 분대), `tut*`(튜토리얼) | |
| 피해 처리 | `hitEnemy, killEnemy, addDmg, dmgStats, PH, dmgSrc, wOwner, TK` | 딜 기여도 기록 (아래 참고) |
| 무기 | `chainL2, shrapnel, updateMoons, updateHunters, updatePBullets, computeShock, updateSound, maybeHole, updateHoles, updateWeapons2`(자기장·화염·미사일·지뢰) | |
| 진화 공통 | `E(k)`, `CUR`, `evoMine/evoHole/evoFlame/fireZone/fireRing/throwObj/evoMissile/zapChain/boltCaps, missileBoom, mineBoom, updateEvo` | |
| 특수 능력 | `updateSpecial`(조석력), `pMass`(밀도 압축), `supernova`, `P_sp` | |
| 메인 갱신 | `update(dt)` → 이동·크기·충돌·당구·무기·진화 순 | |
| 그리기 | `glow/glowSpr`(더하기 합성 스프라이트), `drawFire/fireLayer`(불 전용 1/3 해상도 레이어), `drawEnemy, drawPlayer, hud, overlay` | |
| 아이콘 | `iconCanvas(key), drawIconGlyph, drawIconBox, iconKeyOf` | 모두 코드로 그림 (외부 이미지 없음) |
| 개발자 모드 | `devToggle, devRender, devClick, devSetTime` | `hichanplay` 입력 |
| 설정 메뉴 | `MENU_ROWS, openMenu, menuKey, bindKey, drawMenu` | |

## 꼭 알아야 할 설계 규칙
- **진화 = 두 무기의 작동이 섞인 것.** 진화하면 두 무기 모두 계속 작동하고(슬롯은 1칸), 진화 전용 효과가 각 무기 코드 안에서 `E('a+b')` 로 분기된다. 진화로 생긴 물체(블랙홀·지뢰·불길·미사일·위성 등)에는 `evo` 필드에 진화 키가 붙는다.
- **`E(k)` 는 부수효과가 있다:** 참이면 `CUR=k` 로 "현재 진화"를 기억하고, `evoMine/evoHole/evoFlame/fireZone/fireRing/throwObj/evoMissile` 은 생성 시 `CUR` 를 물체에 기록한다. 지연 생성(던진 물체 착지, 블랙홀이 꺼질 때 흩뿌림 등)은 `{evo:원래키}` 를 직접 넘길 것.
- **딜 기여도:** `hitEnemy` 가 `dmgSrc || PH` 를 출처로 `addDmg` 에 넘긴다. `PH` 는 `update` 의 단계마다(`'ram','billiard','cherenkov','hole','orbit','aura','fire','missile','mine','shrap','chain','evo','special'`) 바뀐다. 진화에 쓰인 무기의 기본 피해는 `wOwner` 로 그 진화 몫이 된다. 폭발은 `booms` 의 `src` 로 구분.
- **충돌 피해:** 적에게 충격량 J, 단 적이 부서질 만큼만 전달(`Jr=min(J, 적 남은 체력/dmgMul)`). 내 피해 = Δv×`DV_DMG` 를 `10*(d/10)^.7` 로 굽히고 한 번에 최대 체력 60% 상한.
- **불 계열 그리기**는 `drawFire()` 안에서만, `fireLayer` 가 1/3 해상도 캔버스에 `'lighten'` 합성으로 그린다(겹쳐도 하얗게 안 뭉침 + 성능). 새 불 효과는 여기에 넣을 것.
- **성능:** 불길·지뢰는 칸 나누기(`flameKey`, `eCell`)로 근처만 검사. 배열마다 개수 상한이 있다. 새 효과도 상한을 둘 것.
- 시뮬레이션 하네스에서는 `document.createElement` 가 가짜이므로 새 DOM 의존 코드는 `if(g&&g.beginPath)` 처럼 방어할 것.

## 자주 하는 작업
- **수치 조정:** `docs/BALANCE.md` 의 표와 `tools/sim/matrix.sh` 로 전후 비교. 랜덤 봇이라 ±15~20% 흔들리므로 시드 2개 이상.
- **카드·진화 추가:** `UPS`/`EVO_DESC`/`EVO_NAME` 수정 → 아이콘(`drawIconGlyph`) 추가 → `node tools/gen_docs.js`.
- **배포:** 정적 파일이므로 GitHub Pages 로 충분.
