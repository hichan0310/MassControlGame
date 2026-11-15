// index.html 의 데이터(카드·진화·특수 능력·적)를 읽어 docs/CONTENT.md 를 다시 만든다.
// 사용: python3 tools/sim/extract.py && node tools/gen_docs.js
const fs=require('fs'),path=require('path');
const {M}=require('./sim/harness')('game.js');
const W=['chain','shrap','hole','orbit','aura','fire','missile','mine'];
const WN={};for(const u of M.UPS)if(u.w)WN[u.w]=u.n;
let o='# 콘텐츠 목록 (자동 생성)\n\n> `node tools/gen_docs.js` 로 index.html 에서 다시 생성됩니다. 직접 고치지 마세요.\n\n';
o+='## 무기 (슬롯 '+4+'칸)\n\n| 키 | 이름 | 최대 Lv | 설명 |\n|---|---|---|---|\n';
for(const u of M.UPS.filter(u=>u.w))o+=`| \`${u.w}\` | ${u.n} | ${u.max} | ${u.d} |\n`;
o+='\n## 일반 카드\n\n| 이름 | 최대 | 설명 |\n|---|---|---|\n';
for(const u of M.UPS.filter(u=>!u.w&&!u.evo&&!u.sp))o+=`| ${u.n} | ${u.max||(u.once?1:'∞')} | ${u.d} |\n`;
o+='\n## 특수 능력 (5·15레벨에 3개 중 1개, 최대 2개)\n\n| 키 | 이름 | 설명 |\n|---|---|---|\n';
for(const u of M.UPS.filter(u=>u.sp))o+=`| \`${u.sp}\` | ${u.n} | ${u.d} |\n`;
o+='\n## 진화 28종 (두 무기 최대 레벨 → 슬롯 1칸으로 합쳐짐)\n\n| 키 | 이름 | 재료 | 효과 |\n|---|---|---|---|\n';
for(const e of M.EVOS)o+=`| \`${e.key}\` | ${e.name} | ${WN[e.a]} + ${WN[e.b]} | ${e.d} |\n`;
fs.writeFileSync(path.join(__dirname,'..','docs','CONTENT.md'),o);
console.log('docs/CONTENT.md 생성');
