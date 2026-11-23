import * as ImagePicker from 'expo-image-picker';
import type { CapturedPhoto, PhotoCapture } from './foodPhotoService';

/**
 * Cámara real con expo-image-picker (SPEC-ai-003, AC-10): el permiso se pide al tocar «Hacer foto», no antes. Se pide la foto ya comprimida
 * (calidad 0,5) en base64 y sin editar; la API le quita los metadatos antes de enviarla a la IA.
 */
export class ImagePickerCapture implements PhotoCapture {
  async capture(): Promise<CapturedPhoto> {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { kind: 'denied', canAskAgain: permission.canAskAgain };

    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, base64: true, exif: false, allowsEditing: false });
    const base64 = result.canceled ? null : result.assets[0]?.base64 ?? null;
    return base64 ? { kind: 'ok', base64 } : { kind: 'cancelled' };
  }
}
