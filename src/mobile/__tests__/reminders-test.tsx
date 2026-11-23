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
