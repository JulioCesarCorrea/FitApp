// Foto de comida con IA (SPEC-ai-003). La IA solo estima: la persona corrige cada alimento y cada cantidad, y recién entonces se registra con
// las reglas de siempre (SPEC-nutrition-001). La imagen se envía y se descarta: no se guarda en el teléfono por esta función.

import type { AiResult } from './aiService';
import type { NutritionService } from './nutritionService';
import type { LocalFood } from './types';

/** Una foto ya tomada, en base64 (JPEG). */
export type CapturedPhoto =
  | { kind: 'ok'; base64: string }
  | { kind: 'denied'; canAskAgain: boolean }
  | { kind: 'cancelled' };

/** La cámara del teléfono (expo-image-picker en la app, una versión en memoria en las pruebas). */
export interface PhotoCapture {
  /** Pide el permiso de la cámara en este momento (no antes) y saca una foto. */
  capture(): Promise<CapturedPhoto>;
}

export interface FoodPhotoItem {
  name: string;
  grams: number;
  confidence: 'alta' | 'media' | 'baja';
  estimate: boolean;
  kcalPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  possibleAllergens: string[];
}

export interface FoodPhoto {
  kind: 'proposal';
  items: FoodPhotoItem[];
  disclaimer: string;
}

export interface FoodPhotoApi {
  analyzeFoodPhoto(imageBase64: string): Promise<AiResult<FoodPhoto>>;
}

/** Lo que la persona deja tras corregir: nombre y gramos (los valores por 100 g son los estimados por la IA). */
export interface EditedPhotoItem {
  name: string;
  grams: string;
  item: FoodPhotoItem;
}

export type RegisterPhotoResult = { ok: true; registered: number } | { ok: false; issues: string[] };

export class FoodPhotoService {
  constructor(
    private readonly camera: PhotoCapture,
    private readonly remote: FoodPhotoApi,
    private readonly nutrition: NutritionService,
  ) {}

  takePhoto(): Promise<CapturedPhoto> {
    return this.camera.capture();
  }

  analyze(base64: string): Promise<AiResult<FoodPhoto>> {
    return this.remote.analyzeFoodPhoto(base64);
  }

  /**
   * AC-ai-003-05 y 06: crea (o reutiliza) un alimento propio con origen «ia» por cada elemento y registra la entrada con las reglas de la spec14.
   * Todo o nada: si algún elemento no es válido no se registra ninguno y se explica por qué.
   */
  async register(edited: EditedPhotoItem[], meal: string, date: string): Promise<RegisterPhotoResult> {
    if (edited.length === 0) return { ok: false, issues: ['No hay nada que registrar.'] };

    const issues: string[] = [];
    for (const e of edited) {
      const grams = Number(e.grams.trim().replace(',', '.'));
      if (!Number.isFinite(grams) || grams <= 0) issues.push(`${e.name.trim() || 'Alimento'}: indica una cantidad en gramos mayor que 0.`);
    }
    if (issues.length > 0) return { ok: false, issues };
    const foods: { food: LocalFood; grams: string }[] = [];
    for (const e of edited) {
      const existing = (await this.nutrition.searchFoods(e.name.trim())).find(
        (f) => f.source === 'ia' && f.name === e.name.trim() && f.kcalPer100g === e.item.kcalPer100g && f.proteinPer100g === e.item.proteinPer100g
          && f.fatPer100g === e.item.fatPer100g && f.carbsPer100g === e.item.carbsPer100g,
      );
      if (existing) {
        foods.push({ food: existing, grams: e.grams });
        continue;
      }

      const saved = await this.nutrition.saveFood({
        name: e.name, brand: '', barcode: '', kcal: String(e.item.kcalPer100g), protein: String(e.item.proteinPer100g), fat: String(e.item.fatPer100g),
        carbs: String(e.item.carbsPer100g), source: 'ia',
      });
      if (!saved.ok) {
        issues.push(...saved.issues.map((i) => `${e.name || 'Alimento'}: ${i.message}`));
        continue;
      }
      foods.push({ food: saved.food, grams: e.grams });
    }
    if (issues.length > 0) return { ok: false, issues };

    let registered = 0;
    for (const { food, grams } of foods) {
      const result = await this.nutrition.saveEntry({ date, meal, grams, foodId: food.id });
      if (!result.ok) return { ok: false, issues: result.issues.map((i) => `${food.name}: ${i.message}`) };
      registered += 1;
    }
    return { ok: true, registered };
  }
}
