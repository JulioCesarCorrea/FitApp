import { describe, expect, it } from 'vitest';
import app from '../app.json';
import eas from '../eas.json';

// SPEC-deploy-001, AC-deploy-001-10: la app instalable tiene identidad propia y su APK sale del perfil «preview».

describe('configuración de la app instalable (SPEC-deploy-001)', () => {
  it('AC-deploy-001-10 tiene nombre y paquete Android propios, no los de la plantilla', () => {
    expect(app.expo.name).not.toBe('mobile');
    expect(app.expo.slug).not.toBe('mobile');
    expect(app.expo.android.package).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
    expect(app.expo.android.package).not.toMatch(/^com\.(anonymous|example)\b/);
  });

  it('AC-deploy-001-10 el perfil preview genera un APK de distribución interna', () => {
    expect(eas.build.preview.distribution).toBe('internal');
    expect(eas.build.preview.android.buildType).toBe('apk');
  });

  it('AC-deploy-001-10 la URL de la API no está escrita en el repositorio: viene del entorno de EAS', () => {
    expect(eas.build.preview.environment).toBe('preview');
    const text = JSON.stringify(eas) + JSON.stringify(app);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toContain('EXPO_PUBLIC_API_URL');
  });

  it('AC-deploy-001-10 no hay secretos en la configuración (el código de invitación no se incrusta)', () => {
    expect(JSON.stringify(eas) + JSON.stringify(app)).not.toMatch(/invite|jwt|password/i);
  });
});
