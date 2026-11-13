import {
  DAYS,
  type CatalogSection,
  type DayKey,
  type DayState,
  type EquipmentProfile,
  type EquipmentState,
  type LocalExerciseLog,
  type LocalFood,
  type LocalFoodEntry,
  type LocalPlanEntry,
  type LocalProfile,
  type LocalStore,
  type ProfileState,
  type ServerExerciseLog,
  type ServerFood,
  type ServerFoodEntry,
  type SyncStatus,
} from './types';

/** Almacén en memoria con el mismo contrato que el de SQLite. Lo usan las pruebas. */
export class MemoryStore implements LocalStore {
  private catalog: CatalogSection[] | null = null;
  private days = new Map<DayKey, DayState>();
  private equipment: EquipmentState = { profile: null, status: 'synced', message: null };
  private settings = new Map<string, string>();
  private logs = new Map<string, LocalExerciseLog>();
  private foods = new Map<string, LocalFood>();
  private foodEntries = new Map<string, LocalFoodEntry>();
  private profile: ProfileState = { profile: null, status: 'synced', message: null };

  /** Los pesos viven en otra tabla (db.ts); las pruebas fijan aquí cuántos hay pendientes. */
  pendingWeights = 0;

  async getCatalog() {
    return this.catalog;
  }

  async saveCatalog(sections: CatalogSection[]) {
    this.catalog = sections;
  }

  async getDays(): Promise<DayState[]> {
    return DAYS.flatMap((d) => {
      const state = this.days.get(d);
      return state ? [{ ...state, entries: state.entries.map((e) => ({ ...e })) }] : [];
    });
  }

  async saveDay(day: DayKey, entries: LocalPlanEntry[]) {
    this.days.set(day, { day, status: 'pending', message: null, entries });
  }

  async replaceDaySynced(day: DayKey, entries: LocalPlanEntry[]) {
    if (entries.length === 0) this.days.delete(day);
    else this.days.set(day, { day, status: 'synced', message: null, entries });
  }

  async setDayStatus(day: DayKey, status: SyncStatus, message: string | null) {
    const state = this.days.get(day);
    if (state) this.days.set(day, { ...state, status, message });
  }

  async getEquipment() {
    return this.equipment;
  }

  async saveEquipment(profile: EquipmentProfile) {
    this.equipment = { profile, status: 'pending', message: null };
  }

  async setEquipmentStatus(status: SyncStatus, message: string | null) {
    this.equipment = { ...this.equipment, status, message };
  }

  async getLog(id: string) {
    const log = this.logs.get(id);
    return log ? { ...log } : null;
  }

  async getLogs(exerciseId: string) {
    return [...this.logs.values()].filter((l) => l.exerciseId === exerciseId).map((l) => ({ ...l }));
  }

  async getPendingLogs() {
    return [...this.logs.values()].filter((l) => l.pendingOp !== null && l.status === 'pending').map((l) => ({ ...l }));
  }

  async saveLog(log: LocalExerciseLog) {
    this.logs.set(log.id, { ...log });
  }

  async deleteLog(id: string) {
    this.logs.delete(id);
  }

  async replaceSyncedLogs(exerciseId: string, logs: ServerExerciseLog[]) {
    for (const [id, l] of this.logs) if (l.exerciseId === exerciseId) this.logs.delete(id);
    for (const l of logs) {
      this.logs.set(l.id, { ...l, status: 'synced', message: null, pendingOp: null, attempted: true });
    }
  }

  async getProfile() {
    return this.profile;
  }

  async saveProfile(profile: LocalProfile) {
    this.profile = { profile, status: 'pending', message: null };
  }

  async setProfileStatus(status: SyncStatus, message: string | null) {
    this.profile = { ...this.profile, status, message };
  }

  async getFoods() {
    return [...this.foods.values()].map((f) => ({ ...f }));
  }

  async getFood(id: string) {
    const f = this.foods.get(id);
    return f ? { ...f } : null;
  }

  async saveFood(food: LocalFood) {
    this.foods.set(food.id, { ...food });
  }

  async deleteFood(id: string) {
    this.foods.delete(id);
  }

  async replaceSyncedFoods(foods: ServerFood[]) {
    for (const [id, f] of this.foods) if (f.pendingOp === null && f.status === 'synced') this.foods.delete(id);
    for (const f of foods) {
      if (this.foods.get(f.id)?.pendingOp) continue; // lo que espera envío manda sobre el servidor
      this.foods.set(f.id, { ...f, status: 'synced', message: null, pendingOp: null, attempted: true });
    }
  }

  async getFoodEntries(date: string) {
    return [...this.foodEntries.values()].filter((e) => e.date === date).map((e) => ({ ...e }));
  }

  async getFoodEntry(id: string) {
    const e = this.foodEntries.get(id);
    return e ? { ...e } : null;
  }

  async saveFoodEntry(entry: LocalFoodEntry) {
    this.foodEntries.set(entry.id, { ...entry });
  }

  async deleteFoodEntry(id: string) {
    this.foodEntries.delete(id);
  }

  async getPendingNutrition() {
    const pending = <T extends { pendingOp: string | null; status: SyncStatus }>(x: T) => x.pendingOp !== null && x.status === 'pending';
    return {
      foods: [...this.foods.values()].filter(pending).map((f) => ({ ...f })),
      entries: [...this.foodEntries.values()].filter(pending).map((e) => ({ ...e })),
    };
  }

  async replaceSyncedFoodEntries(date: string, entries: ServerFoodEntry[]) {
    for (const [id, e] of this.foodEntries) if (e.date === date && e.pendingOp === null && e.status === 'synced') this.foodEntries.delete(id);
    for (const e of entries) {
      if (this.foodEntries.get(e.id)?.pendingOp) continue;
      this.foodEntries.set(e.id, { ...e, status: 'synced', message: null, pendingOp: null, attempted: true });
    }
  }

  async clearUserData() {
    this.profile = { profile: null, status: 'synced', message: null };
    this.foods.clear();
    this.foodEntries.clear();
    this.days.clear();
    this.equipment = { profile: null, status: 'synced', message: null };
    this.logs.clear();
    this.pendingWeights = 0;
    for (const key of [...this.settings.keys()]) {
      if (key.startsWith('stagnation') || key.startsWith('nutrition') || key === 'localUserId') this.settings.delete(key);
    }
  }

  async countPendingChanges() {
    const days = [...this.days.values()].filter((d) => d.status === 'pending' || d.status === 'needs_confirmation').length;
    const equipment = this.equipment.profile !== null && this.equipment.status === 'pending' ? 1 : 0;
    const logs = [...this.logs.values()].filter((l) => l.pendingOp !== null && l.status === 'pending').length
      + [...this.foods.values()].filter((f) => f.pendingOp !== null && f.status === 'pending').length
      + [...this.foodEntries.values()].filter((e) => e.pendingOp !== null && e.status === 'pending').length;
    const threshold = this.settings.get('stagnationThresholdStatus') === 'pending' ? 1 : 0;
    const profile = this.profile.profile !== null && this.profile.status === 'pending' ? 1 : 0;
    return days + equipment + logs + threshold + profile + this.pendingWeights;
  }

  async getSetting(key: string) {
    return this.settings.get(key) ?? null;
  }

  async setSetting(key: string, value: string) {
    this.settings.set(key, value);
  }
}
