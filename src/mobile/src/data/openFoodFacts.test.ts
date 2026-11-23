import { describe, expect, it } from 'vitest';
import { OFF_USER_AGENT, OpenFoodFactsClient, parseProduct } from './openFoodFacts';

// SPEC-nutrition-001, AC-17: la respuesta de Open Food Facts es un dato sin verificar y todo es opcional.

const NUTELLA = {
  status: 1,
  product: {
    product_name: 'Nutella', brands: 'Ferrero, Otra',
    nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 },
  },
};

const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('lectura de la respuesta (AC-nutrition-001-17)', () => {
  it('un producto completo se devuelve con nombre, marca (la primera) y valores por 100 g', () => {
    expect(parseProduct('3017624010701', NUTELLA)).toEqual({
      kind: 'found',
      product: {
        barcode: '3017624010701', name: 'Nutella', brand: 'Ferrero',
        kcalPer100g: 539, proteinPer100g: 6.3, fatPer100g: 30.9, carbsPer100g: 57.5, allergens: null,
        fiberPer100g: null, sugarsPer100g: null, sodiumMgPer100g: null,
      },
    });
  });

  it('si falta algún valor es incompleto y conserva lo que sí hay', () => {
    const { kind, product } = parseProduct('123456789', {
      status: 1, product: { product_name: 'Galletas', nutriments: { 'energy-kcal_100g': 480 } },
    }) as { kind: string; product: { name: string | null; kcalPer100g: number | null; proteinPer100g: number | null } };

    expect(kind).toBe('incomplete');
    expect(product).toMatchObject({ name: 'Galletas', kcalPer100g: 480, proteinPer100g: null });
  });

  it('sin nombre también es incompleto', () => {
    const result = parseProduct('123456789', {
      status: 1, product: { nutriments: { 'energy-kcal_100g': 1, proteins_100g: 1, fat_100g: 1, carbohydrates_100g: 1 } },
    });

    expect(result.kind).toBe('incomplete');
  });

  it.each([[{ status: 0 }], [{ status: 1 }], [{}]])('un producto desconocido (%j) no se encuentra', (body) => {
    expect(parseProduct('0000000000000', body)).toEqual({ kind: 'notFound' });
  });

  it('los valores negativos o que no son números se descartan y los demás se redondean a un decimal', () => {
    const { product } = parseProduct('123456789', {
      status: 1,
      product: { product_name: 'X', nutriments: { 'energy-kcal_100g': '300', proteins_100g: -2, fat_100g: 3.456, carbohydrates_100g: 10 } },
    }) as { product: { kcalPer100g: number | null; proteinPer100g: number | null; fatPer100g: number | null } };

    expect(product).toMatchObject({ kcalPer100g: null, proteinPer100g: null, fatPer100g: 3.5 });
  });
});

describe('consulta (AC-nutrition-001-17)', () => {
  it('pide solo el código de barras, con un User-Agent propio y sin ningún dato de la persona', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = new OpenFoodFactsClient(async (url, init) => {
      calls.push({ url: String(url), init });
      return response(NUTELLA);
    });

    const result = await client.lookup('3017624010701');

    expect(result.kind).toBe('found');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://world.openfoodfacts.org/api/v2/product/3017624010701?fields=code,product_name,brands,nutriments,allergens_tags');
    expect((calls[0].init?.headers as Record<string, string>)['User-Agent']).toBe(OFF_USER_AGENT);
    expect(JSON.stringify(calls[0].init)).not.toMatch(/authorization|cookie/i);
  });

  it('sin conexión o con un error del servicio devuelve «offline» y un 404, «no encontrado»', async () => {
    const down = new OpenFoodFactsClient(async () => { throw new TypeError('Network request failed'); });
    const error = new OpenFoodFactsClient(async () => response({}, 503));
    const missing = new OpenFoodFactsClient(async () => response({}, 404));

    expect(await down.lookup('123456789')).toEqual({ kind: 'offline' });
    expect(await error.lookup('123456789')).toEqual({ kind: 'offline' });
    expect(await missing.lookup('123456789')).toEqual({ kind: 'notFound' });
  });
});

describe('alérgenos de Open Food Facts (SPEC-nutrition-003)', () => {
  const body = (extra: object) => ({
    status: 1, product: { product_name: 'Galletas', brands: 'Marca', nutriments: { 'energy-kcal_100g': 480, proteins_100g: 6, fat_100g: 20, carbohydrates_100g: 65 }, ...extra },
  });

  it('AC-nutrition-003-03 traduce allergens_tags a las etiquetas propias', () => {
    const { product } = parseProduct('123456789', body({ allergens_tags: ['en:gluten', 'en:milk', 'en:desconocido'] })) as { product: { allergens: string[] | null } };

    expect(product.allergens).toEqual(['gluten', 'leche']);
  });

  it('AC-nutrition-003-03 sin el campo el dato es null («sin dato»), no una lista vacía', () => {
    const { product } = parseProduct('123456789', body({})) as { product: { allergens: string[] | null } };

    expect(product.allergens).toBeNull();
  });

  it('AC-nutrition-003-03 con una lista vacía el producto declara no tener alérgenos conocidos (lista vacía)', () => {
    const { product } = parseProduct('123456789', body({ allergens_tags: [] })) as { product: { allergens: string[] | null } };

    expect(product.allergens).toEqual([]);
  });
});

describe('micronutrientes de Open Food Facts (SPEC-nutrition-004)', () => {
  const withNutriments = (extra: Record<string, number>) => ({
    status: 1,
    product: {
      product_name: 'Galletas', brands: 'Marca',
      nutriments: { 'energy-kcal_100g': 480, proteins_100g: 6, fat_100g: 20, carbohydrates_100g: 65, ...extra },
    },
  });

  it('AC-nutrition-004-11 lee fibra y azúcares en g y convierte el sodio de g a mg', () => {
    const { product } = parseProduct('123456789', withNutriments({ fiber_100g: 3.45, sugars_100g: 20, sodium_100g: 0.4 })) as {
      product: { fiberPer100g: number | null; sugarsPer100g: number | null; sodiumMgPer100g: number | null };
    };

    expect(product).toMatchObject({ fiberPer100g: 3.5, sugarsPer100g: 20, sodiumMgPer100g: 400 });
  });

  it('AC-nutrition-004-11 si solo hay sal, el sodio es sal / 2,5', () => {
    const { product } = parseProduct('123456789', withNutriments({ salt_100g: 1 })) as { product: { sodiumMgPer100g: number | null } };

    expect(product.sodiumMgPer100g).toBe(400);
  });

  it('AC-nutrition-004-11 sin esos datos quedan vacíos y el producto sigue siendo completo', () => {
    const result = parseProduct('123456789', withNutriments({}));

    expect(result.kind).toBe('found');
    expect(result.kind === 'found' && result.product).toMatchObject({ fiberPer100g: null, sugarsPer100g: null, sodiumMgPer100g: null });
  });
});
