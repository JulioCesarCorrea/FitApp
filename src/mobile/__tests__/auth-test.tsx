import { act, configure, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { createDeps } from '../src/data/deps';
import { CATALOG, SESSION, createFakes } from './support';

// La app real abre SQLite, el almacén seguro y la API por HTTP; en estas pruebas se sustituyen por versiones en memoria.
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

const has = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const press = async (element: Parameters<typeof fireEvent.press>[0]) => fireEvent.press(element);
const type = async (label: string, value: string) => fireEvent.changeText(await screen.findByLabelText(label), value);

async function login(username = 'julio', password = 'contraseña-segura-1') {
  await type('Nombre de usuario', username);
  await type('Contraseña', password);
  await press(screen.getByTestId('login-submit'));
}

const GOOD = 'contraseña-segura-1';

describe('Pantallas protegidas (SPEC-mobile-004)', () => {
  beforeEach(() => {
    fakes = createFakes({ signedIn: false });
  });

  it.each(['/', '/mas', '/rutina', '/equipo', '/exercise/press-plano-con-barra', '/session/press-plano-con-barra', '/change-password'])(
    'AC-mobile-004-01: sin sesión %s redirige a Entrar',
    async (url) => {
      await openApp(url);

      expect(await screen.findByTestId('login-submit')).toBeOnTheScreen();
      expect(screen).toHavePathname('/login');
    },
  );

  it('AC-mobile-004-01: sin sesión se puede ir a Crear cuenta y volver', async () => {
    await openApp('/');
    await press(await screen.findByTestId('go-register'));

    expect(await screen.findByTestId('register-submit')).toBeOnTheScreen();
    expect(screen).toHavePathname('/register');

    await press(screen.getByTestId('go-login'));
    expect(await screen.findByTestId('login-submit')).toBeOnTheScreen();
  });
});

describe('Entrar (SPEC-mobile-004)', () => {
  beforeEach(() => {
    fakes = createFakes({ signedIn: false });
  });

  it('AC-mobile-004-02: con usuario y contraseña correctos se guarda la sesión y se abre la app', async () => {
    await openApp('/');
    await login();

    expect(await screen.findByText('Pecho')).toBeOnTheScreen();
    expect(fakes.tokens.session?.user.username).toBe('julio');
    expect(screen.queryByTestId('login-submit')).not.toBeOnTheScreen();
  });

  it('AC-mobile-004-02: con datos incorrectos muestra el mensaje y se queda en Entrar', async () => {
    await openApp('/');
    await login('julio', 'contraseña-equivocada');

    expect(await screen.findByTestId('login-message')).toHaveTextContent(has('Usuario o contraseña incorrectos.'));
    expect(screen.getByTestId('login-submit')).toBeOnTheScreen();
    expect(fakes.tokens.session).toBeNull();
  });

  it('AC-mobile-004-02: con los campos vacíos no se envía nada', async () => {
    await openApp('/');
    await press(await screen.findByTestId('login-submit'));

    expect(await screen.findByTestId('login-message')).toHaveTextContent(has('Escribe tu nombre de usuario.'));
    expect(fakes.authRemote.calls).toEqual([]);
  });

  it('AC-mobile-004-02: con la cuenta bloqueada indica cuánto esperar', async () => {
    fakes.authRemote.locked = true;
    await openApp('/');
    await login();

    expect(await screen.findByTestId('login-message')).toHaveTextContent(has('Espera 10 minutos'));
  });

  it('AC-mobile-004-12: sin conexión dice que hace falta conexión, no que la contraseña sea incorrecta', async () => {
    fakes.authRemote.online = false;
    await openApp('/');
    await login();

    const message = await screen.findByTestId('login-message');
    expect(message).toHaveTextContent(has('Necesitas conexión con el servidor para entrar.'));
    expect(message).not.toHaveTextContent(has('incorrectos'));
  });
});

describe('Crear cuenta (SPEC-mobile-004)', () => {
  beforeEach(() => {
    fakes = createFakes({ signedIn: false });
  });

  async function fillRegister(over: Partial<Record<'user' | 'pass' | 'confirm' | 'code', string>> = {}) {
    const v = { user: 'nuevo.user', pass: GOOD, confirm: GOOD, code: 'codigo-bueno', ...over };
    await type('Nombre de usuario', v.user);
    await type('Contraseña', v.pass);
    await type('Repite la contraseña', v.confirm);
    await type('Código de invitación', v.code);
    await press(screen.getByTestId('register-submit'));
  }

  it('AC-mobile-004-03: crea la cuenta y entra', async () => {
    await openApp('/register');
    await fillRegister();

    expect(await screen.findByText('Pecho')).toBeOnTheScreen();
    expect(fakes.tokens.session?.user.username).toBe('nuevo.user');
  });

  it('AC-mobile-004-03: valida en el teléfono y no envía nada si algo está mal', async () => {
    await openApp('/register');
    await fillRegister({ user: 'ab', pass: 'corta', confirm: 'otra', code: '' });

    const message = await screen.findByTestId('register-message');
    expect(message).toHaveTextContent(has('3 a 30 caracteres'));
    expect(message).toHaveTextContent(has('al menos 10 caracteres'));
    expect(message).toHaveTextContent(has('código de invitación'));
    expect(fakes.authRemote.calls).toEqual([]);
  });

  it('AC-mobile-004-03: la repetición de la contraseña tiene que coincidir', async () => {
    await openApp('/register');
    await fillRegister({ confirm: 'otra-contraseña-distinta' });

    expect(await screen.findByTestId('register-message')).toHaveTextContent(has('no coinciden'));
  });

  it('AC-mobile-004-03: un código incorrecto o un usuario ya usado muestran el motivo', async () => {
    await openApp('/register');
    await fillRegister({ code: 'otro-codigo' });
    expect(await screen.findByTestId('register-message')).toHaveTextContent(has('El código de invitación no es válido.'));

    await fillRegister({ user: 'julio' });
    await waitFor(() => expect(screen.getByTestId('register-message')).toHaveTextContent(has('Ese nombre de usuario ya está en uso.')));
  });

  it('AC-mobile-004-12: sin conexión dice que hace falta conexión', async () => {
    fakes.authRemote.online = false;
    await openApp('/register');
    await fillRegister();

    expect(await screen.findByTestId('register-message')).toHaveTextContent(has('Necesitas conexión'));
  });
});

describe('Sesión guardada y sesión expirada (SPEC-mobile-004)', () => {
  it('AC-mobile-004-04: con sesión guardada abre la app directamente, aunque no haya conexión', async () => {
    fakes = createFakes();
    await fakes.store.saveCatalog(CATALOG);
    fakes.remote.online = false;
    fakes.authRemote.online = false;

    await openApp('/');

    expect(await screen.findByText('Press plano con barra')).toBeOnTheScreen();
    expect(screen.queryByTestId('login-submit')).not.toBeOnTheScreen();
  });

  it('AC-mobile-004-06: si la API rechaza la renovación vuelve a Entrar con un aviso y sin borrar los datos', async () => {
    fakes = createFakes({ session: { ...SESSION, expiresAt: Date.now() - 1000 } });
    await fakes.store.saveDay('martes', [{ id: 'p1', exerciseId: 'press-plano-con-barra', order: 0, machineStepKg: null }]);
    await openApp('/');
    await screen.findByText('Pecho');

    await act(async () => {
      await fakes.auth.token(); // la renovación se rechaza: la sesión terminó
    });

    expect(await screen.findByTestId('session-notice')).toHaveTextContent(has('Tu sesión terminó.'));
    expect(screen.getByTestId('login-submit')).toBeOnTheScreen();
    expect((await fakes.store.getDays()).length).toBe(1);
  });
});

describe('Otra cuenta en el mismo teléfono (SPEC-mobile-004)', () => {
  beforeEach(async () => {
    fakes = createFakes({ signedIn: false });
    await fakes.store.setSetting('localUserId', 'user-2'); // los datos son de «ana»
    await fakes.store.saveDay('martes', [{ id: 'p1', exerciseId: 'press-plano-con-barra', order: 0, machineStepKg: null }]);
  });

  it('AC-mobile-004-07: con cambios sin enviar de la otra cuenta pide confirmación antes de entrar', async () => {
    await openApp('/');
    await login(); // «julio»

    expect(await screen.findByTestId('replace-warning')).toHaveTextContent(has('1 cambio sin enviar de otra cuenta'));
    expect(screen.queryByText('Pecho')).not.toBeOnTheScreen();
    expect((await fakes.store.getDays()).length).toBe(1);
  });

  it('AC-mobile-004-07: al confirmar se borran los datos de la otra cuenta y se entra', async () => {
    await openApp('/');
    await login();
    await press(await screen.findByTestId('confirm-replace'));

    expect(await screen.findByText('Pecho')).toBeOnTheScreen();
    expect(await fakes.store.getDays()).toEqual([]);
    expect(await fakes.store.getSetting('localUserId')).toBe('user-1');
  });

  it('AC-mobile-004-07: al cancelar no se entra y no se borra nada', async () => {
    await openApp('/');
    await login();
    await press(await screen.findByTestId('cancel-replace'));

    await waitFor(() => expect(screen.queryByTestId('replace-warning')).not.toBeOnTheScreen());
    expect(screen.getByTestId('login-submit')).toBeOnTheScreen();
    expect((await fakes.store.getDays()).length).toBe(1);
    expect(fakes.authRemote.calls).toContain('logout');
  });
});

describe('Cuenta en Más (SPEC-mobile-004)', () => {
  beforeEach(() => {
    fakes = createFakes();
  });

  it('AC-mobile-004-08: muestra el usuario con la sesión iniciada', async () => {
    await openApp('/mas');

    expect(await screen.findByTestId('account-username')).toHaveTextContent('Sesión iniciada como julio');
  });

  it('AC-mobile-004-08: cerrar sesión pide confirmar, borra los datos del teléfono y vuelve a Entrar', async () => {
    await fakes.store.setSetting('theme', 'dark');
    await fakes.store.saveDay('martes', [{ id: 'p1', exerciseId: 'press-plano-con-barra', order: 0, machineStepKg: null }]);
    await fakes.store.setDayStatus('martes', 'synced', null);
    await openApp('/mas');
    await press(await screen.findByTestId('sign-out'));

    expect(await screen.findByTestId('signout-warning')).toHaveTextContent(has('Se borrarán los datos de este teléfono'));
    await press(screen.getByTestId('confirm-sign-out'));

    expect(await screen.findByTestId('login-submit')).toBeOnTheScreen();
    expect(await fakes.store.getDays()).toEqual([]);
    expect(await fakes.store.getSetting('theme')).toBe('dark');
    expect(fakes.tokens.session).toBeNull();
    expect(fakes.authRemote.calls).toContain('logout');
  });

  it('AC-mobile-004-08: con cambios sin enviar avisa de que se perderán', async () => {
    await fakes.store.saveDay('martes', [{ id: 'p1', exerciseId: 'press-plano-con-barra', order: 0, machineStepKg: null }]);
    await openApp('/mas');
    await press(await screen.findByTestId('sign-out'));

    expect(await screen.findByTestId('signout-warning')).toHaveTextContent(has('Tienes 1 cambio sin enviar. Si cierras sesión se perderán.'));
  });

  it('AC-mobile-004-08: cancelar no cierra la sesión', async () => {
    await openApp('/mas');
    await press(await screen.findByTestId('sign-out'));
    await press(await screen.findByTestId('cancel-sign-out'));

    expect(screen.queryByTestId('signout-warning')).not.toBeOnTheScreen();
    expect(fakes.tokens.session).not.toBeNull();
  });
});

describe('Cambiar contraseña (SPEC-mobile-004)', () => {
  async function fillChange(over: Partial<Record<'current' | 'next' | 'confirm', string>> = {}) {
    const v = { current: GOOD, next: 'nueva-contraseña-2', confirm: 'nueva-contraseña-2', ...over };
    await type('Contraseña actual', v.current);
    await type('Contraseña nueva', v.next);
    await type('Repite la contraseña nueva', v.confirm);
    await press(screen.getByTestId('change-password-submit'));
  }

  it('AC-mobile-004-09: desde Más cambia la contraseña y lo confirma', async () => {
    fakes = createFakes();
    await openApp('/mas');
    await press(await screen.findByTestId('go-change-password'));
    await fillChange();

    expect(await screen.findByTestId('password-changed')).toBeOnTheScreen();
    expect(fakes.authRemote.accounts.get('julio')?.password).toBe('nueva-contraseña-2');
    expect(fakes.tokens.session?.accessToken).toBe('access-1');
  });

  it('AC-mobile-004-09: valida en el teléfono y muestra el motivo de la API si la actual no coincide', async () => {
    fakes = createFakes();
    await openApp('/change-password');
    await fillChange({ next: 'corta', confirm: 'corta' });
    expect(await screen.findByTestId('password-message')).toHaveTextContent(has('al menos 10 caracteres'));

    await fillChange({ current: 'no-es-esta-actual' });
    await waitFor(() => expect(screen.getByTestId('password-message')).toHaveTextContent(has('La contraseña actual no es correcta.')));
  });

  it('AC-mobile-004-10: con cambio obligatorio solo se ve esta pantalla hasta completarla', async () => {
    fakes = createFakes({ session: { ...SESSION, user: { ...SESSION.user, mustChangePassword: true } } });
    fakes.authRemote.accounts.get('julio')!.mustChange = true;
    await openApp('/');

    expect(await screen.findByTestId('forced-notice')).toBeOnTheScreen();
    expect(screen).toHavePathname('/change-password');
    expect(screen.queryByText('Pecho')).not.toBeOnTheScreen();

    await fillChange();

    expect(await screen.findByText('Pecho')).toBeOnTheScreen();
  });

  it('AC-mobile-004-10: con cambio obligatorio no se puede abrir otra pantalla', async () => {
    fakes = createFakes({ session: { ...SESSION, user: { ...SESSION.user, mustChangePassword: true } } });
    await openApp('/mas');

    expect(await screen.findByTestId('forced-notice')).toBeOnTheScreen();
    expect(screen).toHavePathname('/change-password');
  });
});

describe('Tema claro y oscuro (SPEC-mobile-004)', () => {
  it.each([
    ['light', '#111827'],
    ['dark', '#F3F4F6'],
  ])('AC-mobile-004-13: Entrar usa el texto del tema %s', async (mode, textColor) => {
    fakes = createFakes({ signedIn: false });
    await fakes.store.setSetting('theme', mode);
    await openApp('/');

    const title = (await screen.findAllByText('Entrar'))[0];

    expect(title).toHaveStyle({ color: textColor });
  });
});
