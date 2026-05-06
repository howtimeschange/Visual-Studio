export type OutfitLookItem<T = Record<string, unknown>> = T & {
  id: string
  role?: string
}

export interface OutfitLook<T = Record<string, unknown>> {
  id: string
  items: Array<OutfitLookItem<T>>
  roles: string[]
}

const ROLE_ORDER = ['full_outfit', 'dress', 'top', 'bottom', 'outerwear', 'shoes', 'accessory']

export function buildOutfitLooks<T extends { id: string; role?: string }>(
  garments: Array<OutfitLookItem<T>>,
): Array<OutfitLook<T>> {
  const groups = {
    full_outfit: garments.filter((item) => (item.role || 'full_outfit') === 'full_outfit'),
    dress: garments.filter((item) => item.role === 'dress'),
    top: garments.filter((item) => item.role === 'top'),
    bottom: garments.filter((item) => item.role === 'bottom'),
    outerwear: garments.filter((item) => item.role === 'outerwear'),
    shoes: garments.filter((item) => item.role === 'shoes'),
    accessory: garments.filter((item) => item.role === 'accessory'),
  }

  let baseLooks: Array<Array<OutfitLookItem<T>>> = []
  let optionalOuterwear = groups.outerwear
  let optionalShoes = groups.shoes
  let optionalAccessory = groups.accessory

  if (groups.full_outfit.length > 0) baseLooks.push(...groups.full_outfit.map((item) => [item]))
  if (groups.dress.length > 0) baseLooks.push(...groups.dress.map((item) => [item]))

  if (groups.top.length > 0 && groups.bottom.length > 0) {
    baseLooks.push(...cartesianGarmentItems([groups.top, groups.bottom]))
  } else if (groups.top.length > 0) {
    baseLooks.push(...groups.top.map((item) => [item]))
  } else if (groups.bottom.length > 0) {
    baseLooks.push(...groups.bottom.map((item) => [item]))
  }

  if (baseLooks.length === 0 && groups.outerwear.length > 0) {
    baseLooks.push(...groups.outerwear.map((item) => [item]))
    optionalOuterwear = []
  }

  if (baseLooks.length === 0 && groups.shoes.length > 0) {
    baseLooks.push(...groups.shoes.map((item) => [item]))
    optionalShoes = []
  }

  if (baseLooks.length === 0 && groups.accessory.length > 0) {
    baseLooks.push(...groups.accessory.map((item) => [item]))
    optionalAccessory = []
  }

  let looks = [...baseLooks]
  if (optionalOuterwear.length > 0 && looks.length > 0) looks = expandOutfitLooks(looks, optionalOuterwear)
  if (optionalShoes.length > 0 && looks.length > 0) looks = expandOutfitLooks(looks, optionalShoes)
  if (optionalAccessory.length > 0 && looks.length > 0) looks = expandOutfitLooks(looks, optionalAccessory)

  return dedupeOutfitLooks(looks)
}

function cartesianGarmentItems<T>(
  groups: Array<Array<OutfitLookItem<T>>>,
): Array<Array<OutfitLookItem<T>>> {
  let combos: Array<Array<OutfitLookItem<T>>> = [[]]
  for (const group of groups) {
    const next: Array<Array<OutfitLookItem<T>>> = []
    for (const combo of combos) {
      for (const item of group) {
        next.push([...combo, item])
      }
    }
    combos = next
  }
  return combos
}

function expandOutfitLooks<T>(
  looks: Array<Array<OutfitLookItem<T>>>,
  items: Array<OutfitLookItem<T>>,
): Array<Array<OutfitLookItem<T>>> {
  const next = [...looks]
  for (const look of looks) {
    for (const item of items) {
      next.push([...look, item])
    }
  }
  return next
}

function dedupeOutfitLooks<T>(
  looks: Array<Array<OutfitLookItem<T>>>,
): Array<OutfitLook<T>> {
  const map = new Map<string, OutfitLook<T>>()
  for (const items of looks) {
    const look = createLook(items)
    if (!map.has(look.id)) map.set(look.id, look)
  }
  return [...map.values()]
}

function createLook<T>(items: Array<OutfitLookItem<T>>): OutfitLook<T> {
  const orderedItems = [...items].sort((left, right) =>
    garmentRoleOrder(left.role) - garmentRoleOrder(right.role))
  return {
    id: orderedItems.map((item) => item.id).join('+'),
    items: orderedItems,
    roles: orderedItems.map((item) => item.role || 'full_outfit'),
  }
}

function garmentRoleOrder(role?: string): number {
  const index = ROLE_ORDER.indexOf(role || 'full_outfit')
  return index === -1 ? ROLE_ORDER.length : index
}
