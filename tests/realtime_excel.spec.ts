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
