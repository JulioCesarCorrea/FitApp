import { configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { createDeps } from '../src/data/deps';
import { portionOf } from '../src/data/nutritionRules';
import { localDate } from '../src/data/nutritionService';
import type { ServerFood, ServerFoodEntry } from '../src/data/types';
import { createFakes } from './support';

// La app real abre SQLite, la cámara y la API por HTTP; en estas pruebas se sustituyen por versiones en memoria.
jest.mock('../src/data/deps', () => ({ createDeps: jest.fn() }));
jest.mock('../src/database', () => ({ getDb: jest.fn() }));
jest.mock('../src/Scanner', () => ({ Scanner: () => null }));
jest.mock('../src/components/WeightPanel', () => ({ WeightPanel: () => null }));
// El lector de códigos usa la cámara: aquí es un botón que «lee» siempre el mismo código.
jest.mock('../src/components/BarcodeScanner', () => {
  const { Pressable } = require('react-native');
  return {
    BarcodeScanner: ({ onScanned }: { onScanned: (code: string) => void }) => (
      <Pressable testID="fake-scan" onPress={() => onScanned('3017624010701')} />
    ),
  };
});

// Montar la app completa tarda más de 1 s en equipos lentos; este margen evita falsos fallos.
configure({ asyncUtilTimeout: 5000 });
// Estas pruebas recorren varias pantallas; el margen por defecto de 5 s se queda corto en el primer arranque en frío.
jest.setTimeout(20000);

const TODAY = localDate();
const OATS: ServerFood = {
  id: 'f-oats', name: 'Avena', brand: null, barcode: null, kcalPer100g: 389, proteinPer100g: 16.9, fatPer100g: 6.9, carbsPer100g: 66.3, source: 'manual',
};

const entry = (id: string, meal: string, grams: number, food = OATS): ServerFoodEntry => ({
  id, date: TODAY, meal, foodId: food.id, grams, name: food.name,
  ...portionOf(food.kcalPer100g, food.proteinPer100g, food.fatPer100g, food.carbsPer100g, grams),
});

let fakes: ReturnType<typeof createFakes>;

async function openNutrition() {
  (createDeps as jest.Mock).mockResolvedValue(fakes.deps);
  await renderRouter('./src/app', { initialUrl: '/nutricion' });
}

const press = async (element: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(element);
const type = async (label: string, value: string) => fireEvent.changeText(await screen.findByLabelText(label), value);
const has = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

async function fillFood(over: Partial<Record<'Nombre del alimento' | 'Calorías por 100 g' | 'Proteína por 100 g' | 'Grasa por 100 g' | 'Carbohidratos por 100 g', string>> = {}) {
  const v = {
    'Nombre del alimento': 'Avena', 'Calorías por 100 g': '389', 'Proteína por 100 g': '16,9', 'Grasa por 100 g': '6,9',
    'Carbohidratos por 100 g': '66,3', ...over,
  };
  for (const [label, value] of Object.entries(v)) await type(label, value);
}

beforeEach(() => {
  fakes = createFakes();
});

describe('Pestaña Nutrición (SPEC-nutrition-001)', () => {
  it('AC-nutrition-001-15: muestra el día de hoy con lo consumido frente al objetivo y las entradas por comida', async () => {
    fakes.remote.serverFoods = [OATS];
    fakes.remote.serverEntries = [entry('e1', 'desayuno', 50), entry('e2', 'cena', 120), entry('e3', 'Merienda libre', 60)];
    await openNutrition();

    expect(await screen.findByTestId('nutrition-target')).toHaveTextContent(has('Objetivo: 2500 kcal'));
    const kcal = [50, 120, 60].reduce((a, g) => a + portionOf(389, 16.9, 6.9, 66.3, g).kcal, 0);
    expect(await screen.findByTestId('nutrition-totals')).toHaveTextContent(has(`Consumido: ${kcal} kcal`));
    expect(screen.getByTestId('nutrition-remaining')).toHaveTextContent(`Te faltan ${2500 - kcal} kcal`);
    expect(screen.getByTestId('meal-desayuno')).toHaveTextContent(has('Avena · 50 g'));
    expect(screen.getByTestId('meal-Merienda libre')).toBeOnTheScreen();
    expect(screen.getByText(has('no sustituyen a un profesional de la salud'))).toBeOnTheScreen();
  });

  it('AC-nutrition-001-15: si falta el perfil o el peso lo indica en lugar del objetivo', async () => {
    fakes.remote.targets = { kind: 'missing', what: 'perfil' };
    await openNutrition();

    expect(await screen.findByTestId('nutrition-missing')).toHaveTextContent(has('falta completar tu perfil'));
    expect(screen.queryByTestId('nutrition-target')).not.toBeOnTheScreen();
  });

  it('AC-nutrition-001-16: crea un alimento a mano, lo registra con unos gramos y aparece en el día, sincronizado', async () => {
    await openNutrition();
    await press(await screen.findByTestId('add-food'));
    await press(await screen.findByTestId('create-food'));
    await fillFood();

    await press(screen.getByTestId('save-food'));
    expect(await screen.findByTestId('selected-food')).toHaveTextContent(has('Avena'));
    await type('Cantidad en gramos', '50');
    await press(screen.getByTestId('save-entry'));

    expect(await screen.findByTestId('meal-desayuno')).toHaveTextContent(has('Avena · 50 g'));
    const [saved] = await fakes.store.getFoodEntries(TODAY);
    expect(saved).toMatchObject({ meal: 'desayuno', grams: 50, name: 'Avena', status: 'synced', ...portionOf(389, 16.9, 6.9, 66.3, 50) });
    expect(fakes.remote.serverEntries).toHaveLength(1);
    expect(fakes.remote.serverFoods.map((f) => f.name)).toEqual(['Avena']);
  });

  it('AC-nutrition-001-16: con otra comida de nombre libre la agrupa aparte', async () => {
    fakes.remote.serverFoods = [OATS];
    await openNutrition();
    await press(await screen.findByTestId('add-food'));
    await press(await screen.findByTestId('meal-otra'));
    await type('Nombre de la comida', 'Antes de entrenar');
    await press(await screen.findByTestId(`food-${OATS.id}`));
    await type('Cantidad en gramos', '40');

    await press(screen.getByTestId('save-entry'));

    expect(await screen.findByTestId('meal-Antes de entrenar')).toHaveTextContent(has('Avena · 40 g'));
  });

  it('AC-nutrition-001-06: un alimento con valores fuera de las reglas no se guarda y se explica por qué', async () => {
    await openNutrition();
    await press(await screen.findByTestId('add-food'));
    await press(await screen.findByTestId('create-food'));
    await fillFood({ 'Calorías por 100 g': '1000' });

    await press(screen.getByTestId('save-food'));

    expect(await screen.findByTestId('food-issues')).toHaveTextContent(has('Las calorías por 100 g va de 0 a 900'));
    expect(await fakes.store.getFoods()).toEqual([]);
  });

  it('AC-nutrition-001-17: al escanear consulta Open Food Facts, rellena el formulario y la persona lo confirma antes de guardar', async () => {
    fakes.products.result = {
      kind: 'found',
      product: { barcode: '3017624010701', name: 'Nutella', brand: 'Ferrero', kcalPer100g: 539, proteinPer100g: 6.3, fatPer100g: 30.9, carbsPer100g: 57.5 },
    };
    await openNutrition();
    await press(await screen.findByTestId('add-food'));
    await press(await screen.findByTestId('scan-food'));

    await press(await screen.findByTestId('fake-scan'));

    await waitFor(() => expect(screen.getByLabelText('Nombre del alimento').props.value).toBe('Nutella'));
    expect(fakes.products.lookups).toEqual(['3017624010701']);
    expect(screen.getByLabelText('Código de barras (opcional)').props.value).toBe('3017624010701');
    expect(screen.getByLabelText('Calorías por 100 g').props.value).toBe('539');
    expect(screen.getByLabelText('Proteína por 100 g').props.value).toBe('6,3');
    expect(screen.getByTestId('food-notice')).toHaveTextContent(has('Valores de Open Food Facts: revísalos antes de guardar'));
    expect(await fakes.store.getFoods()).toEqual([]); // todavía nada guardado

    await type('Calorías por 100 g', '540'); // la persona corrige
    await press(screen.getByTestId('save-food'));

    expect(await screen.findByTestId('selected-food')).toHaveTextContent(has('Nutella'));
    expect(await fakes.store.getFoods()).toMatchObject([{ name: 'Nutella', barcode: '3017624010701', kcalPer100g: 540, source: 'openfoodfacts' }]);
  });

  it.each([
    [{ kind: 'notFound' } as const, 'No encuentro ese producto'],
    [{ kind: 'offline' } as const, 'Sin conexión: escribe los valores del producto'],
  ])('AC-nutrition-001-17: si %j abre el formulario manual con el código ya puesto', async (result, message) => {
    fakes.products.result = result;
    await openNutrition();
    await press(await screen.findByTestId('add-food'));
    await press(await screen.findByTestId('scan-food'));

    await press(await screen.findByTestId('fake-scan'));

    await waitFor(() => expect(screen.getByLabelText('Código de barras (opcional)').props.value).toBe('3017624010701'));
    expect(screen.getByLabelText('Nombre del alimento').props.value).toBe('');
    expect(screen.getByTestId('food-notice')).toHaveTextContent(has(message));
  });

  it('AC-nutrition-001-17: un producto incompleto rellena lo que hay y pide completar el resto', async () => {
    fakes.products.result = {
      kind: 'incomplete',
      product: { barcode: '3017624010701', name: 'Galletas', brand: null, kcalPer100g: 480, proteinPer100g: null, fatPer100g: null, carbsPer100g: null },
    };
    await openNutrition();
    await press(await screen.findByTestId('add-food'));
    await press(await screen.findByTestId('scan-food'));

    await press(await screen.findByTestId('fake-scan'));

    await waitFor(() => expect(screen.getByLabelText('Nombre del alimento').props.value).toBe('Galletas'));
    expect(screen.getByLabelText('Proteína por 100 g').props.value).toBe('');
    expect(screen.getByTestId('food-notice')).toHaveTextContent(has('no tiene todos los datos'));
  });

  it('AC-nutrition-001-17: un código que la persona ya tiene selecciona su alimento sin consultar nada', async () => {
    fakes.remote.serverFoods = [{ ...OATS, barcode: '3017624010701' }];
    await openNutrition();
    await press(await screen.findByTestId('add-food'));
    await screen.findByTestId(`food-${OATS.id}`);
    await press(screen.getByTestId('scan-food'));

    await press(await screen.findByTestId('fake-scan'));

    expect(await screen.findByTestId('selected-food')).toHaveTextContent(has('Avena'));
    expect(fakes.products.lookups).toEqual([]);
  });

  it('AC-nutrition-001-18: sin conexión registra en el teléfono, calcula los totales aquí y muestra el último objetivo', async () => {
    fakes.remote.serverFoods = [OATS];
    await fakes.store.saveFood({ ...OATS, status: 'synced', message: null, pendingOp: null, attempted: true });
    await fakes.store.setSetting('nutritionTarget', JSON.stringify({ target: (fakes.remote.targets as { target: unknown }).target, calculatedAt: '2026-11-10' }));
    fakes.remote.online = false;
    await openNutrition();
    expect(await screen.findByTestId('nutrition-target')).toHaveTextContent(has('Calculado el 2026-11-10'));

    await press(await screen.findByTestId('add-food'));
    await press(await screen.findByTestId(`food-${OATS.id}`));
    await type('Cantidad en gramos', '50');
    await press(screen.getByTestId('save-entry'));

    expect(await screen.findByTestId('meal-desayuno')).toHaveTextContent(has('pendiente de enviar'));
    expect(screen.getByTestId('nutrition-totals')).toHaveTextContent(has(`Consumido: ${portionOf(389, 16.9, 6.9, 66.3, 50).kcal} kcal`));
    expect(fakes.remote.serverEntries).toEqual([]);

    fakes.remote.online = true; // al volver la conexión se envía una sola vez, con el mismo id
    await fakes.nutrition.syncPending();
    await fakes.nutrition.syncPending();
    expect(fakes.remote.entryPuts).toHaveLength(1);
  });

  it('AC-nutrition-001-19: cambiar los gramos actualiza el total y borrar la entrada la quita, y ambos se sincronizan', async () => {
    fakes.remote.serverFoods = [OATS];
    fakes.remote.serverEntries = [entry('e1', 'desayuno', 50)];
    await openNutrition();
    await press(await screen.findByTestId('edit-entry-e1'));
    await waitFor(() => expect(screen.getByLabelText('Cantidad en gramos').props.value).toBe('50'));

    await type('Cantidad en gramos', '100');
    await press(screen.getByTestId('save-entry'));

    await waitFor(() => expect(screen.getByTestId('nutrition-totals')).toHaveTextContent(has('Consumido: 389 kcal')));
    expect(fakes.remote.serverEntries[0]).toMatchObject({ id: 'e1', grams: 100, kcal: 389 });

    await press(screen.getByTestId('delete-entry-e1'));

    await waitFor(() => expect(screen.queryByTestId('entry-e1')).not.toBeOnTheScreen());
    expect(screen.getByTestId('nutrition-totals')).toHaveTextContent(has('Consumido: 0 kcal'));
    expect(fakes.remote.serverEntries).toEqual([]);
  });

  it('AC-nutrition-001-19: una entrada rechazada por la API muestra el motivo, no cuenta y se puede descartar', async () => {
    fakes.remote.serverFoods = [OATS];
    fakes.remote.entryResult = { kind: 'rejected', reason: 'La fecha no es válida.' };
    await fakes.store.saveFood({ ...OATS, status: 'synced', message: null, pendingOp: null, attempted: true });
    await openNutrition();
    await press(await screen.findByTestId('add-food'));
    await press(await screen.findByTestId(`food-${OATS.id}`));
    await type('Cantidad en gramos', '50');
    await press(screen.getByTestId('save-entry'));

    expect(await screen.findByText('La fecha no es válida.')).toBeOnTheScreen();
    expect(screen.getByTestId('nutrition-totals')).toHaveTextContent(has('Consumido: 0 kcal'));

    await press(screen.getByTestId('discard-entry-food-1'));
    await waitFor(() => expect(screen.queryByTestId('entry-food-1')).not.toBeOnTheScreen());
  });
});
