import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

/** AC-mobile-001-05: muestra el tipo y el valor del código EAN/UPC leído. */
export function Scanner() {
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(false);
  const [last, setLast] = useState<{ type: string; data: string } | null>(null);
  const handled = useRef(false);

  if (!permission) return null; // cargando el estado del permiso

  if (!permission.granted) {
    return <Button title="Permitir cámara para escanear" onPress={requestPermission} />;
  }

  if (!active) {
    return (
      <View style={styles.box}>
        <Button
          title="Escanear código de barras"
          onPress={() => {
            handled.current = false;
            setActive(true);
          }}
        />
        {last && <Text style={styles.result}>{`${last.type}: ${last.data}`}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={({ type, data }) => {
          if (handled.current) return; // el evento se dispara varias veces por lectura
          handled.current = true;
          setLast({ type, data });
          setActive(false);
        }}
      />
      <Button title="Cancelar" onPress={() => setActive(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  camera: { height: 220, borderRadius: 8, overflow: 'hidden' },
  result: { fontSize: 16, fontWeight: '600' },
});
