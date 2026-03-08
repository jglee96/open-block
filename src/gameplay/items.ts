export type ItemId =
  | "log"
  | "planks"
  | "stick"
  | "cobblestone"
  | "crafting_table"
  | "furnace"
  | "wooden_pickaxe"
  | "stone_pickaxe"
  | "raw_meat"
  | "cooked_meat"
  | "coal"
  | "wool"
  | "bed"
  | "dirt"
  | "sand"
  | "snowball";

export type RecipeId =
  | "planks"
  | "sticks"
  | "crafting_table"
  | "wooden_pickaxe"
  | "stone_pickaxe"
  | "furnace"
  | "bed";

export interface Recipe {
  id: RecipeId;
  inputs: Partial<Record<ItemId, number>>;
  outputs: Partial<Record<ItemId, number>>;
}

export const RECIPES: Recipe[] = [
  { id: "planks", inputs: { log: 1 }, outputs: { planks: 4 } },
  { id: "sticks", inputs: { planks: 2 }, outputs: { stick: 4 } },
  { id: "crafting_table", inputs: { planks: 4 }, outputs: { crafting_table: 1 } },
  { id: "wooden_pickaxe", inputs: { planks: 3, stick: 2 }, outputs: { wooden_pickaxe: 1 } },
  { id: "stone_pickaxe", inputs: { cobblestone: 3, stick: 2 }, outputs: { stone_pickaxe: 1 } },
  { id: "furnace", inputs: { cobblestone: 8 }, outputs: { furnace: 1 } },
  { id: "bed", inputs: { wool: 3, planks: 3 }, outputs: { bed: 1 } },
];

export const BLOCK_DROP_BY_BLOCK_TYPE: Record<number, ItemId | null> = {
  0: null,
  1: "cobblestone",
  2: "dirt",
  3: "log",
  4: "sand",
  5: null,
  6: "snowball",
  7: null,
};

export const PLACEABLE_BLOCK_BY_ITEM: Partial<Record<ItemId, number>> = {
  cobblestone: 1,
  dirt: 2,
  sand: 4,
};

export function getRecipe(recipeId: RecipeId): Recipe | undefined {
  return RECIPES.find((recipe) => recipe.id === recipeId);
}

export function getBlockDropItem(blockType: number): ItemId | null {
  return BLOCK_DROP_BY_BLOCK_TYPE[blockType] ?? null;
}
