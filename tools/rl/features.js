// 강화학습 관측 — 게임 메커니즘에 맞춘 특징. Node(학습 환경)와 브라우저(관전) 공용.
//
// 관측은 하나의 Float32 벡터이고, 구간(spec.seg)으로 나뉜다:
//   self   내 상태 + 스킬 발동 조건·재충전 + U 의 모든 수치 + 카드별 보유 상태
//   enemy  가까운 적 K 마리 (토큰): 위치·상대속도·접촉까지 시간·"지금 박으면 부술 수 있나"·상태·종류
//   bullet 적탄 (토큰): 궤적 예측 (최근접 시각·빗나가는 거리)
//   rock   바위 (토큰)
//   obj    내 블랙홀·지뢰 (토큰)
//   radar  주변 무리 (나를 중심으로 12방향 × 4거리, 1400 까지) — 어느 방향이 비었는지
//   map    맵 전체 미니맵 (400px 칸 14×9: 적 수·적 체력·구슬) — 멀리 어디로 빠질지 (사람이 미니맵으로 보는 것)
//   card   카드 고르기 때 후보 3장 (카드 번호 + 특징)
// 토큰의 0번 특징은 "있음(1)/없음(0)" — 모델이 가림막(mask)으로 쓴다.
//
// 게임이 바뀌면 여기만 고치면 된다. 적 종류(ET)·카드(UPS)·U 수치 목록은 자동으로 읽으므로
// 새 스킬의 "발동 조건"을 모델에 알려주고 싶을 때만 SELF 목록에 줄을 추가하면 된다.
(function(){
const K={enemy:40,bullet:12,rock:6,obj:10};
const F={bullet:8,rock:7,obj:7,card:10};
const RAD={sec:12,rings:[200,450,800,1400],ch:5};
const MAPC=400,MAPCH=3;   // 미니맵 칸 크기, 채널
const EN_BASE=19;   // 적 토큰 고정 특징 수 (+ 종류 원-핫)
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const slog=v=>v>=0?Math.log1p(v):-Math.log1p(-v);

// 내 상태: [이름, 계산] — 메커니즘별로 묶음. 새 스킬 조건은 여기에 추가.
function selfList(M){
  const P=M.P,U=M.U,sp=()=>Math.hypot(P.vx,P.vy),tz=()=>(P.r-U.rmin)/Math.max(1,U.rmax-U.rmin);
  const Jvs=r=>1.3*sp()/(1/M.mass(U.rmax)+1/M.mass(r));   // 최대 크기로 반지름 r 적에게 박을 때 충격량
  return [
    // 운동
    ['vx',()=>P.vx/1500],['vy',()=>P.vy/1500],['speed',()=>sp()/1500],
    ['speed/체렌코프',()=>sp()/M.MACH],                       // 1 넘으면 체렌코프 빛
    ['speed/최고속도',()=>sp()/M.VTof(P.r)],['speed/최소크기최고속도',()=>sp()/M.VTof(U.rmin)],
    ['speed/화염임계',()=>sp()/480],                           // 화염 궤적은 480 이상에서 남음
    // 크기·질량
    ['크기비율',tz],['r',()=>P.r/60],['rmin',()=>U.rmin/10],['rmax',()=>U.rmax/60],['질량비',()=>M.mass(P.r)/M.mass(U.rmax)],
    // 충돌 세기 (스킬 임계값 기준)
    ['운동량',()=>Math.log1p(M.mass(U.rmax)*sp())/10],
    ['J/번개·탄환임계',()=>clamp(Jvs(8)/250,0,20)/5],         // 연쇄 번개·추가 탄환: J ≥ 250
    ['J/충돌폭발임계',()=>clamp(Jvs(8)/3000,0,10)/2],          // 충돌 폭발: J ≥ 3000
    // 에너지
    ['에너지',()=>P.energy/U.energyMax],['에너지최대',()=>U.energyMax/200],['과부하',()=>P.overload?1:0],
    ['충전구간',()=>tz()<.4?1:0],['소모율',()=>26*U.upkeep*tz()*tz()/Math.max(1,U.regen)],
    // 체력
    ['체력',()=>P.hp/U.hpMax],['체력최대',()=>U.hpMax/300],['무적',()=>P.inv>0?1:0],
    // 진행
    ['시간',()=>M.time/900],['레벨',()=>M.lvl/50],['경험치',()=>M.xp/Math.max(1,M.xpNeed(M.lvl))],
    ['x',()=>P.x/M.WW*2-1],['y',()=>P.y/M.WH*2-1],
    ['왼벽',()=>clamp(P.x/1000,0,2)],['오른벽',()=>clamp((M.WW-P.x)/1000,0,2)],['위벽',()=>clamp(P.y/1000,0,2)],['아래벽',()=>clamp((M.WH-P.y)/1000,0,2)],
    ['연속처치',()=>Math.min(M.combo,100)/50],['관통',()=>Math.min(M.pierceN,20)/10],['관통중',()=>M.pierceT>0?1:0],
    // 무기 타이머·상태
    ['번개대기',()=>M.chainCd>0?1:0],['미사일까지',()=>clamp(M.missileT,0,3)/3],['지뢰까지',()=>clamp(M.mineT,0,1.2)],
    ['블랙홀대기',()=>clamp(M.holeCd,0,3)/3],['블랙홀수',()=>M.holes.length/6],['위성수',()=>M.moons.length/12],
    ['화염수',()=>M.flamesN/220],['자기장반경',()=>U.aura>0?M.auraR()/1000:0],
    // 특수 능력 조건
    ['초신성준비',()=>U.nova>0&&M.novaT<=0?1:0],['초신성대기',()=>clamp(M.novaT,0,150)/150],
    ['압축대기',()=>clamp(M.P_sp.denseCd,0,8)/8],['압축중',()=>clamp(M.P_sp.denseT-M.time,0,2)/2],
    ['크게있던뒤',()=>clamp((M.time-M.P_sp.bigT)/.45,0,2)],   // 밀도 압축: 크게 있다가 0.45초 안에 최소로
    ['큰질량저장',()=>M.P_sp.bigM/M.mass(U.rmax)],
    ['우물대기',()=>clamp(M.P_sp.wellCd,0,4)/4],['흡수량',()=>(M.P_sp.absGain||0)/12],
    ['조석력활성',()=>U.sp.tidal&&tz()>.5?1:0],
  ];
}
function makeSpec(M){
  const types=Object.keys(M.ET),cards=M.UPS.map(u=>u.n);
  const ukeys=Object.keys(M.U).filter(k=>typeof M.U[k]==='number').sort();   // 카드 효과 배율 등 (자동)
  const sl=selfList(M).map(x=>x[0]);
  const nSelf=sl.length+ukeys.length+cards.length;
  const fe=EN_BASE+types.length;
  const seg={};let o=0;const add=(n,len)=>{seg[n]=[o,len];o+=len;};
  add('self',nSelf);add('enemy',K.enemy*fe);add('bullet',K.bullet*F.bullet);add('rock',K.rock*F.rock);add('obj',K.obj*F.obj);
  const mw=Math.ceil(M.WW/MAPC),mh=Math.ceil(M.WH/MAPC);
  add('radar',RAD.sec*RAD.rings.length*RAD.ch);add('map',mw*mh*MAPCH);add('card',3*F.card);
  return {version:2,arch:'attn',types,cards,ukeys,selfNames:sl,K,F:{...F,enemy:fe},RAD,MAP:{w:mw,h:mh,cell:MAPC,ch:MAPCH},seg,nObs:o,nMove:27,nCardTotal:cards.length};
}
function compatible(spec,M){const s=makeSpec(M);return s.nObs===spec.nObs&&s.types.join()===spec.types.join()&&s.cards.join()===spec.cards.join()&&s.ukeys.join()===spec.ukeys.join()&&s.selfNames.join()===spec.selfNames.join();}

// 접촉까지 시간 (상대 운동, 반경 R). 없으면 9
function ttc(rx,ry,ux,uy,R){const a=ux*ux+uy*uy,b=2*(rx*ux+ry*uy),c=rx*rx+ry*ry-R*R;if(c<=0)return 0;if(a<1e-6||b>=0)return 9;const D=b*b-4*a*c;if(D<0)return 9;return (-b-Math.sqrt(D))/(2*a);}

// picks: 이번 판 카드별 고른 횟수 (카운터 없는 일반 카드용). sl: selfList 캐시
function build(M,spec,picks,out,cache){
  out.fill(0);const P=M.P,U=M.U;
  if(!cache.sl)cache.sl=selfList(M).map(x=>x[1]);
  // --- self ---
  let k=spec.seg.self[0];
  for(const f of cache.sl){const v=f();out[k++]=Number.isFinite(v)?clamp(v,-10,10):0;}
  for(const key of spec.ukeys){const v=U[key];out[k++]=typeof v==='number'?clamp(slog(v),-10,10):0;}
  for(let i=0;i<spec.cards.length;i++){const u=M.UPS[i];let v;
    if(u.w)v=(U[u.w]||0)/u.max;else if(u.k)v=(U[u.k]||0)/u.max;else if(u.evo)v=U.evos[u.evo]?1:0;else if(u.sp)v=U.sp[u.sp]?1:0;else v=Math.min(1,(picks[i]||0)/5);
    out[k++]=v;}
  const sp=Math.hypot(P.vx,P.vy),mMax=M.mass(U.rmax),mNow=M.mass(P.r),Rb=U.rmax*.75;
  const auraR=U.aura>0?M.auraR():0;
  // --- 적 토큰: 몸 표면 거리순 K 마리 ---
  const fe=spec.F.enemy,ti=cache.ti||(cache.ti=Object.fromEntries(spec.types.map((t,i)=>[t,i])));
  const cand=cache.cand||(cache.cand=[]);cand.length=0;
  const RR=1600;
  for(const e of M.enemies){if(e.dead||e.spawn>0)continue;const dx=e.x-P.x,dy=e.y-P.y;if(dx>RR||dx<-RR||dy>RR||dy<-RR)continue;cand.push([Math.hypot(dx,dy)-e.r-P.r,e]);}
  cand.sort((a,b)=>a[0]-b[0]);
  let o=spec.seg.enemy[0];
  for(let i=0;i<Math.min(K.enemy,cand.length);i++,o+=fe){const [sd,e]=cand[i],dx=e.x-P.x,dy=e.y-P.y,d=Math.hypot(dx,dy)||1;
    const rvx=e.vx-P.vx,rvy=e.vy-P.vy,cl=-(rvx*dx+rvy*dy)/d,me=M.mass(e.r),hp=Math.max(1,e.hp);
    const cle=Math.max(cl,0);
    const Jmax=1.3*cle/(1/mMax+1/me)*U.dmgMul,Jnow=1.3*cle/(1/mNow+1/me)*U.dmgMul;
    out[o]=1;out[o+1]=dx/1000;out[o+2]=dy/1000;out[o+3]=clamp(sd/1000,-1,2);out[o+4]=rvx/1000;out[o+5]=rvy/1000;out[o+6]=cl/1000;
    out[o+7]=Math.min(ttc(dx,dy,rvx,rvy,P.r+e.r),3)/3;out[o+8]=Math.min(ttc(dx,dy,rvx,rvy,Rb+e.r),3)/3;
    out[o+9]=e.r/30;out[o+10]=Math.log1p(hp)/10;out[o+11]=e.hp/Math.max(1,e.max);
    out[o+12]=clamp(Math.log((Jmax+1)/hp),-4,4)/4;out[o+13]=clamp(Math.log((Jnow+1)/hp),-4,4)/4;   // >0 이면 부술 수 있음
    out[o+14]=e.stun>0?1:0;out[o+15]=auraR&&d<auraR+e.r?1:0;
    out[o+16]=e.st==='aim'?.5:e.st==='dash'?1:0;out[o+17]=e.type==='shooter'?clamp(e.shoot,0,2.5)/2.5:0;
    out[o+18]=e.hitCd>0?1:0;
    const t=ti[e.type];if(t!==undefined)out[o+EN_BASE+t]=1;}
  // --- 적탄 ---
  cand.length=0;for(const b of M.bullets){const dx=b.x-P.x,dy=b.y-P.y;if(Math.abs(dx)>700||Math.abs(dy)>700)continue;cand.push([dx*dx+dy*dy,b]);}
  cand.sort((a,b)=>a[0]-b[0]);o=spec.seg.bullet[0];
  for(let i=0;i<Math.min(K.bullet,cand.length);i++,o+=F.bullet){const b=cand[i][1],dx=b.x-P.x,dy=b.y-P.y,ux=b.vx-P.vx,uy=b.vy-P.vy,uu=ux*ux+uy*uy||1;
    const tc=clamp(-(dx*ux+dy*uy)/uu,0,3),mx=dx+ux*tc,my=dy+uy*tc,miss=Math.hypot(mx,my);
    out[o]=1;out[o+1]=dx/1000;out[o+2]=dy/1000;out[o+3]=ux/1000;out[o+4]=uy/1000;out[o+5]=tc/3;out[o+6]=Math.min(miss,300)/100;out[o+7]=miss<P.r+(b.r||5)+4?1:0;}
  // --- 바위 ---
  cand.length=0;for(const r of M.rocks){const sd=Math.hypot(r.x-P.x,r.y-P.y)-r.r-P.r;if(sd<1200)cand.push([sd,r]);}
  cand.sort((a,b)=>a[0]-b[0]);o=spec.seg.rock[0];
  for(let i=0;i<Math.min(K.rock,cand.length);i++,o+=F.rock){const [sd,r]=cand[i],dx=r.x-P.x,dy=r.y-P.y,d=Math.hypot(dx,dy)||1,cl=(P.vx*dx+P.vy*dy)/d;
    out[o]=1;out[o+1]=dx/1000;out[o+2]=dy/1000;out[o+3]=r.r/200;out[o+4]=sd/1000;out[o+5]=cl/1000;out[o+6]=Math.min(ttc(dx,dy,-P.vx,-P.vy,r.r+P.r),3)/3;}
  // --- 내 블랙홀·지뢰 ---
  cand.length=0;
  for(const h of M.holes){const dx=h.x-P.x,dy=h.y-P.y;cand.push([dx*dx+dy*dy,h,1]);}
  for(const m of M.mines){const dx=m.x-P.x,dy=m.y-P.y;if(Math.abs(dx)<900&&Math.abs(dy)<900)cand.push([dx*dx+dy*dy,m,0]);}
  cand.sort((a,b)=>a[0]-b[0]);o=spec.seg.obj[0];
  for(let i=0;i<Math.min(K.obj,cand.length);i++,o+=F.obj){const [,q,isHole]=cand[i];
    out[o]=1;out[o+1]=isHole;out[o+2]=1-isHole;out[o+3]=(q.x-P.x)/1000;out[o+4]=(q.y-P.y)/1000;out[o+5]=(q.R||60)/300;out[o+6]=clamp(q.life||0,0,30)/30;}
  // --- 레이더: 적 수·적 체력·구슬·적탄·바위/벽 ---
  const rb=spec.seg.radar[0],NS=RAD.sec,RG=RAD.rings,RM=RG[RG.length-1],ch=RAD.ch;
  const cell=(dx,dy)=>{const d2=dx*dx+dy*dy;if(d2>=RM*RM)return -1;const d=Math.sqrt(d2);let r=0;while(d>=RG[r])r++;let s=Math.floor((Math.atan2(dy,dx)+Math.PI)/(2*Math.PI)*NS);if(s>=NS)s=NS-1;return rb+(r*NS+s)*ch;};
  for(const e of M.enemies){if(e.dead||e.spawn>0)continue;const dx=e.x-P.x,dy=e.y-P.y;if(dx>RM||dx<-RM||dy>RM||dy<-RM)continue;const c=cell(dx,dy);if(c<0)continue;out[c]+=1;out[c+1]+=Math.max(0,e.hp);}
  for(const q of M.orbs){const c=cell(q.x-P.x,q.y-P.y);if(c>=0)out[c+2]+=q.v;}
  for(const b of M.bullets){const c=cell(b.x-P.x,b.y-P.y);if(c>=0)out[c+3]+=1;}
  for(let r=0;r<RG.length;r++){const rm=((r?RG[r-1]:0)+RG[r])/2;for(let s=0;s<NS;s++){const a=-Math.PI+(s+.5)/NS*2*Math.PI,wx=P.x+Math.cos(a)*rm,wy=P.y+Math.sin(a)*rm,c=rb+(r*NS+s)*ch;
    let solid=wx<0||wy<0||wx>M.WW||wy>M.WH?1:0;if(!solid)for(const q of M.rocks){if(Math.hypot(wx-q.x,wy-q.y)<q.r){solid=1;break;}}
    out[c]=Math.log1p(out[c]);out[c+1]=Math.log1p(out[c+1]/500);out[c+2]=Math.log1p(out[c+2]);out[c+3]=Math.log1p(out[c+3]);out[c+4]=solid;}}
  // --- 미니맵: 맵 전체 적 수·체력·구슬 (칸마다) ---
  {const mb=spec.seg.map[0],{w,h,cell,ch:mc}=spec.MAP;
    for(const e of M.enemies){if(e.dead)continue;const cx=clamp((e.x/cell)|0,0,w-1),cy=clamp((e.y/cell)|0,0,h-1),c=mb+(cy*w+cx)*mc;out[c]+=1;out[c+1]+=Math.max(0,e.hp);}
    for(const q of M.orbs){const cx=clamp((q.x/cell)|0,0,w-1),cy=clamp((q.y/cell)|0,0,h-1);out[mb+(cy*w+cx)*mc+2]+=q.v;}
    for(let c=mb;c<mb+w*h*mc;c+=mc){out[c]=Math.log1p(out[c]);out[c+1]=Math.log1p(out[c+1]/500);out[c+2]=Math.log1p(out[c+2]);}}
  // --- 카드 후보 ---
  if(M.state==='upgrade'){const nW=M.weaponCount();o=spec.seg.card[0];
    M.opts.forEach((ix,i)=>{const u=M.UPS[ix],lv=u.w?(U[u.w]||0):u.k?(U[u.k]||0):0,mx=u.max||1,q=o+i*F.card;
      out[q]=1;out[q+1]=ix;out[q+2]=u.w?1:0;out[q+3]=u.evo?1:0;out[q+4]=u.sp?1:0;out[q+5]=lv/mx;out[q+6]=u.w&&lv===0?1:0;
      out[q+7]=nW/4;out[q+8]=(u.w||u.k)&&lv+1>=mx?1:0;out[q+9]=M.spMode?1:0;});}
  return out;
}
const MOVES=[[0,0],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]],SIZES=[-1,0,1];
function applyMove(a,set){const [dx,dy]=MOVES[a%9],s=SIZES[(a/9)|0];set('KeyD',dx>0);set('KeyA',dx<0);set('KeyS',dy>0);set('KeyW',dy<0);set('Semicolon',s>0);set('KeyL',s<0);}
const API={makeSpec,compatible,build,applyMove,MOVES,SIZES};
if(typeof module!=='undefined')module.exports=API;else window.RLFeatures=API;
})();
