FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
EXPOSE 8090
USER node
CMD ["node", "server.js"]
