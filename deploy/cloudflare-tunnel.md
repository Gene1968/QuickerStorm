# Cloudflare Tunnel Setup

## One-time setup (Cloudflare dashboard)

1. Log into [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)
2. Navigate to **Networks → Tunnels → Create a tunnel**
3. Name it `quickerstorm`
4. Copy the **tunnel token** — paste into `deploy/.env` as `CF_TUNNEL_TOKEN`
5. Add a public hostname:
   - Subdomain: `app` (or `quickerstorm`)
   - Domain: your domain (e.g. `yourdomain.com`)
   - Service type: `HTTP`
   - URL: `app:8787`  ← Docker container name + port, same network

## WebSocket note

Cloudflare proxies WebSocket upgrades automatically on proxied hostnames.
Ensure the hostname is **proxied** (orange cloud) in Cloudflare DNS settings.

## Starting the tunnel

```sh
# On Synology via Portainer: import docker-compose.yml as a Stack
# Set CF_TUNNEL_TOKEN in the Stack's Environment tab

# OR locally for testing:
cd deploy
cp .env.example .env   # fill in CF_TUNNEL_TOKEN
docker compose up -d
```

## Browser client config

Set `VITE_SIGNAL_URL=wss://app.yourdomain.com` in `.env.production`.

The Vue client connects to this WSS URL; Cloudflare terminates TLS and
forwards to the Bun container over plain HTTP/WS on port 8787.
