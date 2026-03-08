import type { InventoryEntry, PlayerStats, SmeltingState } from "../worker/protocol";

function inventoryCounts(entries: InventoryEntry[]): Map<InventoryEntry["itemId"], number> {
  return new Map(entries.map((entry) => [entry.itemId, entry.count]));
}

export function getTutorialHint(
  inventory: InventoryEntry[],
  stats: PlayerStats | null,
  smelting: SmeltingState | null,
): string {
  const counts = inventoryCounts(inventory);
  const hasCraftingTable = (counts.get("crafting_table") ?? 0) > 0;
  const hasPickaxe = (counts.get("wooden_pickaxe") ?? 0) + (counts.get("stone_pickaxe") ?? 0) > 0;
  const hasHoe = (counts.get("wooden_hoe") ?? 0) + (counts.get("stone_hoe") ?? 0) > 0;
  const hasFuel = (counts.get("coal") ?? 0) + (counts.get("log") ?? 0) + (counts.get("planks") ?? 0) > 0;
  const hasFood = (counts.get("bread") ?? 0) + (counts.get("cooked_meat") ?? 0) + (counts.get("raw_meat") ?? 0) > 0;

  if ((counts.get("log") ?? 0) === 0 && (counts.get("planks") ?? 0) === 0) {
    return "Guide: Break a tree to collect your first logs.";
  }
  if ((counts.get("planks") ?? 0) < 4) {
    return "Guide: Press E and craft planks from your logs.";
  }
  if ((counts.get("stick") ?? 0) < 2) {
    return "Guide: Press E and craft sticks for your first tools.";
  }
  if (!hasCraftingTable) {
    return "Guide: Craft a crafting table to unlock pickaxes, hoes, and furnaces.";
  }
  if (!hasPickaxe) {
    return "Guide: Craft a wooden pickaxe, then mine stone for cobblestone.";
  }
  if ((counts.get("cobblestone") ?? 0) < 8 && (counts.get("furnace") ?? 0) === 0) {
    return "Guide: Mine more stone until you can craft a furnace.";
  }
  if ((counts.get("furnace") ?? 0) === 0) {
    return "Guide: Craft a furnace so raw meat becomes reliable food.";
  }
  if ((counts.get("raw_meat") ?? 0) > 0 && !smelting && hasFuel) {
    return "Guide: Open E and smelt raw meat with fuel in your furnace.";
  }
  if (!hasHoe && (counts.get("wheat_seeds") ?? 0) > 0) {
    return "Guide: Craft a hoe so you can turn seeds into renewable food.";
  }
  if (hasHoe && (counts.get("wheat_seeds") ?? 0) > 0) {
    return "Guide: Till grass or dirt near water, then plant your wheat seeds.";
  }
  if ((counts.get("wheat") ?? 0) >= 2) {
    return "Guide: Hold wheat and feed two pigs or sheep to breed them.";
  }
  if (stats?.isNight && (counts.get("bed") ?? 0) > 0) {
    return "Guide: Use your bed from the action panel to skip the night.";
  }
  if (stats && stats.hunger < stats.maxHunger * 0.5 && !hasFood) {
    return "Guide: Hunt animals, smelt meat, or harvest crops before hunger gets critical.";
  }
  return "Guide: Build shelter, expand your farm, and stockpile food for longer trips.";
}
