import { expect, test, type Page } from "@playwright/test";

import type { SavedState } from "../../src/worker/protocol";

function createState(overrides: Partial<SavedState> = {}): SavedState {
  return {
    version: 1,
    stats: {
      health: 20,
      maxHealth: 20,
      hunger: 12,
      maxHunger: 20,
      timeOfDay: 6_000,
      isNight: false,
      isSheltered: false,
    },
    inventory: [],
    smelting: null,
    entities: [],
    blockOverrides: [],
    cropPlots: [],
    farmlandPlots: [],
    ...overrides,
  };
}

async function seedSave(page: Page, state: SavedState) {
  await page.addInitScript((seededState) => {
    localStorage.setItem("open-block/save-v1", JSON.stringify(seededState));
  }, state);
}

async function waitForReady(page: Page) {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => window.__openBlockE2E?.getSnapshot().ready === true);
  await expect(page.getByTestId("status")).toContainText("Ready");
}

async function inventoryCount(page: Page, itemId: string): Promise<number> {
  return page.evaluate((targetItemId) => {
    const entries = window.__openBlockE2E?.getSnapshot().inventoryEntries ?? [];
    const entry = entries.find((candidate) => candidate.itemId === targetItemId);
    return entry?.count ?? 0;
  }, itemId);
}

test("opens inventory overlay and shows tutorial HUD guidance", async ({ page }) => {
  await seedSave(page, createState({ inventory: [{ itemId: "log", count: 1 }] }));
  await waitForReady(page);

  await page.keyboard.press("KeyE");

  await expect(page.getByTestId("inventory-panel")).toBeVisible();
  await expect(page.getByTestId("recipe-list")).toBeVisible();
  await expect(page.getByTestId("hud")).toContainText("Guide:");
});

test("crafts first-day progression items through the inventory UI", async ({ page }) => {
  await seedSave(
    page,
    createState({
      inventory: [{ itemId: "log", count: 3 }],
    }),
  );
  await waitForReady(page);

  await page.keyboard.press("KeyE");

  await page.locator('[data-recipe-id="planks"]').click();
  await page.locator('[data-recipe-id="planks"]').click();
  await page.locator('[data-recipe-id="planks"]').click();
  await expect.poll(() => inventoryCount(page, "planks")).toBe(12);

  await page.locator('[data-recipe-id="sticks"]').click();
  await expect.poll(() => inventoryCount(page, "stick")).toBe(4);

  await page.locator('[data-recipe-id="crafting_table"]').click();
  await expect.poll(() => inventoryCount(page, "crafting_table")).toBe(1);

  await page.locator('[data-recipe-id="wooden_pickaxe"]').click();
  await expect.poll(() => inventoryCount(page, "wooden_pickaxe")).toBe(1);
});

test("smelts meat and consumes the result from the action panel", async ({ page }) => {
  test.slow();

  await seedSave(
    page,
    createState({
      stats: {
        health: 20,
        maxHealth: 20,
        hunger: 8,
        maxHunger: 20,
        timeOfDay: 6_000,
        isNight: false,
        isSheltered: false,
      },
      inventory: [
        { itemId: "furnace", count: 1 },
        { itemId: "raw_meat", count: 1 },
        { itemId: "coal", count: 1 },
      ],
    }),
  );
  await waitForReady(page);

  await page.keyboard.press("KeyE");
  await page.getByRole("button", { name: "Start" }).click();

  await expect
    .poll(() => page.evaluate(() => window.__openBlockE2E?.getSnapshot().smeltingState?.outputItem ?? null))
    .toBe("cooked_meat");

  await page.waitForTimeout(6_200);
  await page.getByRole("button", { name: "Collect" }).click();
  await expect.poll(() => inventoryCount(page, "cooked_meat")).toBe(1);

  await page.getByRole("button", { name: "Eat" }).first().click();
  await expect.poll(() => inventoryCount(page, "cooked_meat")).toBe(0);
  await expect
    .poll(() => page.evaluate(() => window.__openBlockE2E?.getSnapshot().playerStats?.hunger ?? 0))
    .toBeGreaterThan(8);
});
