export const Color = {
  transparent: "transparent",

  // Basic colors
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
  black: "#000000",
  white: "#ffffff",
  gray: "#808080",

  // Grayscale
  gray50: "#fafafa",
  gray100: "#f5f5f5",
  gray200: "#eeeeee",
  gray300: "#e0e0e0",
  gray400: "#bdbdbd",
  gray500: "#9e9e9e",
  gray600: "#757575",
  gray700: "#616161",
  gray800: "#424242",
  gray900: "#212121",

  // Semantic UI colors
  primary: "#007AFF",
  secondary: "#5856D6",
  success: "#34C759",
  warning: "#FF9500",
  destructive: "#FF3B30",
  info: "#5AC8FA",

  // Reds
  lightCoral: "#f08080",
  salmon: "#fa8072",
  crimson: "#dc143c",
  darkRed: "#8b0000",

  // Oranges / Yellows
  amber: "#ffc107",
  gold: "#ffd700",
  yellow: "#ffff00",
  lemon: "#fff44f",
  darkOrange: "#ff8c00",

  // Greens
  lime: "#32cd32",
  mint: "#98ff98",
  olive: "#808000",
  darkGreen: "#006400",
  teal: "#008080",

  // Cyans / Blues
  cyan: "#00ffff",
  skyBlue: "#87ceeb",
  dodgerBlue: "#1e90ff",
  royalBlue: "#4169e1",
  navy: "#000080",

  // Purples / Pinks
  violet: "#8f00ff",
  purple: "#800080",
  indigo: "#4b0082",
  magenta: "#ff00ff",
  pink: "#ffc0cb",
  hotPink: "#ff69b4",

  // Browns / Earth tones
  brown: "#a52a2a",
  sienna: "#a0522d",
  chocolate: "#d2691e",
  tan: "#d2b48c",
  beige: "#f5f5dc",

  // Dark UI helper colors
  backgroundDark: "#121212",
  surfaceDark: "#1c1c1e",
  borderDark: "#2c2c2e",
  textPrimaryDark: "#f2f2f7",
  textSecondaryDark: "#8e8e93",

  // Light UI helper colors
  backgroundLight: "#ffffff",
  surfaceLight: "#f2f2f7",
  borderLight: "#d1d1d6",
  textPrimaryLight: "#1c1c1e",
  textSecondaryLight: "#6e6e73",
} as const;

export type ColorValue = (typeof Color)[keyof typeof Color];

export enum Size {
  size_2 = "size_2",
  size_4 = "size_4",
  size_8 = "size_8",
  size_12 = "size_12",
  size_16 = "size_16",
  size_20 = "size_20",
  size_24 = "size_24",
  size_32 = "size_32",
  size_48 = "size_48",
  size_64 = "size_64",
}

export const SizePx: Record<Size, number> = {
  [Size.size_2]: 2,
  [Size.size_4]: 4,
  [Size.size_8]: 8,
  [Size.size_12]: 12,
  [Size.size_16]: 16,
  [Size.size_20]: 20,
  [Size.size_24]: 24,
  [Size.size_32]: 32,
  [Size.size_48]: 48,
  [Size.size_64]: 64,
};

export const THUMB_SIZE = 24;
export const MODE_OPTIONS = [
  "tiny",
  "base",
  "small",
  "medium",
  "large",
] as const;
export const DEVICE_OPTIONS = ["cpu", "cuda"] as const;
export const CONVERSION_STEP_TITLES: Record<number, string> = {
  1: "Count MP3 files",
  2: "Detect chapter positions",
  3: "Embed chapters in M4A",
  4: "Create audiobook (M4B)",
};
