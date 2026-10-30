import { configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { createDeps } from '../src/data/deps';
import type { LocalExerciseLog } from '../src/data/types';
import { CATALOG, PROFILE, createFakes } from './support';

// La app real abre SQLite y la API por HTTP; en estas pruebas se sustituyen por versiones en memoria.
jest.mock('../src/data/deps', () => ({ createDeps: jest.fn() }));
jest.mock('../src/database', () => ({ getDb: jest.fn() }));
jest.mock('../src/Scanner', () => ({ Scanner: () => null }));
jest.mock('../src/components/WeightPanel', () => ({ WeightPanel: () => null }));

// Montar la app completa tarda más de 1 s en equipos lentos; este margen evita falsos fallos.
configure({ asyncUtilTimeout: 5000 });

const EXERCISE = 'press-plano-con-barra'; // Barra recta de 20 kg
let fakes: ReturnType<typeof createFakes>;

async function openApp(url: string) {
  (createDeps as jest.Mock).mockResolvedValue(fakes.deps);
  await renderRouter('./src/app', { initialUrl: url });
}

const has = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const press = async (element: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(element);
const type = async (label: string, value: string) => fireEvent.changeText(await screen.findByLabelText(label), value);

const seed = (over: Partial<LocalExerciseLog> & { id: string }): LocalExerciseLog => ({
  exerciseId: EXERCISE, date: '2026-10-01', loadKg: 30, firstSetReps: 9, secondSetReps: 5, secondSetAssistedReps: 5,
  status: 'synced', message: null, pendingOp: null, attempted: true, ...over,
});

async function fillForm(over: Partial<Record<'date' | 'load' | 'first' | 'second' | 'assisted', string>> = {}) {
  const v = { date: '2026-10-29', load: '30', first: '9', second: '5', assisted: '5', ...over };
  await type('Fecha (AAAA-MM-DD)', v.date);
  await type('Carga en kg', v.load);
  await type('Serie 1: repeticiones (hasta 12)', v.first);
  await type('Serie 2: repeticiones propias hasta el fallo', v.second);
  await type('Serie 2: repeticiones asistidas (opcional)', v.assisted);
}

beforeEach(() => {
  fakes = createFakes();
});

describe('Registrar una sesión (SPEC-mobile-003)', () => {
  it('AC-mobile-003-01: guarda la sesión en el teléfono y la envía', async () => {
    fakes.remote.putLog = async () => ({ kind: 'ok' });
    await openApp(`/session/${EXERCISE}`);
    await fillForm();

    await press(await screen.findByTestId('save-session'));

    expect(await screen.findByTestId('saved-message')).toHaveTextContent(has('Sesión guardada.'));
    const [saved] = await fakes.store.getLogs(EXERCISE);
    expect(saved).toMatchObject({ id: 'log-1', date: '2026-10-29', loadKg: 30, firstSetReps: 9, secondSetReps: 5, secondSetAssistedReps: 5, status: 'synced' });
  });

  it('AC-mobile-003-02: con valores inválidos no guarda y muestra el motivo', async () => {
    await openApp(`/session/${EXERCISE}`);
    await fillForm({ first: '13', load: '0' });

    await press(await screen.findByTestId('save-session'));

    const issues = await screen.findByTestId('form-issues');
    expect(issues).toHaveTextContent(has('La serie 1 lleva entre 1 y 12 repeticiones.'));
    expect(issues).toHaveTextContent(has('La carga debe ser mayor que 0 kg.'));
    expect(await fakes.store.getLogs(EXERCISE)).toEqual([]);
  });

  it('AC-mobile-003-02: en peso corporal la carga es un lastre opcional', async () => {
    fakes.remote.fetchCatalog = async () => [
      {
        name: 'Pecho',
        exercises: [{
          id: 'fondos-en-paralelas-para-pecho', name: 'Fondos en paralelas', primaryZone: 'pecho', secondaryZones: [],
          movements: [], equipment: 'PesoCorporal', bar: null, images: [],
        }],
      },
    ];
    await openApp('/session/fondos-en-paralelas-para-pecho');

    expect(await screen.findByLabelText('Lastre en kg (opcional)')).toBeOnTheScreen();
  });

  it('AC-mobile-003-03: sin conexión queda guardada en el teléfono y avisa que se enviará después', async () => {
    await fakes.store.saveCatalog(CATALOG);
    fakes.remote.online = false;
    await openApp(`/session/${EXERCISE}`);
    await fillForm();

    await press(await screen.findByTestId('save-session'));

    expect(await screen.findByTestId('saved-message')).toHaveTextContent(has('se enviará cuando haya conexión'));
    expect((await fakes.store.getLogs(EXERCISE))[0]).toMatchObject({ status: 'pending', pendingOp: 'upsert' });
  });

  it('AC-mobile-003-08: otro registro del mismo día se bloquea y ofrece editar el existente', async () => {
    await fakes.store.saveLog(seed({ id: 'existente', date: '2026-10-29', loadKg: 27.5 }));
    await openApp(`/session/${EXERCISE}`);
    await fillForm({ date: '2026-10-29' });

    await press(await screen.findByTestId('save-session'));

    expect(await screen.findByTestId('form-issues')).toHaveTextContent(has('Ya hay un registro de este ejercicio en esa fecha'));
    expect(await fakes.store.getLogs(EXERCISE)).toHaveLength(1);

    await press(screen.getByTestId('edit-existing'));
    await waitFor(() => expect(screen.getByLabelText('Carga en kg').props.value).toBe('27.5'));
  });
});

describe('Historial, consejo y aviso en el ejercicio (SPEC-mobile-003)', () => {
  it('AC-mobile-003-12: muestra el historial del más reciente al más antiguo con el estado de envío', async () => {
    await fakes.store.saveLog(seed({ id: 'a', date: '2026-10-01', loadKg: 27.5 }));
    await fakes.store.saveLog(seed({ id: 'b', date: '2026-10-08', loadKg: 30, status: 'pending', pendingOp: 'upsert' }));
    await openApp(`/exercise/${EXERCISE}`);

    const newest = await screen.findByTestId('log-b');
    expect(newest).toHaveTextContent(has('2026-10-08'));
    expect(newest).toHaveTextContent(has('30 kg · Serie 1: 9 · Serie 2: 5 + 5 asistidas'));
    expect(newest).toHaveTextContent(has('pendiente de enviar'));
    expect(screen.getByTestId('log-a')).toHaveTextContent(has('sincronizado'));
    const order = screen.getAllByText(/^2026-10-/).map((n) => n.props.children);
    expect(order).toEqual(['2026-10-08', '2026-10-01']);
  });

  it('AC-mobile-003-09: propone subir a la siguiente carga de su equipamiento, sin conexión', async () => {
    await fakes.store.saveEquipment(PROFILE);
    await fakes.store.saveLog(seed({ id: 'a', loadKg: 30, firstSetReps: 12, secondSetReps: 8 }));
    await fakes.store.saveCatalog(CATALOG);
    fakes.remote.online = false;
    await openApp(`/exercise/${EXERCISE}`);

    expect(await screen.findByText('Sugerencia: sube a 35 kg en la próxima sesión.')).toBeOnTheScreen();
    expect(screen.getByText('Serie 1 en el techo de 12.')).toBeOnTheScreen();
  });

  it('AC-mobile-003-09: sin perfil de equipamiento avisa de que hay que configurarlo', async () => {
    await fakes.store.saveLog(seed({ id: 'a', loadKg: 30, firstSetReps: 12, secondSetReps: 8 }));
    await openApp(`/exercise/${EXERCISE}`);

    expect(await screen.findByText(/Configura tu equipamiento/)).toBeOnTheScreen();
  });

  it('AC-mobile-003-10: avisa de estancamiento como sugerencia tras varias sesiones sin mejorar', async () => {
    await fakes.store.saveEquipment(PROFILE);
    for (const [i, date] of ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'].entries()) {
      await fakes.store.saveLog(seed({ id: `s${i}`, date }));
    }
    await openApp(`/exercise/${EXERCISE}`);

    expect(await screen.findByTestId('stagnation-message')).toHaveTextContent(has('Llevas 3 sesiones sin mejorar en este ejercicio.'));
  });

  it('AC-mobile-003-04: editar un registro abre el formulario con sus datos y guarda el cambio', async () => {
    await fakes.store.saveLog(seed({ id: 'a', date: '2026-10-01', loadKg: 27.5 }));
    await openApp(`/exercise/${EXERCISE}`);
    await press(await screen.findByTestId('edit-a'));
    await waitFor(() => expect(screen.getByLabelText('Carga en kg').props.value).toBe('27.5'));

    await type('Carga en kg', '30');
    await press(screen.getByTestId('save-session'));

    await screen.findByTestId('saved-message');
    expect(await fakes.store.getLogs(EXERCISE)).toHaveLength(1);
    expect(await fakes.store.getLog('a')).toMatchObject({ loadKg: 30, status: 'pending', pendingOp: 'upsert' });
  });

  it('AC-mobile-003-05: borrar pide confirmación y quita el registro del historial', async () => {
    await fakes.store.saveLog(seed({ id: 'a' }));
    await openApp(`/exercise/${EXERCISE}`);
    await press(await screen.findByTestId('delete-a'));
    expect(screen.getByTestId('log-a')).toBeOnTheScreen(); // aún no se borró

    await press(screen.getByTestId('confirm-delete-a'));

    await waitFor(() => expect(screen.queryByTestId('log-a')).not.toBeOnTheScreen());
    expect((await fakes.store.getLog('a'))?.pendingOp).toBe('delete');
  });

  it('AC-mobile-003-05: cancelar no borra', async () => {
    await fakes.store.saveLog(seed({ id: 'a' }));
    await openApp(`/exercise/${EXERCISE}`);
    await press(await screen.findByTestId('delete-a'));

    await press(screen.getByText('Cancelar'));

    expect(screen.getByTestId('log-a')).toBeOnTheScreen();
    expect((await fakes.store.getLog('a'))?.pendingOp).toBeNull();
  });

  it('AC-mobile-003-07: un registro rechazado muestra el motivo y se puede descartar', async () => {
    await fakes.store.saveLog(seed({ id: 'a', status: 'rejected', message: 'El ejercicio no existe en el catálogo.', pendingOp: 'upsert' }));
    await openApp(`/exercise/${EXERCISE}`);

    expect(await screen.findByText('El ejercicio no existe en el catálogo.')).toBeOnTheScreen();
    expect(screen.getByTestId('log-a')).toHaveTextContent(has('rechazado'));

    await press(screen.getByTestId('discard-a'));

    await waitFor(() => expect(screen.queryByTestId('log-a')).not.toBeOnTheScreen());
    expect(await fakes.store.getLog('a')).toBeNull();
  });
});

describe('Acceso desde Mi rutina (SPEC-mobile-003)', () => {
  it('AC-mobile-003-13: cada ejercicio del día tiene un botón Registrar que abre su formulario', async () => {
    await fakes.seedServer('martes', [{ id: 'p1', exerciseId: EXERCISE, order: 0, machineStepKg: null }]);
    await openApp('/rutina');

    await press(await screen.findByTestId('log-p1'));

    expect(await screen.findByTestId('save-session')).toBeOnTheScreen();
    expect(screen.getByText('Press plano con barra')).toBeOnTheScreen();
  });
});

describe('Umbral de estancamiento en Más (SPEC-mobile-003)', () => {
  it('AC-mobile-003-11: rechaza un valor fuera de 2 a 10 con el motivo', async () => {
    await openApp('/mas');

    await type('Sesiones sin mejorar', '1');
    await press(screen.getByTestId('save-threshold'));

    expect(await screen.findByText('El umbral debe ser un número entero entre 2 y 10.')).toBeOnTheScreen();
    expect(await fakes.store.getSetting('stagnationThreshold')).toBeNull();
  });

  it('AC-mobile-003-11: guarda el umbral en el teléfono y lo envía', async () => {
    fakes.remote.putTrainingSettings = async () => ({ kind: 'ok' });
    await openApp('/mas');

    await type('Sesiones sin mejorar', '5');
    await press(screen.getByTestId('save-threshold'));

    await waitFor(() => expect(screen.getByTestId('threshold-status')).toHaveTextContent(has('sincronizado')));
    expect(await fakes.store.getSetting('stagnationThreshold')).toBe('5');
  });

  it('AC-mobile-003-11: sin conexión queda pendiente de enviar', async () => {
    fakes.remote.online = false;
    await openApp('/mas');

    await type('Sesiones sin mejorar', '4');
    await press(screen.getByTestId('save-threshold'));

    await waitFor(() => expect(screen.getByTestId('threshold-status')).toHaveTextContent(has('pendiente de enviar')));
    expect(await fakes.store.getSetting('stagnationThreshold')).toBe('4');
  });
});

describe('Tema claro y oscuro (SPEC-mobile-003)', () => {
  it.each([
    ['light', '#111827'],
    ['dark', '#F3F4F6'],
  ])('AC-mobile-003-14: el formulario usa el texto del tema %s', async (mode, textColor) => {
    await fakes.store.setSetting('theme', mode);
    await openApp(`/session/${EXERCISE}`);

    const title = await screen.findByText('Press plano con barra');

    expect(title).toHaveStyle({ color: textColor });
  });
});
