import { reasonFrom } from '../api';
import type {
  CatalogSection, DayKey, EquipmentProfile, LocalPlanEntry, PutDayResult, PutEquipmentResult, PutLogResult, RemoteApi,
  RestrictionHit, ServerExerciseLog,
} from './types';

const TIMEOUT_MS = 8000;

/** Cliente HTTP de la API (SPEC-training-002). Traduce las respuestas al contrato de RemoteApi. */
export class HttpRemote implements RemoteApi {
  constructor(
    private readonly baseUrl: string | undefined = process.env.EXPO_PUBLIC_API_URL,
    private readonly userId: string | undefined = process.env.EXPO_PUBLIC_DEV_USER_ID,
  ) {}

  imageUrl(path: string): string {
    return `${this.baseUrl ?? ''}${path}`;
  }

  async fetchCatalog(): Promise<CatalogSection[] | null> {
    const res = await this.request('GET', '/exercises');
    return res?.ok ? ((await res.json()) as { sections: CatalogSection[] }).sections : null;
  }

  async fetchPlan(): Promise<{ day: DayKey; entries: LocalPlanEntry[] }[] | null> {
    const res = await this.request('GET', '/plan');
    if (!res?.ok) return null;
    const body = (await res.json()) as { days: { day: DayKey; entries: LocalPlanEntry[] }[] };
    return body.days;
  }

  async fetchEquipment(): Promise<EquipmentProfile | null | 'none'> {
    const res = await this.request('GET', '/equipment');
    if (!res?.ok) return null;
    const body = (await res.json()) as EquipmentProfile & { configured: boolean };
    return body.configured ? body : 'none';
  }

  async putDay(day: DayKey, entries: LocalPlanEntry[], confirmWarnings: boolean): Promise<PutDayResult> {
    const res = await this.request('PUT', `/plan/days/${day}`, { entries, confirmWarnings });
    if (!res) return { kind: 'retry' };

    if (res.status === 200) {
      const body = (await res.json()) as { entries: LocalPlanEntry[] };
      return { kind: 'ok', entries: body.entries };
    }
    if (res.status === 409 || res.status === 422) {
      const body = (await res.json().catch(() => null)) as
        | { title?: string; warnings?: RestrictionHit[]; blocked?: RestrictionHit[] }
        | null;
      if (body?.warnings) return { kind: 'warnings', hits: body.warnings };
      if (body?.blocked) return { kind: 'blocked', hits: body.blocked };
      return { kind: 'rejected', reason: body?.title ?? `HTTP ${res.status}` };
    }
    if (res.status === 400) {
      return { kind: 'rejected', reason: reasonFrom(await res.json().catch(() => null), res.status) };
    }
    return { kind: 'retry' }; // 401, 5xx y cualquier otro
  }

  async putEquipment(profile: EquipmentProfile): Promise<PutEquipmentResult> {
    const res = await this.request('PUT', '/equipment', profile);
    if (!res) return { kind: 'retry' };
    if (res.ok) return { kind: 'ok' };
    if (res.status === 400) return { kind: 'rejected', reason: reasonFrom(await res.json().catch(() => null), 400) };
    return { kind: 'retry' };
  }

  /** AC-mobile-003-01: PUT /exercise-logs/{id} (SPEC-training-003). 400, 404, 409 y 422 no se reintentan. */
  async putLog(log: ServerExerciseLog): Promise<PutLogResult> {
    const { id, ...body } = log;
    return this.putResult(await this.request('PUT', `/exercise-logs/${id}`, body));
  }

  async deleteLog(id: string): Promise<'ok' | 'retry'> {
    const res = await this.request('DELETE', `/exercise-logs/${id}`);
    return res?.ok ? 'ok' : 'retry';
  }

  async fetchHistory(exerciseId: string): Promise<ServerExerciseLog[] | null> {
    const res = await this.request('GET', `/exercises/${encodeURIComponent(exerciseId)}/history`);
    return res?.ok ? ((await res.json()) as ServerExerciseLog[]) : null;
  }

  async fetchTrainingSettings(): Promise<number | null> {
    const res = await this.request('GET', '/training-settings');
    return res?.ok ? ((await res.json()) as { stagnationThreshold: number }).stagnationThreshold : null;
  }

  async putTrainingSettings(stagnationThreshold: number): Promise<PutLogResult> {
    return this.putResult(await this.request('PUT', '/training-settings', { stagnationThreshold }));
  }

  private async putResult(res: Response | null): Promise<PutLogResult> {
    if (!res) return { kind: 'retry' };
    if (res.ok) return { kind: 'ok' };
    if ([400, 404, 409, 422].includes(res.status)) {
      const problem = await res.json().catch(() => null);
      return { kind: 'rejected', reason: reasonFrom(problem, res.status) };
    }
    return { kind: 'retry' }; // 401, 5xx y cualquier otro
  }

  private async request(method: 'GET' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<Response | null> {
    if (!this.baseUrl || !this.userId) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-User-Id': this.userId },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return null; // sin red o tiempo agotado
    } finally {
      clearTimeout(timer);
    }
  }
}
