import { beforeEach, describe, expect, it } from 'vitest';
import { describeSyncReport } from './format';
import { MemoryStore } from './memoryStore';
import { SessionService, parseDraft, type RawLogInput } from './sessionService';
import type {
  CatalogExercise, EquipmentProfile, LocalExerciseLog, PutLogResult, RemoteApi, ServerExerciseLog,
} from './types';

const TODAY = '2026-10-30';

const exercise = (equipment: string, id = 'press-plano-con-mancuernas', bar: string | null = null): CatalogExercise => ({
  id, name: id, primaryZone: 'pecho', secondaryZones: [], movements: [], equipment, bar, images: [],
});
const DUMBBELL = exercise('Mancuernas');
const BODYWEIGHT = exercise('PesoCorporal', 'fondos-en-paralelas-para-pecho');
const MACHINE = exercise('Maquina', 'press-inclinado-en-maquina');

const PROFILE: EquipmentProfile = {
  dumbbellsKg: [20, 22.5, 25], barsKg: { recta: 20 }, discsKg: [2.5, 5], machineStepKg: 5, machineBaseKg: 0,
};

const raw = (over: Partial<RawLogInput> = {}): RawLogInput => ({
  date: '2026-10-29', load: '22.5', first: '9', second: '5', assisted: '5', ...over,
});

interface Fake extends RemoteApi {
  online: boolean;
  calls: string[];
  server: Map<string, ServerExerciseLog>;
  putResult: PutLogResult | null;
  settingsOnServer: number;
  settingsPutResult: PutLogResult | null;
}

function fakeRemote(): Fake {
  const r: Fake = {
    online: true,
    calls: [],
    server: new Map(),
    putResult: null,
    settingsOnServer: 3,
    settingsPutResult: null,
    fetchCatalog: async () => null,
    fetchPlan: async () => null,
    fetchEquipment: async () => null,
    putDay: async () => ({ kind: 'retry' }),
    putEquipment: async () => ({ kind: 'retry' }),
    imageUrl: (p) => p,
    putLog: async (log) => {
      if (!r.online) return { kind: 'retry' };
      r.calls.push(`put:${log.id}`);
      if (r.putResult) return r.putResult;
      const clash = [...r.server.values()].find(
        (s) => s.id !== log.id && s.exerciseId === log.exerciseId && s.date === log.date,
      );
      if (clash) return { kind: 'rejected', reason: 'Ya hay un registro de este ejercicio en esa fecha.' };
      r.server.set(log.id, {
        id: log.id, exerciseId: log.exerciseId, date: log.date, loadKg: log.loadKg,
        firstSetReps: log.firstSetReps, secondSetReps: log.secondSetReps, secondSetAssistedReps: log.secondSetAssistedReps,
      });
      return { kind: 'ok' };
    },
    deleteLog: async (id) => {
      if (!r.online) return 'retry';
      r.calls.push(`delete:${id}`);
      r.server.delete(id);
      return 'ok';
    },
    fetchHistory: async (exerciseId) =>
      r.online
        ? [...r.server.values()].filter((s) => s.exerciseId === exerciseId).sort((a, b) => a.date.localeCompare(b.date))
        : null,
    fetchTrainingSettings: async () => (r.online ? r.settingsOnServer : null),
    putTrainingSettings: async (n) => {
      if (!r.online) return { kind: 'retry' };
      r.calls.push(`settings:${n}`);
      if (r.settingsPutResult) return r.settingsPutResult;
      r.settingsOnServer = n;
      return { kind: 'ok' };
    },
  };
  return r;
}

let store: MemoryStore;
let remote: Fake;
let service: SessionService;

beforeEach(async () => {
  let n = 0;
  store = new MemoryStore();
  remote = fakeRemote();
  service = new SessionService(store, remote, () => `log-${++n}`, () => TODAY);
  await store.saveEquipment(PROFILE);
});

const visible = async (e = DUMBBELL) => service.loadHistory(e.id);

const seed = (over: Partial<LocalExerciseLog> & { id: string }): LocalExerciseLog => {
  const log: LocalExerciseLog = {
    exerciseId: DUMBBELL.id, date: '2026-10-01', loadKg: 22.5, firstSetReps: 9, secondSetReps: 5, secondSetAssistedReps: 5,
    status: 'synced', message: null, pendingOp: null, attempted: true, ...over,
  };
  return log;
};

/** Deja registros ya sincronizados (en el servidor y en el teléfono), uno por semana, del más antiguo al más reciente. */
async function seedHistory(rows: { load: number; first: number; second: number; assisted?: number }[], e = DUMBBELL) {
  for (const [i, r] of rows.entries()) {
    const date = new Date(Date.UTC(2026, 8, 1 + 7 * i)).toISOString().slice(0, 10);
    const log = seed({
      id: `seed-${e.id}-${i}`, exerciseId: e.id, date, loadKg: r.load,
      firstSetReps: r.first, secondSetReps: r.second, secondSetAssistedReps: r.assisted ?? 5,
    });
    await store.saveLog(log);
    remote.server.set(log.id, {
      id: log.id, exerciseId: log.exerciseId, date: log.date, loadKg: log.loadKg,
      firstSetReps: log.firstSetReps, secondSetReps: log.secondSetReps, secondSetAssistedReps: log.secondSetAssistedReps,
    });
  }
}

describe('registrar (AC-mobile-003-01, 02, 03)', () => {
  it('AC-mobile-003-01 guarda primero en el teléfono con un UUID del dispositivo y lo envía con ese id', async () => {
    const result = await service.save(DUMBBELL, raw());

    expect(result.ok).toBe(true);
    expect(remote.calls).toEqual(['put:log-1']);
    const [saved] = await visible();
    expect(saved).toMatchObject({
      id: 'log-1', date: '2026-10-29', loadKg: 22.5, firstSetReps: 9, secondSetReps: 5, secondSetAssistedReps: 5,
      status: 'synced', pendingOp: null,
    });
  });

  it.each([
    ['serie 1 en 13', { first: '13' }, 'first'],
    ['serie 1 en 0', { first: '0' }, 'first'],
    ['serie 1 vacía', { first: '' }, 'first'],
    ['serie 1 con decimales', { first: '9.5' }, 'first'],
    ['serie 2 sin repeticiones propias', { second: '0' }, 'second'],
    ['asistidas negativas', { assisted: '-1' }, 'assisted'],
    ['carga 0 en un ejercicio con carga', { load: '0' }, 'load'],
    ['carga negativa', { load: '-5' }, 'load'],
    ['carga con 3 decimales', { load: '22.555' }, 'load'],
    ['carga que no es un número', { load: 'abc' }, 'load'],
    ['carga vacía', { load: '' }, 'load'],
    ['fecha posterior a mañana', { date: '2026-11-01' }, 'date'],
    ['fecha con formato incorrecto', { date: '30/10/2026' }, 'date'],
    ['fecha que no existe', { date: '2026-02-30' }, 'date'],
  ] as const)('AC-mobile-003-02 rechaza %s y no guarda nada', async (_name, over, field) => {
    const result = await service.save(DUMBBELL, raw(over));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.field)).toContain(field);
    expect(await visible()).toEqual([]);
    expect(remote.calls).toEqual([]);
  });

  it('AC-mobile-003-02 acepta la coma decimal y las asistidas vacías (valen 0)', async () => {
    const result = await service.save(DUMBBELL, raw({ load: '22,5', assisted: '' }));

    expect(result.ok).toBe(true);
    expect((await visible())[0]).toMatchObject({ loadKg: 22.5, secondSetAssistedReps: 0 });
  });

  it('AC-mobile-003-02 mañana se acepta por las zonas horarias', async () => {
    expect((await service.save(DUMBBELL, raw({ date: '2026-10-31' }))).ok).toBe(true);
  });

  it('AC-mobile-003-02 en peso corporal la carga es el lastre y puede ser 0 (o vacía)', async () => {
    expect(parseDraft(BODYWEIGHT, raw({ load: '0' }), TODAY)).toMatchObject({ ok: true, draft: { loadKg: 0 } });
    expect(parseDraft(BODYWEIGHT, raw({ load: '' }), TODAY)).toMatchObject({ ok: true, draft: { loadKg: 0 } });
    expect(parseDraft(BODYWEIGHT, raw({ load: '-2' }), TODAY).ok).toBe(false);
  });

  it('AC-mobile-003-03 sin conexión queda pendiente y al volver la red se envía una sola vez con el mismo id', async () => {
    remote.online = false;
    await service.save(DUMBBELL, raw());

    expect((await visible())[0]).toMatchObject({ id: 'log-1', status: 'pending', pendingOp: 'upsert' });
    expect(remote.calls).toEqual([]);

    remote.online = true;
    await service.syncPending();
    await service.syncPending();

    expect(remote.calls).toEqual(['put:log-1']);
    expect((await visible())[0]).toMatchObject({ status: 'synced', pendingOp: null });
  });
});

describe('editar (AC-mobile-003-04)', () => {
  it('AC-mobile-003-04 editar un registro ya enviado lo reenvía con el mismo id y los datos nuevos', async () => {
    await service.save(DUMBBELL, raw());

    await service.save(DUMBBELL, raw({ load: '25', first: '12', second: '8' }), 'log-1');

    expect(remote.calls).toEqual(['put:log-1', 'put:log-1']);
    expect(remote.server.get('log-1')).toMatchObject({ loadKg: 25, firstSetReps: 12, secondSetReps: 8 });
    expect(await visible()).toHaveLength(1);
  });

  it('AC-mobile-003-04 varias ediciones sin conexión se envían como un solo PUT con los últimos datos', async () => {
    remote.online = false;
    await service.save(DUMBBELL, raw());
    await service.save(DUMBBELL, raw({ load: '25' }), 'log-1');
    await service.save(DUMBBELL, raw({ load: '27.5', second: '7' }), 'log-1');

    remote.online = true;
    await service.syncPending();

    expect(remote.calls).toEqual(['put:log-1']);
    expect(remote.server.get('log-1')).toMatchObject({ loadKg: 27.5, secondSetReps: 7 });
  });

  it('AC-mobile-003-04 se puede cambiar la fecha de un registro propio', async () => {
    await service.save(DUMBBELL, raw({ date: '2026-10-28' }));

    await service.save(DUMBBELL, raw({ date: '2026-10-27' }), 'log-1');

    expect((await visible())[0].date).toBe('2026-10-27');
  });
});

describe('borrar (AC-mobile-003-05, 06)', () => {
  it('AC-mobile-003-05 borrar quita el registro del historial de inmediato y envía DELETE', async () => {
    await service.save(DUMBBELL, raw());

    await service.remove('log-1');

    expect(await visible()).toEqual([]);
    expect(remote.calls).toEqual(['put:log-1', 'delete:log-1']);
    expect(remote.server.size).toBe(0);
  });

  it('AC-mobile-003-05 si nunca se intentó enviar, borrar no envía nada', async () => {
    await store.saveLog(seed({ id: 'nuevo', status: 'pending', pendingOp: 'upsert', attempted: false }));

    await service.remove('nuevo');

    expect(await store.getLogs(DUMBBELL.id)).toEqual([]);
    expect(remote.calls).toEqual([]);
  });

  it('AC-mobile-003-05 si ya se intentó enviar, borrar sin conexión envía DELETE al volver la red', async () => {
    remote.online = false;
    await service.save(DUMBBELL, raw());
    await service.remove('log-1');

    expect(await visible()).toEqual([]);
    remote.online = true;
    await service.syncPending();
    await service.syncPending();

    expect(remote.calls).toEqual(['delete:log-1']);
  });

  it('AC-mobile-003-05 editar y luego borrar sin conexión envía solo el DELETE', async () => {
    await service.save(DUMBBELL, raw());
    remote.calls.length = 0;
    remote.online = false;
    await service.save(DUMBBELL, raw({ load: '25' }), 'log-1');
    await service.remove('log-1');

    remote.online = true;
    await service.syncPending();

    expect(remote.calls).toEqual(['delete:log-1']);
  });

  it('AC-mobile-003-06 los borrados se envían antes que los guardados, para que no choquen el mismo día', async () => {
    await service.save(DUMBBELL, raw({ date: '2026-10-28' })); // log-1, ya en el servidor
    remote.calls.length = 0;
    remote.online = false;
    await service.remove('log-1');
    await service.save(DUMBBELL, raw({ date: '2026-10-28', load: '25' })); // log-2, mismo día

    remote.online = true;
    await service.syncPending();

    expect(remote.calls).toEqual(['delete:log-1', 'put:log-2']);
    expect((await visible()).map((l) => [l.id, l.status])).toEqual([['log-2', 'synced']]);
  });

  it('AC-mobile-003-06 ante un fallo de red se detiene y no sigue insistiendo', async () => {
    remote.online = false;
    await service.save(DUMBBELL, raw({ date: '2026-10-27' }));
    await service.save(DUMBBELL, raw({ date: '2026-10-28' }));
    let attempts = 0;
    const original = remote.putLog;
    remote.putLog = async (log) => {
      attempts++;
      return original(log);
    };

    await service.syncPending();

    expect(attempts).toBe(1);
  });
});

describe('rechazos y duplicados (AC-mobile-003-07, 08)', () => {
  it('AC-mobile-003-07 un rechazo de la API queda visible con el motivo y no se reintenta solo', async () => {
    remote.putResult = { kind: 'rejected', reason: 'El ejercicio no existe en el catálogo.' };
    await service.save(DUMBBELL, raw());
    remote.calls.length = 0;

    await service.syncPending();
    await service.syncPending();

    expect((await visible())[0]).toMatchObject({ status: 'rejected', message: 'El ejercicio no existe en el catálogo.' });
    expect(remote.calls).toEqual([]);
  });

  it('AC-mobile-003-07 editar un registro rechazado lo vuelve a enviar', async () => {
    remote.putResult = { kind: 'rejected', reason: 'No válido.' };
    await service.save(DUMBBELL, raw());
    remote.putResult = null;

    await service.save(DUMBBELL, raw({ load: '25' }), 'log-1');

    expect((await visible())[0]).toMatchObject({ status: 'synced', loadKg: 25, message: null });
  });

  it('AC-mobile-003-07 descartar un registro rechazado quita el cambio y vuelve a la versión del servidor', async () => {
    await service.save(DUMBBELL, raw({ load: '22.5' }));
    remote.putResult = { kind: 'rejected', reason: 'No válido.' };
    await service.save(DUMBBELL, raw({ load: '25' }), 'log-1');
    remote.putResult = null;

    await service.discard('log-1');
    const history = await visible();

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: 'log-1', loadKg: 22.5, status: 'synced' });
  });

  it('AC-mobile-003-07 un registro rechazado no cuenta para el consejo ni el estancamiento', async () => {
    await seedHistory([{ load: 22.5, first: 9, second: 5 }]);
    remote.putResult = { kind: 'rejected', reason: 'No válido.' };
    await service.save(DUMBBELL, raw({ date: '2026-10-29', load: '22.5', first: '12', second: '8' }));

    const advice = await service.getAdvice(DUMBBELL);

    expect(advice?.advice.action).toBe('mantener');
    expect(advice?.advice.nextLoadKg).toBe(22.5);
    expect(advice?.firstSetEvaluation).toBe('meta_alcanzada');
  });

  it('AC-mobile-003-08 otro registro del mismo ejercicio y fecha se bloquea y ofrece editar el existente', async () => {
    await service.save(DUMBBELL, raw({ date: '2026-10-28' }));

    const result = await service.save(DUMBBELL, raw({ date: '2026-10-28', load: '25' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => i.field)).toContain('date');
      expect(result.duplicateOf).toBe('log-1');
    }
    expect(await visible()).toHaveLength(1);
  });

  it('AC-mobile-003-08 el mismo día en ejercicios distintos es válido, y editar el propio registro también', async () => {
    await service.save(DUMBBELL, raw({ date: '2026-10-28' }));

    expect((await service.save(MACHINE, raw({ date: '2026-10-28' }))).ok).toBe(true);
    expect((await service.save(DUMBBELL, raw({ date: '2026-10-28', load: '25' }), 'log-1')).ok).toBe(true);
  });

  it('AC-mobile-003-08 un registro que espera borrarse no bloquea registrar de nuevo ese día', async () => {
    await service.save(DUMBBELL, raw({ date: '2026-10-28' }));
    remote.online = false;
    await service.remove('log-1');

    expect((await service.save(DUMBBELL, raw({ date: '2026-10-28', load: '25' }))).ok).toBe(true);
  });
});

describe('consejo de carga (AC-mobile-003-09)', () => {
  it('AC-mobile-003-09 sube a la siguiente carga del equipo cuando se cumple la regla, sin conexión', async () => {
    remote.online = false;
    await service.save(DUMBBELL, raw({ load: '22.5', first: '12', second: '8' }));

    const advice = await service.getAdvice(DUMBBELL);

    expect(advice?.advice).toEqual({ action: 'subir', nextLoadKg: 25, missingLoadData: false });
    expect(advice?.firstSetEvaluation).toBe('techo');
    expect(advice?.needsEquipment).toBe(false);
  });

  it('AC-mobile-003-09 mantiene si no se cumple la regla', async () => {
    await service.save(DUMBBELL, raw({ first: '11', second: '9' }));

    expect((await service.getAdvice(DUMBBELL))?.advice.action).toBe('mantener');
  });

  it('AC-mobile-003-09 sin carga superior mantiene y marca que falta el dato', async () => {
    await service.save(DUMBBELL, raw({ load: '25', first: '12', second: '8' }));

    expect((await service.getAdvice(DUMBBELL))?.advice).toEqual({ action: 'mantener', nextLoadKg: 25, missingLoadData: true });
  });

  it('AC-mobile-003-09 sin perfil de equipamiento avisa de que hay que configurarlo', async () => {
    store = new MemoryStore();
    service = new SessionService(store, remote, () => 'x', () => TODAY);
    await service.save(DUMBBELL, raw({ load: '22.5', first: '12', second: '8' }));

    const advice = await service.getAdvice(DUMBBELL);

    expect(advice?.advice.action).toBe('mantener');
    expect(advice?.advice.missingLoadData).toBe(true);
    expect(advice?.needsEquipment).toBe(true);
  });

  it('AC-mobile-003-09 en peso corporal siempre mantiene, sin marcar dato faltante', async () => {
    await service.save(BODYWEIGHT, raw({ load: '0', first: '12', second: '9' }));

    const advice = await service.getAdvice(BODYWEIGHT);

    expect(advice?.advice).toEqual({ action: 'mantener', nextLoadKg: 0, missingLoadData: false });
    expect(advice?.needsEquipment).toBe(false);
  });

  it('AC-mobile-003-09 una máquina usa el escalón propio que la persona puso en su rutina', async () => {
    await store.saveDay('martes', [{ id: 'p1', exerciseId: MACHINE.id, order: 0, machineStepKg: 2.5 }]);
    await service.save(MACHINE, raw({ load: '10', first: '12', second: '8' }));

    expect((await service.getAdvice(MACHINE))?.advice.nextLoadKg).toBe(12.5);
  });

  it('AC-mobile-003-09 una máquina sin escalón propio usa el del perfil', async () => {
    await service.save(MACHINE, raw({ load: '10', first: '12', second: '8' }));

    expect((await service.getAdvice(MACHINE))?.advice.nextLoadKg).toBe(15);
  });

  it('AC-mobile-003-09 usa el último registro por fecha, aunque se haya guardado antes', async () => {
    await service.save(DUMBBELL, raw({ date: '2026-10-29', load: '20', first: '9', second: '5' }));
    await service.save(DUMBBELL, raw({ date: '2026-10-20', load: '22.5', first: '12', second: '8' }));

    const advice = await service.getAdvice(DUMBBELL);

    expect(advice?.advice).toEqual({ action: 'mantener', nextLoadKg: 20, missingLoadData: false });
  });

  it('AC-mobile-003-09 un registro que espera borrarse ya no cuenta', async () => {
    await service.save(DUMBBELL, raw({ load: '22.5', first: '12', second: '8' }));
    remote.online = false;
    await service.remove('log-1');

    expect(await service.getAdvice(DUMBBELL)).toBeNull();
  });

  it('AC-mobile-003-09 sin registros no hay consejo', async () => {
    expect(await service.getAdvice(DUMBBELL)).toBeNull();
  });
});

describe('estancamiento y umbral (AC-mobile-003-10, 11)', () => {
  const sameFour = [
    { load: 22.5, first: 9, second: 5 }, { load: 22.5, first: 9, second: 5 },
    { load: 22.5, first: 9, second: 5 }, { load: 22.5, first: 9, second: 5 },
  ];

  it('AC-mobile-003-10 avisa tras 3 sesiones sin mejorar con el umbral por defecto', async () => {
    await seedHistory(sameFour);

    const stagnation = (await service.getAdvice(DUMBBELL))?.stagnation;

    expect(stagnation).toMatchObject({ isStagnant: true, sessionsWithoutProgress: 3 });
    expect(stagnation?.message).toBe('Llevas 3 sesiones sin mejorar en este ejercicio.');
  });

  it('AC-mobile-003-10 bajar de carga reinicia la racha y subirla cuenta como progreso', async () => {
    await seedHistory([...sameFour, { load: 20, first: 9, second: 5 }]);
    expect((await service.getAdvice(DUMBBELL))?.stagnation.isStagnant).toBe(false);
  });

  it('AC-mobile-003-10 las repeticiones asistidas no cuentan como progreso', async () => {
    await seedHistory([
      { load: 22.5, first: 9, second: 5, assisted: 3 }, { load: 22.5, first: 9, second: 5, assisted: 4 },
      { load: 22.5, first: 9, second: 5, assisted: 5 }, { load: 22.5, first: 9, second: 5, assisted: 6 },
    ]);
    expect((await service.getAdvice(DUMBBELL))?.stagnation.isStagnant).toBe(true);
  });

  it('AC-mobile-003-11 usa el umbral de la persona', async () => {
    await seedHistory(sameFour.slice(0, 3));
    expect((await service.getAdvice(DUMBBELL))?.stagnation.isStagnant).toBe(false);

    await service.setThreshold(2);

    expect((await service.getAdvice(DUMBBELL))?.stagnation).toMatchObject({ isStagnant: true, sessionsWithoutProgress: 2 });
  });

  it('AC-mobile-003-11 el umbral por defecto es 3', async () => {
    expect(await service.getThreshold()).toBe(3);
  });

  it.each(['1', '11', '0', '-3', '2.5', 'abc', ''])('AC-mobile-003-11 rechaza el umbral «%s» con el motivo', async (text) => {
    const result = await service.setThreshold(text);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/entre 2 y 10/);
    expect(await service.getThreshold()).toBe(3);
    expect(remote.calls).toEqual([]);
  });

  it('AC-mobile-003-11 guarda en el teléfono y lo envía a la API', async () => {
    const result = await service.setThreshold('5');

    expect(result).toEqual({ ok: true, value: 5 });
    expect(await service.getThreshold()).toBe(5);
    expect(remote.calls).toEqual(['settings:5']);
    expect(await service.getThresholdStatus()).toEqual({ status: 'synced', message: null });
  });

  it('AC-mobile-003-11 sin conexión lo usa de inmediato y lo envía al volver la red, una sola vez', async () => {
    remote.online = false;
    await service.setThreshold('7');

    expect(await service.getThreshold()).toBe(7);
    expect((await service.getThresholdStatus()).status).toBe('pending');

    remote.online = true;
    await service.syncSettings();
    await service.syncSettings();

    expect(remote.calls).toEqual(['settings:7']);
    expect((await service.getThresholdStatus()).status).toBe('synced');
  });

  it('AC-mobile-003-11 si la API lo rechaza queda marcado con el motivo', async () => {
    remote.settingsPutResult = { kind: 'rejected', reason: 'Fuera de rango.' };

    await service.setThreshold('5');

    expect(await service.getThresholdStatus()).toEqual({ status: 'rejected', message: 'Fuera de rango.' });
  });

  it('AC-mobile-003-11 con conexión y sin cambios pendientes toma el umbral del servidor', async () => {
    remote.settingsOnServer = 8;

    await service.hydrateSettings();

    expect(await service.getThreshold()).toBe(8);
  });

  it('AC-mobile-003-11 un umbral pendiente no se pisa con el del servidor', async () => {
    remote.online = false;
    await service.setThreshold('6');
    remote.online = true;
    remote.settingsOnServer = 8;

    await service.hydrateSettings();

    expect(await service.getThreshold()).toBe(6);
  });
});

describe('historial (AC-mobile-003-12)', () => {
  it('AC-mobile-003-12 va de la sesión más reciente a la más antigua con el estado de envío de cada una', async () => {
    await seedHistory([{ load: 20, first: 9, second: 5 }, { load: 22.5, first: 9, second: 5 }]);
    remote.online = false;
    await service.save(DUMBBELL, raw({ date: '2026-10-29' }));

    const history = await visible();

    expect(history.map((l) => l.date)).toEqual(['2026-10-29', '2026-09-08', '2026-09-01']);
    expect(history.map((l) => l.status)).toEqual(['pending', 'synced', 'synced']);
  });

  it('AC-mobile-003-12 con conexión y sin pendientes reemplaza el historial local por el del servidor', async () => {
    await store.saveLog(seed({ id: 'viejo', date: '2026-09-01' }));
    remote.server.set('del-servidor', {
      id: 'del-servidor', exerciseId: DUMBBELL.id, date: '2026-09-15', loadKg: 25,
      firstSetReps: 10, secondSetReps: 6, secondSetAssistedReps: 4,
    });

    const history = await visible();

    expect(history.map((l) => l.id)).toEqual(['del-servidor']);
    expect(history[0]).toMatchObject({ status: 'synced', pendingOp: null, loadKg: 25 });
  });

  it('AC-mobile-003-12 con cambios pendientes del ejercicio conserva lo local', async () => {
    remote.online = false;
    await service.save(DUMBBELL, raw());
    remote.online = true;
    remote.putResult = { kind: 'retry' }; // el servidor sigue sin aceptar nada
    remote.server.set('otro', {
      id: 'otro', exerciseId: DUMBBELL.id, date: '2026-09-15', loadKg: 25,
      firstSetReps: 10, secondSetReps: 6, secondSetAssistedReps: 4,
    });

    const history = await visible();

    expect(history.map((l) => l.id)).toEqual(['log-1']);
  });

  it('AC-mobile-003-12 sin conexión muestra lo guardado en el teléfono', async () => {
    await seedHistory([{ load: 22.5, first: 9, second: 5 }]);
    remote.online = false;

    expect(await visible()).toHaveLength(1);
  });

  it('AC-mobile-003-12 un registro rechazado se conserva al abrir el historial con conexión', async () => {
    remote.putResult = { kind: 'rejected', reason: 'No válido.' };
    await service.save(DUMBBELL, raw());
    remote.putResult = null;

    const history = await visible();

    expect(history.map((l) => [l.id, l.status])).toEqual([['log-1', 'rejected']]);
  });

  it('AC-mobile-003-12 los registros de otro ejercicio no se mezclan', async () => {
    await service.save(DUMBBELL, raw());
    await service.save(MACHINE, raw());

    expect((await visible(DUMBBELL)).map((l) => l.exerciseId)).toEqual([DUMBBELL.id]);
    expect((await visible(MACHINE)).map((l) => l.exerciseId)).toEqual([MACHINE.id]);
  });
});

describe('informe de «Sincronizar ahora» (AC-mobile-003-16)', () => {
  it('AC-mobile-003-16 envía lo pendiente y cuenta cuántos se enviaron', async () => {
    remote.online = false;
    await service.save(DUMBBELL, raw({ date: '2026-10-27' }));
    await service.save(DUMBBELL, raw({ date: '2026-10-28' }));
    remote.online = true;

    const report = await service.syncReport();

    expect(report).toEqual({ sent: 2, pending: 0 });
    expect(remote.calls).toEqual(['put:log-1', 'put:log-2']);
  });

  it('AC-mobile-003-16 sin conexión informa de cuántos quedan pendientes', async () => {
    remote.online = false;
    await service.save(DUMBBELL, raw({ date: '2026-10-27' }));
    await service.save(DUMBBELL, raw({ date: '2026-10-28' }));

    expect(await service.syncReport()).toEqual({ sent: 0, pending: 2 });
  });

  it('AC-mobile-003-16 si envía unos y otros no, informa de ambas cosas', async () => {
    remote.online = false;
    await service.save(DUMBBELL, raw({ date: '2026-10-27' }));
    await service.save(DUMBBELL, raw({ date: '2026-10-28' }));
    remote.online = true;
    const original = remote.putLog;
    remote.putLog = async (log) => (log.date === '2026-10-28' ? { kind: 'retry' } : original(log));

    expect(await service.syncReport()).toEqual({ sent: 1, pending: 1 });
  });

  it('AC-mobile-003-16 los borrados pendientes también cuentan como enviados', async () => {
    await service.save(DUMBBELL, raw());
    remote.online = false;
    await service.remove('log-1');
    remote.online = true;

    expect(await service.syncReport()).toEqual({ sent: 1, pending: 0 });
  });

  it('AC-mobile-003-16 sin nada pendiente lo indica', async () => {
    expect(await service.syncReport()).toEqual({ sent: 0, pending: 0 });
  });

  it('AC-mobile-003-16 los registros rechazados no cuentan como pendientes', async () => {
    remote.putResult = { kind: 'rejected', reason: 'No válido.' };
    await service.save(DUMBBELL, raw());

    expect(await service.syncReport()).toEqual({ sent: 0, pending: 0 });
  });

  it.each([
    [{ sent: 0, pending: 0 }, 'No hay registros de sesiones pendientes.'],
    [{ sent: 1, pending: 0 }, 'Se envió 1 registro de sesión.'],
    [{ sent: 3, pending: 0 }, 'Se enviaron 3 registros de sesiones.'],
    [{ sent: 0, pending: 1 }, 'Sin conexión con el servidor: queda 1 registro de sesión pendiente.'],
    [{ sent: 0, pending: 4 }, 'Sin conexión con el servidor: quedan 4 registros de sesiones pendientes.'],
    [{ sent: 2, pending: 1 }, 'Se enviaron 2 registros de sesiones; sin conexión con el servidor, queda 1 registro de sesión pendiente.'],
  ])('AC-mobile-003-16 el texto del informe %j', (report, text) => {
    expect(describeSyncReport(report)).toBe(text);
  });
});
