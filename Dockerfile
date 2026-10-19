# AI-Guided Virtual Science Lab service — production image.
# Build:  docker build -t ai-science-lab-service .
# Run:    docker run --env-file .env -p 8005:8005 ai-science-lab-service
# Secrets (MONGODB_URI, JWT_SECRET, GROQ_API_KEY, MINIO_*) are supplied at runtime,
# never baked into the image — see .env.example for the full list.

FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8005

WORKDIR /app

# Install production dependencies first so this layer is cached until the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Only the runtime code. .dockerignore is an allowlist, so pilot-data/, dev-docs/,
# scripts/, tests and .env files can never end up in the image.
COPY --chown=node:node src ./src

# Run as the unprivileged user that ships with the official Node image.
USER node

EXPOSE 8005

# Used by `docker run`/compose. Azure Container Apps ignores this and uses its own
# probes — point those at GET /health on the same port.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/app.js"]
