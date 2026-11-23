import { allergensFromOff } from './allergens';
import type { ProductLookup, ProductLookupResult, ScannedProduct } from './types';

export const OFF_BASE_URL = 'https://world.openfoodfacts.org';
// Open Food Facts pide identificar la app con un User-Agent propio.
export const OFF_USER_AGENT = 'FitnessApp-personal/1.0 (uso privado)';
const TIMEOUT_MS = 8000;

interface OffResponse {
  status?: number;
  product?: {
    product_name?: string;
    brands?: string;
    nutriments?: Record<string, unknown>;
    allergens_tags?: unknown;
  };
}

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 10) / 10 : null;

/** Traduce la respuesta de Open Food Facts (SPEC-nutrition-001, AC-17). Todo es opcional: la base es comunitaria. */
export function parseProduct(barcode: string, body: OffResponse): ProductLookupResult {
  if (body.status !== 1 || !body.product) return { kind: 'notFound' };

  const n = body.product.nutriments ?? {};
  const product: ScannedProduct = {
    barcode,
    name: body.product.product_name?.trim() || null,
    brand: body.product.brands?.split(',')[0]?.trim() || null,
    kcalPer100g: num(n['energy-kcal_100g']),
    proteinPer100g: num(n['proteins_100g']),
    fatPer100g: num(n['fat_100g']),
    carbsPer100g: num(n['carbohydrates_100g']),
    // Sin el dato (campo ausente) queda null: la app lo muestra como «sin dato», nunca como «libre de alérgenos».
    allergens: Array.isArray(body.product.allergens_tags)
      ? allergensFromOff(body.product.allergens_tags.filter((t): t is string => typeof t === 'string'))
      : null,
  };
  const complete = product.name !== null && [product.kcalPer100g, product.proteinPer100g, product.fatPer100g, product.carbsPer100g]
    .every((v) => v !== null);
  return { kind: complete ? 'found' : 'incomplete', product };
}

/**
 * Consulta de un producto por su código de barras. Solo viaja el código: ningún dato de la persona (P5).
 * Sin conexión, con un error del servicio o con tiempo agotado devuelve `offline`.
 */
export class OpenFoodFactsClient implements ProductLookup {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly baseUrl: string = OFF_BASE_URL,
  ) {}

  async lookup(barcode: string): Promise<ProductLookupResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const url = `${this.baseUrl}/api/v2/product/${encodeURIComponent(barcode)}?fields=code,product_name,brands,nutriments,allergens_tags`;
      const res = await this.fetchFn(url, {
        headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) return res.status === 404 ? { kind: 'notFound' } : { kind: 'offline' };
      return parseProduct(barcode, (await res.json()) as OffResponse);
    } catch {
      return { kind: 'offline' };
    } finally {
      clearTimeout(timer);
    }
  }
}
