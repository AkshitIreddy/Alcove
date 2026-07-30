import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

// Minimal 24-bit BMP writer (NSIS wants classic BMPs).
function toBmp(width, height, rgba) {
  const rowSize = Math.ceil((24 * width) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;
  const buf = Buffer.alloc(fileSize);
  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y; // BMP is bottom-up
    for (let x = 0; x < width; x++) {
      const si = (srcRow * width + x) * 4;
      const di = 54 + y * rowSize + x * 3;
      buf[di] = rgba[si + 2];     // B
      buf[di + 1] = rgba[si + 1]; // G
      buf[di + 2] = rgba[si];     // R
    }
  }
  return buf;
}

const sidebarSvg = `<svg width="164" height="314" viewBox="0 0 164 314" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="vig" cx="50%" cy="38%" r="90%">
      <stop offset="0%" stop-color="#f9f4e7"/>
      <stop offset="70%" stop-color="#f3ecd6"/>
      <stop offset="100%" stop-color="#e9dcbe"/>
    </radialGradient>
  </defs>
  <rect width="164" height="314" fill="url(#vig)"/>
  <path d="M 14 12 C 60 8, 110 9, 150 12 C 154 60, 154 250, 150 302 C 104 306, 58 305, 14 302 C 10 248, 10 62, 14 12 Z"
        fill="none" stroke="#6b4a32" stroke-width="1.6" opacity="0.5"/>
  <g transform="translate(30 70) scale(0.10) rotate(-4 512 512)">
    <path d="M 356 250 C 470 240, 620 242, 706 250 C 718 251, 724 258, 725 270 C 730 420, 731 610, 726 742 C 725 754, 719 760, 707 761 C 610 768, 470 770, 362 764 Z" fill="#f4ecd8" stroke="#6b4a32" stroke-width="10"/>
    <path d="M 318 226 C 330 218, 348 214, 368 214 C 480 206, 600 208, 664 216 C 682 218, 690 228, 691 246 C 697 400, 698 600, 692 716 C 691 734, 682 743, 664 745 C 570 753, 452 754, 360 748 C 336 747, 322 744, 312 736 Z" fill="#c96f4a" stroke="#5d3a26" stroke-width="12"/>
    <path d="M 318 226 C 296 244, 286 268, 285 302 C 281 440, 281 560, 285 668 C 286 700, 296 722, 312 736 C 322 744, 336 747, 360 748 C 348 730, 343 706, 342 676 C 338 552, 338 420, 342 300 C 343 268, 350 242, 368 214 C 348 214, 330 218, 318 226 Z" fill="#a3502f" stroke="#5d3a26" stroke-width="12"/>
    <path d="M 340 330 C 330 331, 296 332, 287 331" fill="none" stroke="#e8b64c" stroke-width="18" stroke-linecap="round"/>
    <path d="M 340 634 C 330 635, 297 636, 288 635" fill="none" stroke="#e8b64c" stroke-width="18" stroke-linecap="round"/>
    <path d="M 574 748 C 573 782, 572 812, 574 842 C 575 852, 580 855, 588 850 C 597 843, 604 843, 612 849 C 620 855, 626 852, 626 842 C 627 812, 626 780, 624 748 Z" fill="#7d915c" stroke="#4f6138" stroke-width="10"/>
  </g>
  <text x="82" y="205" text-anchor="middle" font-family="Segoe Print, Comic Sans MS, cursive" font-size="26" fill="#5d3a26">Notebook</text>
  <text x="82" y="232" text-anchor="middle" font-family="Segoe Print, Comic Sans MS, cursive" font-size="11" fill="#8a6a48">your hand-drawn</text>
  <text x="82" y="248" text-anchor="middle" font-family="Segoe Print, Comic Sans MS, cursive" font-size="11" fill="#8a6a48">study library</text>
  <path d="M 40 268 C 60 264, 105 265, 124 268" fill="none" stroke="#c96f4a" stroke-width="2" opacity="0.6" stroke-linecap="round"/>
</svg>`;

const headerSvg = `<svg width="150" height="57" viewBox="0 0 150 57" xmlns="http://www.w3.org/2000/svg">
  <rect width="150" height="57" fill="#f7f1e3"/>
  <g transform="translate(8 8) scale(0.040)">
    <path d="M 318 226 C 330 218, 348 214, 368 214 C 480 206, 600 208, 664 216 C 682 218, 690 228, 691 246 C 697 400, 698 600, 692 716 C 691 734, 682 743, 664 745 C 570 753, 452 754, 360 748 C 336 747, 322 744, 312 736 Z" fill="#c96f4a" stroke="#5d3a26" stroke-width="14"/>
    <path d="M 318 226 C 296 244, 286 268, 285 302 C 281 440, 281 560, 285 668 C 286 700, 296 722, 312 736 C 322 744, 336 747, 360 748 C 348 730, 343 706, 342 676 C 338 552, 338 420, 342 300 C 343 268, 350 242, 368 214 C 348 214, 330 218, 318 226 Z" fill="#a3502f" stroke="#5d3a26" stroke-width="14"/>
  </g>
  <text x="56" y="36" font-family="Segoe Print, Comic Sans MS, cursive" font-size="17" fill="#5d3a26">Notebook</text>
</svg>`;

for (const [name, svg, w, h] of [
  ['installer-sidebar', sidebarSvg, 164, 314],
  ['installer-header', headerSvg, 150, 57],
]) {
  const raw = await sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().raw().toBuffer();
  writeFileSync(`${name}.bmp`, toBmp(w, h, raw));
  await sharp(Buffer.from(svg)).png().toFile(`${name}-preview.png`);
}
console.log('installer images done');
