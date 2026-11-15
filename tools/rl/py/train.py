"""순수 강화학습(PPO) 학습기 — 전략 힌트 없이 조작 틀(WASD · 크기 · 카드)만 주고 보상으로 배운다.

사용 (저장소 루트에서):
  .venv/bin/python tools/rl/py/train.py --name run1            # 새로 학습 (Ctrl-C: 저장하고 종료)
  .venv/bin/python tools/rl/py/train.py --name run1 --resume   # 이어서
  .venv/bin/python tools/rl/py/train.py --name sc1 --reward score

결과: tools/rl/models/<name>.pt (재개용) · <name>.json (모델, JS 추론용) · <name>.js / latest.js (브라우저 관전) · <name>.csv (기록)
"""
import argparse, base64, collections, json, os, sys, time
import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(__file__))
from envclient import VecEnv, ROOT  # noqa: E402
from model import Net  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--name', default='run1')
p.add_argument('--resume', action='store_true')
p.add_argument('--iters', type=int, default=10**9)
p.add_argument('--envs', type=int, default=96, help='동시에 돌리는 판 수')
p.add_argument('--servers', type=int, default=12, help='Node 환경 서버 수 (통신 지연을 겹치기 위해 여러 개)')
p.add_argument('--remote', action='append', default=[], help='다른 컴퓨터에서도 게임을 돌림: 호스트:판수[:서버수[:폴더]] (SSH 키 접속 필요, 여러 번 가능)')
p.add_argument('--steps', type=int, default=128, help='회차마다 판당 걸음 수')
p.add_argument('--epochs', type=int, default=4)
p.add_argument('--minibatch', type=int, default=4096)
p.add_argument('--lr', type=float, default=3e-4)
p.add_argument('--gamma', type=float, default=0.999, help='할인율 (걸음=4프레임). 0.999 ≈ 1분 앞까지 봄 — 카드 효과처럼 늦게 나타나는 것을 배우려면 길어야 함')
p.add_argument('--lam', type=float, default=0.95)
p.add_argument('--clip', type=float, default=0.2)
p.add_argument('--ent', type=float, default=0.01, help='이동 엔트로피 보너스 (탐험)')
p.add_argument('--ent-card', type=float, default=0.03, help='카드 엔트로피 보너스 (여러 카드를 시도)')
p.add_argument('--vcoef', type=float, default=0.5)
p.add_argument('--max-grad', type=float, default=0.5)
p.add_argument('--reward', default='survive', choices=['survive', 'score', 'mix'], help='survive=살아 있던 시간만')
p.add_argument('--frameskip', type=int, default=4)
p.add_argument('--max-min', type=float, default=15, help='판 시간 상한 (분)')
p.add_argument('--seed', type=int, default=1)
p.add_argument('--d', type=int, default=128); p.add_argument('--layers', type=int, default=2); p.add_argument('--heads', type=int, default=4)
p.add_argument('--trunk', type=int, default=256)
p.add_argument('--arch', default='attn', choices=['attn', 'mlp'])
p.add_argument('--save-every', type=int, default=10)
p.add_argument('--device', default='cuda' if torch.cuda.is_available() else 'cpu')
p.add_argument('--no-amp', action='store_true', help='bf16 혼합 정밀도 끄기')
args = p.parse_args()

MD = os.path.join(ROOT, 'tools', 'rl', 'models'); os.makedirs(MD, exist_ok=True)
path = lambda ext: os.path.join(MD, args.name + ext)
dev = torch.device(args.device)
amp = (lambda: torch.autocast('cuda', dtype=torch.bfloat16)) if dev.type == 'cuda' and not args.no_amp else (lambda: torch.autocast('cpu', enabled=False))
torch.manual_seed(args.seed)


def same_spec(a, b):
    return all(a[k] == b[k] for k in ['nObs', 'types', 'cards', 'ukeys', 'selfNames'])


class RunningStd:  # 할인 누적 보상의 표준편차로 보상 크기를 맞춤
    def __init__(self): self.n, self.mean, self.m2 = 1e-4, 0.0, 1.0
    def update(self, x):
        n, m, v = len(x), float(x.mean()), float(x.var())
        d, tot = m - self.mean, self.n + n
        self.mean += d * n / tot; self.m2 += v * n + d * d * self.n * n / tot; self.n = tot
    @property
    def std(self): return max(1e-4, (self.m2 / self.n) ** 0.5)


ck = torch.load(path('.pt'), map_location='cpu', weights_only=False) if args.resume and os.path.exists(path('.pt')) else None
if ck:  # 저장된 설정 중 구조·환경 관련은 그대로 씀
    for k in ['d', 'layers', 'heads', 'trunk', 'frameskip', 'reward', 'gamma', 'arch']:
        setattr(args, k, ck['args'][k])
env = VecEnv(envs=args.envs, servers=args.servers, frameskip=args.frameskip, max_min=args.max_min,
             seed=args.seed + (ck['iter'] if ck else 0) * 17, reward=args.reward, remote=args.remote)
spec = env.spec
net = Net(spec, d=args.d, layers=args.layers, heads=args.heads, trunk=args.trunk, arch=args.arch).to(dev)
opt = torch.optim.Adam(net.parameters(), lr=args.lr, eps=1e-5)
rstd, it0, total, hist = RunningStd(), 0, 0, collections.deque(maxlen=50)
obs_sq, obs_n = torch.zeros(spec['nObs'], dtype=torch.float64, device=dev), 0   # 관측 제곱합 (배율용)
card_off, card_pick = np.zeros(spec['nCardTotal']), np.zeros(spec['nCardTotal'])
if ck:
    if not same_spec(ck['spec'], spec):
        sys.exit('저장된 모델과 지금 게임의 관측 사양이 다름 (카드·적 종류·스킬 상태가 바뀜). 새 --name 으로 학습하세요.')
    net.load_state_dict(ck['net']); opt.load_state_dict(ck['opt'])
    rstd.__dict__.update(ck['rstd']); it0, total = ck['iter'], ck['total']; hist.extend(ck['hist'])
    obs_sq, obs_n = ck['obs_sq'].to(dev), ck['obs_n']
    card_off, card_pick = ck['card_off'], ck['card_pick']
    print(f'이어서 학습: {it0}회차, {total/1e6:.2f}M 걸음')
nparam = sum(x.numel() for x in net.parameters())
rem = ''.join(f', {r}' for r in args.remote)
print(f'관측 {spec["nObs"]} · 가중치 {nparam:,} · 판 {env.n} (이 컴퓨터 {args.envs}{rem}) · 회차당 {env.n*args.steps:,} 걸음 · 보상 {args.reward} · 장치 {dev}')


def export(it):
    w = {k: [list(v.shape), base64.b64encode(v.detach().cpu().float().numpy().tobytes()).decode()] for k, v in net.state_dict().items()}
    # JS 추론 검증용 표본: 적이 가장 많은 판 + (있으면) 카드 고르는 판
    eo, ek = spec['seg']['enemy'][0], spec['K']['enemy']
    nen = st['obs'][:, eo:eo + ek * spec['F']['enemy']].reshape(len(st['obs']), ek, -1)[:, :, 0].sum(1)
    pick = [int(nen.argmax())] + [int(i) for i in np.nonzero(st['mode'] == 1)[0][:1]]
    o = torch.from_numpy(st['obs'][pick].copy()).to(dev)
    with torch.no_grad():
        ml, cl, v = net(o)
    test = [dict(obs=base64.b64encode(st['obs'][i].astype(np.float32).tobytes()).decode(), move=ml[j].tolist(), card=cl[j].tolist(), value=float(v[j]))
            for j, i in enumerate(pick)]
    m = dict(arch='attn', spec=spec, cfg=net.cfg, frameskip=args.frameskip, meta=dict(iter=it, total=total, reward=args.reward), w=w, test=test)
    js = json.dumps(m)
    open(path('.json'), 'w').write(js)
    open(path('.js'), 'w').write('window.RL_MODEL=' + js + ';\n')
    open(os.path.join(MD, 'latest.js'), 'w').write('window.RL_MODEL=' + js + ';\n')


def save(it):
    torch.save(dict(net=net.state_dict(), opt=opt.state_dict(), rstd=rstd.__dict__, iter=it, total=total, hist=list(hist), spec=spec,
                    args=vars(args), card_off=card_off, card_pick=card_pick, obs_sq=obs_sq.cpu(), obs_n=obs_n), path('.pt'))
    export(it)


N, T = env.n, args.steps   # 원격 컴퓨터 판까지 합친 수
nO = spec['nObs']
co = spec['seg']['card'][0]
OBS = torch.zeros(T, N, nO, device=dev)
MODE, ACT = torch.zeros(T, N, dtype=torch.long, device=dev), torch.zeros(T, N, dtype=torch.long, device=dev)
LP, VAL, REW, DONE = (torch.zeros(T, N, device=dev) for _ in range(4))
ret_acc = np.zeros(N)
st = env.reset()
if not ck:
    open(path('.csv'), 'w').write('iter,steps,sec,fps,surv_min,lvl,kills,score,core,ram,died,ent_move,ent_card,kl,clipfrac,vloss\n')
stop = False
try:
    for it in range(it0 + 1, it0 + args.iters + 1):
        t0 = time.time()
        net.eval()
        for t in range(T):
            o = torch.from_numpy(st['obs'].copy()).to(dev)  # 환경이 다음 걸음에서 버퍼를 덮어쓰므로 복사
            mode = torch.from_numpy(st['mode']).to(dev)
            with torch.no_grad():
                ml, cl, v = net(o)
            lm, lc = F.log_softmax(ml, -1), F.log_softmax(cl, -1)
            am = torch.distributions.Categorical(logits=ml).sample()
            ac = torch.distributions.Categorical(logits=cl).sample()
            a = torch.where(mode == 1, ac, am)
            lp = torch.where(mode == 1, lc.gather(1, ac[:, None])[:, 0], lm.gather(1, am[:, None])[:, 0])
            OBS[t], MODE[t], ACT[t], LP[t], VAL[t] = o, mode, a, lp, v
            an = a.cpu().numpy()
            for i in np.nonzero(st['mode'] == 1)[0]:  # 카드 통계: 제시된 카드 / 고른 카드
                ids = st['obs'][i, co:co + 30].reshape(3, 10)
                for j in range(3):
                    if ids[j, 0] > 0.5: card_off[int(ids[j, 1])] += 1
                card_pick[int(ids[an[i], 1])] += 1
            nst = env.step(an)
            r, d = nst['rew'], nst['done']
            g = np.where(st['mode'] == 1, 1.0, args.gamma)
            ret_acc = ret_acc * g + r; rstd.update(ret_acc); ret_acc[d > 0.5] = 0
            rn = r / rstd.std
            rn = rn + np.where(nst['trunc'] > 0.5, args.gamma * v.cpu().numpy(), 0)  # 시간 상한으로 끊긴 판: 가치로 이어 붙임 (근사)
            REW[t], DONE[t] = torch.from_numpy(rn).to(dev), torch.from_numpy(d).to(dev)
            for e in nst['ep'][nst['ep'][:, 0] >= 0]:
                hist.append(dict(t=e[0], lvl=e[1], kills=e[2], score=e[3], core=e[4], ram=e[5], dead=e[6]))
            st = nst
        t1 = time.time()
        # 관측 배율 갱신 (이번 회차 표본은 옛 배율로 모았으므로 업데이트가 끝난 뒤 적용)
        obs_sq += OBS.view(T * N, nO).double().pow(2).sum(0); obs_n += T * N
        new_scale = (obs_sq / obs_n).sqrt().clamp(min=0.05).float()
        # GAE (카드 고르는 걸음은 시간이 흐르지 않으므로 할인 없음)
        with torch.no_grad():
            _, _, vl = net(torch.from_numpy(st['obs']).to(dev))
        G = torch.where(MODE == 1, torch.ones_like(REW), torch.full_like(REW, args.gamma))
        ADV = torch.zeros_like(REW); last = torch.zeros(N, device=dev); nv = vl
        for t in reversed(range(T)):
            nd = 1 - DONE[t]
            delta = REW[t] + G[t] * nv * nd - VAL[t]
            last = delta + G[t] * args.lam * nd * last
            ADV[t] = last; nv = VAL[t]
        RET = ADV + VAL
        b = dict(obs=OBS.view(T * N, nO), mode=MODE.view(-1), act=ACT.view(-1), lp=LP.view(-1), adv=ADV.view(-1), ret=RET.view(-1))
        b['adv'] = (b['adv'] - b['adv'].mean()) / (b['adv'].std() + 1e-8)
        net.train()
        stats = collections.defaultdict(float); nb = 0
        for ep in range(args.epochs):
            perm = torch.randperm(T * N, device=dev)
            for s in range(0, T * N, args.minibatch):
                ix = perm[s:s + args.minibatch]
                with amp():
                    ml, cl, v = net(b['obs'][ix])
                ml, cl, v = ml.float(), cl.float(), v.float()
                md, ac = b['mode'][ix], b['act'][ix]
                lm, lc = F.log_softmax(ml, -1), F.log_softmax(cl, -1)
                isc = md == 1
                lp = torch.where(isc, lc.gather(1, ac.clamp(max=2)[:, None])[:, 0], lm.gather(1, ac.clamp(max=26)[:, None])[:, 0])
                ratio = (lp - b['lp'][ix]).exp(); A = b['adv'][ix]
                pg = -torch.min(ratio * A, ratio.clamp(1 - args.clip, 1 + args.clip) * A).mean()
                vloss = 0.5 * (v - b['ret'][ix]).pow(2).mean()
                hm = -(lm.exp() * lm).sum(-1); hc = -(lc.exp() * lc).sum(-1)
                em = (hm * ~isc).sum() / (~isc).sum().clamp(min=1); ec = (hc * isc).sum() / isc.sum().clamp(min=1)
                loss = pg + args.vcoef * vloss - args.ent * em - args.ent_card * ec
                opt.zero_grad(); loss.backward()
                torch.nn.utils.clip_grad_norm_(net.parameters(), args.max_grad); opt.step()
                with torch.no_grad():
                    stats['kl'] += float((b['lp'][ix] - lp).mean()); stats['clip'] += float(((ratio - 1).abs() > args.clip).float().mean())
                    stats['v'] += float(vloss); stats['em'] += float(em); stats['ec'] += float(ec) if isc.any() else 0; nb += 1
        net.obs_scale.copy_(new_scale)
        total += T * N
        sec = time.time() - t0
        H = list(hist)
        av = lambda k: float(np.mean([h[k] for h in H])) if H else 0.0
        row = [it, total, round(sec, 1), int(T * N / sec), round(av('t') / 60, 2), round(av('lvl'), 1), int(av('kills')), int(av('score')),
               int(av('core') * 100), int(av('ram') * 100), int(av('dead') * 100), round(stats['em'] / nb, 2), round(stats['ec'] / nb, 2),
               round(stats['kl'] / nb, 4), round(stats['clip'] / nb, 2), round(stats['v'] / nb, 3)]
        open(path('.csv'), 'a').write(','.join(map(str, row)) + '\n')
        print(f'[{it}] {total/1e6:.2f}M 걸음 {sec:.1f}s ({row[3]}/s, 수집 {t1-t0:.1f}s) | 최근{len(H)}판 생존 {row[4]}분 레벨 {row[5]} 처치 {row[6]} '
              f'몸통딜 {row[8]}% (직접박기 {row[9]}%) 사망 {row[10]}% | 엔트로피 이동 {row[11]} 카드 {row[12]} KL {row[13]} 가치오차 {row[15]}', flush=True)
        if it % 10 == 0 and card_off.sum() > 0:  # 카드 선택률: 제시됐을 때 고른 비율
            rate = np.where(card_off >= 20, card_pick / np.maximum(card_off, 1), np.nan)
            order = [i for i in np.argsort(-np.nan_to_num(rate, nan=-1)) if not np.isnan(rate[i])]
            fmt = lambda i: f'{spec["cards"][i]} {rate[i]*100:.0f}%'
            print('   카드 선택률 높음: ' + ', '.join(fmt(i) for i in order[:6]) + '  |  낮음: ' + ', '.join(fmt(i) for i in order[-4:]), flush=True)
            card_off *= 0.5; card_pick *= 0.5  # 최근 경향 위주
        if it % args.save_every == 0:
            save(it)
except KeyboardInterrupt:
    print('\n저장하고 종료합니다', flush=True)
finally:
    try:
        save(it)
    except Exception as e:
        print('저장 실패:', e)
    env.close()
