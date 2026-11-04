# 运行时镜像：假定 frontend/dist 已经在本地构建好（npm run build）。
#
# 为什么不在镜像里装 Node 构建：服务器只剩 9 GB 磁盘、1 GB 可用内存，
# 拉 node:20 基础镜像 + npm install 要几百 MB 且慢；本地构建只多一条命令，
# 换来镜像小一半、部署快十倍。
#
# 部署流程：
#   cd web/frontend && npm ci && npm run build
#   cd .. && docker compose up -d --build
FROM python:3.11-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 国内源，避免构建时卡在 pypi
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

COPY backend/ ./
# dist 里已经包含 public/assets（vite 会把 public 原样拷进去），不用再单独 COPY 一遍
COPY frontend/dist ./frontend/dist

EXPOSE 8765
# 单 worker：服务器可用内存只有 1 GB，多开会互相抢
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8765", "--workers", "1", "--log-level", "info"]
