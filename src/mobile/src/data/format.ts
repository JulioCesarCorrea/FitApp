import type { SessionAdvice } from './sessionService';
import type { LocalExerciseLog } from './types';

/** Convierte «20, 22,5; 25» en [20, 22.5, 25]. `invalid` lista los fragmentos que no son números. */
export function parseKgList(text: string): { values: number[]; invalid: string[] } {
  const parts = text.split(/[;\s]+|,(?=\s)/).map((p) => p.trim()).filter(Boolean);
  const values: number[] = [];
  const invalid: string[] = [];
  for (const part of parts) {
    const n = Number(part.replace(',', '.'));
    if (Number.isFinite(n)) values.push(n);
    else invalid.push(part);
  }
  return { values, invalid };
}

/** Un solo número en kg; vacío vale null. */
export function parseKg(text: string): number | null | 'invalid' {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : 'invalid';
}

export const formatKgList = (values: number[]): string => values.join(', ');

/** Una línea del historial: carga y repeticiones de las dos series. */
export function formatLogLine(log: Pick<LocalExerciseLog, 'loadKg' | 'firstSetReps' | 'secondSetReps' | 'secondSetAssistedReps'>): string {
  const load = log.loadKg === 0 ? 'sin lastre' : `${log.loadKg} kg`;
  const assisted = log.secondSetAssistedReps > 0 ? ` + ${log.secondSetAssistedReps} asistidas` : '';
  return `${load} · Serie 1: ${log.firstSetReps} · Serie 2: ${log.secondSetReps}${assisted}`;
}

const EVALUATION_HINT = {
  por_debajo: 'Serie 1 por debajo de 6: la carga fue demasiado alta.',
  en_banda: 'Serie 1 dentro de la banda (de 6 a 8).',
  meta_alcanzada: 'Serie 1: alcanzaste la meta de 9.',
  por_encima: 'Serie 1 por encima de 9: la carga está ligera.',
  techo: 'Serie 1 en el techo de 12.',
} as const;

/** Textos del consejo de carga (AC-mobile-003-09): sugerencias, no órdenes. */
export function describeAdvice(a: SessionAdvice): string[] {
  const { advice } = a;
  const lines: string[] = [];

  if (a.needsEquipment) {
    lines.push('Configura tu equipamiento (pestaña Equipo) para recibir cargas sugeridas.');
  } else if (advice.action === 'subir') {
    lines.push(`Sugerencia: sube a ${advice.nextLoadKg} kg en la próxima sesión.`);
  } else if (advice.missingLoadData) {
    lines.push(
      `Cumples la condición para subir, pero tu equipamiento no tiene una carga superior a ${advice.nextLoadKg} kg. ` +
        'Mantén la carga o añade la que falta en tu perfil de equipo.',
    );
  } else {
    lines.push(advice.nextLoadKg > 0 ? `Sugerencia: mantén ${advice.nextLoadKg} kg.` : 'Sugerencia: mantén la carga actual.');
  }
  lines.push(EVALUATION_HINT[a.firstSetEvaluation]);
  return lines;
}
