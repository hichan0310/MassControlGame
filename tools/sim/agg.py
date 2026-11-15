"""matrix.sh 결과 폴더를 읽어 8×8 표(초당 피해, 천 단위)를 출력. 대각선=단독 무기, 나머지=진화."""
import json,glob,collections,sys
W=['chain','shrap','hole','orbit','aura','fire','missile','mine']
d=collections.defaultdict(list)
for f in glob.glob(sys.argv[1]+'/*_*.txt'):
    t=open(f).read().strip()
    if not t.startswith('{'):continue
    x=json.loads(t)
    if x.get('dead'):continue
    k=x.get('k') or x['w']+'+'+x['w'];d[k].append(x)
def g(a,b):
    k=a+'+'+b if W.index(a)<=W.index(b) else b+'+'+a
    v=d.get(k)
    return f"{sum(x['wdps'] for x in v)/len(v)/1000:.0f}" if v else '-'
print('      '+' '.join(f'{w[:5]:>6}' for w in W))
for a in W:print(f'{a[:5]:>5} '+' '.join(f'{g(a,b):>6}' for b in W))
