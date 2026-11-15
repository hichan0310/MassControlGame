"""정책·가치 신경망. 관측 구간(spec['seg'])을 메커니즘별로 따로 읽는다.

  토큰(나 1 + 적 K + 적탄 + 바위 + 내 블랙홀·지뢰) → 트랜스포머(셀프 어텐션) : 개체 사이 관계 (이 적과 저 적 사이로 빠질 수 있나 등)
  레이더(나 중심 방향별 밀도) · 미니맵(맵 전체) · 내 상태  → 각각 MLP
  → 줄기 MLP → 이동 27 / 가치 1
  카드: 카드마다 학습되는 고유 벡터 + 카드 특징 + 줄기 → 점수 (제시된 후보만 소프트맥스)

JS 추론(tools/rl/net.js)이 같은 계산을 하므로, 구조를 바꾸면 net.js 도 같이 바꾸고 tools/rl/py/check_js.py 로 확인할 것.
"""
import math
import torch
import torch.nn as nn
import torch.nn.functional as F

TOKENS = ['enemy', 'bullet', 'rock', 'obj']


class Block(nn.Module):
    def __init__(self, d, heads):
        super().__init__()
        self.h = heads
        self.ln1, self.ln2 = nn.LayerNorm(d), nn.LayerNorm(d)
        self.qkv = nn.Linear(d, 3 * d)
        self.proj = nn.Linear(d, d)
        self.ff1, self.ff2 = nn.Linear(d, 2 * d), nn.Linear(2 * d, d)

    def forward(self, x, mask):  # x (B,T,d), mask (B,T) True=있음
        B, T, d = x.shape
        q, k, v = self.qkv(self.ln1(x)).view(B, T, 3, self.h, d // self.h).permute(2, 0, 3, 1, 4)
        y = F.scaled_dot_product_attention(q, k, v, attn_mask=mask[:, None, None, :])  # 없는 토큰은 보지 않음
        x = x + self.proj(y.transpose(1, 2).reshape(B, T, d))
        return x + self.ff2(F.relu(self.ff1(self.ln2(x))))


class Net(nn.Module):
    def __init__(self, spec, d=128, layers=2, heads=4, trunk=256, card_dim=32, arch='attn'):
        super().__init__()
        self.arch = arch
        # 관측 배율: 특징마다 제곱평균의 제곱근으로 나눔 (학습 중 갱신, 저장·JS 추론에 같이 실림). 카드 구간은 그대로
        self.register_buffer('obs_scale', torch.ones(spec['nObs']))
        if arch == 'mlp':  # 비교용: 관측 전체를 MLP 로 (카드 구간 제외)
            self.mlp_in = nn.Linear(spec['seg']['card'][0], 2 * d + 3 * 128)
        self.spec, self.d = spec, d
        seg, K, Fe = spec['seg'], spec['K'], spec['F']
        self.cfg = dict(d=d, layers=layers, heads=heads, trunk=trunk, card_dim=card_dim)
        self.nself = seg['self'][1]
        self.tok = nn.ModuleDict({t: nn.Linear(Fe[t], d) for t in TOKENS})
        self.self_tok = nn.Linear(self.nself, d)
        self.blocks = nn.ModuleList([Block(d, heads) for _ in range(layers)])
        self.ln_f = nn.LayerNorm(d)
        self.radar = nn.Linear(seg['radar'][1], 128)
        self.map = nn.Linear(seg['map'][1], 128)
        self.selfm = nn.Linear(self.nself, 128)
        self.t1, self.t2 = nn.Linear(2 * d + 3 * 128, trunk), nn.Linear(trunk, trunk)
        self.move = nn.Linear(trunk, spec['nMove'])
        self.value = nn.Linear(trunk, 1)
        self.card_emb = nn.Embedding(spec['nCardTotal'], card_dim)
        self.c1, self.c2 = nn.Linear(trunk + card_dim + 8, 128), nn.Linear(128, 1)
        nn.init.orthogonal_(self.move.weight, 0.01); nn.init.zeros_(self.move.bias)
        nn.init.orthogonal_(self.c2.weight, 0.01); nn.init.zeros_(self.c2.bias)
        nn.init.orthogonal_(self.value.weight, 1.0); nn.init.zeros_(self.value.bias)

    def seg(self, obs, name):
        o, n = self.spec['seg'][name]
        return obs[:, o:o + n]

    def forward(self, obs):
        B = obs.shape[0]
        co = self.spec['seg']['card'][0]
        obs = torch.cat([(obs[:, :co] / self.obs_scale[:co]).clamp(-10, 10), obs[:, co:]], 1)
        K, Fe = self.spec['K'], self.spec['F']
        s = self.seg(obs, 'self')
        if self.arch == 'mlp':
            h = F.relu(self.t2(F.relu(self.t1(F.relu(self.mlp_in(obs[:, :self.spec['seg']['card'][0]]))))))
            return self._heads(h, obs, B)
        toks, masks = [self.self_tok(s)[:, None]], [torch.ones(B, 1, dtype=torch.bool, device=obs.device)]
        for t in TOKENS:
            x = self.seg(obs, t).view(B, K[t], Fe[t])
            toks.append(self.tok[t](x)); masks.append(x[:, :, 0] > 0.5)
        x, m = torch.cat(toks, 1), torch.cat(masks, 1)
        for b in self.blocks:
            x = b(x, m)
        x = self.ln_f(x)
        mo = m[:, 1:, None].float()
        pooled = (x[:, 1:] * mo).sum(1) / mo.sum(1).clamp(min=1)
        h = torch.cat([x[:, 0], pooled, F.relu(self.radar(self.seg(obs, 'radar'))), F.relu(self.map(self.seg(obs, 'map'))),
                       F.relu(self.selfm(s))], 1)
        h = F.relu(self.t2(F.relu(self.t1(h))))
        return self._heads(h, obs, B)

    def _heads(self, h, obs, B):
        # 카드 후보 3장: [있음, 번호, 특징 8]
        c = self.seg(obs, 'card').view(B, 3, -1)
        cv, ci, cf = c[:, :, 0] > 0.5, c[:, :, 1].long().clamp(0, self.spec['nCardTotal'] - 1), c[:, :, 2:]
        ch = torch.cat([h[:, None].expand(B, 3, h.shape[1]), self.card_emb(ci), cf], 2)
        card = self.c2(F.relu(self.c1(ch))).squeeze(-1).masked_fill(~cv, -1e9)
        return self.move(h), card, self.value(h).squeeze(-1)
