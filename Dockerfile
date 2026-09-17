FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY persistent-auth.js ./
COPY public-stats-preload.js ./
COPY server.js ./
COPY public ./public

RUN chown -R node:node /app

EXPOSE 8080
USER node
CMD ["npm", "start"]
