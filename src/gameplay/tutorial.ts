import type { InventoryEntry, PlayerStats, SmeltingState } from "../worker/protocol";

export interface TutorialChecklistEntry {
  id: string;
  label: string;
  status: "done" | "active" | "todo";
  detail: string;
}

function inventoryCounts(entries: InventoryEntry[]): Map<InventoryEntry["itemId"], number> {
  return new Map(entries.map((entry) => [entry.itemId, entry.count]));
}

export function getTutorialChecklist(
  inventory: InventoryEntry[],
  stats: PlayerStats | null,
  smelting: SmeltingState | null,
): TutorialChecklistEntry[] {
  const counts = inventoryCounts(inventory);
  const logCount = counts.get("log") ?? 0;
  const plankCount = counts.get("planks") ?? 0;
  const stickCount = counts.get("stick") ?? 0;
  const hasCraftingTable = (counts.get("crafting_table") ?? 0) > 0;
  const hasPickaxe = (counts.get("wooden_pickaxe") ?? 0) + (counts.get("stone_pickaxe") ?? 0) > 0;
  const hasFurnace = (counts.get("furnace") ?? 0) > 0;
  const hasCookedFood = (counts.get("cooked_meat") ?? 0) + (counts.get("bread") ?? 0) > 0;
  const hasHoe = (counts.get("wooden_hoe") ?? 0) + (counts.get("stone_hoe") ?? 0) > 0;
  const hasSeeds = (counts.get("wheat_seeds") ?? 0) > 0;
  const hasWheat = (counts.get("wheat") ?? 0) > 0;
  const hasBreedFeed = (counts.get("wheat") ?? 0) >= 2;

  const rawSteps: Array<{ id: string; label: string; done: boolean; active: boolean; detail: string }> = [
    {
      id: "gather_logs",
      label: "Gather logs",
      done: logCount > 0 || plankCount > 0,
      active: logCount === 0 && plankCount === 0,
      detail: "Break a nearby tree by hand.",
    },
    {
      id: "craft_planks",
      label: "Craft planks and sticks",
      done: plankCount > 0 && stickCount > 0,
      active: (logCount > 0 || plankCount > 0) && stickCount === 0,
      detail: "Use E to turn logs into planks, then sticks.",
    },
    {
      id: "crafting_table",
      label: "Unlock crafting table",
      done: hasCraftingTable,
      active: stickCount > 0 && !hasCraftingTable,
      detail: "Craft a table to unlock tools and stations.",
    },
    {
      id: "first_pickaxe",
      label: "Make a pickaxe",
      done: hasPickaxe,
      active: hasCraftingTable && !hasPickaxe,
      detail: "Craft a wooden pickaxe, then mine stone.",
    },
    {
      id: "reliable_food",
      label: "Secure reliable food",
      done: hasCookedFood || (stats?.hunger ?? 0) >= 16,
      active: hasPickaxe && (!hasFurnace || !hasCookedFood),
      detail: smelting ? "Your furnace is already running." : "Cook meat or craft bread.",
    },
    {
      id: "farming",
      label: "Start a farm",
      done: hasHoe && hasSeeds && hasWheat,
      active: hasHoe || hasSeeds,
      detail: "Make a hoe, plant seeds near water, and grow wheat.",
    },
    {
      id: "breeding",
      label: "Breed animals",
      done: hasBreedFeed && hasWheat,
      active: hasWheat,
      detail: "Hold wheat and feed two pigs or sheep.",
    },
  ];

  let activeAssigned = false;
  return rawSteps.map((step) => {
    if (step.done) {
      return { id: step.id, label: step.label, status: "done", detail: step.detail };
    }
    if (!activeAssigned && step.active) {
      activeAssigned = true;
      return { id: step.id, label: step.label, status: "active", detail: step.detail };
    }
    return { id: step.id, label: step.label, status: "todo", detail: step.detail };
  });
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
