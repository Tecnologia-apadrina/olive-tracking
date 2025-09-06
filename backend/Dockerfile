FROM node:20-alpine AS base
WORKDIR /app

# Install only production deps
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Healthcheck basic (optional)
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "src/index.js"]

