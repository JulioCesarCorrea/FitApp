import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter, testRouter } from 'expo-router/testing-library';
import { Appearance } from 'react-native';
import { createDeps } from '../src/data/deps';
import { DAYS } from '../src/data/types';
import { CATALOG, PROFILE, createFakes } from './support';

// La app real abre SQLite y la API por HTTP; en estas pruebas se sustituyen por versiones en memoria.
jest.mock('../src/data/deps', () => ({ createDeps: jest.fn() }));
jest.mock('../src/database', () => ({ getDb: jest.fn() }));
jest.mock('../src/Scanner', () => ({ Scanner: () => null }));
jest.mock('../src/components/WeightPanel', () => ({ WeightPanel: () => null }));

// Montar la app completa tarda más de 1 s en equipos lentos; este margen evita falsos fallos.
configure({ asyncUtilTimeout: 5000 });

let fakes: ReturnType<typeof createFakes>;

async function openApp(url = '/') {
  (createDeps as jest.Mock).mockResolvedValue(fakes.deps);
  await renderRouter('./src/app', { initialUrl: url });
}

const press = async (element: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(element);

beforeEach(() => {
  fakes = createFakes();
});

describe('Catálogo (SPEC-mobile-002)', () => {
  it('AC-mobile-002-01: muestra las secciones por zona con una tarjeta por ejercicio', async () => {
    await openApp();

    expect(await screen.findByText('Pecho')).toBeOnTheScreen();
    expect(screen.getByText('Hombros')).toBeOnTheScreen();
    expect(screen.getByText('Press plano con barra')).toBeOnTheScreen();
    expect(screen.getByText('Elevaciones laterales con mancuernas')).toBeOnTheScreen();
    expect(screen.getByTestId('image-press-plano-con-barra')).toBeOnTheScreen();
  });

  it('AC-mobile-002-02: si la imagen no carga queda solo el nombre, sin imagen sustituta', async () => {
    await openApp();
    const image = await screen.findByTestId('image-press-plano-con-barra');

    await act(async () => image.props.onError({ nativeEvent: { error: 'no se pudo cargar' } }));

    await waitFor(() => expect(screen.queryByTestId('image-press-plano-con-barra')).not.toBeOnTheScreen());
    expect(screen.getByText('Press plano con barra')).toBeOnTheScreen();
    expect(screen.getByTestId('card-press-plano-con-barra')).toBeOnTheScreen();
  });

  it('AC-mobile-002-08: sin conexión y sin catálogo descargado pide conexión', async () => {
    fakes.remote.online = false;
    await openApp();

    expect(await screen.findByText('Necesitas conexión')).toBeOnTheScreen();
    expect(screen.queryByText('Pecho')).not.toBeOnTheScreen();
  });

  it('AC-mobile-002-08: con el catálogo ya descargado se ve sin conexión', async () => {
    await fakes.store.saveCatalog(CATALOG);
    fakes.remote.online = false;
    await openApp();

    expect(await screen.findByText('Press plano con barra')).toBeOnTheScreen();
    expect(screen.queryByText('Necesitas conexión')).not.toBeOnTheScreen();
  });
});

describe('Asignar ejercicios (SPEC-mobile-002)', () => {
  async function openDetail(id = 'press-plano-con-barra') {
    await openApp();
    await press(await screen.findByTestId(`card-${id}`));
    await screen.findByText('Días en que lo harás');
  }

  it('el selector de días muestra los botones L M X J V S D', async () => {
    await openDetail();

    const letters = DAYS.map((d) => screen.getByTestId(`day-${d}`));
    expect(letters).toHaveLength(7);
    for (const letter of ['L', 'M', 'X', 'J', 'V', 'S', 'D']) expect(screen.getByText(letter)).toBeOnTheScreen();
  });

  it('AC-mobile-002-03: sin elegir un día no se puede añadir', async () => {
    await openDetail();

    expect(screen.getByTestId('add-to-plan')).toBeDisabled();
  });

  const taken = (id: string) => ({ id, exerciseId: 'press-plano-con-barra', order: 0, machineStepKg: null });

  it('AC-mobile-002-11: los días donde el ejercicio ya está salen atenuados y no se pueden elegir', async () => {
    await fakes.seedServer('martes', [taken('x1')]);
    await openDetail();

    expect(screen.getByTestId('day-martes')).toBeDisabled();
    expect(screen.getByTestId('day-jueves')).not.toBeDisabled();
    expect(await screen.findByText('Los días atenuados ya tienen este ejercicio.')).toBeOnTheScreen();

    await press(screen.getByTestId('day-martes'));
    expect(screen.getByTestId('add-to-plan')).toBeDisabled();
  });

  it('AC-mobile-002-11: tras añadirlo a un día, ese día deja de poder elegirse', async () => {
    await openDetail();
    await press(screen.getByTestId('day-martes'));
    await press(screen.getByTestId('add-to-plan'));
    await screen.findByText('Martes: añadido');

    await waitFor(() => expect(screen.getByTestId('day-martes')).toBeDisabled());
    expect(screen.getByTestId('day-jueves')).not.toBeDisabled();
    expect(screen.getByTestId('add-to-plan')).toBeDisabled();
  });

  it('AC-mobile-002-11: si ya está en todos los días lo indica y no deja añadir', async () => {
    for (const [i, day] of DAYS.entries()) await fakes.seedServer(day, [taken(`x${i}`)]);
    await openDetail();

    expect(await screen.findByText('Este ejercicio ya está en todos los días de tu rutina.')).toBeOnTheScreen();
    expect(screen.getByTestId('add-to-plan')).toBeDisabled();
  });

  it('AC-mobile-002-03: añade a varios días y aparece en Mi rutina', async () => {
    await openDetail();
    await press(screen.getByTestId('day-martes'));
    await press(screen.getByTestId('day-jueves'));
    await press(screen.getByTestId('add-to-plan'));

    expect(await screen.findByText('Martes: añadido')).toBeOnTheScreen();
    expect(screen.getByText('Jueves: añadido')).toBeOnTheScreen();

    await press(screen.getByText('Ver mi rutina'));
    const martes = await screen.findByTestId('day-section-martes');
    expect(martes).toHaveTextContent(/1\. Press plano con barra/);
    expect(screen.getByTestId('day-section-jueves')).toHaveTextContent(/Press plano con barra/);
    expect(screen.queryByTestId('day-section-lunes')).not.toBeOnTheScreen();
  });

  it('AC-mobile-002-04: el escalón de una máquina debe ser mayor que cero', async () => {
    await openDetail('press-de-pecho-en-maquina');
    await press(screen.getByTestId('day-martes'));
    await fireEvent.changeText(screen.getByLabelText('Escalón de esta máquina en kg (opcional)'), '0');

    await press(screen.getByTestId('add-to-plan'));

    expect(await screen.findByText('El escalón debe ser un número mayor que 0.')).toBeOnTheScreen();
    expect(fakes.remote.sent).toHaveLength(0);
  });

  it('AC-mobile-002-04: guarda el escalón propio de la máquina', async () => {
    await openDetail('press-de-pecho-en-maquina');
    await press(screen.getByTestId('day-martes'));
    await fireEvent.changeText(screen.getByLabelText('Escalón de esta máquina en kg (opcional)'), '2,5');

    await press(screen.getByTestId('add-to-plan'));

    await screen.findByText('Martes: añadido');
    expect(fakes.remote.sent[0].entries[0].machineStepKg).toBe(2.5);
  });

  it('AC-mobile-002-05: nivel aviso muestra el aviso y se guarda al confirmar', async () => {
    fakes.remote.dayResult = (_d, confirm) =>
      confirm
        ? { kind: 'ok', entries: [] }
        : { kind: 'warnings', hits: [{ exerciseId: 'elevaciones-laterales-con-mancuernas', exerciseName: 'Elevaciones laterales con mancuernas', zones: ['hombros'] }] };
    await openDetail('elevaciones-laterales-con-mancuernas');
    await press(screen.getByTestId('day-miercoles'));

    await press(screen.getByTestId('add-to-plan'));

    expect(await screen.findByText(/Miércoles: aviso de restricción/)).toBeOnTheScreen();
    await press(screen.getByTestId('confirm-miercoles'));
    expect(await screen.findByText('Miércoles: añadido')).toBeOnTheScreen();
    expect(fakes.remote.sent.at(-1)?.confirm).toBe(true);
  });

  it('AC-mobile-002-05: nivel bloqueo no deja añadir y explica el motivo', async () => {
    fakes.remote.dayResult = () => ({
      kind: 'blocked',
      hits: [{ exerciseId: 'press-plano-con-barra', exerciseName: 'Press plano con barra', zones: ['pecho'] }],
    });
    await openDetail();
    await press(screen.getByTestId('day-martes'));

    await press(screen.getByTestId('add-to-plan'));

    expect(await screen.findByText(/no se puede añadir, restricción en nivel bloqueo/)).toBeOnTheScreen();
    expect(screen.queryByText('Martes: añadido')).not.toBeOnTheScreen();
  });

  it('AC-mobile-002-07: sin conexión se guarda en el teléfono y queda pendiente', async () => {
    fakes.remote.online = false;
    await fakes.store.saveCatalog(CATALOG);
    await openDetail();
    await press(screen.getByTestId('day-martes'));

    await press(screen.getByTestId('add-to-plan'));

    expect(await screen.findByText(/guardado en el teléfono; se enviará cuando haya conexión/)).toBeOnTheScreen();
    await press(screen.getByText('Ver mi rutina'));
    expect(await screen.findByText('pendiente de enviar')).toBeOnTheScreen();
  });
});

describe('Mi rutina (SPEC-mobile-002)', () => {
  const entry = (id: string, exerciseId: string, order: number) => ({ id, exerciseId, order, machineStepKg: null });

  beforeEach(async () => {
    await fakes.store.saveCatalog(CATALOG);
    await fakes.seedServer('martes', [
      entry('e1', 'press-plano-con-barra', 0),
      entry('e2', 'press-de-pecho-en-maquina', 1),
    ]);
  });

  it('AC-mobile-002-06: muestra los ejercicios agrupados por día', async () => {
    await openApp('/rutina');

    const martes = await screen.findByTestId('day-section-martes');
    expect(martes).toHaveTextContent(/1\. Press plano con barra/);
    expect(martes).toHaveTextContent(/2\. Press de pecho en máquina/);
    expect(martes).toHaveTextContent(/sincronizado/);
  });

  it('AC-mobile-002-06: reordena un ejercicio', async () => {
    await openApp('/rutina');
    await press(await screen.findByTestId('up-e2'));

    await waitFor(() => expect(screen.getByTestId('day-section-martes')).toHaveTextContent(/1\. Press de pecho en máquina/));
  });

  it('AC-mobile-002-06: quita un ejercicio', async () => {
    await openApp('/rutina');
    await press(await screen.findByTestId('remove-e1'));

    await waitFor(() => expect(screen.queryByText(/Press plano con barra/)).not.toBeOnTheScreen());
    expect(screen.getByTestId('day-section-martes')).toHaveTextContent(/1\. Press de pecho en máquina/);
  });

  it('un día que necesita confirmar muestra el aviso y el botón para confirmar', async () => {
    await fakes.store.setDayStatus('martes', 'needs_confirmation', 'Press plano con barra (pecho)');
    fakes.remote.dayResult = () => ({ kind: 'ok', entries: [] });
    await openApp('/rutina');

    expect(await screen.findByText('necesita confirmación')).toBeOnTheScreen();
    await press(screen.getByTestId('confirm-martes'));

    await waitFor(() => expect(screen.getByText('sincronizado')).toBeOnTheScreen());
  });

  it('AC-mobile-002-07: los cambios hechos sin conexión se envían al abrir la rutina con conexión', async () => {
    await fakes.store.saveDay('jueves', [entry('e9', 'press-plano-con-barra', 0)]);
    await openApp('/rutina');

    await waitFor(() => expect(fakes.remote.sent.map((s) => s.day)).toContain('jueves'));
    expect(fakes.remote.sent.find((s) => s.day === 'jueves')?.entries[0].id).toBe('e9');
  });

  it('sin ejercicios dice cómo empezar', async () => {
    fakes = createFakes();
    await openApp('/rutina');

    expect(await screen.findByText(/Aún no tienes ejercicios/)).toBeOnTheScreen();
  });
});

describe('Mi equipo (SPEC-mobile-002)', () => {
  it('AC-mobile-002-04: valida lo escrito y no guarda un valor inválido', async () => {
    await openApp('/equipo');
    await fireEvent.changeText(await screen.findByLabelText('Mancuernas disponibles (kg, separadas por comas)'), '20, abc');
    await fireEvent.changeText(screen.getByLabelText('Escalón de máquinas y poleas (kg)'), '0');

    await press(screen.getByTestId('save-equipment'));

    expect(await screen.findByText(/Mancuernas: no entiendo «abc»/)).toBeOnTheScreen();
    expect((await fakes.store.getEquipment()).profile).toBeNull();
  });

  it('AC-mobile-002-04: guarda el equipo, lo envía y lo muestra sincronizado', async () => {
    await openApp('/equipo');
    await fireEvent.changeText(await screen.findByLabelText('Mancuernas disponibles (kg, separadas por comas)'), '20, 22,5');
    await fireEvent.changeText(screen.getByLabelText('Discos disponibles (kg; uno por cada par)'), '2.5, 5');
    await fireEvent.changeText(screen.getByLabelText('Barra recta (kg)'), '20');
    await fireEvent.changeText(screen.getByLabelText('Escalón de máquinas y poleas (kg)'), '5');

    await press(screen.getByTestId('save-equipment'));

    await waitFor(() => expect(screen.getByTestId('equipment-status')).toHaveTextContent('Guardado y sincronizado.'));
    expect((await fakes.store.getEquipment()).profile).toMatchObject({ dumbbellsKg: [20, 22.5], discsKg: [2.5, 5], barsKg: { recta: 20 }, machineStepKg: 5 });
  });

  it('AC-mobile-002-07: sin conexión queda guardado en el teléfono', async () => {
    fakes.remote.online = false;
    await openApp('/equipo');
    await fireEvent.changeText(await screen.findByLabelText('Escalón de máquinas y poleas (kg)'), '5');

    await press(screen.getByTestId('save-equipment'));

    await waitFor(() => expect(screen.getByTestId('equipment-status')).toHaveTextContent(/Guardado en el teléfono/));
  });

  it('carga el perfil guardado en los campos', async () => {
    await fakes.store.saveEquipment(PROFILE);
    await fakes.store.setEquipmentStatus('synced', null);
    await openApp('/equipo');

    await waitFor(() => expect(screen.getByLabelText('Mancuernas disponibles (kg, separadas por comas)').props.value).toBe('20, 22.5'));
  });
});

describe('Más: tema (SPEC-mobile-002)', () => {
  let setScheme: jest.SpyInstance;

  // Appearance es global: se simula para que la elección de tema no contamine otras pruebas.
  beforeEach(() => {
    setScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
  });
  afterEach(() => setScheme.mockRestore());

  it('AC-mobile-002-10: la elección de tema se guarda en el teléfono', async () => {
    await openApp('/mas');

    await press(await screen.findByTestId('theme-dark'));

    await act(async () => {});
    expect(await fakes.store.getSetting('theme')).toBe('dark');
    expect(setScheme).toHaveBeenCalledWith('dark');
  });

  it('AC-mobile-002-10: recupera el tema guardado al abrir la app', async () => {
    await fakes.store.setSetting('theme', 'light');
    await openApp('/mas');

    expect(await screen.findByTestId('theme-light')).toBeOnTheScreen();
  });
});

describe('Navegación (ADR-0003)', () => {
  it('las cuatro pestañas están disponibles', async () => {
    await openApp();
    await screen.findByText('Pecho');

    await testRouter.navigate('/equipo');
    expect(screen).toHavePathname('/equipo');
    await testRouter.navigate('/mas');
    expect(screen).toHavePathname('/mas');
    await testRouter.navigate('/rutina');
    expect(screen).toHavePathname('/rutina');
  });
});
