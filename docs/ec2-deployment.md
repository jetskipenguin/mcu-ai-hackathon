# Docker + EC2

Runs both demo instances with persistent passkeys, provenance and policies.
**Browse through an SSH tunnel:** WebAuthn is configured for
`http://localhost:3000`; opening the EC2 IP directly will not support Touch ID.

## Local Docker

With Docker Compose installed, from the repository root:

```sh
cp .env.example .env  # skip if you already have .env
docker compose up -d --build --wait
```

Open http://localhost:3000 (governed) or http://localhost:3001 (ungoverned).

## Manual EC2 deployment

1. Launch **Ubuntu Server 24.04 LTS**, **t3.small**, **20 GiB gp3** storage,
   with a public IP and an SSH key pair. Allow inbound **TCP 22** from your laptop.
2. Connect: `ssh -i demo.pem ubuntu@EC2_PUBLIC_IP`.
3. On EC2:
z
```sh
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
git clone https://github.com/jetskipenguin/mcu-ai-hackathon.git
cd mcu-ai-hackathon
cp .env.example .env
# Optional: edit .env to set SESSION_SECRET and your LLM API key/model.
sudo docker compose up -d --build --wait
```

For a private repository, authenticate Git with your GitHub username and a token
when prompted, or upload your checkout with SCP instead (omit `node_modules`
and `dist`). The checkout must include these Docker/deployment files.

4. On your **laptop**, keep this tunnel running (local ports 3000/3001 must be free):

```sh
ssh -i demo.pem -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 3000:127.0.0.1:3000 -L 3001:127.0.0.1:3001 ubuntu@EC2_PUBLIC_IP
```

5. Open http://localhost:3000 and http://localhost:3001. Sign in and register a
   passkey in your demo browser against this deployment. Dashboard:
   http://localhost:3000/countersign/.

## Automatic deployment on first boot

Use the same EC2 settings, then paste [`deploy/ec2-user-data.sh`](../deploy/ec2-user-data.sh)
into **Advanced details → User data** before launching. It installs Docker,
clones `main` into `/opt/countersign`, and builds/starts both containers. Allow a
few minutes; then open the SSH tunnel above. Docker restarts the containers after
instance reboots.

The repository/ref must contain these files and be readable without interactive
Git authentication; for a private checkout, use the manual method. Edit
`REPO_URL`/`REPO_REF` in the script if using a fork or another branch.
Check bootstrap progress with `sudo less /var/log/cloud-init-output.log`.

## Operations

Run in the checkout (`/opt/countersign` for automatic deployments):

```sh
sudo docker compose ps                         # both should be healthy
sudo docker compose logs -f --tail=100
sudo nano .env                                 # optional LLM configuration
sudo docker compose up -d                      # apply environment changes
sudo docker compose exec governed node dist/countersign/generate/index.js
git pull --ff-only                             # prefix sudo for /opt/countersign
sudo docker compose up -d --build --wait        # deploy updates
sudo docker compose down                       # stop; keep persisted data
```

The generator automatically connects to the ungoverned container. LLM credentials
are only needed for generation; the portal works without them. `.env` is read at
runtime, never baked into the image.

Named volumes retain passkeys, audit logs, Registry vocabulary and policies across
rebuilds; existing volumes keep their current contents rather than taking new
image defaults. Discussion posts and pending WebAuthn challenges are in memory
and reset on restart. `docker compose down -v` **deletes all persisted demo state**.
Volumes live on the instance disk; terminating the instance with its disk deletes them.
