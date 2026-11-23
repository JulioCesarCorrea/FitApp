import { configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { createDeps } from '../src/data/deps';
import { localDate } from '../src/data/nutritionService';
import type { LocalExerciseLog, NutritionTarget, ServerNutritionHistory } from '../src/data/types';
import type { LocalWeight } from '../src/sync';
import { createFakes } from './support';

// La app real abre SQLite, la cámara y la API por HTTP; en estas pruebas se sustituyen por versiones en memoria.
jest.mock('../src/data/deps', () => ({ createDeps: jest.fn() }));
jest.mock('../src/database', () => ({ getDb: jest.fn() }));
jest.mock('../src/Scanner', () => ({ Scanner: () => null }));
jest.mock('../src/components/WeightPanel', () => ({ WeightPanel: () => null }));

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(20000);

let fakes: ReturnType<typeof createFakes>;

/** Un peso registrado hace `daysAgo` días (UTC), como los guarda la cola local de pesos. */
const weight = (kg: number, daysAgo: number, status: LocalWeight['status'] = 'synced'): LocalWeight => {
  const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return { id: `w-${kg}-${daysAgo}`, weightKg: kg, measuredAt: at, createdAt: at, status, error: null };
};

async function openProgress() {
  (createDeps as jest.Mock).mockResolvedValue(fakes.deps);
  await renderRouter('./src/app', { initialUrl: '/progress/weight' });
}

beforeEach(() => {
  fakes = createFakes();
});

describe('Progreso de peso (SPEC-progress-002)', () => {
  it('AC-progress-002-07: muestra el gráfico con la tendencia, el cambio, el mínimo, el máximo y el resumen por semana', async () => {
    fakes.weights.rows = [weight(82, 40), weight(81, 20), weight(80, 10), weight(80.5, 3)];
    await openProgress();

    expect(await screen.findByTestId('weight-chart')).toBeOnTheScreen();
    expect(screen.getByTestId('weight-chart').props.accessibilityLabel).toMatch(/4 pesos, de 80 kg a 82 kg/);
    expect(screen.getByTestId('weight-change')).toHaveTextContent('Cambio en el periodo: -1,5 kg');
    expect(screen.getByTestId('weight-summary')).toHaveTextContent(/Mínimo 80 kg · Máximo 82 kg/);
    expect(screen.getByTestId('weight-summary')).toHaveTextContent(/Último: 80,5 kg/);
    expect(screen.getByText(/tendencia \(estimación calculada, no un dato registrado\)/)).toBeOnTheScreen();
    expect(screen.getByTestId('weight-weeks')).toHaveTextContent(/Semana del/);
  });

  it('AC-progress-002-07: el selector de rango limita el gráfico al periodo elegido', async () => {
    fakes.weights.rows = [weight(82, 80), weight(81, 20), weight(80, 10), weight(80.5, 3)];
    await openProgress();
    await screen.findByTestId('weight-chart'); // 90 días: los cuatro pesos
    expect(screen.getByTestId('weight-chart').props.accessibilityLabel).toMatch(/4 pesos/);

    await fireEvent.press(screen.getByTestId('range-30d'));

    await waitFor(() => expect(screen.getByTestId('weight-chart').props.accessibilityLabel).toMatch(/3 pesos, de 80 kg a 81 kg/));
    expect(screen.getByTestId('weight-change')).toHaveTextContent('Cambio en el periodo: -0,5 kg');
  });

  it('AC-progress-002-08: dibuja los pesos guardados en el teléfono, también los pendientes de enviar, y no los rechazados', async () => {
    fakes.remote.online = false;
    fakes.weights.rows = [weight(80, 10, 'pending'), weight(81, 6, 'pending'), weight(79, 3, 'synced'), weight(200, 2, 'rejected')];
    await openProgress();

    const chart = await screen.findByTestId('weight-chart');

    expect(chart.props.accessibilityLabel).toMatch(/3 pesos, de 79 kg a 81 kg/);
  });

  it('AC-progress-002-09: con menos de 3 pesos muestra un estado vacío en lugar de un gráfico engañoso', async () => {
    fakes.weights.rows = [weight(80, 5), weight(79.5, 2)];
    await openProgress();

    expect(await screen.findByTestId('weight-empty')).toHaveTextContent(/Con menos de 3 pesos/);
    expect(screen.queryByTestId('weight-chart')).not.toBeOnTheScreen();
    expect(screen.getByTestId('weight-summary')).toBeOnTheScreen(); // el resumen sí se muestra
  });

  it('AC-progress-002-09: sin ningún peso invita a registrar', async () => {
    await openProgress();

    expect(await screen.findByTestId('weight-empty')).toHaveTextContent(/Registra tu peso/);
    expect(screen.queryByTestId('weight-summary')).not.toBeOnTheScreen();
  });
});

describe('Progreso de nutrición (SPEC-nutrition-006)', () => {
  const dayAgo = (n: number) => localDate(new Date(Date.now() - n * 86_400_000));
  const logged = (daysAgo: number, kcal: number) => ({ date: dayAgo(daysAgo), logged: true, kcal, proteinG: 120, fatG: 60, carbsG: 250 });
  const TARGET: NutritionTarget = {
    calories: 2000, proteinG: 145, fatG: 56, carbsG: 229, basalKcal: 1800, weightKg: 80.5, weightDate: '2026-11-12',
    calculatedCalories: 2000, source: 'calculated',
  };
  const history = (days: ServerNutritionHistory['days'], targets: NutritionTarget | null = TARGET): ServerNutritionHistory => ({ days, targets });

  async function openNutritionProgress() {
    (createDeps as jest.Mock).mockResolvedValue(fakes.deps);
    await renderRouter('./src/app', { initialUrl: '/progress/nutrition' });
  }

  it('AC-nutrition-006-08: muestra el gráfico semanal con las calorías contra el objetivo, los macros y la adherencia', async () => {
    fakes.remote.serverHistory = history([logged(1, 2000), logged(2, 2100), logged(3, 1000)]);
    await openNutritionProgress();

    const chart = await screen.findByTestId('nutrition-chart');

    expect(chart.props.accessibilityLabel).toMatch(/Calorías medias por semana/);
    expect(screen.getByTestId('history-adherence')).toHaveTextContent(/de 3 días registrados dentro de ±10 % de 2000 kcal/);
    expect(screen.getByText(/Objetivo de hoy: 2000 kcal/)).toBeOnTheScreen();
    expect(screen.getAllByText(/Semana del .*kcal · P 120 g · G 60 g · C 250 g de media/).length).toBeGreaterThan(0);
  });

  it('AC-nutrition-006-08: el selector de semanas cambia el periodo', async () => {
    fakes.remote.serverHistory = history([logged(1, 2000), logged(40, 1800)]);
    await openNutritionProgress();
    await screen.findByTestId('nutrition-chart');
    expect(screen.getByTestId('nutrition-chart').props.accessibilityLabel).toMatch(/1800 kcal/); // 8 semanas por defecto: hace 40 días cae dentro

    await fireEvent.press(screen.getByTestId('weeks-4'));

    await waitFor(() => expect(screen.getByTestId('nutrition-chart').props.accessibilityLabel).not.toMatch(/1800 kcal/));
  });

  it('AC-nutrition-006-09: sin conexión y sin nada guardado lo avisa y no inventa datos', async () => {
    fakes.remote.online = false;
    await openNutritionProgress();

    expect(await screen.findByTestId('history-offline')).toBeOnTheScreen();
    expect(screen.getByTestId('history-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('nutrition-chart')).not.toBeOnTheScreen();
  });

  it('AC-nutrition-006-06: sin objetivo muestra el consumo sin adherencia', async () => {
    fakes.remote.serverHistory = history([logged(1, 2000)], null);
    await openNutritionProgress();

    expect(await screen.findByTestId('history-no-target')).toBeOnTheScreen();
    expect(screen.queryByTestId('history-adherence')).not.toBeOnTheScreen();
  });
});

describe('Progreso de entrenamiento (SPEC-training-006)', () => {
  // En las pruebas «hoy» del servicio de sesiones es el viernes 2026-10-30; la semana en curso empieza el lunes 2026-10-26.
  const log = (id: string, exerciseId: string, date: string, loadKg: number, over: Partial<LocalExerciseLog> = {}): LocalExerciseLog => ({
    id, exerciseId, date, loadKg, firstSetReps: 9, secondSetReps: 8, secondSetAssistedReps: 5,
    status: 'synced', message: null, pendingOp: null, attempted: true, ...over,
  });

  async function openTrainingProgress() {
    (createDeps as jest.Mock).mockResolvedValue(fakes.deps);
    await renderRouter('./src/app', { initialUrl: '/progress/training' });
  }

  it('AC-training-006-07: con todo sincronizado muestra el resumen semanal de la API y la progresión de un ejercicio', async () => {
    await fakes.store.saveLog(log('l1', 'press-plano-con-mancuernas', '2026-10-13', 20));
    await fakes.store.saveLog(log('l2', 'press-plano-con-mancuernas', '2026-10-27', 22.5));
    fakes.remote.serverTrainingWeeks = [
      { weekStart: '2026-10-12', sessions: 1, sets: 2, volumeKg: 340, partial: false },
      { weekStart: '2026-10-19', sessions: 0, sets: 0, volumeKg: 0, partial: false },
      { weekStart: '2026-10-26', sessions: 1, sets: 2, volumeKg: 382.5, partial: true },
    ];
    await openTrainingProgress();

    expect(await screen.findByTestId('training-chart')).toBeOnTheScreen();
    expect(screen.queryByTestId('training-local')).not.toBeOnTheScreen(); // lo calculó la API
    expect(screen.getByTestId('training-week-2026-10-26')).toHaveTextContent('Semana del 2026-10-26 (en curso): 1 sesión, 2 series, 382,5 kg de volumen');
    expect(screen.getByTestId('training-week-2026-10-19')).toHaveTextContent(/0 sesiones, 0 series, 0 kg de volumen/);

    await fireEvent.press(await screen.findByTestId('exercise-press-plano-con-mancuernas'));

    expect(await screen.findByTestId('exercise-chart')).toBeOnTheScreen();
    expect(screen.getByTestId('exercise-session-l2')).toHaveTextContent('2026-10-27: 22,5 kg · series 9/8 · volumen 382,5 kg');
    expect(screen.getByTestId('exercise-session-l1')).toHaveTextContent('2026-10-13: 20 kg · series 9/8 · volumen 340 kg');
  });

  it('AC-training-006-08: sin conexión o con cambios por enviar lo calcula con los registros del teléfono, también los pendientes', async () => {
    fakes.remote.online = false;
    await fakes.store.saveLog(log('l1', 'press-plano-con-mancuernas', '2026-10-27', 20));
    await fakes.store.saveLog(log('l2', 'press-plano-con-barra', '2026-10-27', 40, { status: 'pending', pendingOp: 'upsert', attempted: false }));
    await fakes.store.saveLog(log('l3', 'press-plano-con-barra', '2026-10-20', 100, { status: 'rejected', message: 'No' }));
    await openTrainingProgress();

    expect(await screen.findByTestId('training-local')).toBeOnTheScreen();
    expect(screen.getByTestId('training-week-2026-10-26')).toHaveTextContent(/1 sesión, 4 series, 1020 kg de volumen/); // 20 × 17 + 40 × 17
    expect(screen.getByTestId('training-week-2026-10-19')).toHaveTextContent(/0 sesiones/); // lo rechazado no cuenta
  });

  it('AC-training-006-04: sin sesiones muestra un estado vacío', async () => {
    fakes.remote.serverTrainingWeeks = [{ weekStart: '2026-10-26', sessions: 0, sets: 0, volumeKg: 0, partial: true }];
    await openTrainingProgress();

    expect(await screen.findByTestId('training-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('training-chart')).not.toBeOnTheScreen();
  });

  it('AC-training-006-07: con una sola sesión de un ejercicio no hay progresión que dibujar', async () => {
    await fakes.store.saveLog(log('l1', 'press-plano-con-mancuernas', '2026-10-27', 20));
    fakes.remote.serverTrainingWeeks = [{ weekStart: '2026-10-26', sessions: 1, sets: 2, volumeKg: 340, partial: true }];
    await openTrainingProgress();

    await fireEvent.press(await screen.findByTestId('exercise-press-plano-con-mancuernas'));

    expect(await screen.findByTestId('exercise-single')).toBeOnTheScreen();
    expect(screen.queryByTestId('exercise-chart')).not.toBeOnTheScreen();
  });
});

