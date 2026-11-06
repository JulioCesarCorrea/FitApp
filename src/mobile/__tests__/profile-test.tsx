import { configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { createDeps } from '../src/data/deps';
import type { CatalogSection, RestrictionItem } from '../src/data/types';
import { createFakes } from './support';

// La app real abre SQLite, el almacén seguro y la API por HTTP; en estas pruebas se sustituyen por versiones en memoria.
jest.mock('../src/data/deps', () => ({ createDeps: jest.fn() }));
jest.mock('../src/database', () => ({ getDb: jest.fn() }));
jest.mock('../src/Scanner', () => ({ Scanner: () => null }));
jest.mock('../src/components/WeightPanel', () => ({ WeightPanel: () => null }));

// Montar la app completa tarda más de 1 s en equipos lentos; este margen evita falsos fallos.
configure({ asyncUtilTimeout: 5000 });

// Catálogo con zonas y movimientos para el formulario de restricciones.
const CATALOG: CatalogSection[] = [
  {
    name: 'Pecho',
    exercises: [{
      id: 'press-plano-con-barra', name: 'Press plano con barra', primaryZone: 'pecho', secondaryZones: ['hombro_frontal', 'triceps'],
      movements: ['empuje_horizontal', 'extension_de_codo'], equipment: 'Barra', bar: 'Recta', images: [],
    }],
  },
];

let fakes: ReturnType<typeof createFakes>;

async function openApp(url = '/') {
  fakes.remote.fetchCatalog = async () => (fakes.remote.online ? CATALOG : null);
  (createDeps as jest.Mock).mockResolvedValue(fakes.deps);
  await renderRouter('./src/app', { initialUrl: url });
}

const has = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const press = async (element: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(element);
const type = async (label: string, value: string) => fireEvent.changeText(await screen.findByLabelText(label), value);
const next = async () => press(await screen.findByTestId('wizard-next'));
const title = async () => (await screen.findByTestId('wizard-title')).props.children as string;

/** Contesta los cuatro pasos obligatorios y deja el asistente en el paso 5. */
async function fillRequired(over: { name?: string; birth?: string; height?: string; weight?: string } = {}) {
  await type('Nombre o apodo', over.name ?? 'Julio');
  await next();
  await press(await screen.findByTestId('sex-masculino'));
  await type('Fecha de nacimiento (AAAA-MM-DD)', over.birth ?? '1995-05-20');
  await next();
  await type('Estatura en cm', over.height ?? '178');
  await type('Peso actual en kg', over.weight ?? '80,5');
  await next();
  await press(await screen.findByTestId('goal-ganar_musculo'));
  await next();
}

const appIsOpen = async () => (await screen.findAllByText('Catálogo')).length > 0;
const skip = async () => press(await screen.findByTestId('wizard-skip'));

/** Recorre los pasos opcionales con «Omitir» hasta el último, que se termina. */
async function skipOptionalAndFinish() {
  for (let i = 0; i < 5; i++) await skip(); // actividad, experiencia, método, equipo, restricciones
  await press(await screen.findByTestId('wizard-skip')); // alergias: omitir termina
}

describe('El asistente de bienvenida (SPEC-profile-001)', () => {
  beforeEach(() => {
    fakes = createFakes({ serverProfile: 'none', withProfile: false });
  });

  it('AC-profile-001-11: una cuenta sin perfil ve el asistente en lugar de la app', async () => {
    await openApp('/');

    expect(await title()).toBe('¿Cómo te llamas?');
    expect(screen.getByTestId('wizard-progress')).toHaveTextContent('Paso 1 de 10');
    expect(screen.queryAllByText('Catálogo')).toHaveLength(0);
  });

  it('AC-profile-001-11: aunque se intente abrir otra pantalla, se vuelve al asistente', async () => {
    await openApp('/mas');

    expect(await title()).toBe('¿Cómo te llamas?');
    expect(screen).toHavePathname('/welcome');
  });

  it('AC-profile-001-12: los pasos obligatorios no se pueden omitir', async () => {
    await openApp('/');
    await title();

    expect(screen.queryByTestId('wizard-skip')).not.toBeOnTheScreen();
    await next();

    expect(await screen.findByTestId('wizard-messages')).toHaveTextContent(has('El nombre debe tener de 1 a 40 caracteres.'));
    expect(await title()).toBe('¿Cómo te llamas?');
  });

  it('AC-profile-001-12: «Atrás» conserva lo escrito', async () => {
    await openApp('/');
    await type('Nombre o apodo', 'Julio');
    await next();
    expect(await title()).toBe('Sexo y fecha de nacimiento');

    await press(screen.getByTestId('wizard-back'));

    expect(await title()).toBe('¿Cómo te llamas?');
    expect((await screen.findByLabelText('Nombre o apodo')).props.value).toBe('Julio');
  });

  it('AC-profile-001-12: valida cada paso con los motivos de la API', async () => {
    await openApp('/');
    await type('Nombre o apodo', 'Julio');
    await next();

    await next(); // sin sexo ni fecha
    const birth = await screen.findByTestId('wizard-messages');
    expect(birth).toHaveTextContent(has('Elige tu sexo.'));
    expect(birth).toHaveTextContent(has('formato AAAA-MM-DD'));

    await press(screen.getByTestId('sex-femenino'));
    await type('Fecha de nacimiento (AAAA-MM-DD)', '2030-01-01');
    await next();
    expect(await screen.findByTestId('wizard-messages')).toHaveTextContent(has('edad de 14 a 100 años'));

    await type('Fecha de nacimiento (AAAA-MM-DD)', '1995-05-20');
    await next();
    await next(); // sin estatura ni peso
    const body = await screen.findByTestId('wizard-messages');
    expect(body).toHaveTextContent(has('entre 100 y 250 cm'));
    expect(body).toHaveTextContent(has('entre 20 y 500 kg'));

    await type('Estatura en cm', '178');
    await type('Peso actual en kg', '80');
    await next();
    await next(); // sin objetivo
    expect(await screen.findByTestId('wizard-messages')).toHaveTextContent(has('Elige tu objetivo.'));
  });

  it('AC-profile-001-13: los pasos opcionales tienen «Omitir» y saltarlos usa los valores por defecto', async () => {
    await openApp('/');
    await fillRequired();

    expect(await title()).toBe('Tu actividad diaria');
    expect(screen.getByTestId('wizard-skip')).toBeOnTheScreen();
    await skipOptionalAndFinish();

    await waitFor(() => expect(fakes.remote.serverProfile).not.toBeNull());
    expect(fakes.remote.serverProfile).toEqual({
      displayName: 'Julio', sex: 'masculino', birthDate: '1995-05-20', heightCm: 178, goal: 'ganar_musculo',
      activityLevel: 'ligero', experienceLevel: null, daysPerWeek: null, methodology: 'heavy_duty_personalizado', allergies: [],
    });
    expect(await appIsOpen()).toBe(true);
  });

  it('AC-profile-001-13: los pasos opcionales contestados se guardan', async () => {
    await openApp('/');
    await fillRequired();
    await press(await screen.findByTestId('activity-moderado'));
    await next();
    await press(await screen.findByTestId('experience-intermedio'));
    await type('Días de entrenamiento por semana (de 1 a 7)', '4');
    await next();
    await next(); // método
    await skip(); // equipo
    await skip(); // restricciones
    await type('Alergias o preferencias de comida (separadas por comas)', 'nueces, lactosa');
    await press(await screen.findByTestId('wizard-finish'));

    await waitFor(() => expect(fakes.remote.serverProfile).not.toBeNull());
    expect(fakes.remote.serverProfile).toMatchObject({
      activityLevel: 'moderado', experienceLevel: 'intermedio', daysPerWeek: 4, allergies: ['nueces', 'lactosa'],
    });
  });

  it('AC-profile-001-13: omitir un paso con datos mal escritos los descarta', async () => {
    await openApp('/');
    await fillRequired();
    await skip(); // actividad
    await type('Días de entrenamiento por semana (de 1 a 7)', '9');
    await skip();

    expect(await title()).toBe('Tu método de entrenamiento');
  });

  it('AC-profile-001-13: la metodología sale preseleccionada', async () => {
    await openApp('/');
    await fillRequired();
    await skip();
    await skip();

    expect(await title()).toBe('Tu método de entrenamiento');
    expect(screen.getByTestId('methodology-heavy_duty_personalizado').props.accessibilityState).toEqual({ selected: true });
  });

  it('AC-profile-001-14: el paso del equipo usa el mismo formulario que la pestaña Equipo y lo guarda', async () => {
    await openApp('/');
    await fillRequired();
    for (let i = 0; i < 3; i++) await skip(); // actividad, experiencia, método

    expect(await title()).toBe('El equipo de tu gimnasio');
    await type('Mancuernas disponibles (kg, separadas por comas)', '20, 22,5');
    await type('Escalón de máquinas y poleas (kg)', '5');
    await press(screen.getByTestId('save-equipment'));

    await waitFor(() => expect(screen.getByTestId('equipment-status')).toHaveTextContent('Guardado y sincronizado.'));
    expect((await fakes.store.getEquipment()).profile).toMatchObject({ dumbbellsKg: [20, 22.5], machineStepKg: 5 });
  });

  it('AC-profile-001-15: el paso de restricciones elige de listas, explica los niveles y guarda en la API', async () => {
    await openApp('/');
    await fillRequired();
    for (let i = 0; i < 4; i++) await skip(); // actividad, experiencia, método, equipo

    expect(await title()).toBe('Lesiones o restricciones');
    await press(await screen.findByTestId('add-restriction'));
    await press(await screen.findByTestId('zone-pecho'));
    await press(screen.getByTestId('movement-empuje_horizontal'));
    await press(screen.getByTestId('level-bloqueo'));
    expect(screen.getByText('No te deja añadir ese ejercicio a tu rutina.')).toBeOnTheScreen();
    await type('Fecha de revisión (AAAA-MM-DD, opcional)', '2027-01-15');
    await press(screen.getByTestId('save-restriction'));

    await waitFor(() => expect(fakes.remote.serverRestrictions).toHaveLength(1));
    expect(fakes.remote.serverRestrictions[0]).toMatchObject({
      zone: 'pecho', avoidedMovements: ['empuje_horizontal'], level: 'bloqueo', reviewOn: '2027-01-15',
    });
    expect(await screen.findByText('Pecho')).toBeOnTheScreen();
  });

  it('AC-profile-001-15: las zonas y movimientos salen del catálogo con tildes y el grupo hombros', async () => {
    await openApp('/');
    await fillRequired();
    for (let i = 0; i < 4; i++) await skip();
    await press(await screen.findByTestId('add-restriction'));

    expect(await screen.findByTestId('zone-hombros')).toBeOnTheScreen();
    expect(screen.getByText('Tríceps')).toBeOnTheScreen();
    expect(screen.getByText('Extensión de codo')).toBeOnTheScreen();
  });

  it('AC-profile-001-15: sin conexión el paso indica que hace falta conexión y se puede omitir', async () => {
    await openApp('/');
    await fillRequired();
    for (let i = 0; i < 4; i++) await skip();
    await press(await screen.findByTestId('add-restriction'));
    await press(await screen.findByTestId('zone-pecho'));
    await press(screen.getByTestId('level-aviso'));
    fakes.remote.online = false;

    await press(screen.getByTestId('save-restriction'));

    expect(await screen.findByTestId('restriction-message')).toHaveTextContent(has('Necesitas conexión para cambiar tus restricciones.'));
    expect(screen.getByTestId('wizard-skip')).toBeOnTheScreen();
    expect(fakes.remote.serverRestrictions).toHaveLength(0);
  });

  it('AC-profile-001-16: al terminar sin conexión el perfil queda pendiente, el peso en cola y la app se abre', async () => {
    await openApp('/');
    await fillRequired();
    fakes.remote.online = false;
    await skipOptionalAndFinish();

    expect(await appIsOpen()).toBe(true);
    expect(fakes.weightsAdded).toEqual([80.5]);
    expect((await fakes.store.getProfile()).status).toBe('pending');
    expect(fakes.remote.serverProfile).toBeNull();
  });

  it('AC-profile-001-16: después, al volver la conexión, el perfil se envía una sola vez', async () => {
    await openApp('/');
    await fillRequired();
    fakes.remote.online = false;
    await skipOptionalAndFinish();
    await appIsOpen();

    fakes.remote.online = true;
    await fakes.profile.syncPending();
    await fakes.profile.syncPending();

    expect(fakes.remote.serverProfile).toMatchObject({ displayName: 'Julio' });
    expect((await fakes.store.getProfile()).status).toBe('synced');
  });

  it('AC-profile-001-16: si la API rechaza el perfil, el asistente sigue con el motivo y no se registra el peso', async () => {
    fakes.remote.putProfileResult = { kind: 'rejected', reason: 'La estatura debe estar entre 100 y 250 cm.' };
    await openApp('/');
    await fillRequired();
    await skipOptionalAndFinish();

    expect(await screen.findByTestId('wizard-messages')).toHaveTextContent(has('La estatura debe estar entre 100 y 250 cm.'));
    expect(fakes.weightsAdded).toEqual([]);
    expect(screen.queryAllByText('Catálogo')).toHaveLength(0);
  });
});

describe('Quién ve el asistente (SPEC-profile-001)', () => {
  it('AC-profile-001-11: una cuenta con perfil en el servidor, aunque sea otro teléfono, no ve el asistente', async () => {
    fakes = createFakes({ withProfile: false }); // el servidor sí tiene perfil
    await openApp('/');

    expect(await appIsOpen()).toBe(true);
    expect(screen.queryByTestId('wizard-title')).not.toBeOnTheScreen();
    expect((await fakes.store.getProfile()).profile).toMatchObject({ displayName: 'Julio' });
  });

  it('AC-profile-001-19: con perfil en el teléfono entra directamente, incluso sin conexión', async () => {
    fakes = createFakes();
    await fakes.store.saveCatalog(CATALOG);
    fakes.remote.online = false;
    await openApp('/');

    expect(await appIsOpen()).toBe(true);
    expect(screen.queryByTestId('wizard-title')).not.toBeOnTheScreen();
  });

  it('AC-profile-001-19: sin perfil en el teléfono y sin servidor pide conexión, sin asistente, y deja reintentar', async () => {
    fakes = createFakes({ serverProfile: 'none', withProfile: false });
    fakes.remote.online = false;
    await openApp('/');

    expect(await screen.findByTestId('connect-message')).toBeOnTheScreen();
    expect(screen.queryByTestId('wizard-title')).not.toBeOnTheScreen();

    fakes.remote.online = true;
    await press(screen.getByTestId('connect-retry'));

    expect(await title()).toBe('¿Cómo te llamas?');
  });
});

describe('Perfil y restricciones en Más (SPEC-profile-001)', () => {
  beforeEach(() => {
    fakes = createFakes();
  });

  it('AC-profile-001-17: «Perfil» muestra los datos guardados y permite cambiarlos', async () => {
    await openApp('/mas');
    await press(await screen.findByTestId('go-profile'));

    await waitFor(() => expect(screen.getByLabelText('Nombre o apodo').props.value).toBe('Julio'));
    expect(screen.getByLabelText('Estatura en cm').props.value).toBe('178');
    expect(screen.queryByLabelText('Peso actual en kg')).not.toBeOnTheScreen();

    await type('Nombre o apodo', 'Julio César');
    await type('Estatura en cm', '180');
    await press(screen.getByTestId('save-profile'));

    expect(await screen.findByTestId('profile-saved')).toHaveTextContent('Guardado y sincronizado.');
    expect(fakes.remote.serverProfile).toMatchObject({ displayName: 'Julio César', heightCm: 180 });
  });

  it('AC-profile-001-17: valida con las mismas reglas y sin conexión queda pendiente', async () => {
    await openApp('/profile');
    await waitFor(() => expect(screen.getByLabelText('Nombre o apodo').props.value).toBe('Julio'));

    await type('Estatura en cm', '99');
    await press(screen.getByTestId('save-profile'));
    expect(await screen.findByTestId('profile-message')).toHaveTextContent(has('entre 100 y 250 cm'));

    fakes.remote.online = false;
    await type('Estatura en cm', '181');
    await press(screen.getByTestId('save-profile'));

    expect(await screen.findByTestId('profile-saved')).toHaveTextContent(has('se enviará cuando haya conexión'));
    expect((await fakes.store.getProfile()).status).toBe('pending');
  });

  const restriction = (over: Partial<RestrictionItem> = {}): RestrictionItem => ({
    id: 'r1', zone: 'pecho', avoidedMovements: ['empuje_horizontal'], level: 'bloqueo', reviewOn: null, ...over,
  });

  it('AC-profile-001-18: lista las restricciones con zona, movimientos, nivel y fecha', async () => {
    fakes.remote.serverRestrictions = [restriction({ reviewOn: '2027-01-15' })];
    await openApp('/mas');
    await press(await screen.findByTestId('go-restrictions'));

    const card = await screen.findByTestId('restriction-r1');
    expect(card).toHaveTextContent(has('Pecho'));
    expect(card).toHaveTextContent(has('Evitar: Empuje horizontal'));
    expect(card).toHaveTextContent(has('Nivel: Bloqueo'));
    expect(card).toHaveTextContent(has('Revisar el 2027-01-15'));
    expect(screen.queryByTestId('due-r1')).not.toBeOnTheScreen();
  });

  it('AC-profile-001-18: la que ya llegó a su fecha de revisión sale como pendiente de revisar y su nivel no cambia', async () => {
    fakes.remote.serverRestrictions = [restriction({ reviewOn: '2026-09-01', level: 'aviso' })];
    await openApp('/restrictions');

    expect(await screen.findByTestId('due-r1')).toHaveTextContent('Pendiente de revisar');
    expect(screen.getByTestId('restriction-r1')).toHaveTextContent(has('Nivel: Aviso'));
  });

  it('AC-profile-001-18: se puede editar y borrar', async () => {
    fakes.remote.serverRestrictions = [restriction()];
    await openApp('/restrictions');
    await press(await screen.findByTestId('edit-restriction-r1'));
    await press(await screen.findByTestId('level-aviso'));
    await press(screen.getByTestId('save-restriction'));

    await waitFor(() => expect(fakes.remote.serverRestrictions[0].level).toBe('aviso'));
    expect(fakes.remote.serverRestrictions).toHaveLength(1);

    await press(await screen.findByTestId('delete-restriction-r1'));

    await waitFor(() => expect(fakes.remote.serverRestrictions).toHaveLength(0));
    expect(await screen.findByText('Aún no tienes restricciones.')).toBeOnTheScreen();
  });

  it('AC-profile-001-18: sin conexión indica que hace falta conexión', async () => {
    fakes.remote.online = false;
    await openApp('/restrictions');

    expect(await screen.findByTestId('restrictions-offline')).toHaveTextContent(has('Necesitas conexión'));
  });

  it('AC-profile-001-18: la pantalla recuerda que la app no sustituye a un profesional', async () => {
    await openApp('/restrictions');

    expect(await screen.findByText(has('no diagnostica ni sustituye a un profesional de la salud'))).toBeOnTheScreen();
  });

  it('AC-profile-001-15: exige zona y nivel y muestra el motivo de la API', async () => {
    await openApp('/restrictions');
    await press(await screen.findByTestId('add-restriction'));
    await press(screen.getByTestId('save-restriction'));
    expect(await screen.findByTestId('restriction-message')).toHaveTextContent(has('Elige la zona.'));

    fakes.remote.restrictionResult = { kind: 'rejected', reason: "La zona 'x' no existe en el catálogo." };
    await press(screen.getByTestId('zone-pecho'));
    await press(screen.getByTestId('level-aviso'));
    await press(screen.getByTestId('save-restriction'));
    await waitFor(() => expect(screen.getAllByTestId('restriction-message')[0]).toHaveTextContent(has("no existe en el catálogo")));
  });
});

describe('Tema claro y oscuro (SPEC-profile-001)', () => {
  it.each([
    ['light', '#111827'],
    ['dark', '#F3F4F6'],
  ])('AC-profile-001-21: el asistente usa el texto del tema %s', async (mode, textColor) => {
    fakes = createFakes({ serverProfile: 'none', withProfile: false });
    await fakes.store.setSetting('theme', mode);
    await openApp('/');

    expect(await screen.findByTestId('wizard-title')).toHaveStyle({ color: textColor });
  });
});
