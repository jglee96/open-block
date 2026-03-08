export const BLOCK_TYPE = {
  air: 0,
  stone: 1,
  dirt: 2,
  grass: 3,
  sand: 4,
  water: 5,
  snow: 6,
  bedrock: 7,
  log: 8,
  leaves: 9,
  farmland: 10,
  wheatCrop0: 11,
  wheatCrop1: 12,
  wheatCrop2: 13,
  wheatCrop3: 14,
} as const;

export type ItemId =
  | "log"
  | "planks"
  | "stick"
  | "cobblestone"
  | "crafting_table"
  | "furnace"
  | "wooden_hoe"
  | "stone_hoe"
  | "wooden_pickaxe"
  | "stone_pickaxe"
  | "raw_meat"
  | "cooked_meat"
  | "coal"
  | "wool"
  | "bed"
  | "dirt"
  | "sand"
  | "snowball"
  | "wheat_seeds"
  | "wheat"
  | "bread";

export type PlaceableItemId = "cobblestone" | "dirt" | "sand" | "log";
export type ToolItemId = "wooden_hoe" | "stone_hoe";
export type HotbarItemId = PlaceableItemId | "wheat_seeds" | ToolItemId;

export type RecipeId =
  | "planks"
  | "sticks"
  | "crafting_table"
  | "wooden_pickaxe"
  | "wooden_hoe"
  | "stone_pickaxe"
  | "stone_hoe"
  | "furnace"
  | "bed"
  | "bread";

export interface Recipe {
  id: RecipeId;
  inputs: Partial<Record<ItemId, number>>;
  outputs: Partial<Record<ItemId, number>>;
  requiresCraftingTable?: boolean;
}

export interface HarvestRule {
  blockType: number;
  requiresTool: "none" | "wooden_pickaxe";
  drops: ItemId | null;
  breakableByHand: boolean;
}

export const RECIPES: Recipe[] = [
  { id: "planks", inputs: { log: 1 }, outputs: { planks: 4 } },
  { id: "sticks", inputs: { planks: 2 }, outputs: { stick: 4 } },
  { id: "crafting_table", inputs: { planks: 4 }, outputs: { crafting_table: 1 } },
  {
    id: "wooden_pickaxe",
    inputs: { planks: 3, stick: 2 },
    outputs: { wooden_pickaxe: 1 },
    requiresCraftingTable: true,
  },
  {
    id: "wooden_hoe",
    inputs: { planks: 2, stick: 2 },
    outputs: { wooden_hoe: 1 },
    requiresCraftingTable: true,
  },
  {
    id: "stone_pickaxe",
    inputs: { cobblestone: 3, stick: 2 },
    outputs: { stone_pickaxe: 1 },
    requiresCraftingTable: true,
  },
  {
    id: "stone_hoe",
    inputs: { cobblestone: 2, stick: 2 },
    outputs: { stone_hoe: 1 },
    requiresCraftingTable: true,
  },
  {
    id: "furnace",
    inputs: { cobblestone: 8 },
    outputs: { furnace: 1 },
    requiresCraftingTable: true,
  },
  {
    id: "bed",
    inputs: { wool: 3, planks: 3 },
    outputs: { bed: 1 },
    requiresCraftingTable: true,
  },
  {
    id: "bread",
    inputs: { wheat: 3 },
    outputs: { bread: 1 },
  },
];

export const BLOCK_DROP_BY_BLOCK_TYPE: Record<number, ItemId | null> = {
  [BLOCK_TYPE.air]: null,
  [BLOCK_TYPE.stone]: "cobblestone",
  [BLOCK_TYPE.dirt]: "dirt",
  [BLOCK_TYPE.grass]: "dirt",
  [BLOCK_TYPE.sand]: "sand",
  [BLOCK_TYPE.water]: null,
  [BLOCK_TYPE.snow]: "snowball",
  [BLOCK_TYPE.bedrock]: null,
  [BLOCK_TYPE.log]: "log",
  [BLOCK_TYPE.leaves]: null,
  [BLOCK_TYPE.farmland]: "dirt",
  [BLOCK_TYPE.wheatCrop0]: null,
  [BLOCK_TYPE.wheatCrop1]: null,
  [BLOCK_TYPE.wheatCrop2]: null,
  [BLOCK_TYPE.wheatCrop3]: null,
};

export const PLACEABLE_BLOCK_BY_ITEM: Record<PlaceableItemId, number> = {
  cobblestone: BLOCK_TYPE.stone,
  dirt: BLOCK_TYPE.dirt,
  sand: BLOCK_TYPE.sand,
  log: BLOCK_TYPE.log,
};

export const HOTBAR_ITEMS: Array<HotbarItemId | null> = [
  "cobblestone",
  "dirt",
  "sand",
  "log",
  "wheat_seeds",
  "wooden_hoe",
  "stone_hoe",
  null,
  null,
];

export const PLACEABLE_ITEM_COLORS: Partial<Record<HotbarItemId, string>> = {
  cobblestone: "#808080",
  dirt: "#8c5e35",
  sand: "#eded99",
  log: "#6f4b2a",
  wheat_seeds: "#7aa83f",
  wooden_hoe: "#99623b",
  stone_hoe: "#6a6a6a",
};

export const EDIBLE_HUNGER_BY_ITEM: Partial<Record<ItemId, number>> = {
  raw_meat: 2,
  cooked_meat: 6,
  bread: 5,
};

export const HARVEST_RULES: Record<number, HarvestRule> = {
  [BLOCK_TYPE.air]: { blockType: BLOCK_TYPE.air, requiresTool: "none", drops: null, breakableByHand: false },
  [BLOCK_TYPE.stone]: {
    blockType: BLOCK_TYPE.stone,
    requiresTool: "wooden_pickaxe",
    drops: "cobblestone",
    breakableByHand: false,
  },
  [BLOCK_TYPE.dirt]: { blockType: BLOCK_TYPE.dirt, requiresTool: "none", drops: "dirt", breakableByHand: true },
  [BLOCK_TYPE.grass]: { blockType: BLOCK_TYPE.grass, requiresTool: "none", drops: "dirt", breakableByHand: true },
  [BLOCK_TYPE.sand]: { blockType: BLOCK_TYPE.sand, requiresTool: "none", drops: "sand", breakableByHand: true },
  [BLOCK_TYPE.water]: { blockType: BLOCK_TYPE.water, requiresTool: "none", drops: null, breakableByHand: false },
  [BLOCK_TYPE.snow]: { blockType: BLOCK_TYPE.snow, requiresTool: "none", drops: "snowball", breakableByHand: true },
  [BLOCK_TYPE.bedrock]: { blockType: BLOCK_TYPE.bedrock, requiresTool: "none", drops: null, breakableByHand: false },
  [BLOCK_TYPE.log]: { blockType: BLOCK_TYPE.log, requiresTool: "none", drops: "log", breakableByHand: true },
  [BLOCK_TYPE.leaves]: { blockType: BLOCK_TYPE.leaves, requiresTool: "none", drops: null, breakableByHand: true },
  [BLOCK_TYPE.farmland]: { blockType: BLOCK_TYPE.farmland, requiresTool: "none", drops: "dirt", breakableByHand: true },
  [BLOCK_TYPE.wheatCrop0]: { blockType: BLOCK_TYPE.wheatCrop0, requiresTool: "none", drops: null, breakableByHand: true },
  [BLOCK_TYPE.wheatCrop1]: { blockType: BLOCK_TYPE.wheatCrop1, requiresTool: "none", drops: null, breakableByHand: true },
  [BLOCK_TYPE.wheatCrop2]: { blockType: BLOCK_TYPE.wheatCrop2, requiresTool: "none", drops: null, breakableByHand: true },
  [BLOCK_TYPE.wheatCrop3]: { blockType: BLOCK_TYPE.wheatCrop3, requiresTool: "none", drops: null, breakableByHand: true },
};

export function getRecipe(recipeId: RecipeId): Recipe | undefined {
  return RECIPES.find((recipe) => recipe.id === recipeId);
}

export function getBlockDropItem(blockType: number): ItemId | null {
  return BLOCK_DROP_BY_BLOCK_TYPE[blockType] ?? null;
}

export function getPlaceableBlockType(itemId: ItemId): number | null {
  if (!(itemId in PLACEABLE_BLOCK_BY_ITEM)) return null;
  return PLACEABLE_BLOCK_BY_ITEM[itemId as PlaceableItemId];
}

export function getEdibleHunger(itemId: ItemId): number {
  return EDIBLE_HUNGER_BY_ITEM[itemId] ?? 0;
}

export function isEdibleItem(itemId: ItemId): boolean {
  return getEdibleHunger(itemId) > 0;
}

export function getHarvestRule(blockType: number): HarvestRule | null {
  return HARVEST_RULES[blockType] ?? null;
}

export function isCropBlockType(blockType: number): boolean {
  return (
    blockType === BLOCK_TYPE.wheatCrop0 ||
    blockType === BLOCK_TYPE.wheatCrop1 ||
    blockType === BLOCK_TYPE.wheatCrop2 ||
    blockType === BLOCK_TYPE.wheatCrop3
  );
}

export function getCropStage(blockType: number): number | null {
  switch (blockType) {
    case BLOCK_TYPE.wheatCrop0:
      return 0;
    case BLOCK_TYPE.wheatCrop1:
      return 1;
    case BLOCK_TYPE.wheatCrop2:
      return 2;
    case BLOCK_TYPE.wheatCrop3:
      return 3;
    default:
      return null;
  }
}

export function isHoeItem(itemId: ItemId): itemId is ToolItemId {
  return itemId === "wooden_hoe" || itemId === "stone_hoe";
}
