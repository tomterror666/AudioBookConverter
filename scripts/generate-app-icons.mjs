/**
 * Rasterizes design/app-icon.svg into macOS and iOS AppIcon.appiconset PNGs.
 * Run: npm run icons  (requires devDependency `sharp`)
 */
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = join(root, 'design', 'app-icon.svg');
const svg = readFileSync(svgPath);

async function png(w, h, out) {
  await sharp(svg)
    .resize(w, h)
    .flatten({ background: { r: 216, g: 236, b: 244 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
}

const macDir = join(
  root,
  'macos',
  'AudioBookConverter-macOS',
  'Assets.xcassets',
  'AppIcon.appiconset',
);
const iosDir = join(
  root,
  'ios',
  'AudioBookConverter',
  'Images.xcassets',
  'AppIcon.appiconset',
);

const mac = [
  ['icon_16x16.png', 16, 16],
  ['icon_16x16@2x.png', 32, 32],
  ['icon_32x32.png', 32, 32],
  ['icon_32x32@2x.png', 64, 64],
  ['icon_128x128.png', 128, 128],
  ['icon_128x128@2x.png', 256, 256],
  ['icon_256x256.png', 256, 256],
  ['icon_256x256@2x.png', 512, 512],
  ['icon_512x512.png', 512, 512],
  ['icon_512x512@2x.png', 1024, 1024],
];

const ios = [
  ['Icon-App-20x20@2x.png', 40, 40],
  ['Icon-App-20x20@3x.png', 60, 60],
  ['Icon-App-29x29@2x.png', 58, 58],
  ['Icon-App-29x29@3x.png', 87, 87],
  ['Icon-App-40x40@2x.png', 80, 80],
  ['Icon-App-40x40@3x.png', 120, 120],
  ['Icon-App-60x60@2x.png', 120, 120],
  ['Icon-App-60x60@3x.png', 180, 180],
  ['Icon-App-1024x1024.png', 1024, 1024],
];

async function main() {
  for (const [name, w, h] of mac) {
    await png(w, h, join(macDir, name));
    process.stdout.write(`wrote macOS ${name}\n`);
  }
  for (const [name, w, h] of ios) {
    await png(w, h, join(iosDir, name));
    process.stdout.write(`wrote iOS ${name}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
