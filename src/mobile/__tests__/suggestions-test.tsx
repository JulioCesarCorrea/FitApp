import { configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { createDeps } from '../src/data/deps';
import type { Suggestion } from '../src/data/types';
import { CATALOG, createFakes } from './support';

// La app real abre SQLite y la API por HTTP; en estas pruebas se sustituyen por versiones en memoria.
jest.mock('../src/data/deps', () => ({ createDeps: jest.fn() }));
jest.mock('../src/database', () => ({ getDb: jest.fn() }));
jest.mock('../src/Scanner', () => ({ Scanner: () => null }));
jest.mock('../src/components/WeightPanel', () => ({ WeightPanel: () => null }));

// Montar la app completa tarda más de 1 s en equipos lentos; este margen evita falsos fallos.
configure({ asyncUtilTimeout: 5000 });

const STAGNANT: Suggestion = {
  key: 'ejercicio-estancado:press-plano-con-barra:martes:2026-10-29',
  kind: 'ejercicio-estancado',
  exerciseId: 'press-plano-con-barra',
  day: 'martes',
  message: 'Llevas 3 sesiones sin mejorar en «Press plano con barra». Si quieres, puedes sustituirlo por otro ejercicio.',
  alternatives: [{ exerciseId: 'press-de-pecho-en-maquina', name: 'Press de pecho en máquina' }],
};

const METHOD: Suggestion = {
  key: 'metodo:press-plano-con-barra:2026-10-29',
  kind: 'metodo',
  exerciseId: 'press-plano-con-barra',
  day: null,
  message: '«Press plano con barra»: En tus dos últimas sesiones la serie 1 quedó por debajo de 6 repeticiones.',
  alternatives: null,
};

let fakes: ReturnType<typeof createFakes>;

async function openRoutine() {
  (createDeps as jest.Mock).mockResolvedValue(fakes.deps);
  await fakes.seedServer('martes', [{ id: 'e1', exerciseId: 'press-plano-con-barra', order: 0, machineStepKg: null }]);
  await renderRouter('./src/app', { initialUrl: '/rutina' });
}

const press = async (element: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(element);
const has = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

beforeEach(() => {
  fakes = createFakes();
});

describe('Sugerencias en Mi rutina (SPEC-training-005)', () => {
  it('AC-training-005-15: lista las sugerencias con su texto y las alternativas, sin cambiar nada por sí sola', async () => {
    fakes.remote.serverSuggestions = [STAGNANT, METHOD];
    await openRoutine();

    expect(await screen.findByTestId(`suggestion-${STAGNANT.key}`)).toHaveTextContent(has('Llevas 3 sesiones sin mejorar'));
    expect(screen.getByTestId(`suggestion-${METHOD.key}`)).toHaveTextContent(has('serie 1 quedó por debajo de 6'));
    expect(screen.getByTestId(`alt-${STAGNANT.key}-press-de-pecho-en-maquina`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`accept-${METHOD.key}`)).not.toBeOnTheScreen(); // sin alternativas no se acepta
    expect(fakes.remote.accepted).toEqual([]);
  });

  it('AC-training-005-15: aceptar exige elegir una alternativa y luego la rutina muestra el ejercicio nuevo', async () => {
    fakes.remote.serverSuggestions = [STAGNANT];
    await openRoutine();
    await screen.findByTestId(`suggestion-${STAGNANT.key}`);
    expect(screen.getByTestId(`accept-${STAGNANT.key}`).props.accessibilityState?.disabled).toBe(true);

    await press(screen.getByTestId(`alt-${STAGNANT.key}-press-de-pecho-en-maquina`));
    await press(screen.getByTestId(`accept-${STAGNANT.key}`));

    await waitFor(() => expect(fakes.remote.accepted).toEqual([{ key: STAGNANT.key, replacement: 'press-de-pecho-en-maquina' }]));
    expect(await screen.findByText('1. Press de pecho en máquina')).toBeOnTheScreen();
    expect(screen.queryByText('1. Press plano con barra')).not.toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByTestId(`suggestion-${STAGNANT.key}`)).not.toBeOnTheScreen());
  });

  it('AC-training-005-15: descartar la quita de la lista y se la comunica a la API', async () => {
    fakes.remote.serverSuggestions = [STAGNANT, METHOD];
    await openRoutine();
    await press(await screen.findByTestId(`dismiss-${METHOD.key}`));

    await waitFor(() => expect(screen.queryByTestId(`suggestion-${METHOD.key}`)).not.toBeOnTheScreen());
    expect(fakes.remote.dismissed).toEqual([METHOD.key]);
    expect(screen.getByTestId(`suggestion-${STAGNANT.key}`)).toBeOnTheScreen();
  });

  it('AC-training-005-15: si la API rechaza el cambio muestra el motivo y la rutina no cambia', async () => {
    fakes.remote.serverSuggestions = [STAGNANT];
    fakes.remote.acceptResult = { kind: 'rejected', reason: 'Ese ejercicio no es una de las alternativas de la sugerencia.' };
    await openRoutine();
    await press(await screen.findByTestId(`alt-${STAGNANT.key}-press-de-pecho-en-maquina`));

    await press(screen.getByTestId(`accept-${STAGNANT.key}`));

    expect(await screen.findByTestId('suggestions-notice')).toHaveTextContent(has('no es una de las alternativas'));
    expect(screen.getByText('1. Press plano con barra')).toBeOnTheScreen();
  });

  it('AC-training-005-16: sin conexión el plan funciona y las sugerencias avisan de que necesitan conexión', async () => {
    fakes.remote.serverSuggestions = [STAGNANT];
    await fakes.store.saveCatalog(CATALOG);
    fakes.remote.online = false;
    await openRoutine();

    expect(await screen.findByTestId('suggestions-offline')).toHaveTextContent(has('necesitan conexión'));
    expect(screen.getByText('1. Press plano con barra')).toBeOnTheScreen();
    expect(screen.queryByTestId('suggestions-panel')).not.toBeOnTheScreen();
  });

  it('AC-training-005-15: sin sugerencias no se muestra el panel', async () => {
    await openRoutine();

    await screen.findByText('1. Press plano con barra');
    expect(screen.queryByTestId('suggestions-panel')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('suggestions-offline')).not.toBeOnTheScreen();
  });
});
