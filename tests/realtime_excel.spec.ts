import { test, expect, BrowserContext, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function openPages(browser: import('@playwright/test').Browser, count: number) {
  const contexts: BrowserContext[] = await Promise.all(
    Array.from({ length: count }, () => browser.newContext())
  );
  const pages: Page[] = await Promise.all(contexts.map(ctx => ctx.newPage()));
  await Promise.all(pages.map(p => p.goto('/')));
  return { contexts, pages };
}

async function closeAll(contexts: BrowserContext[]) {
  await Promise.all(contexts.map(c => c.close()));
}

// ---------------------------------------------------------------------------
// Must-pass tests
// ---------------------------------------------------------------------------

test('realtime collaboration across four clients', async ({ browser }) => {
  test.setTimeout(30000);
  // Create 4 independent browser contexts (simulating 4 users)
  const contexts: BrowserContext[] = await Promise.all(
    Array.from({ length: 4 }, () => browser.newContext())
  );
  const pages: Page[] = await Promise.all(contexts.map(ctx => ctx.newPage()));

  try {
    // Navigate all pages to the app
    await Promise.all(pages.map(p => p.goto('/')));

    // Step 1: Wait for all 4 connections to register on all pages
    await Promise.all(
      pages.map(p =>
        expect(p.getByTestId('connection-count')).toHaveText('4', { timeout: 10000 })
      )
    );

    // Step 2: User 1 edits cell A1 (row 0, col 0) to "42"
    await pages[0].getByTestId('cell-input-0-0').fill('42');
    await pages[0].getByTestId('cell-input-0-0').blur();

    await Promise.all(
      pages.map(p =>
        expect(p.getByTestId('cell-input-0-0')).toHaveValue('42', { timeout: 2000 })
      )
    );

    // Step 3: After 2 s, User 2 edits cell B2 (row 1, col 1) to "hello"
    await pages[0].waitForTimeout(2000);
    await pages[1].getByTestId('cell-input-1-1').fill('hello');
    await pages[1].getByTestId('cell-input-1-1').blur();

    await Promise.all(
      pages.map(p =>
        expect(p.getByTestId('cell-input-1-1')).toHaveValue('hello', { timeout: 2000 })
      )
    );

    // Step 4: After 2 s, User 3 overwrites B2 (row 1, col 1) with "world"
    await pages[0].waitForTimeout(2000);
    await pages[2].getByTestId('cell-input-1-1').fill('world');
    await pages[2].getByTestId('cell-input-1-1').blur();

    await Promise.all(
      pages.map(p =>
        expect(p.getByTestId('cell-input-1-1')).toHaveValue('world', { timeout: 2000 })
      )
    );

    // Step 5: After 2 s, User 4 enters formula =A1+6 in cell A3 (row 2, col 0)
    // A1 = 42, so result must be 48
    await pages[0].waitForTimeout(2000);
    await pages[3].getByTestId('cell-input-2-0').fill('=A1+6');
    await pages[3].getByTestId('cell-input-2-0').blur();

    await Promise.all(
      pages.map(p =>
        expect(p.getByTestId('cell-input-2-0')).toHaveValue('48', { timeout: 2000 })
      )
    );

    // No error dialog should be present on any page
    for (const p of pages) {
      await expect(p.getByTestId('cell-error-dialog')).not.toBeAttached();
    }
  } finally {
    await Promise.all(contexts.map(c => c.close()));
  }
});

// Grid renders a 10×10 structure with correct data-testid attributes
test('grid renders 10×10 with correct testids', async ({ page }) => {
  await page.goto('/');

  // Container exists
  await expect(page.getByTestId('spreadsheet-grid')).toBeAttached();

  // All 100 cell wrappers and their inputs must exist
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      await expect(page.getByTestId(`cell-${row}-${col}`)).toBeAttached();
      await expect(page.getByTestId(`cell-input-${row}-${col}`)).toBeAttached();
    }
  }
});

// Non-numeric operand triggers error dialog; cell clears; dismiss removes dialog
test('non-numeric operand shows error dialog and cell clears', async ({ page }) => {
  await page.goto('/');

  // Set D4 (row 3, col 3) to a non-numeric string
  await page.getByTestId('cell-input-3-3').fill('text');
  await page.getByTestId('cell-input-3-3').blur();

  // Enter formula referencing D4 in E4 (row 3, col 4)
  await page.getByTestId('cell-input-3-4').fill('=D4+1');
  await page.getByTestId('cell-input-3-4').blur();

  // Error dialog must appear
  await expect(page.getByTestId('cell-error-dialog')).toBeAttached({ timeout: 3000 });
  await expect(page.getByTestId('cell-error-message')).toBeAttached();
  await expect(page.getByTestId('cell-error-dismiss')).toBeAttached();

  // The formula cell must be cleared to ""
  await expect(page.getByTestId('cell-input-3-4')).toHaveValue('');

  // Dismiss the dialog
  await page.getByTestId('cell-error-dismiss').click();

  // Dialog must leave the DOM after dismissal
  await expect(page.getByTestId('cell-error-dialog')).not.toBeAttached({ timeout: 3000 });
});

// Circular reference triggers error dialog; cell clears
test('circular reference shows error dialog and cell clears', async ({ page }) => {
  await page.goto('/');

  // A9 (row 8, col 0) references itself
  await page.getByTestId('cell-input-8-0').fill('=A9');
  await page.getByTestId('cell-input-8-0').blur();

  await expect(page.getByTestId('cell-error-dialog')).toBeAttached({ timeout: 3000 });
  await expect(page.getByTestId('cell-input-8-0')).toHaveValue('');

  await page.getByTestId('cell-error-dismiss').click();
  await expect(page.getByTestId('cell-error-dialog')).not.toBeAttached({ timeout: 3000 });
});

// An empty cell referenced in a formula resolves to 0
test('empty cell resolves to 0 in formulas', async ({ page }) => {
  await page.goto('/');

  // G6 (row 5, col 6) is untouched (empty). H6 (row 5, col 7) = =G6+10 → 10
  await page.getByTestId('cell-input-5-7').fill('=G6+10');
  await page.getByTestId('cell-input-5-7').blur();

  await expect(page.getByTestId('cell-input-5-7')).toHaveValue('10', { timeout: 3000 });
  await expect(page.getByTestId('cell-error-dialog')).not.toBeAttached();
});

// Arithmetic operators: subtraction, multiplication, division
test('formula arithmetic operators work correctly', async ({ page }) => {
  await page.goto('/');

  // Subtraction: =20-8 → 12
  await page.getByTestId('cell-input-6-0').fill('=20-8');
  await page.getByTestId('cell-input-6-0').blur();
  await expect(page.getByTestId('cell-input-6-0')).toHaveValue('12', { timeout: 3000 });

  // Multiplication: =3*4 → 12
  await page.getByTestId('cell-input-6-1').fill('=3*4');
  await page.getByTestId('cell-input-6-1').blur();
  await expect(page.getByTestId('cell-input-6-1')).toHaveValue('12', { timeout: 3000 });

  // Division: =36/3 → 12
  await page.getByTestId('cell-input-6-2').fill('=36/3');
  await page.getByTestId('cell-input-6-2').blur();
  await expect(page.getByTestId('cell-input-6-2')).toHaveValue('12', { timeout: 3000 });

  await expect(page.getByTestId('cell-error-dialog')).not.toBeAttached();
});

// Connection count decrements when a client disconnects
test('connection count decrements on disconnect', async ({ browser }) => {
  const { contexts, pages } = await openPages(browser, 2);

  try {
    // Both pages must see 2 connected clients
    await Promise.all(
      pages.map(p =>
        expect(p.getByTestId('connection-count')).toHaveText('2', { timeout: 10000 })
      )
    );

    // Close the second context (simulates a client disconnecting)
    await contexts[1].close();

    // The remaining page must now show 1
    await expect(pages[0].getByTestId('connection-count')).toHaveText('1', { timeout: 5000 });
  } finally {
    await contexts[0].close();
  }
});
