"""index.html 에서 <script> 본문을 꺼내 Node 시뮬레이션용 JS 로 만든다.
사용: python3 tools/sim/extract.py        (저장소 루트에서)
결과: tools/sim/build/game.js   — 원본 그대로
      tools/sim/build/game_i.js — 계측판 (플레이어 피격 훅, 시간 getter 추가)
"""
import re, os
HERE=os.path.dirname(os.path.abspath(__file__))
ROOT=os.path.abspath(os.path.join(HERE,'..','..'))
html=open(os.path.join(ROOT,'index.html'),encoding='utf-8').read()
src=re.search(r'<script>(.*)</script>',html,re.S).group(1)
os.makedirs(os.path.join(HERE,'build'),exist_ok=True)
open(os.path.join(HERE,'build','game.js'),'w',encoding='utf-8').write(src)
s=src
def rep(o,n):
    global s
    if s.count(o)!=1: raise SystemExit('계측 지점을 찾지 못함: '+o[:60])
    s=s.replace(o,n)
rep("function addDmg(src,v){if(v>0){if(wOwner[src])src='evo:'+wOwner[src];dmgStats[src]=(dmgStats[src]||0)+v;}}",
    "let DMG_LOG2=null;function addDmg(src,v){if(v>0){if(wOwner[src])src='evo:'+wOwner[src];dmgStats[src]=(dmgStats[src]||0)+v;if(DMG_LOG2)DMG_LOG2(src,v);}}")
rep("setDmgLog:f=>{DMG_LOG=f;}","setDmgLog:f=>{DMG_LOG2=f;}")
rep("function damagePlayer(dmg){\n  if(dmg<.3||state!=='play')return;","function damagePlayer(dmg){\n  if(dmg<.3||state!=='play')return;if(global.__hurt)global.__hurt(dmg,PH,P.r);")
rep("get tut(){return tut;},","get tut(){return tut;},get time(){return time;},get dmgStats(){return dmgStats;},")
open(os.path.join(HERE,'build','game_i.js'),'w',encoding='utf-8').write(s)
print('ok: build/game.js, build/game_i.js')
