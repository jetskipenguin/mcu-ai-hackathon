#!/bin/bash
# EC2 user data for Ubuntu Server 24.04 LTS. Runs as root on first boot.
set -euo pipefail

# This URL must be readable by the instance without interactive authentication.
REPO_URL="https://github.com/jetskipenguin/mcu-ai-hackathon.git"
REPO_REF="main"
# Optional public HTTPS hostname, e.g. YOUR_ELASTIC_IP.sslip.io. No scheme/path.
# Leave empty for localhost/SSH access. Open TCP 80/443 for public deployment.
PUBLIC_HOST=""

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 git
systemctl enable --now docker

git clone --branch "$REPO_REF" --single-branch "$REPO_URL" /opt/countersign
cd /opt/countersign
cp .env.example .env
if [ -n "$PUBLIC_HOST" ]; then
  printf '\nCOMPOSE_FILE=compose.yaml:compose.public.yaml\nPUBLIC_HOST=%s\n' "$PUBLIC_HOST" >> .env
fi
# Optional: set LLM credentials in /opt/countersign/.env after startup.
docker compose up -d --build --wait --wait-timeout 180
