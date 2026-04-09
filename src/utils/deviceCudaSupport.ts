import { Platform } from "react-native";

/**
 * Whether "cuda" is offered as a device on this platform.
 * macOS: false (no NVIDIA CUDA stack).
 * Windows: true in principle (requires NVIDIA GPU in practice; native driver checks can be added later).
 */
export function isCudaDeviceSupportedOnThisPlatform(): boolean {
  if (Platform.OS === "macos") {
    return false;
  }
  if (Platform.OS === "windows") {
    return true;
  }
  return false;
}
