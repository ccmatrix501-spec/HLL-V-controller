FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY persistent-auth.js ./
COPY host-controls-preload.js ./
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
EXPOSE 8090
USER node
CMD ["node", "--require", "./persistent-auth.js", "--require", "./host-controls-preload.js", "server.js"]
