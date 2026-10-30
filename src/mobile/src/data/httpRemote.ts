import { reasonFrom } from '../api';
import { authedFetch, type Authorizer } from './authedFetch';
import type {
  CatalogSection, DayKey, EquipmentProfile, LocalPlanEntry, LocalProfile, PutDayResult, PutEquipmentResult, PutLogResult,
  RemoteApi, RestrictionHit, RestrictionItem, ServerExerciseLog,
} from './types';

/** Cliente HTTP de la API (SPEC-training-002). Traduce las respuestas al contrato de RemoteApi. */
export class HttpRemote implements RemoteApi {
  constructor(
    private readonly auth: Authorizer,
    private readonly baseUrl: string | undefined = process.env.EXPO_PUBLIC_API_URL,
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

  /** GET /profile (SPEC-profile-001): null sin conexión; 'none' si la cuenta aún no tiene perfil. */
  async fetchProfile(): Promise<LocalProfile | null | 'none'> {
    const res = await this.request('GET', '/profile');
    if (!res?.ok) return null;
    const { configured, ...profile } = (await res.json()) as LocalProfile & { configured: boolean };
    return configured ? { ...profile, allergies: profile.allergies ?? [] } : 'none';
  }

  async putProfile(profile: LocalProfile): Promise<PutLogResult> {
    return this.putResult(await this.request('PUT', '/profile', profile));
  }

  async fetchRestrictions(): Promise<RestrictionItem[] | null> {
    const res = await this.request('GET', '/restrictions');
    return res?.ok ? ((await res.json()) as RestrictionItem[]) : null;
  }

  async putRestriction(item: RestrictionItem): Promise<PutLogResult> {
    const { id, ...body } = item;
    return this.putResult(await this.request('PUT', `/restrictions/${id}`, body));
  }

  async deleteRestriction(id: string): Promise<'ok' | 'retry'> {
    const res = await this.request('DELETE', `/restrictions/${id}`);
    return res?.ok ? 'ok' : 'retry';
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

  // AC-mobile-004-11: siempre con el token de la sesión; sin token o sin red devuelve null (queda pendiente).
  private request(method: 'GET' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<Response | null> {
    if (!this.baseUrl) return Promise.resolve(null);
    return authedFetch(this.auth, `${this.baseUrl}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}
