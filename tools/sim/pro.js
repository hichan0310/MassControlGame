// 숙련 돌진형 봇 (pro): 사람이 하는 "골라서 박기"를 흉내 낸다.
//  - 지금 속도로 최대 크기에서 박았을 때 부술 수 있는 적만 노림. 못 부수는 적(방패병·엘리트 등)과 가시는 장애물로 피함
//  - 경로에 장애물이 없고, 가속할 거리가 있는 무리를 고름
//  - 실제 접촉 시각을 계산해 "커지는 데 걸리는 시간"만큼 직전에 커지고, 지나가면 바로 작아짐
//  - 적탄 궤적 예측 회피, 작을 때 폭탄병 근처 피하기, 포위되면 빈 쪽으로 탈출
//  - 에너지가 바닥나기 전에 무리에서 벗어나 충전
// 사용: bot.js 에서 require('./pro')(M, set) → {tick, pickCard}
//       브라우저: index.html#bot=pro (또는 #bot=proevade, &speed=2) 로 열면 이 파일을 불러와 관전
const mass=r=>{const v=r/.64;return v*v/100;};
const DMG_DV=.12;
const ENV=typeof process!=='undefined'?process.env:{};   // 브라우저 관전(index.html#bot=pro)에서도 돌아가게
const REC=+(ENV.REC||.3),FLEE=ENV.FLEE||'rep';   // 측정상 rep + 30% 가 가장 오래 버팀 (gap 은 빈틈 찾기 도주)
// noAttack=true: 같은 회피·도주·크기 판단을 쓰되 절대 먼저 노리지 않는 숙련 회피형 (공정한 비교 상대)
const ProBot=function(M,set,noAttack){
  const st={tgt:null,ret:0,rec:false,esc:0};
  function steerTo(dx,dy){const L=Math.hypot(dx,dy)||1;dx/=L;dy/=L;set('KeyD',dx>.38);set('KeyA',dx<-.38);set('KeyS',dy>.38);set('KeyW',dy<-.38);}
  // 박았을 때 예상 충격량 (커진 상태 기준)
  function hitJ(e,c){const U=M.U,mb=mass(U.rmax*.92),me=mass(e.r);return 1.3*c/(1/mb+1/me);}
  function killable(e,c){if(e.type==='spiker')return false;return hitJ(e,c)*M.U.dmgMul>=e.hp*1.05;}
  // 상대 운동으로 언제 닿는지 (없으면 Infinity)
  function contactT(P,e,R){const rx=e.x-P.x,ry=e.y-P.y,ux=e.vx-P.vx,uy=e.vy-P.vy;const a=ux*ux+uy*uy,b=2*(rx*ux+ry*uy),c=rx*rx+ry*ry-R*R;
    if(c<=0)return 0;if(a<1e-6||b>=0)return Infinity;const D=b*b-4*a*c;if(D<0)return Infinity;return (-b-Math.sqrt(D))/(2*a);}
  function segDist(px,py,ax,ay,bx,by){const vx=bx-ax,vy=by-ay,L=vx*vx+vy*vy||1;let t=((px-ax)*vx+(py-ay)*vy)/L;t=Math.max(0,Math.min(1,t));return Math.hypot(px-ax-vx*t,py-ay-vy*t);}
  function avoidRocksWalls(dx,dy){const P=M.P,m=350;if(P.x<m)dx+=(m-P.x)/m*3;if(P.x>5600-m)dx-=(P.x-5600+m)/m*3;if(P.y<m)dy+=(m-P.y)/m*3;if(P.y>3600-m)dy-=(P.y-3600+m)/m*3;
    const sp=Math.hypot(P.vx,P.vy);if(sp<60)return [dx,dy];const vx=P.vx/sp,vy=P.vy/sp,look=sp*.5+P.r+90;
    for(const k of M.rocks){const rx=k.x-P.x,ry=k.y-P.y,along=rx*vx+ry*vy;if(along<-k.r||along>look+k.r)continue;const side=rx*vy-ry*vx;if(Math.abs(side)>k.r+P.r+60)continue;
      const s2=side>0?-1:1,w=2.5*(1-Math.max(0,along)/(look+k.r))+1;dx+=vy*s2*w;dy+=-vx*s2*w;dx-=vx*w*.6;dy-=vy*w*.6;}
    return [dx,dy];}
  function tick(){
    const P=M.P,U=M.U,es=[];for(const e of M.enemies)if(!e.dead&&e.spawn<=0&&Math.abs(e.x-P.x)<1400&&Math.abs(e.y-P.y)<1100)es.push(e);
    const sp=Math.hypot(P.vx,P.vy),hpF=P.hp/U.hpMax,eF=P.energy/U.energyMax;
    const growT=Math.max(.08,(U.rmax*.92-P.r)/U.sizeRate)+.05;
    // 충전 ↔ 돌격 사이클: 에너지가 REC(기본 30%) 아래로 떨어지면 무리 안에서 새 목표를 잡지 않고 빈 쪽으로 빠져나가
    // 작은 몸으로 충전, 90% 이상 차면 적 쪽으로 작게 가속 → 닿기 직전 커져서 충돌 (폭탄병 포함)
    // 무리 한가운데서 에너지가 바닥나면 커지지도 도망치지도 못하므로, 남은 에너지로 빠져나올 여유를 둠
    if(P.overload||P.energy<U.energyMax*REC)st.rec=true;if(P.energy>=U.energyMax*.9&&!P.overload)st.rec=false;
    if(noAttack)st.rec=true;
    // 위험물 분류
    const hard=[],soft=[];
    for(const e of es){const dx=e.x-P.x,dy=e.y-P.y,d=Math.hypot(dx,dy)||1;
      // 가까우면 지금 속도 그대로, 멀면 가속할 여유를 조금 줌 (낙관적으로 보면 못 부수는 적에 박음)
      const c=d<350?sp*.85:Math.max(sp*.85,Math.min(900,350+d*.6));(e.type!=='elite'&&killable(e,c)?soft:hard).push(e);}
    let ax=0,ay=0;
    // 1) 목표 고르기
    st.ret-=1/60;
    if(!st.rec&&(!st.tgt||st.tgt.dead||st.ret<=0||!soft.includes(st.tgt))){
      st.ret=.35;let best=-1e9,bt=null;const cand=soft.length>80?soft.filter((_,i)=>i%Math.ceil(soft.length/80)===0):soft;
      const vx=sp>80?P.vx/sp:0,vy=sp>80?P.vy/sp:0;
      for(const e of cand){const dx=e.x-P.x,dy=e.y-P.y,d=Math.hypot(dx,dy);if(d>1100)continue;
        let c=0;for(const o of soft)if(Math.abs(o.x-e.x)<170&&Math.abs(o.y-e.y)<170)c++;
        let block=0;for(const h of hard){const sd=segDist(h.x,h.y,P.x,P.y,e.x,e.y);if(sd<h.r+U.rmax+30)block++;}
        for(const k of M.rocks){if(segDist(k.x,k.y,P.x,P.y,e.x,e.y)<k.r+P.r+20)block++;}
        let bomb=0;if(e.type==='bomber'&&P.energy<U.energyMax*.35)bomb=99;   // 커질 에너지가 없으면 폭탄병은 노리지 않음
        const align=(dx*vx+dy*vy)/(d||1);
        const sc=Math.min(c,12)*1.0-block*6-Math.abs(d-550)/350+align*1.2-bomb;   // 550 정도 떨어진 무리: 가속할 거리 확보
        if(sc>best){best=sc;bt=e;}}
      st.tgt=bt;
    }
    const t=st.rec?null:st.tgt;
    if(t){const dx=t.x-P.x,dy=t.y-P.y,d=Math.hypot(dx,dy)||1,lead=Math.min(.6,d/Math.max(500,sp));
      const tx=t.x+t.vx*lead-P.x,ty=t.y+t.vy*lead-P.y,tl=Math.hypot(tx,ty)||1;
      // 목표 쪽 속도 + 옆으로 새는 속도 상쇄
      const ux=tx/tl,uy=ty/tl,vpar=P.vx*ux+P.vy*uy,px=P.vx-ux*vpar,py=P.vy-uy*vpar;
      ax+=ux*2-px/600;ay+=uy*2-py/600;
      // 너무 가까운데 느리면 가속 거리를 벌리려 살짝 비켜감
      if(d<180&&vpar<350){ax-=ux*1.5;ay-=uy*1.5;ax+=-uy*1.2;ay+=ux*1.2;}
    }else if(FLEE==='gap'){
      // 충전: 24방향 중 멀리까지 가장 빈 쪽으로 최고 속도로 빠짐 (사방에서 밀어내는 힘을 더하면 서로 상쇄돼 느려지고 포위됨)
      let bc=1e9,bx=0,by=0;const spn=Math.max(200,sp);
      for(let k=0;k<24;k++){const a=k/24*Math.PI*2,ux=Math.cos(a),uy=Math.sin(a);let cost=0;
        for(const e of es){const dx=e.x+e.vx*.4-P.x,dy=e.y+e.vy*.4-P.y,d=Math.hypot(dx,dy)||1;if(d>1100)continue;const cs=(dx*ux+dy*uy)/d;if(cs<=-.2)continue;
          cost+=Math.pow((cs+.2)/1.2,2)*(1+250/d)*(e.type==='bomber'||e.type==='shooter'?2:1);}
        for(const r of M.rocks){const dx=r.x-P.x,dy=r.y-P.y,d=Math.hypot(dx,dy)-r.r;if(d>400)continue;if((dx*ux+dy*uy)/(Math.hypot(dx,dy)||1)>.6)cost+=8*(1-d/400)+2;}
        const wx=P.x+ux*600,wy=P.y+uy*600;if(wx<150||wx>5450||wy<150||wy>3450)cost+=25;
        for(const o of M.orbs){const dx=o.x-P.x,dy=o.y-P.y,d=Math.hypot(dx,dy);if(d<500&&(dx*ux+dy*uy)/(d||1)>.8)cost-=.15;}   // 가는 길의 구슬
        cost-=(P.vx*ux+P.vy*uy)/spn*.6;
        if(cost<bc){bc=cost;bx=ux;by=uy;}}
      ax+=bx*4;ay+=by*4;
    }else{   // FLEE=rep: 구슬 줍기 + 가까운 적 밀어내기만
      let ob=null,bd=600;for(const o of M.orbs){const d=Math.hypot(o.x-P.x,o.y-P.y);if(d>=bd)continue;let safe=true;for(const e of es){if(Math.abs(e.x-o.x)<140&&Math.abs(e.y-o.y)<140){safe=false;break;}}if(safe){bd=d;ob=o;}}
      if(ob){ax+=(ob.x-P.x)/bd;ay+=(ob.y-P.y)/bd;}
      else{const tx=-(P.y-1800),ty=(P.x-2800),tl=Math.hypot(tx,ty)||1;ax+=tx/tl*.6;ay+=ty/tl*.6;}
    }
    // 2) 장애물 회피: 못 부수는 적 / 가시 / (작을 때·충전 중) 모든 적 / 작을 때 폭탄병
    for(const e of es){const dx=P.x-(e.x+e.vx*.3),dy=P.y-(e.y+e.vy*.3),d=Math.hypot(dx,dy)-e.r-P.r;
      const isHard=!soft.includes(e),isBomb=e.type==='bomber'&&e!==t;
      let rng=0,w=0;
      if(isHard){rng=e.type==='elite'?420:300;w=3;}
      else if(st.rec){rng=FLEE==='gap'?(e.type==='bomber'?300:180):(e.type==='bomber'?520:560);w=FLEE==='gap'?(e.type==='bomber'?3:1.5):(e.type==='bomber'?4:2.2);}
      else if(isBomb){rng=P.r<U.rmax*.6?280:200;w=1.6;}
      if(!rng||d>rng)continue;const q=Math.max(15,d),k=w*(1-d/rng)*(1+60/q);ax+=dx/(Math.hypot(dx,dy)||1)*k;ay+=dy/(Math.hypot(dx,dy)||1)*k;}
    // 3) 적탄 회피
    for(const b of M.bullets){const rx=b.x-P.x,ry=b.y-P.y;if(rx*rx+ry*ry>450*450)continue;const ux=b.vx-P.vx,uy=b.vy-P.vy,uu=ux*ux+uy*uy||1;
      let tt=-(rx*ux+ry*uy)/uu;if(tt<0||tt>.9)continue;const cx=rx+ux*tt,cy=ry+uy*tt,md=Math.hypot(cx,cy);if(md>P.r+b.r+30)continue;
      const k=2.5*(1-tt/.9);if(md>1){ax-=cx/md*k;ay-=cy/md*k;}else{ax+=-uy/Math.sqrt(uu)*k;ay+=ux/Math.sqrt(uu)*k;}}
    // 4) 포위 탈출: 느린데 주변이 빽빽하면 가장 빈 쪽으로
    //    16방향 중 적·바위가 가장 적은 틈을 골라 빠져나감 (무리 중심 반대쪽은 막혀 있는 경우가 많음)
    let near=0;for(const e of es){const d=Math.hypot(e.x-P.x,e.y-P.y);if(d<240)near++;}
    if(near>=5&&(sp<450||P.energy<20)){
      let bc=1e9,bx=0,by=0;
      for(let k=0;k<16;k++){const a=k/16*Math.PI*2,ux=Math.cos(a),uy=Math.sin(a);let cost=0;
        for(const e of es){const dx=e.x-P.x,dy=e.y-P.y,d=Math.hypot(dx,dy)||1;if(d>520)continue;const cs=(dx*ux+dy*uy)/d;if(cs<=0)continue;cost+=Math.pow(cs,4)*(e.type==='bomber'||!soft.includes(e)?3:1)*(1+200/d);}
        for(const r of M.rocks){const dx=r.x-P.x,dy=r.y-P.y,d=Math.hypot(dx,dy)-r.r;if(d>350)continue;const cs=(dx*ux+dy*uy)/(Math.hypot(dx,dy)||1);if(cs>.5)cost+=20;}
        const wx=P.x+ux*400,wy=P.y+uy*400;if(wx<100||wx>5500||wy<100||wy>3500)cost+=30;
        cost-=(P.vx*ux+P.vy*uy)/Math.max(200,sp)*.8;   // 지금 가는 방향 쪽을 약간 선호 (방향 전환은 느림)
        if(cost<bc){bc=cost;bx=ux;by=uy;}}
      const w=near>=12?6:4;ax=ax*.3+bx*w;ay=ay*.3+by*w;
    }
    [ax,ay]=avoidRocksWalls(ax,ay);steerTo(ax,ay);
    // 5) 크기: 곧 닿을 적이 있으면 커짐 (받는 속도 변화를 줄이고 충격량을 키움), 아니면 작아져서 가속·충전
    // 회피형은 에너지와 상관없이 충돌을 피할 수 없을 때만 커짐 (받는 피해 줄이기)
    // 충전 중(에너지 40% 미만)에는 단단한 적·폭탄병에 닿을 때만 커짐 — 떼거리에 닿을 때마다 커지면 에너지가 영영 안 참
    let tc=Infinity;const Rb=U.rmax*.75,picky=st.rec&&P.energy<U.energyMax*.4&&!noAttack;
    for(const e of es){if(picky&&soft.includes(e)&&e.type!=='bomber')continue;const tt=contactT(P,e,Rb+e.r);if(tt<tc)tc=tt;}
    for(const b of M.bullets){const tt=contactT(P,{x:b.x,y:b.y,vx:b.vx,vy:b.vy},P.r+b.r+U.rmax*.5);if(tt<.12&&tt<tc)tc=tt;}
    // 폭탄병·엘리트가 근처에 있으면 미리 커져 둠 (언제 터질지 모르므로 질량으로 버팀)
    let bombNear=false;for(const e of es){if(e.type!=='bomber'&&e.type!=='elite')continue;const R=(e.type==='bomber'?170:260)+P.r+30;if(Math.hypot(e.x-P.x,e.y-P.y)<R&&e.hp<e.max*.7){bombNear=true;break;}}
    const canGrow=!P.overload&&P.energy>14;   // 비상금: 폭발 대비용 에너지는 남겨 둠
    const g=canGrow&&(tc<growT||(bombNear&&P.energy>8));
    set('Semicolon',g);set('KeyL',!g);
  }
  // 카드: 진화 > 가진 무기 강화 > 빈 슬롯 새 무기 > 생존(체력 낮을 때) > 몸통 강화
  const WANT={'중량타':6,'강체':5,'재생':4,'거대화':5,'효율':4,'축전지':4,'고속 충전':3,'급변':3,'추진력':4,'당구':3,'자석':2,'가시 장갑':1,'충돌 폭발':3,'극소화':2,'체렌코프 증폭':2};
  const SPW={nova:6,elastic:5,dense:4,absorb:4,tidal:3,well:3};
  function pickCard(){
    const U=M.U,P=M.P;let best=-1e9,bi=0;const nW=M.weaponCount();
    M.opts.forEach((ix,i)=>{const u=M.UPS[ix];let s=0;
      if(u.evo)s=20;
      else if(u.sp)s=SPW[u.sp]||2;
      else if(u.w){const lv=U[u.w]||0;s=lv>0?9+lv*.5:(nW<4?7:0);}
      else s=WANT[u.n]||1;
      if(P.hp/U.hpMax<.5&&(u.n==='강체'||u.n==='재생'))s+=6;
      if(s>best){best=s;bi=i;}});
    return bi;
  }
  return {tick,pickCard,_st:st};
};
if(typeof module!=='undefined')module.exports=ProBot;else window.ProBot=ProBot;
