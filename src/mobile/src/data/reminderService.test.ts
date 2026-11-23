import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryScheduler } from './memoryScheduler';
import { MemoryStore } from './memoryStore';
import {
  DEFAULT_PREFS, HORIZON_DAYS, MAX_SCHEDULED, planReminders, ReminderService, validatePrefs, type RecordedToday, type ReminderPrefs,
} from './reminderService';
import type { LocalExerciseLog } from './types';

// Jueves 2026-11-12 a las 10:00 (hora local).
const NOW = new Date(2026, 10, 12, 10, 0, 0);
const NONE: RecordedToday = { training: false, weight: false, meals: [] };

const prefs = (over: Partial<ReminderPrefs> = {}): ReminderPrefs => ({
  training: { enabled: false, days: [], time: '18:00' },
  meals: { enabled: false, times: { desayuno: null, almuerzo: null, cena: null, snack: null } },
  weight: { enabled: false, day: 1, time: '08:00' },
  ...over,
});

const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hour = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('qué avisos se programan (SPEC-notify-001)', () => {
  it('AC-notify-001-02 entrenar: solo los días elegidos y a su hora, sin repetidos, dentro del margen de días', () => {
    const plan = planReminders(prefs({ training: { enabled: true, days: [1, 3, 5], time: '18:00' } }), NOW, NONE);

    // Lunes 16, miércoles 18 y viernes 20 de noviembre y lunes 23, miércoles 25... hasta 14 días.
    expect(plan.map((r) => dateKey(r.at))).toEqual(['2026-11-13', '2026-11-16', '2026-11-18', '2026-11-20', '2026-11-23', '2026-11-25']);
    expect(new Set(plan.map((r) => r.at.getTime())).size).toBe(plan.length);
    expect(plan.every((r) => hour(r.at) === '18:00' && r.route === '/rutina')).toBe(true);
    expect(Math.max(...plan.map((r) => r.at.getTime())) - NOW.getTime()).toBeLessThan(HORIZON_DAYS * 86_400_000);
  });

  it('AC-notify-001-03 comidas: cada comida a su hora cada día, y sin hora no hay aviso', () => {
    const plan = planReminders(prefs({ meals: { enabled: true, times: { desayuno: '08:30', almuerzo: '14:00', cena: '21:00', snack: null } } }), NOW, NONE);

    const today = plan.filter((r) => dateKey(r.at) === '2026-11-12');
    expect(today.map((r) => [hour(r.at), r.body])).toEqual([['14:00', 'Registra tu almuerzo.'], ['21:00', 'Registra tu cena.']]); // el desayuno de hoy ya pasó
    expect(plan.filter((r) => dateKey(r.at) === '2026-11-13').map((r) => hour(r.at))).toEqual(['08:30', '14:00', '21:00']);
    expect(plan.every((r) => r.route === '/nutricion')).toBe(true);
  });

  it('AC-notify-001-04 peso: una vez por semana, el día y la hora elegidos', () => {
    const plan = planReminders(prefs({ weight: { enabled: true, day: 1, time: '08:00' } }), NOW, NONE); // lunes

    expect(plan.map((r) => dateKey(r.at))).toEqual(['2026-11-16', '2026-11-23']);
    expect(plan.every((r) => hour(r.at) === '08:00' && r.route === '/mas')).toBe(true);
  });

  it('AC-notify-001-05 lo ya registrado hoy no se avisa hoy pero sí los demás días', () => {
    const all = prefs({
      training: { enabled: true, days: [4], time: '18:00' }, // jueves = hoy
      meals: { enabled: true, times: { desayuno: '08:30', almuerzo: '14:00', cena: '21:00', snack: null } },
      weight: { enabled: true, day: 4, time: '20:00' },
    });

    const plan = planReminders(all, NOW, { training: true, weight: true, meals: ['almuerzo'] });

    const today = plan.filter((r) => dateKey(r.at) === '2026-11-12');
    expect(today.map((r) => r.body)).toEqual(['Registra tu cena.']); // sin entrenar, sin pesarse y sin almuerzo
    expect(plan.some((r) => dateKey(r.at) === '2026-11-19' && r.body === 'Hoy toca entrenar.')).toBe(true); // el jueves siguiente sí
  });

  it('AC-notify-001-08 el texto es genérico: no lleva datos personales ni de salud', () => {
    const all = prefs({
      training: { enabled: true, days: [1, 2, 3, 4, 5, 6, 7], time: '18:00' },
      meals: { enabled: true, times: { desayuno: '08:30', almuerzo: '14:00', cena: '21:00', snack: '17:00' } },
      weight: { enabled: true, day: 1, time: '08:00' },
    });

    const texts = new Set(planReminders(all, NOW, NONE).flatMap((r) => [r.title, r.body]));

    expect([...texts].sort()).toEqual([
      'Es hora de registrar tu peso.', 'Fitness', 'Hoy toca entrenar.', 'Registra tu almuerzo.', 'Registra tu cena.',
      'Registra tu desayuno.', 'Registra tu snack.',
    ]);
  });

  it('nunca programa más de MAX_SCHEDULED avisos (iOS admite 64) y se queda con los más próximos', () => {
    const all = prefs({
      training: { enabled: true, days: [1, 2, 3, 4, 5, 6, 7], time: '23:00' },
      meals: { enabled: true, times: { desayuno: '06:00', almuerzo: '13:00', cena: '20:00', snack: '16:00' } },
    });

    const plan = planReminders(all, NOW, NONE);

    expect(plan.length).toBe(MAX_SCHEDULED);
    expect(plan.map((r) => r.at.getTime())).toEqual([...plan.map((r) => r.at.getTime())].sort((a, b) => a - b));
  });

  it('con todo apagado no hay avisos', () => {
    expect(planReminders(DEFAULT_PREFS, NOW, NONE)).toEqual([]);
  });
});

describe('validación de horarios', () => {
  it.each(['25:00', '18:60', '1800', 'las 6', ''])('rechaza la hora «%s»', (time) => {
    expect(validatePrefs(prefs({ training: { enabled: false, days: [], time } })).length).toBeGreaterThan(0);
  });

  it('acepta horas de 24 horas y pide al menos un día o una comida cuando el tipo está activado', () => {
    expect(validatePrefs(prefs({ training: { enabled: true, days: [1], time: '07:05' } }))).toEqual([]);
    expect(validatePrefs(prefs({ training: { enabled: true, days: [], time: '07:05' } })).map((i) => i.field)).toEqual(['training']);
    expect(validatePrefs(prefs({ meals: { enabled: true, times: { desayuno: null, almuerzo: null, cena: null, snack: null } } })).map((i) => i.field)).toEqual(['meals']);
  });
});

describe('ReminderService (AC-notify-001-01, 02, 06, 07 y 09)', () => {
  let store: MemoryStore;
  let scheduler: MemoryScheduler;
  let signedIn: boolean;
  let weights: { measuredAt: string }[];
  let service: ReminderService;

  const log = (date: string): LocalExerciseLog => ({
    id: `l-${date}`, exerciseId: 'e', date, loadKg: 20, firstSetReps: 9, secondSetReps: 8, secondSetAssistedReps: 5,
    status: 'synced', message: null, pendingOp: null, attempted: true,
  });

  beforeEach(() => {
    store = new MemoryStore();
    scheduler = new MemoryScheduler();
    signedIn = true;
    weights = [];
    service = new ReminderService(store, scheduler, async () => weights, () => signedIn, () => NOW);
  });

  it('AC-notify-001-01 al activar un tipo pide el permiso en ese momento y, si lo concede, programa', async () => {
    expect(scheduler.permissionRequests).toBe(0);

    const result = await service.setEnabled('training', true);

    expect(result).toEqual({ ok: true });
    expect(scheduler.permissionRequests).toBe(1);
    expect((await service.getPrefs()).training.enabled).toBe(true);
    expect(scheduler.scheduled.length).toBeGreaterThan(0);
  });

  it('AC-notify-001-01 si niega el permiso, el interruptor vuelve a apagado y se explica cómo activarlo', async () => {
    scheduler.willGrant = false;

    const result = await service.setEnabled('meals', true);

    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.message).toMatch(/ajustes del sistema/);
    expect((await service.getPrefs()).meals.enabled).toBe(false);
    expect(scheduler.scheduled).toEqual([]);
  });

  it('AC-notify-001-01 con el permiso ya concedido no vuelve a pedirlo', async () => {
    scheduler.status = 'granted';

    await service.setEnabled('weight', true);
    await service.setEnabled('training', true);

    expect(scheduler.permissionRequests).toBe(0);
  });

  it('AC-notify-001-02 cambiar los días reprograma sin duplicados y apagarlo cancela todo', async () => {
    scheduler.status = 'granted';
    await service.setEnabled('training', true);
    const first = scheduler.scheduled.length;

    await service.savePrefs({ ...(await service.getPrefs()), training: { enabled: true, days: [1], time: '19:30' } });

    expect(scheduler.scheduled.length).toBeLessThan(first);
    expect(scheduler.scheduled.every((r) => hour(r.at) === '19:30')).toBe(true);
    expect(new Set(scheduler.scheduled.map((r) => r.at.getTime())).size).toBe(scheduler.scheduled.length);

    await service.setEnabled('training', false);

    expect(scheduler.scheduled).toEqual([]);
  });

  it('AC-notify-001-02 guardar horarios inválidos no cambia nada y devuelve los motivos', async () => {
    scheduler.status = 'granted';
    await service.setEnabled('training', true);
    const before = scheduler.scheduled.length;

    const issues = await service.savePrefs({ ...(await service.getPrefs()), training: { enabled: true, days: [1], time: '99:99' } });

    expect(issues.map((i) => i.message)).toEqual(['La hora de entrenar se escribe HH:MM (por ejemplo 18:00).']);
    expect(scheduler.scheduled.length).toBe(before);
    expect((await service.getPrefs()).training.time).toBe('18:00');
  });

  it('AC-notify-001-05 un registro de hoy quita el aviso de hoy al reprogramar', async () => {
    scheduler.status = 'granted';
    await service.savePrefs({ ...DEFAULT_PREFS, training: { enabled: true, days: [4], time: '18:00' } });
    expect(scheduler.scheduled.some((r) => dateKey(r.at) === '2026-11-12')).toBe(true);

    await store.saveLog(log('2026-11-12'));
    await service.refresh();

    expect(scheduler.scheduled.some((r) => dateKey(r.at) === '2026-11-12')).toBe(false);
    expect(scheduler.scheduled.some((r) => dateKey(r.at) === '2026-11-19')).toBe(true);
  });

  it('AC-notify-001-05 un peso de hoy quita el aviso del peso de hoy', async () => {
    scheduler.status = 'granted';
    await service.savePrefs({ ...DEFAULT_PREFS, weight: { enabled: true, day: 4, time: '20:00' } });
    weights = [{ measuredAt: NOW.toISOString() }];

    await service.refresh();

    expect(scheduler.scheduled.some((r) => dateKey(r.at) === '2026-11-12')).toBe(false);
  });

  it('AC-notify-001-06 las preferencias se guardan y refresh reprograma lo que falte (al reiniciar o actualizar la app)', async () => {
    scheduler.status = 'granted';
    await service.setEnabled('training', true);
    scheduler.scheduled = []; // el sistema perdió los avisos

    await service.refresh();

    expect(scheduler.scheduled.length).toBeGreaterThan(0);
    expect((await service.getPrefs()).training.days).toEqual([1, 3, 5]);
  });

  it('AC-notify-001-07 sin sesión no queda ningún aviso y cancelAll los quita', async () => {
    scheduler.status = 'granted';
    await service.setEnabled('training', true);

    signedIn = false;
    await service.refresh();
    expect(scheduler.scheduled).toEqual([]);

    signedIn = true;
    await service.refresh();
    expect(scheduler.scheduled.length).toBeGreaterThan(0);
    await service.cancelAll();
    expect(scheduler.scheduled).toEqual([]);
  });

  it('AC-notify-001-07 al borrar los datos de la cuenta se pierden las preferencias', async () => {
    scheduler.status = 'granted';
    await service.setEnabled('training', true);

    await store.clearUserData();

    expect((await service.getPrefs()).training.enabled).toBe(false);
  });

  it('AC-notify-001-08 al tocar un aviso se llama al manejador con su pantalla', () => {
    const opened: string[] = [];
    const stop = service.onTap((route) => opened.push(route));

    scheduler.tap('/rutina');
    stop();
    scheduler.tap('/mas');

    expect(opened).toEqual(['/rutina']);
  });

  it('AC-notify-001-09 sin permiso concedido no se programa nada aunque haya preferencias (todo es local, sin conexión)', async () => {
    await store.setSetting('reminders', JSON.stringify({ ...DEFAULT_PREFS, training: { enabled: true, days: [1], time: '18:00' } }));

    await service.refresh();

    expect(scheduler.scheduled).toEqual([]);
  });
});
