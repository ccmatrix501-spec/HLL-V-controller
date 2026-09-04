# Railway Deployment — 1st M.I. HLL Server Controller v2

This deployment uses **two Railway services in one project**:

1. `controller` — public website, built from this GitHub repository.
2. `rcon` — private-only HLLRCON bridge, deployed from `ghcr.io/sledro/hllrcon:latest`.

The controller communicates with the RCON bridge over Railway's private network at:

`http://rcon.railway.internal:8080`

## Before you start

- Put this project in a **private GitHub repository**.
- Do not commit a real `.env` file.
- Keep your RCON password out of GitHub; the controller asks for it at runtime.

## Step 1 — Create a Railway project

1. Sign in to Railway.
2. Create a **New Project**.
3. Choose **Deploy from GitHub repo**.
4. Select the private repository containing this controller.
5. Rename that Railway service to exactly: `controller`.

Railway should detect the root `Dockerfile` automatically.

## Step 2 — Add controller variables

Open `controller` -> **Variables** -> **Raw Editor** and add:

```env
PANEL_PASSWORD=YOUR_PRIVATE_CONTROLLER_PASSWORD
SESSION_SECRET=YOUR_LONG_RANDOM_SECRET
QPANEL_URL=https://qp.qonzer.com/
```

Optional explicit values:

```env
TRUST_PROXY=true
COOKIE_SECURE=true
RCON_BACKEND=http://rcon.railway.internal:8080
```

The app automatically enables secure proxy/cookie handling when it detects Railway, and it automatically uses the `rcon.railway.internal` backend if `RCON_BACKEND` is omitted.

## Step 3 — Configure controller healthcheck

In `controller` -> **Settings** -> **Deploy**:

- Healthcheck Path: `/controller/health`
- Restart Policy: `On Failure` (or `Always` on a paid plan)
- Serverless: **Off** for the most reliable instant admin access

Do not manually set a fixed `PORT`; Railway injects one and the controller listens on it automatically.

## Step 4 — Give the controller a public URL

In `controller` -> **Settings** -> **Networking**:

1. Click **Generate Domain**.
2. Open the generated `*.up.railway.app` URL.

Only the controller should have a public domain.

## Step 5 — Add the private RCON service

From the same Railway project canvas:

1. Add a new **Empty Service** / **Docker Image** service.
2. Set its source image to:

   `ghcr.io/sledro/hllrcon:latest`

3. Rename the service to exactly:

   `rcon`

4. Add these variables:

```env
HLL_SERVER_HOST=0.0.0.0
HLL_SERVER_PORT=8080
HLL_LOG_LEVEL=info
HLL_LOG_FORMAT=text
```

5. **Do not generate a public domain for `rcon`.**
6. Leave **Serverless off** for this service as well so the RCON session is not cold-started or discarded during normal administration.

The `controller` service can still reach it privately at `rcon.railway.internal:8080`.

## Step 6 — Deploy both services

Deploy/redeploy both services after the variables are saved.

Expected controller log lines:

```text
1st M.I. HLL Server Controller listening on port <Railway PORT>
Deployment: Railway
RCON backend: http://rcon.railway.internal:8080
```

Expected RCON service behavior: it should listen on port `8080`.

## Step 7 — Connect to your HLL server

1. Open the controller's Railway public URL.
2. Log in with `PANEL_PASSWORD`.
3. Click **Connect RCON**.
4. Enter the RCON host/IP, port, and password supplied by Qonzer.

Your HLL RCON password is submitted to HLLRCON for the active in-memory session; it is not stored in this project's files.

## Step 8 — Optional custom domain

Once the Railway URL works, add a custom domain such as:

`hll.1stmid.com`

Do this from `controller` -> **Settings** -> **Networking** -> **Custom Domain**, then add the DNS record Railway shows you.

## Security checklist

- GitHub repository: **Private**.
- `controller`: public domain allowed.
- `rcon`: **no public domain**.
- Never commit `.env`.
- Use a strong `PANEL_PASSWORD`.
- Keep `SESSION_SECRET` only in Railway Variables.
- Keep the controller at one replica unless/until server-side session storage is added.
- Restrict Railway project access to trusted administrators.

## Updating later

When the `controller` service is connected to GitHub, pushing a new commit to the selected branch triggers a new Railway deployment automatically.

The `rcon` service uses the published HLLRCON container image and can be redeployed independently.

## Troubleshooting

### Controller deploys but shows RCON backend unavailable

Check:

- the second Railway service is named exactly `rcon`;
- `rcon` is running;
- `HLL_SERVER_PORT=8080` is set on the `rcon` service;
- `RCON_BACKEND=http://rcon.railway.internal:8080` is set on the controller if you renamed the service.

### Login works locally but not on Railway

Make sure Railway is serving the controller through HTTPS. v2 automatically enables proxy trust and secure cookies on Railway. If you explicitly set variables, use:

```env
TRUST_PROXY=true
COOKIE_SECURE=true
```

### Railway healthcheck fails

Set the controller healthcheck path to:

`/controller/health`

Do not force `PORT=8090` on the controller service; allow Railway to inject its own `PORT` value.
