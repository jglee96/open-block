import { expect, test, type Page } from "@playwright/test";

import { BLOCK_TYPE } from "../../src/gameplay/items";
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

function createEntity(overrides: Partial<SavedState["entities"][number]> & Pick<SavedState["entities"][number], "id" | "kind">): SavedState["entities"][number] {
  return {
    id: overrides.id,
    kind: overrides.kind,
    position: overrides.position ?? { x: 8.5, y: 62, z: 6.2 },
    radius: overrides.radius ?? 0.35,
    halfHeight: overrides.halfHeight ?? 0.9,
    health: overrides.health ?? (overrides.kind === "zombie" ? 20 : 8),
    maxHealth: overrides.maxHealth ?? (overrides.kind === "zombie" ? 20 : 8),
    hostile: overrides.hostile ?? (overrides.kind === "zombie"),
    isBaby: overrides.isBaby ?? false,
    growUpAtMs: overrides.growUpAtMs ?? null,
    breedReadyAtMs: overrides.breedReadyAtMs ?? 0,
    loveUntilMs: overrides.loveUntilMs ?? null,
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

async function blockTypeAt(page: Page, worldX: number, worldY: number, worldZ: number): Promise<number> {
  return page.evaluate(
    ([x, y, z, airBlock]) => window.__openBlockE2E?.getBlockTypeAt(x, y, z) ?? airBlock,
    [worldX, worldY, worldZ, BLOCK_TYPE.air],
  );
}

async function generateChunk(page: Page, chunkX: number, chunkZ: number) {
  await page.evaluate(
    ([cx, cz]) => {
      window.__openBlockE2E?.generateChunk(cx, cz);
    },
    [chunkX, chunkZ],
  );
}

async function setPlayerPose(
  page: Page,
  pose: { x: number; y: number; z: number; yaw?: number; pitch?: number },
) {
  await page.evaluate((nextPose) => {
    window.__openBlockE2E?.setPlayerPose(nextPose);
  }, pose);
}

async function sampleBlockTarget(page: Page): Promise<{ worldX: number; worldY: number; worldZ: number; faceNormal: [number, number, number] } | null> {
  return page.evaluate(() => {
    const target = window.__openBlockE2E?.sampleTarget();
    if (!target || target.kind !== "block") return null;
    return {
      worldX: target.hit.worldX,
      worldY: target.hit.worldY,
      worldZ: target.hit.worldZ,
      faceNormal: target.hit.faceNormal,
    };
  });
}

async function sampleEntityTarget(page: Page): Promise<{ id: string; kind: string; isBaby: boolean } | null> {
  return page.evaluate(() => {
    const target = window.__openBlockE2E?.sampleTarget();
    if (!target || target.kind !== "entity") return null;
    return {
      id: target.entity.id,
      kind: target.entity.kind,
      isBaby: target.entity.isBaby,
    };
  });
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

test("breaks a targeted block, switches hotbar, and places the gathered block back into the world", async ({ page }) => {
  await seedSave(
    page,
    createState({
      blockOverrides: [
        { x: 8, y: 63, z: 6, blockType: BLOCK_TYPE.log },
        { x: 8, y: 62, z: 6, blockType: BLOCK_TYPE.dirt },
        { x: 8, y: 62, z: 7, blockType: BLOCK_TYPE.dirt },
      ],
    }),
  );
  await waitForReady(page);
  await generateChunk(page, 0, 0);

  await expect.poll(() => blockTypeAt(page, 8, 63, 6)).toBe(BLOCK_TYPE.log);

  await setPlayerPose(page, { x: 8.5, y: 62, z: 8.5, yaw: 0, pitch: 0 });
  await expect
    .poll(() => page.evaluate(() => window.__openBlockE2E?.sampleTarget()?.kind ?? null))
    .toBe("block");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const target = window.__openBlockE2E?.sampleTarget();
        return target?.kind === "block" ? target.hit.worldZ : null;
      }),
    )
    .toBe(6);

  await page.evaluate(() => window.__openBlockE2E?.interactAtCurrentTarget(0));
  await expect.poll(() => blockTypeAt(page, 8, 63, 6)).toBe(BLOCK_TYPE.air);
  await expect.poll(() => inventoryCount(page, "log")).toBe(1);

  await page.keyboard.press("Digit4");
  await expect
    .poll(() => page.evaluate(() => window.__openBlockE2E?.getSnapshot().hotbar.selectedItemId ?? null))
    .toBe("log");

  await setPlayerPose(page, { x: 8.5, y: 62, z: 8.5, yaw: 0, pitch: -0.55 });
  await setPlayerPose(page, { x: 8.5, y: 62, z: 8.5, yaw: 0, pitch: -0.8 });
  await expect.poll(() => sampleBlockTarget(page)).toEqual({
    worldX: 8,
    worldY: 62,
    worldZ: 7,
    faceNormal: [0, 1, 0],
  });

  await page.evaluate(() => window.__openBlockE2E?.interactAtCurrentTarget(2));
  await expect.poll(() => blockTypeAt(page, 8, 63, 7)).toBe(BLOCK_TYPE.log);
  await expect.poll(() => inventoryCount(page, "log")).toBe(0);
});

test("prevents stone breaking without a pickaxe and allows it once a pickaxe is owned", async ({ page }) => {
  await seedSave(
    page,
    createState({
      blockOverrides: [
        { x: 8, y: 63, z: 6, blockType: BLOCK_TYPE.stone },
        { x: 8, y: 62, z: 6, blockType: BLOCK_TYPE.dirt },
      ],
    }),
  );
  await waitForReady(page);
  await generateChunk(page, 0, 0);
  await expect.poll(() => blockTypeAt(page, 8, 63, 6)).toBe(BLOCK_TYPE.stone);

  await setPlayerPose(page, { x: 8.5, y: 62, z: 8.5, yaw: 0, pitch: 0 });
  await expect.poll(() => sampleBlockTarget(page)).toEqual({
    worldX: 8,
    worldY: 63,
    worldZ: 6,
    faceNormal: [0, 0, 1],
  });
  await page.evaluate(() => window.__openBlockE2E?.interactAtCurrentTarget(0));
  await page.waitForTimeout(200);
  await expect.poll(() => blockTypeAt(page, 8, 63, 6)).toBe(BLOCK_TYPE.stone);
  await expect.poll(() => inventoryCount(page, "cobblestone")).toBe(0);

  await page.evaluate((state) => {
    window.__openBlockE2E?.sendToWorker({ type: "LOAD_STATE", state });
  }, createState({
    inventory: [{ itemId: "wooden_pickaxe", count: 1 }],
    blockOverrides: [
      { x: 8, y: 63, z: 6, blockType: BLOCK_TYPE.stone },
      { x: 8, y: 62, z: 6, blockType: BLOCK_TYPE.dirt },
    ],
  }));
  await generateChunk(page, 0, 0);
  await expect.poll(() => inventoryCount(page, "wooden_pickaxe")).toBe(1);
  await setPlayerPose(page, { x: 8.5, y: 62, z: 8.5, yaw: 0, pitch: 0 });
  await expect.poll(() => sampleBlockTarget(page)).toEqual({
    worldX: 8,
    worldY: 63,
    worldZ: 6,
    faceNormal: [0, 0, 1],
  });

  await page.evaluate(() => window.__openBlockE2E?.interactAtCurrentTarget(0));
  await expect.poll(() => blockTypeAt(page, 8, 63, 6)).toBe(BLOCK_TYPE.air);
  await expect.poll(() => inventoryCount(page, "cobblestone")).toBe(1);
});

test("breeds two sheep when wheat is held and spawns a baby", async ({ page }) => {
  await seedSave(
    page,
    createState({
      inventory: [{ itemId: "wheat", count: 2 }],
      entities: [
        createEntity({ id: "sheep-a", kind: "sheep", position: { x: 8.2, y: 62, z: 6.2 } }),
        createEntity({ id: "sheep-b", kind: "sheep", position: { x: 9.6, y: 62, z: 6.2 } }),
      ],
    }),
  );
  await waitForReady(page);

  await page.keyboard.press("Digit6");
  await expect
    .poll(() => page.evaluate(() => window.__openBlockE2E?.getSnapshot().hotbar.selectedItemId ?? null))
    .toBe("wheat");

  await setPlayerPose(page, { x: 8.5, y: 62, z: 8.5, yaw: -0.12, pitch: 0 });
  await expect.poll(() => sampleEntityTarget(page)).toEqual({ id: "sheep-a", kind: "sheep", isBaby: false });
  await page.evaluate(() => window.__openBlockE2E?.interactAtCurrentTarget(2));
  await expect.poll(() => inventoryCount(page, "wheat")).toBe(1);

  await setPlayerPose(page, { x: 8.5, y: 62, z: 8.5, yaw: 0.45, pitch: 0 });
  await expect.poll(() => sampleEntityTarget(page)).toEqual({ id: "sheep-b", kind: "sheep", isBaby: false });
  await page.evaluate(() => window.__openBlockE2E?.interactAtCurrentTarget(2));
  await expect.poll(() => inventoryCount(page, "wheat")).toBe(0);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const entities = window.__openBlockE2E?.getSnapshot().entitySnapshots ?? [];
        return {
          count: entities.length,
          babyCount: entities.filter((entity) => entity.kind === "sheep" && entity.isBaby).length,
        };
      }),
    )
    .toEqual({ count: 3, babyCount: 1 });
});

test("kills a pig after repeated attacks and awards meat drops", async ({ page }) => {
  await seedSave(
    page,
    createState({
      inventory: [{ itemId: "wooden_pickaxe", count: 1 }],
      entities: [
        createEntity({ id: "pig-a", kind: "pig", position: { x: 8.5, y: 62, z: 6.2 } }),
      ],
    }),
  );
  await waitForReady(page);

  await setPlayerPose(page, { x: 8.5, y: 62, z: 8.5, yaw: 0, pitch: 0 });
  await expect.poll(() => sampleEntityTarget(page)).toEqual({ id: "pig-a", kind: "pig", isBaby: false });

  await page.evaluate(() => window.__openBlockE2E?.interactAtCurrentTarget(0));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const pig = (window.__openBlockE2E?.getSnapshot().entitySnapshots ?? []).find((entity) => entity.id === "pig-a");
        return pig?.health ?? 0;
      }),
    )
    .toBe(4);

  await page.evaluate(() => window.__openBlockE2E?.interactAtCurrentTarget(0));
  await expect
    .poll(() =>
      page.evaluate(() => (window.__openBlockE2E?.getSnapshot().entitySnapshots ?? []).some((entity) => entity.id === "pig-a")),
    )
    .toBe(false);
  await expect.poll(() => inventoryCount(page, "raw_meat")).toBe(2);
});
