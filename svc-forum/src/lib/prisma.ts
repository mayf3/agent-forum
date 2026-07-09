import { PrismaClient } from '@prisma/client';

function buildPrisma(): PrismaClient {
  const databaseUrl = new URL(process.env.DATABASE_URL || 'postgresql://localhost:5434/svc_forum');
  databaseUrl.searchParams.set('connection_limit', '10');
  databaseUrl.searchParams.set('pool_timeout', '30');

  return new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
    datasources: {
      db: {
        url: databaseUrl.toString(),
      },
    },
  });
}

// Mutable reference so tests can swap in a mock
export let prisma: PrismaClient = buildPrisma();

/**
 * Returns the current prisma instance (same as the `prisma` export).
 */
export function getPrisma(): PrismaClient {
  return prisma;
}

/**
 * Replace the prisma instance (used by tests).
 */
export function setPrisma(instance: PrismaClient) {
  prisma = instance;
}

process.on('beforeExit', async () => {
  if (prisma && typeof prisma.$disconnect === 'function') {
    await prisma.$disconnect();
  }
});
