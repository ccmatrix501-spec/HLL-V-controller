FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    EMBEDDED_RCON_PORT=8081

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv git ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

# Pin the known-working HLL:V RCON bridge revision inside this controller image.
# This removes the runtime dependency on a separate Railway hllv-rcon service while
# keeping the proven HLLVRcon protocol implementation and existing /api/v2 routes.
RUN python3 -m venv /opt/hllv-rcon-venv \
    && git init /opt/hllv-rcon-bridge \
    && cd /opt/hllv-rcon-bridge \
    && git remote add origin https://github.com/ccmatrix501-spec/HLLV-RCON-Bridge.git \
    && git fetch --depth 1 origin 43bfc30bff8d112f8f7c7d482b0117b28cf90409 \
    && git checkout --detach FETCH_HEAD \
    && /opt/hllv-rcon-venv/bin/pip install --no-cache-dir -r requirements.txt \
    && rm -rf /opt/hllv-rcon-bridge/.git

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY persistent-auth.js ./
COPY public-stats-preload.js ./
COPY server.js ./
COPY public ./public
COPY start-direct-rcon.sh ./start-direct-rcon.sh

RUN chmod +x /app/start-direct-rcon.sh \
    && chown -R node:node /app

EXPOSE 8090
USER node
CMD ["/app/start-direct-rcon.sh"]
