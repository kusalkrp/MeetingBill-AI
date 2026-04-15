import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';

/**
 * Executes a database operation within an RLS-enforced tenant context.
 * 
 * Uses `SET LOCAL` within a transaction to set `app.current_workspace_id`.
 * Because PgBouncer is running in transaction pool mode, `SET LOCAL` is completely
 * safe and will automatically drop off once the transaction commits or rolls back,
 * ensuring no connection bleed between tenants.
 */
export async function withTenantContext<T>(
  workspaceId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return await prisma.$transaction(async (tx) => {
    // Set RLS context for this transaction (true = IS_LOCAL)
    await tx.$executeRaw`SELECT set_config('app.current_workspace_id', ${workspaceId}, true)`;
    return await fn(tx);
  });
}
