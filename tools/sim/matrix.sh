#!/bin/sh
# 무기 8종 단독 + 진화 28종을 후반 모의(적 체력 30배, 무적)로 돌려 8×8 표를 만든다.
# 사용: sh tools/sim/matrix.sh [결과폴더]   (저장소 루트에서, 약 10~15분)
OUT=${1:-tools/sim/out}
mkdir -p "$OUT"
python3 tools/sim/extract.py >/dev/null
( for w in shrap chain hole orbit aura fire missile mine; do for sd in 7 11; do echo "W $w $sd"; done; done
  W="chain shrap hole orbit aura fire missile mine"
  for a in chain shrap hole orbit aura fire missile; do f=0; for b in $W; do [ $f = 1 ] && { echo "E $a+$b 7"; echo "E $a+$b 11"; }; [ $a = $b ] && f=1; done; done ) \
| xargs -P 2 -L 1 sh -c 'if [ $0 = W ]; then LATE=1 HM=30 W=$1 node tools/sim/bot.js ram $2 2 2>&1 | head -1 > "'$OUT'/W_$1_$2.txt"; else LATE=1 HM=30 EVK=$1 node tools/sim/bot.js ram $2 2 2>&1 | head -1 > "'$OUT'/E_$1_$2.txt"; fi'
python3 tools/sim/agg.py "$OUT"
