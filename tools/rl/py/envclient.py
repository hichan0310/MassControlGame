"""Node 환경 서버(tools/rl/envserver.js)를 여러 개 띄워 하나의 벡터 환경처럼 쓰는 클라이언트.
서버마다 통신·스레드 깨우는 지연이 있으므로, 여러 서버에 행동을 먼저 다 보내고 나서 결과를 모아 지연을 겹친다."""
import json, os, subprocess, numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))


class _Server:
    def __init__(self, envs, frameskip, max_min, seed, reward, host=None, rdir=None):
        a = ['--envs', str(envs), '--frameskip', str(frameskip), '--max-min', str(max_min), '--seed', str(seed), '--reward', reward]
        if host:  # 다른 컴퓨터: SSH 로 그쪽 게임 서버를 띄우고 표준 입출력으로 통신
            cmd = ['ssh', '-T', '-o', 'ServerAliveInterval=30', host, f'cd {rdir} && node tools/rl/envserver.js ' + ' '.join(a)]
        else:
            cmd = ['node', os.path.join(ROOT, 'tools', 'rl', 'envserver.js')] + a
        self.host = host or '이 컴퓨터'
        self.p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, cwd=ROOT, bufsize=0)
        head = json.loads(self.p.stdout.readline())
        self.spec, self.extra, self.n = head['spec'], head['extra'], envs
        self.stride = self.spec['nObs'] + self.extra
        self.nbytes = 4 * envs * self.stride
        self.buf = bytearray(self.nbytes)

    def send(self, actions):
        msg = np.empty(self.n + 1, dtype=np.int32); msg[0] = 1; msg[1:] = actions
        self.p.stdin.write(msg.tobytes())

    def recv(self, out):
        mv, o = memoryview(self.buf), 0
        while o < self.nbytes:
            r = self.p.stdout.readinto(mv[o:])
            if not r:
                raise RuntimeError('환경 서버가 종료됨 (node 오류를 확인하세요)')
            o += r
        out[:] = np.frombuffer(self.buf, dtype=np.float32).reshape(self.n, self.stride)

    def close(self):
        try:
            msg = np.zeros(self.n + 1, dtype=np.int32); msg[0] = 2
            self.p.stdin.write(msg.tobytes())
            self.p.wait(timeout=5)
        except Exception:
            self.p.kill()


def parse_remote(s):
    """'호스트:판수[:서버수[:폴더]]' → (호스트, 판수, 서버수, 폴더). 예: laptop:48:6:~/MassControlGame"""
    p = s.split(':')
    return p[0], int(p[1]), int(p[2]) if len(p) > 2 and p[2] else max(1, int(p[1]) // 8), p[3] if len(p) > 3 else '~/MassControlGame'


class VecEnv:
    def __init__(self, envs=64, servers=4, frameskip=4, max_min=15, seed=1, reward='survive', remote=()):
        subprocess.run(['python3', os.path.join(ROOT, 'tools', 'sim', 'extract.py')], check=True, stdout=subprocess.DEVNULL)
        plan = [(None, None, envs // servers + (1 if i < envs % servers else 0)) for i in range(servers)]
        for r in remote:
            host, n, ns, rdir = parse_remote(r)
            subprocess.run(['ssh', host, f'cd {rdir} && python3 tools/sim/extract.py'], check=True, stdout=subprocess.DEVNULL)
            plan += [(host, rdir, n // ns + (1 if i < n % ns else 0)) for i in range(ns)]
        self.servers = [_Server(n, frameskip, max_min, seed * 1000 + i, reward, h, d) for i, (h, d, n) in enumerate(plan)]
        for s in self.servers[1:]:
            if s.spec != self.servers[0].spec:
                raise RuntimeError(f'{s.host} 의 게임 코드가 이 컴퓨터와 다름 (관측 사양 불일치) — 같은 버전으로 맞추세요 (git pull 등)')
        envs = sum(s.n for s in self.servers)
        per = [s.n for s in self.servers]
        self.spec, self.extra, self.n = self.servers[0].spec, self.servers[0].extra, envs
        self.nobs = self.spec['nObs']
        self.a = np.zeros((envs, self.nobs + self.extra), dtype=np.float32)
        self.sl = np.cumsum([0] + per)
        for i, s in enumerate(self.servers):
            s.recv(self.a[self.sl[i]:self.sl[i + 1]])

    def split(self):
        a, x = self.a, self.a[:, self.nobs:]
        return dict(obs=a[:, :self.nobs], rew=x[:, 0].copy(), done=x[:, 1].copy(), trunc=x[:, 2].copy(), mode=x[:, 3].astype(np.int64),
                    nopt=x[:, 4].astype(np.int64), ep=x[:, 5:12].copy())

    def reset(self):
        return self.split()

    def step(self, actions):
        actions = np.asarray(actions, dtype=np.int32)
        for i, s in enumerate(self.servers):
            s.send(actions[self.sl[i]:self.sl[i + 1]])
        for i, s in enumerate(self.servers):
            s.recv(self.a[self.sl[i]:self.sl[i + 1]])
        return self.split()

    def close(self):
        for s in self.servers:
            s.close()
