import { describe, expect, it } from 'vitest';
import { validateChangePassword, validateLogin, validateRegister } from './authForms';

const valid = { username: 'julio.c', password: 'contraseña-segura-1', confirm: 'contraseña-segura-1', inviteCode: 'codigo' };
const fields = (issues: { field: string }[]) => issues.map((i) => i.field);

describe('formulario de entrar (AC-mobile-004-02)', () => {
  it('AC-mobile-004-02 exige usuario y contraseña', () => {
    expect(fields(validateLogin({ username: '  ', password: '' }))).toEqual(['username', 'password']);
    expect(validateLogin({ username: 'julio', password: 'x' })).toEqual([]);
  });
});

describe('formulario de crear cuenta (AC-mobile-004-03)', () => {
  it('AC-mobile-004-03 acepta datos válidos, también con mayúsculas y espacios al borde en el usuario', () => {
    expect(validateRegister(valid)).toEqual([]);
    expect(validateRegister({ ...valid, username: '  Julio_C-1  ' })).toEqual([]);
  });

  it.each([
    ['usuario de menos de 3 caracteres', { username: 'ab' }, 'username'],
    ['usuario de más de 30 caracteres', { username: 'a'.repeat(31) }, 'username'],
    ['usuario con espacios', { username: 'con espacio' }, 'username'],
    ['usuario con acentos', { username: 'acentuación' }, 'username'],
    ['contraseña de menos de 10 caracteres', { password: 'corta123', confirm: 'corta123' }, 'password'],
    ['contraseña de más de 128 caracteres', { password: 'a'.repeat(129), confirm: 'a'.repeat(129) }, 'password'],
    ['contraseña igual al usuario', { username: 'usuario.largo', password: 'usuario.largo', confirm: 'usuario.largo' }, 'password'],
    ['repetición distinta', { confirm: 'otra-contraseña-2' }, 'confirm'],
    ['sin código de invitación', { inviteCode: '  ' }, 'inviteCode'],
  ] as const)('AC-mobile-004-03 rechaza %s', (_name, over, field) => {
    expect(fields(validateRegister({ ...valid, ...over }))).toContain(field);
  });
});

describe('formulario de cambiar contraseña (AC-mobile-004-09)', () => {
  const ok = { current: 'actual-contraseña-1', next: 'nueva-contraseña-2', confirm: 'nueva-contraseña-2' };

  it('AC-mobile-004-09 acepta una nueva válida', () => {
    expect(validateChangePassword(ok, 'julio.c')).toEqual([]);
  });

  it.each([
    ['sin la actual', { current: '' }, 'current'],
    ['nueva demasiado corta', { next: 'corta', confirm: 'corta' }, 'next'],
    ['nueva igual al usuario', { next: 'julio.c.usuario', confirm: 'julio.c.usuario' }, 'next'],
    ['repetición distinta', { confirm: 'otra-distinta-9' }, 'confirm'],
  ] as const)('AC-mobile-004-09 rechaza %s', (_name, over, field) => {
    const username = field === 'next' && over.next === 'julio.c.usuario' ? 'julio.c.usuario' : 'julio.c';
    expect(fields(validateChangePassword({ ...ok, ...over }, username))).toContain(field);
  });
});
