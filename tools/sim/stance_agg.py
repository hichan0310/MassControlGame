"""stance.sh 결과 폴더 → 돌진형·회피형 비교 표"""
import json,sys,glob,os
D=sys.argv[1] if len(sys.argv)>1 else 'tools/sim/out_stance'
R={}
for f in glob.glob(os.path.join(D,'*.json')):
    t=open(f).read().strip()
    if t:r=json.loads(t);R.setdefault(r['bot'],[]).append(r)
avg=lambda a,k:sum(x[k] for x in a)/len(a)
print('| 봇 | 판 | 평균 생존(분) | 10분 이상 | 사망 | 평균 레벨 | 평균 처치 | 평균 점수 | 몸통 딜 % |')
print('|---|---|---|---|---|---|---|---|---|')
for b in ['pro','proevade','rl','ram','evade','kite']:
    a=R.get(b)
    if not a:continue
    print(f"| {b} | {len(a)} | {avg(a,'surv'):.2f} | {sum(x['surv']>=10 for x in a)} | {sum(x['dead'] for x in a)} | {avg(a,'lvl'):.1f} | {avg(a,'kills'):.0f} | {avg(a,'score'):,.0f} | {avg(a,'core'):.0f} |")
if 'pro' in R and 'proevade' in R:
    r,k=R['pro'],R['proevade']
    print(f"\n돌진/회피 비율 — 생존 {avg(r,'surv')/max(1e-9,avg(k,'surv')):.2f}배, 처치 {avg(r,'kills')/max(1,avg(k,'kills')):.2f}배, 점수 {avg(r,'score')/max(1,avg(k,'score')):.2f}배")
