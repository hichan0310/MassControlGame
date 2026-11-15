// 학습된 모델(tools/rl/py/model.py 의 Net)을 JS 로 추론. 브라우저 관전 · bot.js 평가용. Node·브라우저 공용.
// model.py 의 구조를 바꾸면 여기도 같이 바꾸고 `node tools/rl/check.js 모델이름` 으로 PyTorch 출력과 같은지 확인.
(function(){
const FT=typeof module!=='undefined'?require('./features'):window.RLFeatures;
function b64(s){let u8;if(typeof Buffer!=='undefined'){const b=Buffer.from(s,'base64');u8=new Uint8Array(b.length);u8.set(b);}else{const t=atob(s);u8=new Uint8Array(t.length);for(let i=0;i<t.length;i++)u8[i]=t.charCodeAt(i);}return new Float32Array(u8.buffer);}
function load(m){const W={};for(const k in m.w)W[k]=b64(m.w[k][1]);return {m,W};}
// y = W x + b (W: out×in, torch 배치)
function lin(W,b,x,nin,nout,out){out=out||new Float32Array(nout);for(let o=0;o<nout;o++){let s=b?b[o]:0;const r=o*nin;for(let i=0;i<nin;i++)s+=W[r+i]*x[i];out[o]=s;}return out;}
function relu(a){for(let i=0;i<a.length;i++)if(a[i]<0)a[i]=0;return a;}
function ln(x,g,b,d){let m=0;for(let i=0;i<d;i++)m+=x[i];m/=d;let v=0;for(let i=0;i<d;i++)v+=(x[i]-m)**2;v/=d;const s=1/Math.sqrt(v+1e-5),o=new Float32Array(d);for(let i=0;i<d;i++)o[i]=(x[i]-m)*s*g[i]+b[i];return o;}
const TOK=['enemy','bullet','rock','obj'];
function forward(net,obs){
  const {m,W}=net,sp=m.spec,c=m.cfg,d=c.d,H=c.heads,dh=d/H,seg=sp.seg;
  {const sc=W['obs_scale'],co=seg.card[0],x=new Float32Array(obs.length);x.set(obs);   // 관측 배율 (model.py 와 같게)
    if(sc)for(let i=0;i<co;i++){let v=x[i]/sc[i];x[i]=v>10?10:v<-10?-10:v;}obs=x;}
  const sl=n=>obs.subarray(seg[n][0],seg[n][0]+seg[n][1]);
  const s=sl('self'),ns=seg.self[1];
  // 토큰 (없는 토큰은 아예 빼고 계산 = 가림막과 같음)
  const xs=[lin(W['self_tok.weight'],W['self_tok.bias'],s,ns,d)];
  for(const t of TOK){const K=sp.K[t],Fe=sp.F[t],a=sl(t);for(let k=0;k<K;k++){const r=a.subarray(k*Fe,(k+1)*Fe);if(r[0]>.5)xs.push(lin(W['tok.'+t+'.weight'],W['tok.'+t+'.bias'],r,Fe,d));}}
  const T=xs.length;
  for(let L=0;L<c.layers;L++){const p='blocks.'+L+'.';
    const qkv=xs.map(x=>lin(W[p+'qkv.weight'],W[p+'qkv.bias'],ln(x,W[p+'ln1.weight'],W[p+'ln1.bias'],d),d,3*d));
    const att=xs.map(()=>new Float32Array(d)),sc=new Float32Array(T),isq=1/Math.sqrt(dh);
    for(let h=0;h<H;h++)for(let i=0;i<T;i++){let mx=-1e30;
      for(let j=0;j<T;j++){let z=0;for(let e=0;e<dh;e++)z+=qkv[i][h*dh+e]*qkv[j][d+h*dh+e];z*=isq;sc[j]=z;if(z>mx)mx=z;}
      let sm=0;for(let j=0;j<T;j++){sc[j]=Math.exp(sc[j]-mx);sm+=sc[j];}
      for(let j=0;j<T;j++){const w=sc[j]/sm;for(let e=0;e<dh;e++)att[i][h*dh+e]+=w*qkv[j][2*d+h*dh+e];}}
    for(let i=0;i<T;i++){const pr=lin(W[p+'proj.weight'],W[p+'proj.bias'],att[i],d,d);for(let e=0;e<d;e++)xs[i][e]+=pr[e];
      const f=relu(lin(W[p+'ff1.weight'],W[p+'ff1.bias'],ln(xs[i],W[p+'ln2.weight'],W[p+'ln2.bias'],d),d,2*d)),f2=lin(W[p+'ff2.weight'],W[p+'ff2.bias'],f,2*d,d);
      for(let e=0;e<d;e++)xs[i][e]+=f2[e];}}
  const fx=xs.map(x=>ln(x,W['ln_f.weight'],W['ln_f.bias'],d));
  const pooled=new Float32Array(d);if(T>1){for(let i=1;i<T;i++)for(let e=0;e<d;e++)pooled[e]+=fx[i][e];for(let e=0;e<d;e++)pooled[e]/=T-1;}
  const nr=seg.radar[1],nm=seg.map[1];
  const hcat=new Float32Array(2*d+384);hcat.set(fx[0],0);hcat.set(pooled,d);
  hcat.set(relu(lin(W['radar.weight'],W['radar.bias'],sl('radar'),nr,128)),2*d);
  hcat.set(relu(lin(W['map.weight'],W['map.bias'],sl('map'),nm,128)),2*d+128);
  hcat.set(relu(lin(W['selfm.weight'],W['selfm.bias'],s,ns,128)),2*d+256);
  const tr=c.trunk,h=relu(lin(W['t2.weight'],W['t2.bias'],relu(lin(W['t1.weight'],W['t1.bias'],hcat,2*d+384,tr)),tr,tr));
  const move=lin(W['move.weight'],W['move.bias'],h,tr,sp.nMove),value=lin(W['value.weight'],W['value.bias'],h,tr,1)[0];
  const card=new Float32Array(3).fill(-1e9),cs=sl('card'),cd=c.card_dim,FC=cs.length/3;
  for(let j=0;j<3;j++){const r=cs.subarray(j*FC,(j+1)*FC);if(r[0]<=.5)continue;const ci=Math.max(0,Math.min(sp.nCardTotal-1,Math.round(r[1])));
    const v=new Float32Array(tr+cd+8);v.set(h,0);v.set(W['card_emb.weight'].subarray(ci*cd,(ci+1)*cd),tr);v.set(r.subarray(2,10),tr+cd);
    card[j]=lin(W['c2.weight'],W['c2.bias'],relu(lin(W['c1.weight'],W['c1.bias'],v,tr+cd+8,128)),128,1)[0];}
  return {move,card,value};
}
function softmax(a,n){let m=-1e30;for(let i=0;i<n;i++)if(a[i]>m)m=a[i];const p=new Float32Array(n);let s=0;for(let i=0;i<n;i++){p[i]=Math.exp(a[i]-m);s+=p[i];}for(let i=0;i<n;i++)p[i]/=s;return p;}
function sample(p,rnd,greedy){if(greedy){let b=0;for(let i=1;i<p.length;i++)if(p[i]>p[b])b=i;return b;}let u=rnd(),i=0;for(;i<p.length-1;i++){u-=p[i];if(u<=0)break;}return i;}
// 봇: bot.js 의 pro 와 같은 모양 (tick / pickCard). frameskip 프레임마다 한 번 결정.
function makeBot(M,set,model,opt){
  opt=opt||{};const net=load(model),sp=model.spec,obs=new Float32Array(sp.nObs),cache={},fs=model.frameskip||4,rnd=opt.rnd||Math.random;
  let picks={},lastT=-1,fc=0;
  const run=()=>{if(M.time<lastT)picks={};lastT=M.time;FT.build(M,sp,picks,obs,cache);return forward(net,obs);};
  return {spec:sp,
    tick(){if(fc++%fs)return;const o=run();FT.applyMove(sample(softmax(o.move,sp.nMove),rnd,opt.greedy),set);},
    pickCard(){const o=run(),n=M.opts.length,i=sample(softmax(o.card,n),rnd,opt.greedy);picks[M.opts[i]]=(picks[M.opts[i]]||0)+1;return i;}};
}
const API={load,forward,makeBot,b64};
if(typeof module!=='undefined')module.exports=API;else window.RLNet=API;
})();
