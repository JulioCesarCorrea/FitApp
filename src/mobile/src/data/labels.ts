// Etiquetas en español para los valores del perfil y de las restricciones (SPEC-profile-001).
// Sin dependencias de React Native.

import type { ActivityLevel, CatalogSection, ExperienceLevel, Goal, RestrictionLevel, Sex } from './types';

// El catálogo guarda las zonas y los movimientos sin tildes; aquí se recuperan palabra a palabra.
const ACCENTS: Record<string, string> = {
  abduccion: 'abducción', apertura: 'apertura', biceps: 'bíceps', cuadriceps: 'cuádriceps', elevacion: 'elevación',
  extension: 'extensión', flexion: 'flexión', gluteo: 'glúteo', isometrico: 'isométrico', muneca: 'muñeca',
  rotacion: 'rotación', traccion: 'tracción', triceps: 'tríceps',
};

/** `extension_de_rodilla` → «Extensión de rodilla». Una palabra desconocida se deja tal cual (sin inventar tildes). */
export function humanize(slug: string): string {
  const text = slug.split('_').map((w) => ACCENTS[w] ?? w).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

/** Zonas del catálogo (primarias y secundarias) más el grupo «hombros». */
export function zonesFromCatalog(sections: CatalogSection[] | null): string[] {
  if (!sections) return [];
  const zones = sections.flatMap((s) => s.exercises).flatMap((e) => [e.primaryZone, ...e.secondaryZones]);
  return sorted([...zones, 'hombros']);
}

/** Movimientos que aparecen en el catálogo. */
export function movementsFromCatalog(sections: CatalogSection[] | null): string[] {
  if (!sections) return [];
  return sorted(sections.flatMap((s) => s.exercises).flatMap((e) => e.movements));
}

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export const SEX_OPTIONS: Option<Sex>[] = [
  { value: 'masculino', label: 'Masculino' },
  { value: 'femenino', label: 'Femenino' },
];

export const GOAL_OPTIONS: Option<Goal>[] = [
  { value: 'bajar_grasa', label: 'Bajar grasa', hint: 'Perder peso conservando el músculo.' },
  { value: 'ganar_musculo', label: 'Ganar músculo', hint: 'Aumentar masa muscular y fuerza.' },
  { value: 'mantener', label: 'Mantener', hint: 'Mantener el peso o recomponer el cuerpo.' },
];

export const ACTIVITY_OPTIONS: Option<ActivityLevel>[] = [
  { value: 'sedentario', label: 'Sedentario', hint: 'Trabajo sentado y casi nada de movimiento.' },
  { value: 'ligero', label: 'Ligero', hint: 'Caminas algo o te mueves un poco al día.' },
  { value: 'moderado', label: 'Moderado', hint: 'De pie o en movimiento buena parte del día.' },
  { value: 'muy_activo', label: 'Muy activo', hint: 'Trabajo físico o muchísimo movimiento diario.' },
];

export const EXPERIENCE_OPTIONS: Option<ExperienceLevel>[] = [
  { value: 'principiante', label: 'Principiante', hint: 'Menos de 6 meses entrenando.' },
  { value: 'intermedio', label: 'Intermedio', hint: 'De 6 meses a 2 años.' },
  { value: 'avanzado', label: 'Avanzado', hint: 'Más de 2 años de entrenamiento constante.' },
];

export const METHODOLOGY_OPTIONS: Option<'heavy_duty_personalizado'>[] = [
  {
    value: 'heavy_duty_personalizado',
    label: 'Heavy Duty personalizado',
    hint: '2 series efectivas por ejercicio: la primera sin llegar al fallo y la segunda hasta el fallo.',
  },
];

export const LEVEL_OPTIONS: Option<RestrictionLevel>[] = [
  { value: 'contexto', label: 'Contexto', hint: 'Solo informa. Puedes añadir el ejercicio sin interrupciones.' },
  { value: 'aviso', label: 'Aviso', hint: 'Te avisa y te pide confirmar antes de añadirlo a tu rutina.' },
  { value: 'bloqueo', label: 'Bloqueo', hint: 'No te deja añadir ese ejercicio a tu rutina.' },
];
