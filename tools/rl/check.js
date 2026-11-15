// JS 추론(net.js)이 PyTorch 와 같은 값을 내는지 확인. 사용: node tools/rl/check.js 모델이름
const fs=require('fs'),path=require('path'),NET=require('./net');
const name=process.argv[2]||'latest',m=JSON.parse(fs.readFileSync(path.join(__dirname,'models',name+'.json'),'utf8'));
const net=NET.load(m);let worst=0;
for(const t of [].concat(m.test)){const x=NET.b64(t.obs),o=NET.forward(net,x);
  const d=(a,b)=>Math.max(0,...a.map((v,i)=>b[i]<-1e8?0:Math.abs(v-b[i])));
  const dm=d(Array.from(o.move),t.move),dc=d(Array.from(o.card),t.card),dv=Math.abs(o.value-t.value);worst=Math.max(worst,dm,dc,dv);
  const sp=m.spec,eo=sp.seg.enemy[0];let ne=0;for(let k=0;k<sp.K.enemy;k++)if(x[eo+k*sp.F.enemy]>.5)ne++;
  const cardMode=t.card.some(v=>v>-1e8);
  const t0=Date.now();for(let i=0;i<10;i++)NET.forward(net,x);
  console.log(`적 토큰 ${ne}${cardMode?' · 카드 고르기':''}: 이동 최대차 ${dm.toExponential(1)} · 카드 ${dc.toExponential(1)} · 가치 ${dv.toExponential(1)} · JS 추론 ${((Date.now()-t0)/10).toFixed(1)}ms`);}
console.log(worst<1e-3?'일치':'불일치 — net.js 와 model.py 구조를 비교하세요');
