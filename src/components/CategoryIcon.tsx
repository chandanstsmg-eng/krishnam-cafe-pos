import { Cake, Coffee, Cookie, CookingPot, CupSoda, IceCreamCone, Salad, Sandwich, Soup, Sunrise, Utensils, UtensilsCrossed, Wheat, type LucideIcon } from 'lucide-react';

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  coffee: Coffee,
  sunrise: Sunrise,
  utensils: Utensils,
  'cooking-pot': CookingPot,
  cookie: Cookie,
  'cup-soda': CupSoda,
  'ice-cream-cone': IceCreamCone,
  soup: Soup,
  salad: Salad,
  sandwich: Sandwich,
  wheat: Wheat,
  cake: Cake,
};

export function CategoryIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const Icon = (name && CATEGORY_ICONS[name]) || UtensilsCrossed;
  return <Icon className={className} aria-hidden />;
}
