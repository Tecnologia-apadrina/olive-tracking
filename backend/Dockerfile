FROM node:20-alpine AS base
WORKDIR /app

# Install only production deps
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY src ./src

# Build metadata for versioning
ARG COMMIT_SHA=unknown
ARG BUILD_TIME
ENV COMMIT_SHA=${COMMIT_SHA}
ENV BUILD_TIME=${BUILD_TIME}

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Healthcheck basic (optional)
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "src/index.js"]
