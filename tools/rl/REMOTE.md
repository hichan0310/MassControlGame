# 다른 컴퓨터(노트북)로 강화학습 돕기

> **노트북에서 새로 시작한 Claude Code 세션이 먼저 읽을 문서.** 저장소 전체 안내는 `CLAUDE.md`, 강화학습 구조·명령은 `tools/README.md` 의 "강화학습" 절.

## 지금 상황 (2026-11-15 기준)
- **데스크톱**(리눅스, 12코어, RTX 4060 Ti): 학습기 `tools/rl/py/train.py` 를 돌린다. 신경망 학습은 GPU, 게임 시뮬레이션은 CPU(Node)에서 돈다. **병목은 게임 시뮬레이션(CPU)** 이다.
- **노트북**(Windows + WSL2 Ubuntu, 사용자 `hichan`, 32스레드): 데스크톱의 학습을 돕는 **게임 서버** 역할. 학습기가 SSH 로 노트북의 `tools/rl/envserver.js` 를 띄우고 표준 입출력으로 관측·행동을 주고받는다(`--remote laptop:판수`). 노트북에는 PyTorch 가 필요 없다(Node 와 Python 3 만).
- **연결**: 데스크톱의 랜 포트는 하나뿐이라, 학습 중에는 데스크톱 랜선을 노트북 이더넷에 직결하고(데스크톱 인터넷은 끊김) Claude Code 는 노트북(와이파이)에서 돌린다.
  - 데스크톱 `10.10.0.1` ↔ 노트북 `10.10.0.2` (고정 IP, 서브넷 255.255.255.0, 게이트웨이 없음)
  - 노트북 WSL 의 SSH 서버는 **포트 2222**
- 학습 진행: `run1`(보상=생존 시간)은 **잡지도 줍지도 않고 도망만 다니는** 쪽으로 배웠다(5.5분 생존인데 레벨 4.5). 그래서 `--reward mix`(생존 + 점수)로 `mix1` 을 새로 학습하기로 했다.

## 노트북에서 할 일 (한 번만)
1. **WSL 미러 네트워크** — Windows 의 `%UserProfile%\.wslconfig`:
   ```ini
   [wsl2]
   networkingMode=mirrored
   ```
   관리자 PowerShell: `wsl --shutdown` 후
   `Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow`
   (Windows 11 22H2 이상 필요. 가상화가 꺼져 있으면 `wsl --install --no-distribution` + BIOS 에서 VT-x/SVM 켜기)
2. **Windows 이더넷 고정 IP** — 설정 → 네트워크 → 이더넷 → IP 할당 편집 → 수동: `10.10.0.2` / `255.255.255.0` / 게이트웨이 비움
3. **WSL Ubuntu 안에서**:
   ```bash
   sudo apt update && sudo apt install -y openssh-server python3 rsync curl git
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
   sudo sed -i 's/^#\?Port .*/Port 2222/' /etc/ssh/sshd_config && sudo systemctl enable --now ssh
   git clone -b rl-training https://github.com/hichan0310/MassControlGame.git ~/MassControlGame   # 또는 데스크톱이 rsync 로 복사
   ```
   - 저장소 위치는 **`~/MassControlGame`** (학습기 기본값). 다른 곳이면 `--remote laptop:판수:서버수:폴더`.
4. **데스크톱 공개키 등록** — 사용자가 데스크톱에서 `cat ~/.ssh/id_ed25519_laptop.pub` 한 줄을 넘겨준다:
   ```bash
   mkdir -p ~/.ssh && echo "<공개키 한 줄>" >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
   ```
5. 확인: `node --version`(v18 이상), `ss -ltn | grep 2222`(SSH 대기 중), Windows 에서 `ipconfig`(이더넷 10.10.0.2)
6. 학습 중 절전 모드로 들어가지 않게 전원 설정, 전원 연결.

## 데스크톱에서 할 일 (사용자가 직접 — 데스크톱 네트워크 설정 변경은 사용자가 실행)
```bash
# 선 바꾸기 전 (인터넷 있을 때) 한 번
nmcli con add type ethernet ifname enp6s0 con-name direct ipv4.method manual ipv4.addresses 10.10.0.1/24 ipv6.method disabled connection.autoconnect no
ssh-keygen -t ed25519 -N "" -C mass-rl -f ~/.ssh/id_ed25519_laptop
printf '\nHost laptop\n    HostName 10.10.0.2\n    Port 2222\n    User hichan\n    IdentityFile ~/.ssh/id_ed25519_laptop\n    StrictHostKeyChecking accept-new\n' >> ~/.ssh/config
sudo systemctl enable --now sshd          # (선택) 노트북에서 데스크톱으로 들어가 명령을 내리려면

# 선을 노트북에 직결한 뒤
nmcli con up direct
ssh laptop 'node --version; nproc'        # 연결 확인
rsync -a --delete --exclude .venv --exclude tools/rl/models --exclude tools/sim/build ~/MassControlGame/ laptop:~/MassControlGame/   # 게임 코드를 바꿨을 때마다
.venv/bin/python tools/rl/py/train.py --name mix1 --reward mix --resume --remote laptop:96

# 끝나고 인터넷 복구: 랜선을 원래대로 꽂고
nmcli con up "유선 연결 1"
```
- 시작 줄에 `판 192 (이 컴퓨터 96, laptop:96)` 처럼 나오면 연결된 것.
- 노트북과 데스크톱의 게임 코드가 다르면 "관측 사양 불일치" 로 멈춘다 → rsync 다시.
- 회차 시간(`[N] … 15.0s`)이 오히려 늘면 노트북 판 수를 줄인다(`laptop:64`). 회차 속도는 느린 쪽에 맞춰진다.

## 노트북 세션이 데스크톱을 조작하려면
데스크톱에서 `sudo systemctl enable --now sshd` 를 켜고, 노트북(WSL)의 공개키를 데스크톱 `~/.ssh/authorized_keys` 에 넣으면 노트북에서 `ssh hichan@10.10.0.1` 로 들어가 학습 명령을 내리고 로그(`tools/rl/models/mix1.csv`)를 볼 수 있다. 데스크톱 저장소는 `/home/hichan/MassControlGame`, 파이썬은 그 안의 `.venv/bin/python`.

## 대안: 노트북이 따로 학습
노트북에도 NVIDIA GPU 가 있으면, WSL 에서 독립 실험을 돌리는 편이 네트워크 문제 없이 효율적이다(Windows 의 NVIDIA 드라이버만 있으면 WSL 의 PyTorch 가 CUDA 를 씀):
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh     # uv 가 없으면
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r tools/rl/py/requirements.txt
.venv/bin/python tools/rl/py/train.py --name mix_laptop --reward mix --envs 128 --servers 16
```

## 학습이 잘 되는지 볼 것 (요약)
- **생존과 레벨·처치가 같이 오르는가.** 생존만 오르고 레벨이 4~5 에 머물면 도망만 배우는 것(run1 의 실패).
- 엔트로피 이동(최대 3.30)은 천천히 내려가야, 카드(최대 1.10)는 레벨이 오르면서 내려가야 함. KL 0.002~0.02.
- 걸음/초가 크게 떨어지면 적이 쌓이는 중(안 잡음).
- 관전: `index.html#bot=rl&model=mix1&speed=2` (Windows 브라우저에서 WSL 경로 `\\wsl$\Ubuntu\home\hichan\MassControlGame\index.html` 로 열어도 됨)
- 비교 기준: 숙련 돌진형 봇 `pro` 는 15분 상한에서 평균 생존 12.3분, 레벨 32.
