// 빠른 회귀 점검: 무기 8종 최대 + 진화 4개로 2분 돌려 프레임 시간·오류 확인
// 사용: python3 tools/sim/extract.py && node tools/sim/smoke.js
const {M,fire,step}=require('./harness')('game.js');
let s=7;Math.random=()=>{s=(s*16807)%2147483647;return s/2147483647;};
step();M.endTutorial();M.initGame(false);M.U.hpMul=1e7;M.U.hpMax=1e9;
const MX={chain:5,shrap:5,hole:4,orbit:4,aura:5,fire:5,missile:5,mine:5};for(const k in MX)M.U[k]=MX[k];
for(const k of ['chain+fire','shrap+aura','hole+mine','orbit+missile'])M.U.evos[k]=true;
const codes=['KeyW','KeyA','KeyS','KeyD','KeyL','Semicolon'];let worst=0,tot=0;
for(let i=0;i<60*120;i++){if(i%20===0)for(const c of codes)(Math.random()<.5?fire('keydown',c):fire('keyup',c));M.P.hp=1e9;const t=Date.now();step();const d=Date.now()-t;worst=Math.max(worst,d);tot+=d;if(M.state==='upgrade')fire('keydown','Enter');}
console.log('2분 시뮬: 최악 '+worst+'ms, 평균 '+(tot/7200).toFixed(2)+'ms, 처치 '+M.kills);
