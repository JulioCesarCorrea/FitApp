import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Muted } from './ui';

/**
 * Lector de códigos de barras de alimentos (SPEC-nutrition-001, AC-17). Avisa una sola vez del código leído; quien lo
 * usa decide qué hacer con él. Pide el permiso de cámara la primera vez.
 */
export function BarcodeScanner({ onScanned, onCancel }: { onScanned: (code: string) => void; onCancel: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  if (!permission) return null; // cargando el estado del permiso

  if (!permission.granted) {
    return (
      <View style={styles.box}>
        <Muted>Para escanear necesitas permitir el uso de la cámara.</Muted>
        <Button title="Permitir cámara" onPress={requestPermission} testID="allow-camera" />
        <Button title="Cancelar" variant="secondary" onPress={onCancel} />
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return; // el evento se dispara varias veces por lectura
          handled.current = true;
          onScanned(data);
        }}
      />
      <Button title="Cancelar" variant="secondary" onPress={onCancel} testID="cancel-scan" />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  camera: { height: 220, borderRadius: 8, overflow: 'hidden' },
});
