// Node 에서 게임을 화면 없이 돌리기 위한 가짜 브라우저 환경.
// 사용: const H=require('./harness')('game_i.js'); H.M 은 window.__mass (게임 내부 접근용)
const fs=require('fs'),path=require('path');
module.exports=function(file){
  const ctxProxy=new Proxy({},{get:(t,k)=>{if(k==='createRadialGradient'||k==='createLinearGradient')return()=>({addColorStop(){}});if(k==='measureText')return()=>({width:50});if(k==='getTransform')return()=>({a:1,d:1});return t[k]!==undefined?t[k]:(()=>{});},set:(t,k,v)=>{t[k]=v;return true;}});
  const canvas={getContext:()=>ctxProxy,style:{},width:960,height:600,addEventListener:(ev,fn)=>{canvas[ev]=fn;},getBoundingClientRect:()=>({left:0,top:0,width:960,height:600})};
  const L={};
  global.document={getElementById:()=>canvas,createElement:()=>({width:0,height:0,style:{},getContext:()=>ctxProxy,addEventListener(){},appendChild(){}}),body:{appendChild(){}}};
  global.window=global;global.innerWidth=1200;global.innerHeight=800;global.devicePixelRatio=1;
  global.addEventListener=(e,f)=>{(L[e]=L[e]||[]).push(f);};global.localStorage={getItem:()=>null,setItem:()=>{}};
  let raf=null;global.requestAnimationFrame=f=>{raf=f;};global.performance={now:()=>0};
  (0,eval)(fs.readFileSync(path.join(__dirname,'build',file||'game.js'),'utf8'));
  const M=global.__mass;
  const fire=(t,code)=>(L[t]||[]).forEach(f=>f({code,key:'',repeat:false,preventDefault(){}}));
  let tt=0;const step=()=>{tt+=16.7;const f=raf;raf=null;f(tt);};
  const T=(type,x,y)=>{const e=M.mkEnemy(type,x,y);e.spawn=0;M.enemies.push(e);return e;};
  return {M,fire,step,T};
};
