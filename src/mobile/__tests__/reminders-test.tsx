import { configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { createDeps } from '../src/data/deps';
import { createFakes } from './support';

// La app real abre SQLite, la cámara y la API por HTTP; en estas pruebas se sustituyen por versiones en memoria.
jest.mock('../src/data/deps', () => ({ createDeps: jest.fn() }));
jest.mock('../src/database', () => ({ getDb: jest.fn() }));
jest.mock('../src/Scanner', () => ({ Scanner: () => null }));
jest.mock('../src/components/WeightPanel', () => ({ WeightPanel: () => null }));

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(20000);

let fakes: ReturnType<typeof createFakes>;

async function openApp(url: string) {
  (createDeps as jest.Mock).mockResolvedValue(fakes.deps);
  await renderRouter('./src/app', { initialUrl: url });
}

const press = async (element: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(element);
const type = async (label: string, value: string) => fireEvent.changeText(await screen.findByLabelText(label), value);

beforeEach(() => {
  fakes = createFakes();
});

describe('Recordatorios (SPEC-notify-001)', () => {
  it('AC-notify-001-01: al activar entrenar se pide el permiso en ese momento y se programan los avisos', async () => {
    await openApp('/reminders');
    await screen.findByTestId('reminder-training');
    expect(fakes.scheduler.permissionRequests).toBe(0);

    await press(screen.getByTestId('reminder-training'));

    await waitFor(() => expect(screen.getByTestId('reminder-training')).toHaveTextContent(/^Activado/));
    expect(fakes.scheduler.permissionRequests).toBe(1);
    expect(fakes.scheduler.scheduled.length).toBeGreaterThan(0);
    expect(fakes.scheduler.scheduled.every((r) => r.route === '/rutina')).toBe(true);
  });

  it('AC-notify-001-01: si se niega el permiso el interruptor vuelve a apagado y se explica cómo activarlo', async () => {
    fakes.scheduler.willGrant = false;
    await openApp('/reminders');

    await press(await screen.findByTestId('reminder-meals'));

    expect(await screen.findByTestId('reminder-message')).toHaveTextContent(/ajustes del sistema/);
    expect(screen.getByTestId('reminder-meals')).toHaveTextContent(/^Desactivado/);
    expect(fakes.scheduler.scheduled).toEqual([]);
  });

  it('AC-notify-001-02: cambiar los días y la hora reprograma; una hora inválida se explica y no cambia nada', async () => {
    fakes.scheduler.status = 'granted';
    await openApp('/reminders');
    await press(await screen.findByTestId('reminder-training'));
    await waitFor(() => expect(fakes.scheduler.scheduled.length).toBeGreaterThan(0));

    await type('Hora de entrenar (HH:MM)', '25:00');
    await press(screen.getByTestId('save-reminders'));
    expect(await screen.findByTestId('reminder-message')).toHaveTextContent(/HH:MM/);
    expect(screen.queryByTestId('reminders-saved')).not.toBeOnTheScreen();

    await type('Hora de entrenar (HH:MM)', '19:30');
    await press(screen.getByTestId('training-day-1')); // quita el lunes
    await press(screen.getByTestId('save-reminders'));

    expect(await screen.findByTestId('reminders-saved')).toBeOnTheScreen();
    const days = new Set(fakes.scheduler.scheduled.map((r) => r.at.getDay()));
    expect(days.has(1)).toBe(false); // sin lunes
    expect(fakes.scheduler.scheduled.every((r) => r.at.getHours() === 19 && r.at.getMinutes() === 30)).toBe(true);
  });

  it('AC-notify-001-07: cerrar sesión cancela todos los avisos del teléfono', async () => {
    fakes.scheduler.status = 'granted';
    await fakes.reminders.setEnabled('training', true);
    expect(fakes.scheduler.scheduled.length).toBeGreaterThan(0);
    await openApp('/mas');

    await press(await screen.findByTestId('sign-out'));
    await press(await screen.findByTestId('confirm-sign-out'));

    await waitFor(() => expect(fakes.scheduler.scheduled).toEqual([]));
  });

  it('AC-notify-001-08: tocar un aviso abre su pantalla', async () => {
    await openApp('/mas');
    await screen.findByTestId('go-reminders');

    fakes.scheduler.tap('/nutricion');

    expect(await screen.findByTestId('add-food')).toBeOnTheScreen();
  });
});

describe('Inteligencia artificial (SPEC-ai-001)', () => {
  it('AC-ai-001-13: «Más → Inteligencia artificial» muestra las funciones, qué se envía, el uso y el aviso de que no sustituye a un profesional', async () => {
    await openApp('/mas');
    await press(await screen.findByTestId('go-ai'));

    expect(await screen.findByTestId('ai-chat')).toHaveTextContent(/texto de tus preguntas/);
    expect(screen.getByTestId('ai-food_photo')).toHaveTextContent(/foto del plato/);
    expect(screen.getByTestId('ai-unavailable-food_photo')).toBeOnTheScreen();
    expect(screen.getByTestId('ai-usage-today')).toHaveTextContent(/Hoy: 1200 de 80000/);
    expect(screen.getByTestId('ai-usage-month')).toHaveTextContent(/Gasto del mes: 0,00 USD de 5,00 USD/);
    expect(screen.getByText(/no sustituyen a un profesional de la salud/)).toBeOnTheScreen();
  });

  it('AC-ai-001-02 y 13: activar una función la deja activada en la API y volver a pulsarla la retira', async () => {
    await openApp('/ai');

    await press(await screen.findByTestId('ai-toggle-chat'));
    await waitFor(() => expect(screen.getByTestId('ai-toggle-chat')).toHaveTextContent(/^Activada/));
    expect(fakes.remote.serverAi?.features.find((f) => f.feature === 'chat')?.consented).toBe(true);

    await press(screen.getByTestId('ai-toggle-chat'));
    await waitFor(() => expect(screen.getByTestId('ai-toggle-chat')).toHaveTextContent(/^Desactivada/));
  });

  it('AC-ai-001-13: sin conexión lo avisa y no ofrece nada que cambiar', async () => {
    fakes.remote.online = false;
    await openApp('/ai');

    expect(await screen.findByTestId('ai-offline')).toBeOnTheScreen();
    expect(screen.queryByTestId('ai-toggle-chat')).not.toBeOnTheScreen();
  });
});

describe('Análisis y planes con IA (SPEC-ai-002)', () => {
  const analysis = {
    scope: 'training' as const, kind: 'proposal' as const, disclaimer: 'Orientativo: la app no diagnostica ni sustituye a un profesional de la salud.',
    sections: [{
      title: 'Volumen',
      claims: [
        { text: 'Entrenaste 3 sesiones.', kind: 'registrado' as const, source: 'entrenamiento_semanal', verified: true },
        { text: 'Pesaste 91 kg.', kind: 'inferencia' as const, source: '', verified: false },
      ],
    }],
  };
  const proposal = (over: Record<string, unknown> = {}) => ({
    id: 'p1', scope: 'training' as const, kind: 'proposal' as const, summary: 'Cambio de variante', status: 'pending' as const, createdAt: '2026-11-23T10:00:00Z',
    changes: [{ kind: 'replace_exercise' as const, reason: 'Variar el estímulo', day: 'Monday', fromExerciseId: 'a', toExerciseId: 'b', toExerciseName: 'Press con barra' }],
    ...over,
  });

  it('AC-ai-002-06: el análisis muestra cada afirmación con su tipo y su fuente y marca lo que no se pudo comprobar', async () => {
    fakes.remote.analysisResult = { kind: 'ok', value: analysis };
    await openApp('/assistant');

    await press(await screen.findByTestId('ask-analysis'));

    expect(await screen.findByTestId('claim-Volumen-0')).toHaveTextContent(/Dato registrado · fuente: entrenamiento_semanal/);
    expect(screen.getByTestId('claim-Volumen-1')).toHaveTextContent(/Inferencia · no se pudo comprobar con tus datos/);
    expect(screen.getByText(/Sugerencia de IA/)).toBeOnTheScreen();
    expect(screen.getByText(/Nada se aplica solo/)).toBeOnTheScreen();
  });

  it('AC-ai-002-06 y 10: una propuesta no se aplica sola; al aceptarla se aplica y pasa al historial, y al rechazar otra también', async () => {
    fakes.remote.serverProposals = [proposal(), proposal({ id: 'p2', summary: 'Otra' })];
    await openApp('/assistant');
    expect(await screen.findByTestId('proposal-p1')).toHaveTextContent(/Sugerencia de IA/);
    expect(screen.getByTestId('proposal-p1')).toHaveTextContent(/El lunes: sustituir un ejercicio por «Press con barra»/);
    expect(fakes.remote.resolved).toEqual([]);

    await press(screen.getByTestId('accept-p1'));
    await waitFor(() => expect(screen.queryByTestId('proposal-p1')).not.toBeOnTheScreen());
    await press(screen.getByTestId('reject-p2'));

    await waitFor(() => expect(screen.getByTestId('past-p2')).toHaveTextContent(/Rechazada · entrenamiento: Otra/));
    expect(screen.getByTestId('past-p1')).toHaveTextContent(/Aceptada/);
    expect(fakes.remote.resolved).toEqual([{ id: 'p1', action: 'accept' }, { id: 'p2', action: 'reject' }]);
  });

  it('AC-ai-002-08: sin consentimiento lo explica y lleva a los ajustes de la IA; sin conexión lo avisa', async () => {
    fakes.remote.analysisResult = { kind: 'error', code: 'consent_required', message: 'x', retryAfterSeconds: null };
    await openApp('/assistant');

    await press(await screen.findByTestId('ask-analysis'));

    expect(await screen.findByTestId('assistant-message')).toHaveTextContent(/Activa «Análisis y planes» en Inteligencia artificial/);
    expect(screen.getByTestId('go-ai-settings')).toBeOnTheScreen();

    fakes.remote.online = false;
    await press(screen.getByTestId('ask-plan'));
    await waitFor(() => expect(screen.getByTestId('assistant-message')).toHaveTextContent(/La IA necesita conexión\./));
  });

  it('AC-ai-002-08: con la cuota agotada dice cuándo reintentar y el resto de la app sigue funcionando', async () => {
    fakes.remote.planResult = { kind: 'error', code: 'provider_quota', message: 'x', retryAfterSeconds: 60 };
    await openApp('/assistant');

    await press(await screen.findByTestId('ask-plan'));

    expect(await screen.findByTestId('assistant-message')).toHaveTextContent(/Reintenta en 60 s/);
  });
});
