# Synology DS923+ Deployment

## Prerequisites

- Docker and Portainer installed via Synology Package Center
- Cloudflare Tunnel token obtained (see `cloudflare-tunnel.md`)

## Deploy via Portainer

1. In Portainer, go to **Stacks → Add stack**
2. Name: `quickerstorm`
3. Build method: **Git repository**
   - URL: your repo URL
   - Compose path: `deploy/docker-compose.yml`
4. Under **Environment variables**, add:
   - `CF_TUNNEL_TOKEN` = your tunnel token
5. Click **Deploy the stack**

## Build on Synology (alternative)

Build the image locally, push to Synology's private registry (`SYNO_IP:5000`),
then reference it in `docker-compose.yml` instead of the `build:` stanza.

## Logs

```sh
# Via Portainer UI: click container → Logs
# Via SSH into Synology:
docker logs quickerstorm-app -f
docker logs quickerstorm-tunnel -f
```

## Updating

```sh
# Via Portainer: pull + redeploy the stack
# Via SSH:
docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d --build
```

## Env file

Copy `deploy/.env.example` → `deploy/.env` and fill in `CF_TUNNEL_TOKEN`.
**Never commit `deploy/.env` to git.**
