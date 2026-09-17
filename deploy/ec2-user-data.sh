#!/bin/bash
# EC2 user data for Ubuntu Server 24.04 LTS. Runs as root on first boot.
set -euo pipefail

# This URL must be readable by the instance without interactive authentication.
REPO_URL="https://github.com/jetskipenguin/mcu-ai-hackathon.git"
REPO_REF="main"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 git
systemctl enable --now docker

git clone --branch "$REPO_REF" --single-branch "$REPO_URL" /opt/countersign
cd /opt/countersign
cp .env.example .env
# Optional: set LLM credentials in /opt/countersign/.env after startup.
docker compose up -d --build --wait --wait-timeout 180
