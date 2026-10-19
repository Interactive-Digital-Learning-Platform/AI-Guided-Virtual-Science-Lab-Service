FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production PORT=8005

# Dependencies first so this layer is only rebuilt when the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Runtime code only: no .env, pilot (participant) data, dev docs, tests or scripts.
COPY src ./src

USER node
EXPOSE 8005
CMD ["node", "src/app.js"]
