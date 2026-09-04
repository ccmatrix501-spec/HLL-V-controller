# 1st M.I. Hell Let Loose Server Controller — Railway v2

A streamlined browser control panel for a Hell Let Loose server. The controller uses Sledro/HLLRCON as a private REST/RCON bridge and is prepared for a two-service Railway deployment.

## Recommended production architecture

```text
Internet
   |
   | HTTPS
   v
Railway: controller (PUBLIC)
   |
   | Railway private network
   v
Railway: rcon (PRIVATE ONLY)
   |
   | HLL RCON V2 / TCP
   v
Qonzer Hell Let Loose server
```

## What it controls

- Live server/session information
- Live player list and player lookup
- Direct messages, punish, kick, force team switch
- Temporary and permanent bans
- Server broadcasts and welcome message
- Map change, rotation and sequence
- VIPs and administrators
- Ban lists and removals
- Admin logs
- Queue, VIP slots, idle kick and high-ping threshold
- Team-switch cooldown
- Auto-balance and vote-kick controls
- qPanel shortcut for host-level operations

## Host-level limitation

HLL RCON cannot start, stop, reinstall, or restart the hosted game process itself. Those functions remain in Qonzer/qPanel unless an authenticated Qonzer host-control API becomes available.

## Deploy to Railway

Read **`RAILWAY-SETUP.md`** and follow it from top to bottom.

Important points:

- Keep this GitHub repository private.
- Railway service `controller` is public.
- Railway service `rcon` is private-only.
- Use `ghcr.io/sledro/hllrcon:latest` for the `rcon` service.
- The controller automatically uses `http://rcon.railway.internal:8080` on Railway when `RCON_BACKEND` is not supplied.
- Railway injects `PORT`; this app listens on it automatically.

## Local Docker testing

1. Copy `.env.example` to `.env`.
2. Set `PANEL_PASSWORD` and `SESSION_SECRET`.
3. Run:

```bash
docker compose up -d --build
```

4. Open `http://localhost:8090`.

## Security

- The controller has its own password gate and login rate limiting.
- Session cookies are `HttpOnly`, `SameSite=Strict`, and become `Secure` automatically on Railway.
- The RCON bridge should never receive a Railway public domain.
- The HLL RCON credential is entered at runtime; this project does not intentionally write it into config files.
- Keep the controller at one Railway replica while it uses in-memory session state.

## Attribution

RCON bridge runtime: Sledro/HLLRCON, MIT-licensed open-source software.
