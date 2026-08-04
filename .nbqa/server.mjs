import { chromium } from 'playwright';

const ctx = await chromium.launchPersistentContext(
  'C:/Users/akshi/AppData/Local/Temp/claude/nbqa-profile',
  {
    headless: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    args: [
      '--remote-debugging-port=9222',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
    ],
  },
);
console.log('READY', ctx.pages().length);
await new Promise(() => {});
