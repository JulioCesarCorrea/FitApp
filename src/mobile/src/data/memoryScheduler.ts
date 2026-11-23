import type { ReminderScheduler, ScheduledReminder } from './reminderService';

/** Programador de avisos en memoria con el mismo contrato que el del sistema. Lo usan las pruebas. */
export class MemoryScheduler implements ReminderScheduler {
  status: 'granted' | 'denied' | 'undetermined' = 'undetermined';
  /** Qué responde la persona cuando se le pide el permiso. */
  willGrant = true;
  scheduled: ScheduledReminder[] = [];
  cancelCalls = 0;
  permissionRequests = 0;
  private handlers = new Set<(route: string) => void>();

  async permission() {
    return this.status;
  }

  async requestPermission() {
    this.permissionRequests++;
    this.status = this.willGrant ? 'granted' : 'denied';
    return this.willGrant;
  }

  async cancelAll() {
    this.cancelCalls++;
    this.scheduled = [];
  }

  async schedule(reminder: ScheduledReminder) {
    this.scheduled.push(reminder);
  }

  onTap(handler: (route: string) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Simula que la persona toca un aviso. */
  tap(route: string) {
    for (const h of this.handlers) h(route);
  }
}
