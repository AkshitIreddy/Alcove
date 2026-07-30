/**
 * Notebook Script insert flow, end to end: paste script → live preview →
 * insert → real sticky-note and tree-diagram nodes render on the page.
 */
import { expect, test } from 'playwright/test';
import { openBlankPage } from './helpers';

const SCRIPT = `# Script test {sticker=star}

::: sticky-note {color=lemon, rotate=-2}
Inserted by the **E2E** suite.
:::

\`\`\`tree {style=watercolor}
Root
  Branch A
    Leaf 1
  Branch B
\`\`\`
`;

test('insert script renders a sticky note and a tree diagram', async ({
  page,
}) => {
  const prose = await openBlankPage(page);
  // Focus the blank page so the dialog inserts into this editor.
  await prose.click();

  await page.getByRole('button', { name: 'Insert script' }).click();
  const dialog = page.locator('.nb-ins-card');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  await dialog.locator('.nb-ins-textarea').fill(SCRIPT);
  // Live preview picks the script up (debounced parse).
  await expect(dialog.locator('.nb-ins-preview')).not.toContainText(
    'the preview appears here',
    { timeout: 15_000 },
  );
  // The authored script is clean — no parse warnings.
  await expect(dialog.locator('.nb-ins-warnings')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  // Real nodes landed in the editor document.
  await expect(prose.locator('[data-type="sticky-note"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(prose.locator('[data-type="sticky-note"]')).toContainText(
    'Inserted by the E2E suite.',
  );
  const diagram = prose.locator('.nb-diagram');
  await expect(diagram).toBeVisible({ timeout: 30_000 });
  // The tree actually laid out and drew nodes (svg with text labels).
  await expect(diagram.locator('svg')).toBeVisible({ timeout: 30_000 });
  await expect(diagram).toContainText('Branch A');
});
