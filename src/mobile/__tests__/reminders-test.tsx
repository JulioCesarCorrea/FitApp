import { configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { createDeps } from '../src/data/deps';
import { localDate } from '../src/data/nutritionService';
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

describe('Preguntas a la IA (SPEC-ai-004)', () => {
  const stream = (...parts: string[]) => [
    { type: 'meta' as const, medical: false, category: null, notice: null },
    ...parts.map((text) => ({ type: 'delta' as const, text })),
    { type: 'done' as const, usage: { promptTokens: 10, completionTokens: 5 } },
  ];

  it('AC-ai-004-18: pregunta, ve la respuesta, el aviso permanente y lo que ocupa lo guardado', async () => {
    fakes.remote.chatEvents = stream('Come algo ', 'ligero.');
    await openApp('/chat');
    expect(await screen.findByTestId('chat-disclaimer')).toHaveTextContent(/no sustituyen a un profesional de la salud/);

    await type('Tu pregunta', '¿Qué como antes de entrenar?');
    await press(screen.getByTestId('chat-send'));

    expect(await screen.findByText('Come algo ligero.')).toBeOnTheScreen();
    expect(screen.getAllByText('¿Qué como antes de entrenar?').length).toBeGreaterThan(0); // la pregunta y el título de la conversación
    await waitFor(() => expect(screen.getByTestId('chat-storage')).toHaveTextContent(/1 conversaciones, 2 mensajes/));
    expect(fakes.remote.chatRequests[0]).toMatchObject({ text: '¿Qué como antes de entrenar?', useMyData: false, history: [] });
  });

  it('AC-ai-004-03: el interruptor «usar mis datos» se envía con la pregunta', async () => {
    fakes.remote.chatEvents = stream('Ok');
    await openApp('/chat');
    await press(await screen.findByTestId('use-data-data'));

    await type('Tu pregunta', '¿Cómo voy?');
    await press(screen.getByTestId('chat-send'));

    await screen.findByText('Ok');
    expect(fakes.remote.chatRequests[0].useMyData).toBe(true);
  });

  it('AC-ai-004-05: una pregunta médica muestra el aviso fijo bajo la respuesta', async () => {
    fakes.remote.chatEvents = [
      { type: 'meta', medical: true, category: 'dolor_lesion', notice: 'Consulta a un profesional sanitario antes de seguir.' },
      { type: 'delta', text: 'Descansa unos días.' },
      { type: 'done', usage: { promptTokens: 1, completionTokens: 1 } },
    ];
    await openApp('/chat');

    await type('Tu pregunta', 'Me duele la rodilla');
    await press(screen.getByTestId('chat-send'));

    expect(await screen.findByText('Consulta a un profesional sanitario antes de seguir.')).toBeOnTheScreen();
  });

  it('AC-ai-004-06: una emergencia muestra el texto fijo sin pasar por la IA', async () => {
    fakes.remote.chatOutcome = { kind: 'emergency', category: 'emergencia', text: 'Acude ya a los servicios de emergencia de tu país.' };
    await openApp('/chat');

    await type('Tu pregunta', 'Me falta el aire');
    await press(screen.getByTestId('chat-send'));

    expect(await screen.findByText('Acude ya a los servicios de emergencia de tu país.')).toBeOnTheScreen();
  });

  it('AC-ai-004-18: sin conexión lo avisa, conserva la pregunta y el resto de la app sigue funcionando', async () => {
    fakes.remote.online = false;
    await openApp('/chat');

    await type('Tu pregunta', 'Hola');
    await press(screen.getByTestId('chat-send'));

    expect(await screen.findByTestId('chat-message')).toHaveTextContent(/necesita conexión/);
    expect(screen.getAllByText('Hola').length).toBeGreaterThan(0);
  });

  it('AC-ai-004-15 y 16: se pueden borrar una conversación y todo lo guardado', async () => {
    fakes.remote.chatEvents = stream('Ok');
    await openApp('/chat');
    await type('Tu pregunta', 'Una pregunta');
    await press(screen.getByTestId('chat-send'));
    await screen.findByText('Ok');

    await press(await screen.findByTestId('delete-conversation'));

    await waitFor(() => expect(screen.getByTestId('chat-storage')).toHaveTextContent(/0 conversaciones, 0 mensajes/));
    expect(screen.queryByText('Una pregunta')).not.toBeOnTheScreen();
  });

  it('AC-ai-004-18: «Más» lleva a las preguntas', async () => {
    await openApp('/mas');

    await press(await screen.findByTestId('go-chat'));

    expect(await screen.findByTestId('chat-send')).toBeOnTheScreen();
  });
});

describe('Foto de comida con IA (SPEC-ai-003)', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    name: 'Arroz blanco', grams: 150, confidence: 'media' as const, estimate: true, kcalPer100g: 130, proteinPer100g: 2.7, fatPer100g: 0.3, carbsPer100g: 28,
    kcal: 195, proteinG: 4.1, fatG: 0.5, carbsG: 42, possibleAllergens: [] as string[], ...over,
  });
  const proposal = (...items: ReturnType<typeof item>[]) => ({
    kind: 'ok' as const,
    value: { kind: 'proposal' as const, items, disclaimer: 'Orientativo: la app no diagnostica ni sustituye a un profesional de la salud.' },
  });

  it('AC-ai-003-10: antes de hacer la foto explica qué se envía y no pide el permiso hasta tocar «Hacer foto»', async () => {
    await openApp('/food/photo');

    expect(await screen.findByTestId('photo-notice')).toHaveTextContent(/sin ubicación ni datos de la propia foto y no se guarda/);
    expect(fakes.camera.calls).toBe(0);
  });

  it('AC-ai-003-05 y 06: corrige un alimento y su cantidad, y solo entonces se registra con las reglas de siempre y origen «ia»', async () => {
    fakes.remote.photoResult = proposal(item(), item({ name: 'Pollo', grams: 100, kcalPer100g: 165, proteinPer100g: 31, fatPer100g: 3.6, carbsPer100g: 0, kcal: 165 }));
    await openApp('/food/photo');
    await press(await screen.findByTestId('photo-take'));
    expect(await screen.findByTestId('photo-item-0')).toBeOnTheScreen();
    expect(fakes.remote.photosReceived).toEqual(['FOTO-EN-BASE64']);
    expect(await fakes.store.getFoods()).toEqual([]); // nada se registra sin confirmar

    await type('Nombre del alimento 1', 'Arroz integral');
    await type('Gramos de 1', '200');
    await press(screen.getByTestId('photo-remove-1')); // quita el pollo
    await press(screen.getByTestId('photo-meal-cena'));
    await press(screen.getByTestId('photo-register'));

    await waitFor(() => expect(screen.queryByTestId('photo-register')).not.toBeOnTheScreen());
    const [food] = await fakes.store.getFoods();
    expect(food).toMatchObject({ name: 'Arroz integral', source: 'ia', kcalPer100g: 130, proteinPer100g: 2.7 });
    const [entry] = await fakes.store.getFoodEntries(localDate());
    expect(entry).toMatchObject({ meal: 'cena', grams: 200, name: 'Arroz integral', kcal: 260 });
  });

  it('AC-ai-003-07: avisa de los alérgenos que sugiere el nombre y que chocan con las alergias', async () => {
    fakes.remote.photoResult = proposal(item({ name: 'Yogur con leche', possibleAllergens: ['leche'] }));
    await openApp('/food/photo');

    await press(await screen.findByTestId('photo-take'));

    expect(await screen.findByTestId('photo-allergen-0')).toHaveTextContent(/Podría contener Leche.*orientativo/);
  });

  it('AC-ai-003-10: sin permiso de cámara lo explica y sin conexión lo avisa sin romper el resto', async () => {
    fakes.camera.next = { kind: 'denied', canAskAgain: false };
    await openApp('/food/photo');
    await press(await screen.findByTestId('photo-take'));
    expect(await screen.findByTestId('photo-message')).toHaveTextContent(/ajustes del sistema/);

    fakes.camera.next = { kind: 'ok', base64: 'X' };
    fakes.remote.online = false;
    await press(screen.getByTestId('photo-take'));
    await waitFor(() => expect(screen.getByTestId('photo-message')).toHaveTextContent(/necesita conexión.*a mano o escanear/));
  });

  it('AC-ai-003-08: sin consentimiento lo explica y lleva a los ajustes de la IA', async () => {
    fakes.remote.photoResult = { kind: 'error', code: 'consent_required', message: 'x', retryAfterSeconds: null };
    await openApp('/food/photo');

    await press(await screen.findByTestId('photo-take'));

    expect(await screen.findByTestId('photo-message')).toHaveTextContent(/Activa «Análisis y planes» en Inteligencia artificial/);
    expect(screen.getByTestId('go-ai-settings')).toBeOnTheScreen();
  });

  it('AC-ai-003-10: el botón «Foto» de Añadir alimento solo aparece si la función está disponible', async () => {
    await openApp('/food/add');
    await screen.findByTestId('scan-food');
    expect(screen.queryByTestId('photo-food')).not.toBeOnTheScreen(); // por defecto la función no está disponible

    fakes.remote.serverAi = { ...fakes.remote.serverAi!, features: fakes.remote.serverAi!.features.map((f) => (f.feature === 'food_photo' ? { ...f, available: true } : f)) };
    await openApp('/food/add');

    expect(await screen.findByTestId('photo-food')).toBeOnTheScreen();
  });
});

describe('Mi contexto (SPEC-profile-002)', () => {
  it('AC-profile-002-12: anota una creatina con su marca y dosis, activa el interruptor y llega a la API', async () => {
    await openApp('/context');
    expect(await screen.findByTestId('context-empty')).toBeOnTheScreen();

    await type('Nombre', 'Creatina');
    await type('Marca (opcional)', 'Marca X');
    await type('Dosis (opcional)', '5 g');
    await press(screen.getByTestId('context-frequency-diario'));
    expect(screen.getByTestId('context-share')).toHaveTextContent(/desactivado/); // apagado por defecto
    await press(screen.getByTestId('context-share'));
    await press(screen.getByTestId('context-save'));

    expect(await screen.findByTestId('context-ctx-1')).toHaveTextContent(/Creatina/);
    expect(screen.getByTestId('context-ctx-1')).toHaveTextContent(/Marca X · 5 g · A diario/);
    expect(screen.getByTestId('context-ctx-1')).toHaveTextContent(/Compartido con la IA/);
    expect(fakes.remote.serverContext.get('ctx-1')).toMatchObject({ name: 'Creatina', shareWithAi: true, frequency: 'diario' });
  });

  it('AC-profile-002-12: la medicación no tiene interruptor y explica que nunca se comparte', async () => {
    await openApp('/context');
    await press(await screen.findByTestId('context-type-medicacion'));

    expect(screen.queryByTestId('context-share')).not.toBeOnTheScreen();
    expect(screen.getByTestId('context-medication-note')).toHaveTextContent(/nunca se comparte con la IA/);

    await type('Nombre', 'Ibuprofeno');
    await press(screen.getByTestId('context-save'));

    expect(await screen.findByTestId('context-ctx-1')).toHaveTextContent(/nunca se comparte con la IA/);
    expect(fakes.remote.serverContext.get('ctx-1')?.shareWithAi).toBe(false);
  });

  it('AC-profile-002-15: al escribir una nota con un dato personal avisa y no deja guardar', async () => {
    await openApp('/context');
    await press(await screen.findByTestId('context-type-nota'));
    expect(screen.getByTestId('context-note-help')).toHaveTextContent(/No escribas nombres, ubicaciones ni datos clínicos/);

    await type('Nombre', 'Contacto');
    await type('Texto de la nota', 'Escríbeme a julio@correo.com');
    expect(await screen.findByTestId('context-personal-warning')).toBeOnTheScreen();
    await press(screen.getByTestId('context-save'));

    expect(await screen.findByTestId('context-issues')).toHaveTextContent(/No escribas correos/);
    expect(fakes.remote.serverContext.size).toBe(0);
  });

  it('AC-profile-002-12: edita, da de baja y borra una entrada', async () => {
    await openApp('/context');
    await type('Nombre', 'Creatina');
    await press(screen.getByTestId('context-save'));
    await press(await screen.findByTestId('context-edit-ctx-1'));
    await type('Dosis (opcional)', '3 g');
    await press(screen.getByTestId('context-save'));
    await waitFor(() => expect(screen.getByTestId('context-ctx-1')).toHaveTextContent(/3 g/));

    await press(screen.getByTestId('context-end-ctx-1'));
    await waitFor(() => expect(screen.getByTestId('context-reactivate-ctx-1')).toBeOnTheScreen()); // pasa a «De baja»
    expect(fakes.remote.serverContext.get('ctx-1')?.endedOn).toBe('2026-11-23');

    await press(screen.getByTestId('context-delete-ctx-1'));
    await waitFor(() => expect(screen.queryByTestId('context-ctx-1')).not.toBeOnTheScreen());
    expect(fakes.remote.serverContext.size).toBe(0);
  });

  it('AC-profile-002-13: sin conexión se guarda en el teléfono y avisa de que está pendiente', async () => {
    fakes.remote.online = false;
    await openApp('/context');
    await type('Nombre', 'Magnesio');

    await press(screen.getByTestId('context-save'));

    expect(await screen.findByTestId('context-ctx-1')).toHaveTextContent(/Pendiente de enviar/);
    expect(fakes.remote.serverContext.size).toBe(0);
  });

  it('AC-profile-002-12: Más lleva a Mi contexto', async () => {
    await openApp('/mas');

    await press(await screen.findByTestId('go-context'));

    expect(await screen.findByTestId('context-save')).toBeOnTheScreen();
  });
});
