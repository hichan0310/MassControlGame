"""학습된 모델 평가: 판 N 개를 끝까지 돌려 생존·레벨·딜 구성·카드 선택을 표로.

사용 (저장소 루트에서):
  .venv/bin/python tools/rl/py/eval.py run1                 # 24판, 15분 상한
  .venv/bin/python tools/rl/py/eval.py run1 --episodes 48 --greedy
비교 기준: 숙련 돌진형 봇(pro)은 15분 상한에서 평균 생존 12.3분, 10분 이상 79% (docs/BALANCE.md)
"""
import argparse, collections, os, sys
import numpy as np
import torch

sys.path.insert(0, os.path.dirname(__file__))
from envclient import VecEnv, ROOT  # noqa: E402
from model import Net  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('name')
p.add_argument('--episodes', type=int, default=24)
p.add_argument('--max-min', type=float, default=15)
p.add_argument('--greedy', action='store_true', help='확률 대신 가장 높은 행동만')
p.add_argument('--seed', type=int, default=777)
p.add_argument('--servers', type=int, default=6)
args = p.parse_args()

ck = torch.load(os.path.join(ROOT, 'tools', 'rl', 'models', args.name + '.pt'), map_location='cpu', weights_only=False)
a = ck['args']
env = VecEnv(envs=args.episodes, servers=min(args.servers, args.episodes), frameskip=a['frameskip'], max_min=args.max_min, seed=args.seed, reward=a['reward'])
dev = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
net = Net(env.spec, d=a['d'], layers=a['layers'], heads=a['heads'], trunk=a['trunk'], arch=a.get('arch', 'attn')).to(dev)
net.load_state_dict(ck['net']); net.eval()
print(f'모델 {args.name}: {ck["iter"]}회차, {ck["total"]/1e6:.1f}M 걸음 학습 · {args.episodes}판 · {"최선 행동" if args.greedy else "확률 행동"}')

st, res, done = env.reset(), {}, np.zeros(args.episodes, bool)
picks = [collections.Counter() for _ in range(args.episodes)]
co = env.spec['seg']['card'][0]
while not done.all():
    o = torch.from_numpy(st['obs'].copy()).to(dev)
    with torch.no_grad():
        ml, cl, _ = net(o)
    if args.greedy:
        am, ac = ml.argmax(-1), cl.argmax(-1)
    else:
        am, ac = torch.distributions.Categorical(logits=ml).sample(), torch.distributions.Categorical(logits=cl).sample()
    act = torch.where(torch.from_numpy(st['mode']).to(dev) == 1, ac, am).cpu().numpy()
    for i in np.nonzero((st['mode'] == 1) & ~done)[0]:
        picks[i][env.spec['cards'][int(st['obs'][i, co + act[i] * 10 + 1])]] += 1
    st = env.step(act)
    for i in np.nonzero((st['ep'][:, 0] >= 0) & ~done)[0]:
        res[i] = st['ep'][i].copy(); done[i] = True
        print(f'  판 {i+1:2d}: {"사망" if res[i][6] else "생존"} {res[i][0]/60:5.1f}분  레벨 {int(res[i][1]):2d}  처치 {int(res[i][2]):6d}  몸통딜 {res[i][4]*100:3.0f}%', flush=True)
env.close()
R = np.array([res[i] for i in range(args.episodes)])
print(f'\n평균 생존 {R[:,0].mean()/60:.2f}분 · 10분 이상 {(R[:,0]>=600).sum()}/{len(R)} · 평균 레벨 {R[:,1].mean():.1f} · 평균 처치 {R[:,2].mean():.0f} · '
      f'몸통딜 {R[:,4].mean()*100:.0f}% (직접박기 {R[:,5].mean()*100:.0f}%)')
tot = collections.Counter()
for c in picks: tot.update(c)
print('많이 고른 카드:', ', '.join(f'{k} {v}' for k, v in tot.most_common(12)))
