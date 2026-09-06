# Qonzer qPanel Host Controls

The controller now has **Restart Server** and **Stop Server** buttons. These are host-level actions and do not use HLL:V RCON.

Qonzer documents restart/stop control in qPanel, but does not publish a public host-control API in its knowledgebase. The controller therefore includes a secure request adapter that can reproduce the exact authenticated qPanel action request once its URL/auth details are configured in Railway.

## Railway variables

Required once the qPanel action requests are known:

```env
QPANEL_RESTART_URL=https://qp.qonzer.com/...
QPANEL_STOP_URL=https://qp.qonzer.com/...
```

Optional request settings:

```env
QPANEL_RESTART_METHOD=POST
QPANEL_STOP_METHOD=POST
QPANEL_RESTART_BODY_JSON={}
QPANEL_STOP_BODY_JSON={}
QPANEL_CONTROL_HEADERS_JSON={}
QPANEL_CONTROL_COOKIE=
QPANEL_CONTROL_BEARER_TOKEN=
QPANEL_ALLOWED_HOSTS=qp.qonzer.com
```

All of these belong in **Railway Variables**, never in GitHub.

## Capture the qPanel request

1. Sign in to qPanel and open the HLL:V service.
2. Press `F12` in Chrome/Edge.
3. Open **Network**.
4. Enable **Preserve log**.
5. Select **Fetch/XHR**.
6. Perform one normal Restart from qPanel.
7. Click the request that appears when Restart is confirmed.
8. Record:
   - Request URL
   - Request Method
   - Content-Type
   - any anti-CSRF header name/value
   - Request Payload / Form Data
9. Repeat for Stop when convenient.

Do not commit qPanel cookies/tokens to GitHub. Store them only as Railway secrets.

## Safety

The controller requires typing `RESTART` or `STOP` before it will send the corresponding host command. The backend also validates the confirmation and only permits HTTPS targets on the configured qPanel host allow-list.
