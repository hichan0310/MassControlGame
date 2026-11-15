// 봇으로 한 판을 돌려 딜 출처·생존 시간을 출력한다.
// 사용: node tools/sim/bot.js <ram|kite|noweap> <seed> <분>
//   환경변수 W=무기        → 그 무기만 최대 레벨로 시작 (LV=1 이면 1레벨)
//   환경변수 EVK=a+b       → 해당 진화와 재료 무기 최대 레벨로 시작
//   환경변수 LATE=1 HM=30  → 무적 + 적 체력 HM배 + 큰 무리 주기 투입 (후반 모의, 포화 없는 화력 측정)
//   환경변수 DUMMY=1       → 무적 + 죽지 않는 표적 150마리 (잠재 화력)
// 출력 첫 줄이 W/EVK 모드일 때 JSON (wdps=무기 쪽 초당 피해, core=몸통 계열 비중 등)
const {M,fire,step,T}=require('./harness')('game_i.js');
const BOT=process.argv[2]||'ram',SEED=+(process.argv[3]||7),MINS=+(process.argv[4]||20);
let s=SEED;const _m=Math.random;Math.random=()=>{s=(s*16807)%2147483647;return s/2147483647;};
step();M.endTutorial();M.initGame(false);
const ONLY=process.env.W,EVK=process.env.EVK;if(EVK){const [a,b]=EVK.split('+');for(const w of [a,b]){const u=M.UPS.find(x=>x.w===w);M.U[w]=u.max;}M.U.evos[EVK]=true;}if(ONLY){const u=M.UPS.find(x=>x.w===ONLY);M.U[ONLY]=+(process.env.LV||u.max);}
const set=(k,v)=>{M.keys[k]=v;};
const CAT={ram:'몸통',billiard:'몸통',cherenkov:'몸통',enemyboom:'기타',etc:'기타'};
let bucket={},buckets=[],dlog=(src,d)=>{bucket[src]=(bucket[src]||0)+d;};M.setDmgLog(dlog);
let rng2=SEED*7+1;const r2=()=>{rng2=(rng2*48271)%2147483647;return rng2/2147483647;};   // 카드 선택용 (봇과 무관하게 동일)
function steer(dx,dy){const L=Math.hypot(dx,dy)||1;dx/=L;dy/=L;set('KeyD',dx>.38);set('KeyA',dx<-.38);set('KeyS',dy>.38);set('KeyW',dy<-.38);}
function wallAvoid(dx,dy){const P=M.P;const m=400;let L=Math.hypot(dx,dy)||1;dx/=L;dy/=L;if(P.x<m)dx+=2;if(P.x>5600-m)dx-=2;if(P.y<m)dy+=2;if(P.y>3600-m)dy-=2;
  // 바위 피하기: 진행 방향 앞쪽에 있는 바위를 옆으로 비켜감
  const sp=Math.hypot(P.vx,P.vy),vx=sp>50?P.vx/sp:dx,vy=sp>50?P.vy/sp:dy,look=sp*.45+P.r+80;
  for(const k of M.rocks){const rx=k.x-P.x,ry=k.y-P.y,along=rx*vx+ry*vy;if(along<0||along>look+k.r)continue;const side=rx*vy-ry*vx;if(Math.abs(side)>k.r+P.r+50)continue;
    const s2=side>0?-1:1;dx+=vy*s2*3;dy+=-vx*s2*3;dx-=vx*1.5;dy-=vy*1.5;}
  return [dx,dy];}
let mode='seek',tgt=null,retarget=0;
function botRam(){
  const P=M.P,es=M.enemies.filter(e=>!e.dead&&e.spawn<=0);if(!es.length){steer(1,0);set('KeyL',1);set('Semicolon',0);return;}
  let cx=0,cy=0,n=0;for(const e of es){const d=Math.hypot(e.x-P.x,e.y-P.y);if(d<500){cx+=e.x;cy+=e.y;n++;}}
  const hpF=P.hp/M.U.hpMax;
  if(P.energy<45&&!M.P._atk){M.P._rec=true;}if(P.energy>85)M.P._rec=false;
  if((hpF<.3||M.P._rec)&&n){botKite();let tm=9;for(const e of es){const ex=e.x-P.x,ey=e.y-P.y,dd=Math.hypot(ex,ey);if(dd>500)continue;const c=((P.vx-e.vx)*ex+(P.vy-e.vy)*ey)/(dd||1);if(c>0){const t=(dd-P.r-e.r-M.U.rmax*.6)/c;if(t<tm)tm=t;}}
    const g=tm<.3&&P.energy>4&&!P.overload;set('Semicolon',g);set('KeyL',!g);return;}
  retarget-=1/60;
  if(!tgt||tgt.dead||retarget<=0){retarget=.6;let best=-1;const sm=es.length>60?es.filter((_,i)=>i%Math.ceil(es.length/60)===0):es;
    for(const e of sm){const d=Math.hypot(e.x-P.x,e.y-P.y);if(d>1100)continue;let c=0;for(const o of es)if(Math.abs(o.x-e.x)<140&&Math.abs(o.y-e.y)<140)c++;const sc=c-d/300;if(sc>best){best=sc;tgt=e;}}
    if(!tgt)tgt=es[0];}
  const dx=tgt.x-P.x,dy=tgt.y-P.y,d=Math.hypot(dx,dy),sp=Math.hypot(P.vx,P.vy),close=(P.vx*dx+P.vy*dy)/(d||1);
  let [sx,sy]=wallAvoid(dx,dy);steer(sx,sy);
  // 핵심 기술: 곧 부딪힐 적이 있으면 커지고, 아니면 작아져서 가속
  let tmin=9,near=0;for(const e of es){const ex=e.x-P.x,ey=e.y-P.y,dd=Math.hypot(ex,ey);if(dd>700)continue;if(dd<220)near++;
    const c=((P.vx-e.vx)*ex+(P.vy-e.vy)*ey)/(dd||1);if(c>0){const t=(dd-P.r-e.r-M.U.rmax*.6)/c;if(t<tmin)tmin=t;}}
  const growNow=tmin<.32&&P.energy>6&&!P.overload;
  if(!growNow&&(P.energy<30||P.overload)&&n){let [fx,fy]=wallAvoid(P.x-cx/n,P.y-cy/n);steer(fx,fy);}   // 에너지 회복할 동안은 무리에서 벗어남
  set('Semicolon',growNow);set('KeyL',!growNow);
}
let orbitDir=1;
function botKite(){
  const P=M.P,es=M.enemies.filter(e=>!e.dead&&e.spawn<=0);set('Semicolon',0);set('KeyL',1);
  let ax=0,ay=0;for(const e of es){const dx=P.x-e.x,dy=P.y-e.y,d=Math.hypot(dx,dy);if(d<600&&d>1){ax+=dx/d/(d/100);ay+=dy/d/(d/100);}}
  // 원을 그리며 도망: 맵 중심 기준 접선 방향 + 회피
  const tx=-(P.y-1800)*orbitDir,ty=(P.x-2800)*orbitDir,tl=Math.hypot(tx,ty)||1;let dx=ax*3+tx/tl,dy=ay*3+ty/tl;
  [dx,dy]=wallAvoid(dx,dy);steer(dx,dy);
}
let hurt={};global.__hurt=(d,ph,r)=>{const k=ph+(r<12?'/작음':r<25?'/중간':'/큼');hurt[k]=(hurt[k]||0)+Math.min(d,60);};
const T0=Date.now();let lastB=0,dead=false,minute=0;
const FR=60*60*MINS;
for(let i=0;i<FR;i++){
  if(M.state==='play'){if(BOT==='ram'||BOT==='noweap')botRam();else{botKite();
    const P=M.P;let tm=9;for(const e of M.enemies){if(e.dead||e.spawn>0)continue;const ex=e.x-P.x,ey=e.y-P.y,dd=Math.hypot(ex,ey);if(dd>500)continue;const c=((P.vx-e.vx)*ex+(P.vy-e.vy)*ey)/(dd||1);if(c>0){const t=(dd-P.r-e.r-M.U.rmax*.6)/c;if(t<tm)tm=t;}}
    const g=tm<.3&&P.energy>4&&!P.overload;set('Semicolon',g);set('KeyL',!g);}}
  if(M.state==='upgrade'){let pick=Math.floor(r2()*M.opts.length);
    if(ONLY||EVK||BOT==='noweap'){const ok=M.opts.findIndex(o=>!M.UPS[o].w&&!M.UPS[o].evo);if(ok>=0)pick=ok;}
    M.pick(pick);}
  if(process.env.LATE){if(i===0){M.U.hpMul=1e5;M.U.hpMax=1e7;}M.P.hp=M.U.hpMax;for(const e of M.enemies)if(!e._t){e._t=1;const hm=+(process.env.HM||8);e.hp*=hm;e.max*=hm;}if(i%600===0){const P=M.P;for(let j=0;j<60;j++){const a=Math.random()*6.28,d=300+Math.random()*900;const e=M.mkEnemy(['chaser','chaser','swarm','shield','charger','spiker','splitter','bomber'][j%8],P.x+Math.cos(a)*d,P.y+Math.sin(a)*d);e.spawn=0;M.enemies.push(e);}}}
  if(process.env.DUMMY){M.P.hp=M.U.hpMax;for(const e of M.enemies)if(!e._t){e._t=1;e.hp=e.max=1e7;}if(i===0){const P=M.P;for(let j=0;j<150;j++){const a=Math.random()*6.28,d=200+Math.random()*900;const e=M.mkEnemy(j%6?'chaser':'charger',P.x+Math.cos(a)*d,P.y+Math.sin(a)*d);e.spawn=0;M.enemies.push(e);}}}
  step();
  if(M.state==='dead'){dead=true;break;}
  if(M.time>=(minute+1)*60*5){minute++;buckets.push(bucket);bucket={};}
}
if(Object.keys(bucket).length)buckets.push(bucket);
const sum=b=>Object.values(b).reduce((a,c)=>a+c,0);
const rows=buckets.map((b,i)=>{const t=sum(b)||1;const core=(b.ram||0)+(b.billiard||0)+(b.cherenkov||0);
  const top=Object.entries(b).sort((x,y)=>y[1]-x[1]).slice(0,4).map(([k,v])=>k+' '+Math.round(v/t*100)+'%').join(', ');
  return `  ${i*5}~${i*5+5}분: 몸통계열 ${Math.round(core/t*100)}% | ${top}`;});
const ALL=buckets.reduce((a,b)=>{for(const k in b)a[k]=(a[k]||0)+b[k];return a;},{});const TOT=Object.values(ALL).reduce((a,c)=>a+c,0);
if(EVK){const core=(ALL.ram||0)+(ALL.billiard||0)+(ALL.cherenkov||0);const wd=TOT-core-(ALL.enemyboom||0)-(ALL.etc||0);
  console.log(JSON.stringify({k:EVK,seed:SEED,surv:+(M.time/60).toFixed(1),dead,kills:M.kills,wdps:Math.round(wd/M.time),evo:Math.round((ALL.evo||0)/M.time)}));}
if(ONLY){const tags={shrap:['shrap'],chain:['chain'],hole:['hole'],orbit:['orbit'],aura:['aura'],fire:['fire'],missile:['missile','wboom'],mine:['mine','wboom']}[ONLY];const wd=tags.reduce((a,t)=>a+(ALL[t]||0),0);
  console.log(JSON.stringify({w:ONLY,seed:SEED,surv:+(M.time/60).toFixed(1),dead,kills:M.kills,lvl:M.lvl,wdps:Math.round(wd/M.time),share:Math.round(wd/TOT*100),core:Math.round(((ALL.ram||0)+(ALL.billiard||0)+(ALL.cherenkov||0))/TOT*100)}));}
console.log(`[${BOT} seed${SEED}] ${dead?'사망 '+(M.time/60).toFixed(1)+'분':'생존 '+MINS+'분'} 레벨 ${M.lvl} 처치 ${M.kills} 무기 ${M.UPS.filter(u=>u.w&&M.U[u.w]>0).map(u=>u.n+M.U[u.w]).join(' ')} 진화 ${Object.keys(M.U.evos).join(',')} (${((Date.now()-T0)/1000).toFixed(0)}s)`);
console.log(rows.join('\n'));console.log('  받은 피해:',Object.entries(hurt).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>k+' '+Math.round(v)).join(', '));
