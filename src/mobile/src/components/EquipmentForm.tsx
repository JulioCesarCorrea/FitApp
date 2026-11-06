import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDeps } from '../data/DataContext';
import { formatKgList, parseKg, parseKgList } from '../data/format';
import { useEquipment } from '../data/hooks';
import type { EquipmentProfile } from '../data/types';
import { useTheme } from '../theme';
import { Body, Button, Field, Muted } from './ui';

const BARS = [
  { key: 'recta', label: 'Barra recta (kg)' },
  { key: 'z', label: 'Barra Z (kg)' },
  { key: 'smith', label: 'Barra de la máquina Smith (kg)' },
  { key: 'remo_en_t', label: 'Soporte de remo en T (kg)' },
] as const;

/**
 * Formulario del perfil de equipamiento (SPEC-mobile-002, AC-04). Lo comparten la pestaña Equipo y el asistente de
 * bienvenida (SPEC-profile-001, AC-14): se guarda igual, primero en el teléfono y luego en la API.
 */
export function EquipmentForm() {
  const { colors } = useTheme();
  const { service } = useDeps();
  const { profile, status, message, reload } = useEquipment();

  const [dumbbells, setDumbbells] = useState('');
  const [discs, setDiscs] = useState('');
  const [bars, setBars] = useState<Record<string, string>>({});
  const [step, setStep] = useState('');
  const [base, setBase] = useState('');
  const [issues, setIssues] = useState<string[]>([]);

  useEffect(() => {
    if (!profile) return;
    setDumbbells(formatKgList(profile.dumbbellsKg));
    setDiscs(formatKgList(profile.discsKg));
    setBars(Object.fromEntries(Object.entries(profile.barsKg).map(([k, v]) => [k, String(v)])));
    setStep(String(profile.machineStepKg));
    setBase(String(profile.machineBaseKg));
  }, [profile]);

  const save = async () => {
    const found: string[] = [];
    const d = parseKgList(dumbbells);
    const c = parseKgList(discs);
    if (d.invalid.length) found.push(`Mancuernas: no entiendo «${d.invalid.join('», «')}».`);
    if (c.invalid.length) found.push(`Discos: no entiendo «${c.invalid.join('», «')}».`);

    const barsKg: Record<string, number> = {};
    for (const { key, label } of BARS) {
      const v = parseKg(bars[key] ?? '');
      if (v === 'invalid') found.push(`${label}: escribe un número.`);
      else if (v !== null) barsKg[key] = v;
    }

    const stepKg = parseKg(step);
    const baseKg = parseKg(base);
    if (stepKg === 'invalid' || stepKg === null) found.push('El escalón de las máquinas es obligatorio y debe ser un número.');
    if (baseKg === 'invalid') found.push('La carga base de las máquinas debe ser un número.');

    if (found.length === 0) {
      const next: EquipmentProfile = {
        dumbbellsKg: d.values,
        discsKg: c.values,
        barsKg,
        machineStepKg: stepKg as number,
        machineBaseKg: (baseKg as number | null) ?? 0,
      };
      const result = await service.saveEquipment(next);
      found.push(...result.issues.map((i) => i.message));
    }

    setIssues(found);
    await reload();
  };

  const statusText =
    status === 'synced' ? (profile ? 'Guardado y sincronizado.' : 'Aún no has registrado tu equipo.')
      : status === 'pending' ? 'Guardado en el teléfono; se enviará cuando haya conexión.'
      : `Rechazado: ${message ?? ''}`;

  return (
    <View style={styles.box}>
      <Field label="Mancuernas disponibles (kg, separadas por comas)" value={dumbbells} onChangeText={setDumbbells} placeholder="10, 12.5, 15, 17.5, 20" />
      <Field label="Discos disponibles (kg; uno por cada par)" value={discs} onChangeText={setDiscs} placeholder="1.25, 2.5, 5, 10, 20" />
      {BARS.map(({ key, label }) => (
        <Field
          key={key}
          label={label}
          value={bars[key] ?? ''}
          onChangeText={(t) => setBars((b) => ({ ...b, [key]: t }))}
          keyboardType="decimal-pad"
        />
      ))}
      <Field label="Escalón de máquinas y poleas (kg)" value={step} onChangeText={setStep} keyboardType="decimal-pad" placeholder="5" />
      <Field label="Carga base de las máquinas (kg, opcional)" value={base} onChangeText={setBase} keyboardType="decimal-pad" placeholder="0" />

      {issues.map((m) => (
        <Body key={m} style={{ color: colors.danger }}>{m}</Body>
      ))}
      <Button title="Guardar equipo" onPress={() => void save()} testID="save-equipment" />
      <Muted testID="equipment-status">{statusText}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
});
