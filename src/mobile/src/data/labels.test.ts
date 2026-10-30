import { describe, expect, it } from 'vitest';
import { humanize, movementsFromCatalog, zonesFromCatalog } from './labels';
import type { CatalogSection } from './types';

const catalog: CatalogSection[] = [
  {
    name: 'Pecho',
    exercises: [
      { id: 'a', name: 'A', primaryZone: 'pecho', secondaryZones: ['hombro_frontal', 'triceps'], movements: ['empuje_horizontal', 'extension_de_codo'], equipment: 'Barra', bar: 'Recta', images: [] },
      { id: 'b', name: 'B', primaryZone: 'cuadriceps', secondaryZones: ['gluteo'], movements: ['extension_de_rodilla', 'empuje_horizontal'], equipment: 'Maquina', bar: null, images: [] },
    ],
  },
];

describe('etiquetas en español (SPEC-profile-001, reglas y datos)', () => {
  it.each([
    ['pecho', 'Pecho'],
    ['espalda_baja', 'Espalda baja'],
    ['hombro_frontal', 'Hombro frontal'],
    ['cuadriceps', 'Cuádriceps'],
    ['biceps', 'Bíceps'],
    ['triceps', 'Tríceps'],
    ['gluteo', 'Glúteo'],
    ['extension_de_rodilla', 'Extensión de rodilla'],
    ['abduccion_de_cadera', 'Abducción de cadera'],
    ['traccion_vertical', 'Tracción vertical'],
    ['rotacion_de_tronco', 'Rotación de tronco'],
    ['flexion_profunda_de_cadera', 'Flexión profunda de cadera'],
    ['extension_de_muneca', 'Extensión de muñeca'],
    ['isometrico_de_core', 'Isométrico de core'],
    ['hombros', 'Hombros'],
  ])('AC-profile-001-15 «%s» se muestra como «%s»', (slug, label) => {
    expect(humanize(slug)).toBe(label);
  });

  it('AC-profile-001-15 una palabra desconocida se capitaliza sin inventar tildes', () => {
    expect(humanize('movimiento_nuevo')).toBe('Movimiento nuevo');
  });

  it('AC-profile-001-15 las zonas salen del catálogo, sin repetidos, ordenadas y con el grupo «hombros»', () => {
    expect(zonesFromCatalog(catalog)).toEqual(['cuadriceps', 'gluteo', 'hombro_frontal', 'hombros', 'pecho', 'triceps']);
  });

  it('AC-profile-001-15 los movimientos salen del catálogo, sin repetidos y ordenados', () => {
    expect(movementsFromCatalog(catalog)).toEqual(['empuje_horizontal', 'extension_de_codo', 'extension_de_rodilla']);
  });

  it('AC-profile-001-15 sin catálogo las listas están vacías', () => {
    expect(zonesFromCatalog(null)).toEqual([]);
    expect(movementsFromCatalog(null)).toEqual([]);
  });
});
