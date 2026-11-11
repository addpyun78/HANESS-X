import { z } from 'zod';
import { inventorySummary } from './build.js';
import { InventorySchema, type Inventory } from './schema.js';

/**
 * P4-A.12 GET /api/builder/inventory → { inventory, summary }
 * summary는 화면용 한 줄 ("스킬 23개, 엔진 4개 사용 가능").
 */

export const INVENTORY_ROUTE = '/api/builder/inventory';

export const InventoryResponseSchema = z
  .object({
    inventory: InventorySchema,
    summary: z.string().min(1),
  })
  .strict();
export type InventoryResponse = z.infer<typeof InventoryResponseSchema>;

/** Fastify 등 GET 라우트를 등록할 수 있는 서버 (구조적 타입) */
export interface InventoryRouteHost {
  get(path: string, handler: () => Promise<unknown>): unknown;
}

export interface InventoryProvider {
  get(): Promise<Inventory>;
}

export function inventoryResponse(inv: Inventory): InventoryResponse {
  return { inventory: inv, summary: inventorySummary(inv) };
}

export function registerInventoryRoute(app: InventoryRouteHost, provider: InventoryProvider): void {
  app.get(INVENTORY_ROUTE, async () => inventoryResponse(await provider.get()));
}
