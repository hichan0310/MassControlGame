// 강화학습 환경 서버: 게임 N 판을 스레드마다 하나씩 화면 없이 돌리고, 파이썬 학습기와 표준 입출력으로 통신한다.
// 실행은 학습기(tools/rl/train.py)가 한다: node tools/rl/envserver.js --envs 64 --frameskip 4 --max-min 15 --seed 1 --reward survive
//
// 통신 (모두 little-endian):
//   시작:  stdout 으로 사양 JSON 한 줄 → 이어서 첫 관측 프레임
//   매 걸음: stdin 으로 Int32[1+N] = [명령(1=걸음, 2=끝), 판마다 행동]  → stdout 으로 프레임
//   프레임: Float32[N × (nObs + EXTRA)]
//     판마다 [관측 nObs | 보상, 끝남, 시간상한으로 끊김, 모드(0 이동/1 카드), 후보 수, 끝난 판 통계 7개(생존초, 레벨, 처치, 점수, 몸통딜, 직접박기, 사망)]
//   행동: 모드 0 이면 0~26 (이동 9 × 크기 3), 모드 1 이면 후보 번호 0~2
const {Worker,isMainThread,parentPort,workerData}=require('worker_threads');
const path=require('path'),fs=require('fs');
const EXTRA=12;

if(isMainThread){
  const argv=process.argv.slice(2),arg=(k,d)=>{const i=argv.indexOf('--'+k);return i<0?d:argv[i+1];};
  const cfg={envs:+arg('envs',32),frameskip:+arg('frameskip',4),maxMin:+arg('max-min',15),seed:+arg('seed',1),reward:arg('reward','survive'),scoreScale:+arg('score-scale',20000)};
  global.__nodraw=1;
  const probe=require(path.join(__dirname,'..','sim','harness'))('game_i.js');
  const spec=require('./features').makeSpec(probe.M);
  const N=cfg.envs,stride=spec.nObs+EXTRA;
  const sabObs=new SharedArrayBuffer(N*stride*4),sabAct=new SharedArrayBuffer(N*4),sabCtl=new SharedArrayBuffer((N+1)*4);
  const OBS=new Float32Array(sabObs),ACT=new Int32Array(sabAct),CTL=new Int32Array(sabCtl);
  const workers=[];
  for(let i=0;i<N;i++)workers.push(new Worker(__filename,{workerData:{i,cfg,spec,sabObs,sabAct,sabCtl,stride}}));
  for(const w of workers)w.on('error',e=>{process.stderr.write('환경 스레드 오류: '+(e&&e.stack||e)+'\n');process.exit(1);});
  // 모든 스레드에 일을 시키고 끝날 때까지 기다림 (CTL[N] = 끝낸 스레드 수)
  function runAll(){Atomics.store(CTL,N,0);for(let i=0;i<N;i++){Atomics.store(CTL,i,1);Atomics.notify(CTL,i);}
    let d;while((d=Atomics.load(CTL,N))<N)Atomics.wait(CTL,N,d,1000);}
  const out=Buffer.from(sabObs);
  const writeAll=b=>{let o=0;while(o<b.length){try{o+=fs.writeSync(1,b,o,b.length-o);}catch(e){if(e.code!=='EAGAIN')throw e;}}};
  const readExact=n=>{const b=Buffer.alloc(n);let o=0;while(o<n){let r;try{r=fs.readSync(0,b,o,n-o,null);}catch(e){if(e.code==='EAGAIN')continue;if(e.code==='EOF')process.exit(0);throw e;}if(r===0)process.exit(0);o+=r;}return b;};
  // 스레드 준비 대기 후 시작
  let ready=0;workers.forEach(w=>w.once('message',()=>{if(++ready===N)start();}));
  function start(){
    writeAll(Buffer.from(JSON.stringify({spec,extra:EXTRA,cfg})+'\n'));
    for(let i=0;i<N;i++)ACT[i]=-1;   // -1: 첫 관측만
    runAll();writeAll(out);
    for(;;){const b=readExact(4*(N+1));const cmd=b.readInt32LE(0);if(cmd===2)process.exit(0);
      for(let i=0;i<N;i++)ACT[i]=b.readInt32LE(4*(i+1));
      runAll();writeAll(out);}
  }
}else{
  // ---------- 환경 스레드: 게임 한 판 ----------
  const {i,cfg,spec,sabObs,sabAct,sabCtl,stride}=workerData;
  global.__nodraw=1;
  let gs=cfg.seed*7919+i*104729+11;Math.random=()=>{gs=(gs*16807)%2147483647;return gs/2147483647;};
  const {M,step}=require(path.join(__dirname,'..','sim','harness'))('game_i.js');
  const F=require('./features');
  const OBS=new Float32Array(sabObs,i*stride*4,stride),ACT=new Int32Array(sabAct),CTL=new Int32Array(sabCtl),N=CTL.length-1;
  const nObs=spec.nObs,cache={},set=(k,v)=>{M.keys[k]=!!v;},OBSv=OBS.subarray(0,nObs);
  let picks={},lastScore=0;
  const reset=()=>{M.initGame(false);picks={};lastScore=0;for(const k in M.keys)M.keys[k]=false;};
  step();M.endTutorial();reset();
  function epStats(o){const d=M.dmgStats||{};let tot=0,core=0,ram=0;for(const k in d){tot+=d[k];if(k==='ram'||k==='billiard'||k==='cherenkov')core+=d[k];if(k==='ram')ram+=d[k];}
    o[0]=M.time;o[1]=M.lvl;o[2]=M.kills;o[3]=M.score;o[4]=tot?core/tot:0;o[5]=tot?ram/tot:0;o[6]=M.state==='dead'?1:0;}
  const ep=new Float32Array(7);
  function work(){
    const a=ACT[i];let r=0,done=0,trunc=0;ep.fill(0);let epDone=0;
    if(a>=0){
      if(M.state==='upgrade'){const o=M.opts,j=Math.min(Math.max(a,0),o.length-1);picks[o[j]]=(picks[o[j]]||0)+1;M.pick(j);}
      else{F.applyMove(a,set);let f=0;while(f<cfg.frameskip){step();f++;if(M.state!=='play')break;}
        r=cfg.reward==='score'?(M.score-lastScore)/cfg.scoreScale:cfg.reward==='mix'?f/60+(M.score-lastScore)/cfg.scoreScale:f/60;
        lastScore=M.score;
        if(M.state==='dead'){done=1;epStats(ep);epDone=1;reset();}
        else if(M.time>=cfg.maxMin*60){done=1;trunc=1;epStats(ep);epDone=1;reset();}}
    }
    F.build(M,spec,picks,OBSv,cache);   // 관측 구간에만 씀
    const x=OBS.subarray(nObs);x[0]=r;x[1]=done;x[2]=trunc;x[3]=M.state==='upgrade'?1:0;x[4]=M.state==='upgrade'?M.opts.length:0;
    for(let k=0;k<7;k++)x[5+k]=epDone?ep[k]:0;
    if(!epDone)x[5]=-1;   // 끝난 판 없음 표시
  }
  parentPort.postMessage('ready');
  for(;;){Atomics.wait(CTL,i,0);work();Atomics.store(CTL,i,0);Atomics.add(CTL,N,1);Atomics.notify(CTL,N);}
}
