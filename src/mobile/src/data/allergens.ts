// Alérgenos de los alimentos (SPEC-nutrition-003, ADR-0004). Copia de Allergens.cs de la API: los casos de
// tests/Api.Tests/Nutrition/allergen-vectors.json los ejecutan la API y esta copia. Orientativo: manda el etiquetado (P3, P8).

export interface AllergenInfo {
  tag: string;
  label: string;
  /** Palabras (sin acentos ni mayúsculas) con las que la persona escribe esa alergia en el perfil. */
  words: string[];
  /** Etiquetas de Open Food Facts (`allergens_tags`) que corresponden a este alérgeno. */
  off: string[];
}

export const ALLERGENS: AllergenInfo[] = [
  { tag: 'gluten', label: 'Gluten', off: ['en:gluten'], words: ['gluten', 'trigo', 'celiaco', 'celiaca', 'celiaquia', 'cebada', 'centeno'] },
  { tag: 'crustaceos', label: 'Crustáceos', off: ['en:crustaceans'], words: ['crustaceo', 'gamba', 'langostino', 'camaron', 'cangrejo', 'langosta', 'marisco'] },
  { tag: 'huevo', label: 'Huevo', off: ['en:eggs'], words: ['huevo', 'ovoalbumina'] },
  { tag: 'pescado', label: 'Pescado', off: ['en:fish'], words: ['pescado', 'atun', 'salmon', 'merluza', 'bacalao'] },
  { tag: 'cacahuete', label: 'Cacahuete', off: ['en:peanuts'], words: ['cacahuete', 'cacahuate', 'mani', 'peanut'] },
  { tag: 'soja', label: 'Soja', off: ['en:soybeans'], words: ['soja', 'soya'] },
  { tag: 'leche', label: 'Leche', off: ['en:milk'], words: ['leche', 'lactosa', 'lacteo', 'lactea', 'caseina'] },
  {
    tag: 'frutos_secos', label: 'Frutos secos', off: ['en:nuts'],
    words: ['fruto seco', 'frutos secos', 'nuez', 'nueces', 'almendra', 'avellana', 'pistacho', 'anacardo', 'castana', 'macadamia', 'pecana'],
  },
  { tag: 'apio', label: 'Apio', off: ['en:celery'], words: ['apio'] },
  { tag: 'mostaza', label: 'Mostaza', off: ['en:mustard'], words: ['mostaza'] },
  { tag: 'sesamo', label: 'Sésamo', off: ['en:sesame-seeds'], words: ['sesamo', 'ajonjoli'] },
  { tag: 'sulfitos', label: 'Sulfitos', off: ['en:sulphur-dioxide-and-sulphites'], words: ['sulfito', 'dioxido de azufre'] },
  { tag: 'altramuces', label: 'Altramuces', off: ['en:lupin'], words: ['altramuz', 'altramuces', 'lupino'] },
  { tag: 'moluscos', label: 'Moluscos', off: ['en:molluscs'], words: ['molusco', 'mejillon', 'almeja', 'calamar', 'pulpo', 'ostra', 'caracol'] },
];

export const ALLERGEN_TAGS = ALLERGENS.map((a) => a.tag);

export const allergenLabel = (tag: string): string => ALLERGENS.find((a) => a.tag === tag)?.label ?? tag;

/** Texto sin acentos ni mayúsculas. */
const fold = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Etiquetas válidas, sin repetir y en el orden del catálogo (así la API y la app guardan lo mismo). */
export const normalizeAllergens = (tags: readonly string[] | null | undefined): string[] =>
  ALLERGEN_TAGS.filter((t) => tags?.includes(t));

const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Palabra completa, con plural: «mani» no coincide con «manitas». */
const wordRegex = (word: string): RegExp => new RegExp(`(^|[^a-z])${escape(word)}(s|es)?([^a-z]|$)`);

/** AC-nutrition-003-04: alérgenos del alimento que coinciden con alguna alergia escrita en el perfil. */
export function allergenConflicts(profileAllergies: readonly string[], foodTags: readonly string[]): string[] {
  const typed = profileAllergies.map(fold).filter((t) => t.length > 0);
  const present = normalizeAllergens(foodTags);
  return ALLERGENS
    .filter((a) => present.includes(a.tag) && typed.some((t) => a.words.some((w) => wordRegex(w).test(t))))
    .map((a) => a.tag);
}

/** AC-nutrition-003-03: traduce `allergens_tags` de Open Food Facts a las etiquetas propias; lo desconocido se ignora. */
export const allergensFromOff = (offTags: readonly string[]): string[] =>
  ALLERGEN_TAGS.filter((tag) => ALLERGENS.find((a) => a.tag === tag)!.off.some((o) => offTags.includes(o)));
