import {Platform} from 'react-native';

/**
 * Ob „cuda“ als Gerät auf dieser Plattform unterstützt wird.
 * macOS: nein (kein NVIDIA-CUDA wie unter Windows).
 * Windows: grundsätzlich ja (effektiv nur mit NVIDIA-GPU; detaillierte
 * Treiber/GPU-Erkennung kann später nativ ergänzt werden).
 */
export function isCudaDeviceSupportedOnThisPlatform(): boolean {
  if (Platform.OS === 'macos') {
    return false;
  }
  if (Platform.OS === 'windows') {
    return true;
  }
  return false;
}
