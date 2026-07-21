FROM node:22-slim

WORKDIR /app

# Install OpenSSL (required by Prisma Client at runtime)
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install production dependencies from lockfile
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy source, schema, scripts, and entrypoint
COPY tsconfig.json .
COPY src/ src/
COPY prisma/ prisma/
COPY docker-entrypoint.sh /

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npx --no-install tsc

RUN chmod +x /docker-entrypoint.sh

EXPOSE 3460

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "dist/src/app.js"]
