#!/bin/sh
# 돌진형(ram) vs 회피형(evade) 비교: 같은 시드·같은 카드 선택으로 한 판씩 돌려 생존·처치·점수를 비교한다.
# 핵심 재미("박는 쪽이 이득")를 지키는 기준선. 회피형이 이기면 설계가 잘못된 것.
# 사용: sh tools/sim/stance.sh [분=15] [결과폴더]   (저장소 루트에서, 시드 8개 기준 약 2분)
#       카드는 두 봇 모두 같은 방식(pro.js 의 pickCard)으로 고름
#       SEEDS="1 2 3 ..." 로 시드 목록 지정 (흔들림이 커서 비교할 땐 20개 이상 권장)
MINS=${1:-15}
OUT=${2:-tools/sim/out_stance}
rm -rf "$OUT";mkdir -p "$OUT"
python3 tools/sim/extract.py >/dev/null
( for b in pro proevade; do for sd in ${SEEDS:-7 11 13 17 19 23 29 31}; do echo "$b $sd"; done; done ) \
| xargs -P 6 -L 1 sh -c 'SMART=1 RES=1 node tools/sim/bot.js $0 $1 '"$MINS"' 2>&1 | grep "^RES " | cut -c5- > "'"$OUT"'/$0_$1.json"'
python3 tools/sim/stance_agg.py "$OUT"
