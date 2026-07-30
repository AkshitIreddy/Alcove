import sharp from 'sharp';

const svg = 'icon.svg';

// full-size render
await sharp(svg, { density: 96 }).resize(1024, 1024).png().toFile('icon-1024.png');

// contact sheet: 256, 64, 32, 16 on neutral dark + light strips to judge taskbar readability
const sizes = [256, 64, 32, 16];
const rendered = await Promise.all(
  sizes.map(s => sharp(svg).resize(s, s).png().toBuffer())
);

const sheetW = 256 + 24 + 64 + 24 + 32 + 24 + 16 + 48 * 2;
const sheetH = 256 + 96;
const composites = [];
let x = 48;
for (let i = 0; i < sizes.length; i++) {
  composites.push({ input: rendered[i], left: x, top: 48 });
  x += sizes[i] + 24;
}
await sharp({ create: { width: sheetW, height: sheetH, channels: 4, background: '#2b2b2b' } })
  .composite(composites)
  .png()
  .toFile('contact-dark.png');
await sharp({ create: { width: sheetW, height: sheetH, channels: 4, background: '#e8e8e8' } })
  .composite(composites)
  .png()
  .toFile('contact-light.png');

console.log('done');
