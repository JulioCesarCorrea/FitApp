// Recordatorios locales (SPEC-notify-001, P5): se programan en el teléfono y no salen de él. Nada de servidor push. El texto de
// cada aviso es genérico (sin datos personales ni de salud). Esta lógica no importa expo-notifications: el programador real se
// inyecta (notificationsScheduler.ts) y las pruebas usan uno en memoria.

import { localDate } from './nutritionService';
import type { LocalStore } from './types';

export type MealKey = 'desayuno' | 'almuerzo' | 'cena' | 'snack';
export const MEAL_KEYS: MealKey[] = ['desayuno', 'almuerzo', 'cena', 'snack'];

/** Días de la semana de lunes (1) a domingo (7). */
export const WEEKDAYS = [
  { value: 1, label: 'L' }, { value: 2, label: 'M' }, { value: 3, label: 'X' }, { value: 4, label: 'J' },
  { value: 5, label: 'V' }, { value: 6, label: 'S' }, { value: 7, label: 'D' },
];

export interface ReminderPrefs {
  training: { enabled: boolean; days: number[]; time: string };
  /** Hora de cada comida; null = sin recordatorio para esa comida. */
  meals: { enabled: boolean; times: Record<MealKey, string | null> };
  weight: { enabled: boolean; day: number; time: string };
}

export const DEFAULT_PREFS: ReminderPrefs = {
  training: { enabled: false, days: [1, 3, 5], time: '18:00' },
  meals: { enabled: false, times: { desayuno: '08:30', almuerzo: '14:00', cena: '21:00', snack: null } },
  weight: { enabled: false, day: 1, time: '08:00' },
};

export type ReminderKind = 'training' | 'meals' | 'weight';

/** Lo que la persona ya registró hoy: ese día no se le avisa de lo mismo (AC-notify-001-05). */
export interface RecordedToday {
  training: boolean;
  weight: boolean;
  meals: string[];
}

export interface ScheduledReminder {
  at: Date;
  title: string;
  body: string;
  /** Pantalla que abre al tocarlo. */
  route: string;
}

/** Programador de avisos del sistema (expo-notifications en la app, uno en memoria en las pruebas). */
export interface ReminderScheduler {
  permission(): Promise<'granted' | 'denied' | 'undetermined'>;
  requestPermission(): Promise<boolean>;
  cancelAll(): Promise<void>;
  schedule(reminder: ScheduledReminder): Promise<void>;
  /** Llama al manejador con la ruta cuando la persona toca un aviso; devuelve cómo dejar de escuchar. */
  onTap(handler: (route: string) => void): () => void;
}

/** iOS admite como máximo 64 avisos pendientes: se programa un margen de días por debajo de ese tope. */
export const HORIZON_DAYS = 14;
export const MAX_SCHEDULED = 60;

const TITLE = 'Fitness';

export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const at = (day: Date, time: string): Date => {
  const [h, m] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
};

/** Lunes = 1 … domingo = 7. */
const isoWeekday = (d: Date): number => ((d.getDay() + 6) % 7) + 1;

/**
 * AC-notify-001-02, 03, 04, 05 y 08: los avisos de los próximos días, uno por uno (no repetidos), sin los de hoy que ya están
 * registrados y sin los que ya pasaron. Así se puede saltar el de hoy y reprogramar al abrir la app (AC-06).
 */
export function planReminders(prefs: ReminderPrefs, now: Date, recorded: RecordedToday): ScheduledReminder[] {
  const out: ScheduledReminder[] = [];
  for (let offset = 0; offset < HORIZON_DAYS; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const today = offset === 0;

    if (prefs.training.enabled && prefs.training.days.includes(isoWeekday(day)) && !(today && recorded.training)) {
      out.push({ at: at(day, prefs.training.time), title: TITLE, body: 'Hoy toca entrenar.', route: '/rutina' });
    }
    if (prefs.meals.enabled) {
      for (const meal of MEAL_KEYS) {
        const time = prefs.meals.times[meal];
        if (!time || (today && recorded.meals.includes(meal))) continue;
        out.push({ at: at(day, time), title: TITLE, body: `Registra tu ${meal}.`, route: '/nutricion' });
      }
    }
    if (prefs.weight.enabled && isoWeekday(day) === prefs.weight.day && !(today && recorded.weight)) {
      out.push({ at: at(day, prefs.weight.time), title: TITLE, body: 'Es hora de registrar tu peso.', route: '/mas' });
    }
  }
  return out
    .filter((r) => r.at.getTime() > now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_SCHEDULED);
}

const SETTINGS_KEY = 'reminders';

export interface PrefsIssue {
  field: 'training' | 'meals' | 'weight';
  message: string;
}

/** Valida las horas y los días antes de guardar (formato HH:MM de 24 horas). */
export function validatePrefs(prefs: ReminderPrefs): PrefsIssue[] {
  const issues: PrefsIssue[] = [];
  if (!TIME_PATTERN.test(prefs.training.time)) issues.push({ field: 'training', message: 'La hora de entrenar se escribe HH:MM (por ejemplo 18:00).' });
  if (prefs.training.enabled && prefs.training.days.length === 0) issues.push({ field: 'training', message: 'Elige al menos un día para entrenar.' });
  for (const meal of MEAL_KEYS) {
    const t = prefs.meals.times[meal];
    if (t !== null && t !== '' && !TIME_PATTERN.test(t)) issues.push({ field: 'meals', message: `La hora de ${meal} se escribe HH:MM (por ejemplo 08:30).` });
  }
  if (prefs.meals.enabled && MEAL_KEYS.every((m) => !prefs.meals.times[m])) issues.push({ field: 'meals', message: 'Pon la hora de al menos una comida.' });
  if (!TIME_PATTERN.test(prefs.weight.time)) issues.push({ field: 'weight', message: 'La hora de pesarte se escribe HH:MM (por ejemplo 08:00).' });
  return issues;
}

export type ToggleResult = { ok: true } | { ok: false; message: string };

export class ReminderService {
  constructor(
    private readonly store: LocalStore,
    private readonly scheduler: ReminderScheduler,
    /** Pesos guardados en el teléfono (para saber si ya se pesó hoy). */
    private readonly weights: () => Promise<{ measuredAt: string }[]>,
    private readonly isSignedIn: () => boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getPrefs(): Promise<ReminderPrefs> {
    const stored = await this.store.getSetting(SETTINGS_KEY);
    if (!stored) return structuredClone(DEFAULT_PREFS);
    const parsed = JSON.parse(stored) as Partial<ReminderPrefs>;
    return {
      training: { ...DEFAULT_PREFS.training, ...parsed.training },
      meals: { enabled: parsed.meals?.enabled ?? false, times: { ...DEFAULT_PREFS.meals.times, ...parsed.meals?.times } },
      weight: { ...DEFAULT_PREFS.weight, ...parsed.weight },
    };
  }

  /**
   * AC-notify-001-01: al activar un tipo se pide el permiso del sistema en ese momento; si lo niega, queda apagado y se explica
   * cómo activarlo en los ajustes.
   */
  async setEnabled(kind: ReminderKind, enabled: boolean): Promise<ToggleResult> {
    if (enabled && (await this.scheduler.permission()) !== 'granted' && !(await this.scheduler.requestPermission())) {
      await this.save({ ...(await this.getPrefs()), [kind]: { ...(await this.getPrefs())[kind], enabled: false } });
      await this.refresh();
      return { ok: false, message: 'Sin el permiso de notificaciones no se pueden programar recordatorios. Actívalo en los ajustes del sistema, en Notificaciones.' };
    }
    const prefs = await this.getPrefs();
    await this.save({ ...prefs, [kind]: { ...prefs[kind], enabled } } as ReminderPrefs);
    await this.refresh();
    return { ok: true };
  }

  /** Guarda los horarios (ya validados) y reprograma. */
  async savePrefs(prefs: ReminderPrefs): Promise<PrefsIssue[]> {
    const issues = validatePrefs(prefs);
    if (issues.length > 0) return issues;
    await this.save(prefs);
    await this.refresh();
    return [];
  }

  private save(prefs: ReminderPrefs): Promise<void> {
    return this.store.setSetting(SETTINGS_KEY, JSON.stringify(prefs));
  }

  private async recordedToday(): Promise<RecordedToday> {
    const today = localDate(this.now());
    const logs = await this.store.getAllLogs();
    const entries = (await this.store.getFoodEntries(today)).filter((e) => e.pendingOp !== 'delete' && e.status !== 'rejected');
    const todayUtc = this.now().toISOString().slice(0, 10);
    return {
      training: logs.some((l) => l.date === today && l.pendingOp !== 'delete' && l.status !== 'rejected'),
      meals: [...new Set(entries.map((e) => e.meal))],
      weight: (await this.weights()).some((w) => w.measuredAt.slice(0, 10) === todayUtc),
    };
  }

  /**
   * AC-notify-001-02 a 07: deja programados exactamente los avisos que tocan (cancela los anteriores antes, así nunca hay
   * duplicados). Sin sesión, sin permiso o sin nada activado, no queda ninguno. Se llama al abrir la app, al volver a ella y al salir.
   */
  async refresh(): Promise<void> {
    await this.scheduler.cancelAll();
    if (!this.isSignedIn()) return;
    const prefs = await this.getPrefs();
    if (!prefs.training.enabled && !prefs.meals.enabled && !prefs.weight.enabled) return;
    if ((await this.scheduler.permission()) !== 'granted') return;
    for (const reminder of planReminders(prefs, this.now(), await this.recordedToday())) await this.scheduler.schedule(reminder);
  }

  /** AC-notify-001-07: al cerrar sesión o borrar la cuenta se cancelan todos los avisos del teléfono. */
  async cancelAll(): Promise<void> {
    await this.scheduler.cancelAll();
  }

  /** AC-notify-001-08: al tocar un aviso se abre su pantalla. */
  onTap(handler: (route: string) => void): () => void {
    return this.scheduler.onTap(handler);
  }
}
