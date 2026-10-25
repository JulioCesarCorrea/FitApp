import {
  DAYS,
  type CatalogSection,
  type DayKey,
  type DayState,
  type EquipmentProfile,
  type EquipmentState,
  type LocalPlanEntry,
  type LocalStore,
  type SyncStatus,
} from './types';

/** Almacén en memoria con el mismo contrato que el de SQLite. Lo usan las pruebas. */
export class MemoryStore implements LocalStore {
  private catalog: CatalogSection[] | null = null;
  private days = new Map<DayKey, DayState>();
  private equipment: EquipmentState = { profile: null, status: 'synced', message: null };
  private settings = new Map<string, string>();

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

  async getSetting(key: string) {
    return this.settings.get(key) ?? null;
  }

  async setSetting(key: string, value: string) {
    this.settings.set(key, value);
  }
}
