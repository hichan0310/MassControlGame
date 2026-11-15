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
rep("function damagePlayer(dmg){\n  if(dmg<.3||state!=='play')return;","function damagePlayer(dmg){\n  if(dmg<.3||state!=='play')return;if(global.__hurt)global.__hurt(dmg,global.__hc||PH,P.r);")
# 피격 원인 표시: 어떤 충돌로 다쳤는지 (bot.js 의 받은 피해 분석용)
rep("damagePlayer(dvP*DV_DMG*pm);","global.__hc=e.type+(e.dead?'/부숨':'/못부숨');damagePlayer(dvP*DV_DMG*pm);global.__hc=null;")
rep("P.vx+=nx*dv;P.vy+=ny*dv;damagePlayer(dv*DV_DMG*.6);","P.vx+=nx*dv;P.vy+=ny*dv;global.__hc='폭발';damagePlayer(dv*DV_DMG*.6);global.__hc=null;")
rep("if(h.cl>200){damagePlayer(dv*DV_DMG*.3);","if(h.cl>200){global.__hc='바위';damagePlayer(dv*DV_DMG*.3);global.__hc=null;")
rep("  damagePlayer(dv*DV_DMG);\n}","  global.__hc='적탄';damagePlayer(dv*DV_DMG);global.__hc=null;\n}")
# 강화학습: 화면 그리기 생략 (global.__nodraw 일 때)
rep("  draw();\n  requestAnimationFrame(frame);","  if(!global.__nodraw)draw();\n  requestAnimationFrame(frame);")
rep("get tut(){return tut;},","get tut(){return tut;},get time(){return time;},get dmgStats(){return dmgStats;},")
open(os.path.join(HERE,'build','game_i.js'),'w',encoding='utf-8').write(s)
print('ok: build/game.js, build/game_i.js')
