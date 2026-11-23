import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';

export interface ChartPoint {
  /** Posición horizontal (p. ej. el día como número). */
  x: number;
  y: number;
}

export interface ChartSeries {
  key: string;
  points: ChartPoint[];
  /** Color del tema; la tendencia se dibuja con otro color que los puntos registrados. */
  color: string;
  /** Con `dots` se marca cada punto (datos registrados); sin ellos solo se dibuja la línea (estimación). */
  dots?: boolean;
}

const HEIGHT = 160;
const PAD = 10;

/**
 * Gráfico de líneas sin dependencias (SPEC-progress-002, AC-07): segmentos y puntos con vistas. Pensado para pocas series y
 * pocas decenas de puntos. El significado nunca depende solo del color: el llamador añade un texto con los valores.
 */
export function LineChart({
  series, yLabels, accessibilityLabel, testID,
}: {
  series: ChartSeries[];
  /** Texto del valor mínimo y máximo del eje vertical. */
  yLabels: { min: string; max: string };
  accessibilityLabel: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  // Hasta que se mide la caja se usa un ancho razonable (y en las pruebas, que no miden, también).
  const [width, setWidth] = useState(300);

  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
  const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];
  const px = (x: number) => PAD + (xMax === xMin ? (width - 2 * PAD) / 2 : ((x - xMin) / (xMax - xMin)) * (width - 2 * PAD));
  const py = (y: number) => PAD + (yMax === yMin ? (HEIGHT - 2 * PAD) / 2 : (1 - (y - yMin) / (yMax - yMin)) * (HEIGHT - 2 * PAD));

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(Math.max(120, e.nativeEvent.layout.width))}
      style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}
    >
      <View style={{ height: HEIGHT }}>
        {series.map((s) => (
          <View key={s.key} style={StyleSheet.absoluteFill} pointerEvents="none">
            {s.points.slice(1).map((p, i) => {
              const a = s.points[i];
              const [x1, y1, x2, y2] = [px(a.x), py(a.y), px(p.x), py(p.y)];
              const length = Math.hypot(x2 - x1, y2 - y1);
              return (
                <View
                  key={`l${i}`}
                  style={{
                    position: 'absolute', left: (x1 + x2) / 2 - length / 2, top: (y1 + y2) / 2 - 1, width: length, height: 2,
                    backgroundColor: s.color, transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }],
                  }}
                />
              );
            })}
            {s.dots && s.points.map((p, i) => (
              <View
                key={`d${i}`}
                style={{ position: 'absolute', left: px(p.x) - 3, top: py(p.y) - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: s.color }}
              />
            ))}
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        <Text style={{ color: colors.textMuted }}>{yLabels.min}</Text>
        <Text style={{ color: colors.textMuted }}>{yLabels.max}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 10, padding: 6 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: PAD },
});
