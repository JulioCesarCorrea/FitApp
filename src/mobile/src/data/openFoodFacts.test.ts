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
        kcalPer100g: 539, proteinPer100g: 6.3, fatPer100g: 30.9, carbsPer100g: 57.5,
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
    expect(calls[0].url).toBe('https://world.openfoodfacts.org/api/v2/product/3017624010701?fields=code,product_name,brands,nutriments');
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
