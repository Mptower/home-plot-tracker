/**
 * The only module in the app that speaks to Home Assistant.
 *
 * Everything goes through Supervisor's proxy at `http://supervisor/core/api`,
 * authenticated with `SUPERVISOR_TOKEN`. That token is the reason this is
 * server-only: it is a credential for her entire Home Assistant instance, and
 * it must never be handed to the browser, logged, or echoed into a response
 * body. Nothing here returns it, and the one endpoint the client is given
 * (`GET /api/home-assistant`) is built by hand from the few fields the banner
 * needs.
 *
 * ## It never throws
 *
 * Every method returns a discriminated result rather than rejecting. Home
 * Assistant is a nice-to-have bolted onto a garden app; a Supervisor that is
 * slow, restarting, upgrading or simply gone must never surface as an error in
 * the app, an unhandled rejection, or a request that hangs. Callers are
 * expected to handle `ok: false` by carrying on with less information, and the
 * type makes forgetting that awkward.
 *
 * ## It gives up quickly
 *
 * Every request carries a 5-second timeout. Home Assistant restarts can leave
 * the proxy accepting connections and never answering, which without a deadline
 * is a hung poll that holds a timer slot forever.
 */

/** Success carries the parsed body; failure carries a reason fit for a log line. */
export type HaResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status?: number };

/** A Home Assistant entity as `GET /states/<id>` returns it. */
export interface HaEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

/** Injectable so tests can drive the whole integration without a network. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface HaClientOptions {
  baseUrl: string;
  token: string;
  /** Defaults to the global `fetch`. Tests pass a stand-in with a call log. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class HomeAssistantClient {
  readonly #baseUrl: string;
  readonly #supervisorUrl: string;
  readonly #token: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(options: HaClientOptions) {
    this.#supervisorUrl = options.baseUrl.replace(/\/+$/, '');
    this.#baseUrl = `${this.#supervisorUrl}/core/api`;
    this.#token = options.token;
    this.#fetch = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async #send<T>(url: string, init: { method: string; body?: unknown }): Promise<HaResult<T>> {
    // `AbortSignal.timeout` rather than a manual timer: it cannot leak a
    // dangling timer if the request settles first, which a poll running every
    // fifteen minutes forever would eventually notice.
    let signal: AbortSignal | undefined;

    try {
      signal = AbortSignal.timeout(this.#timeoutMs);
    } catch {
      signal = undefined;
    }

    try {
      const response = await this.#fetch(url, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.#token}`,
          'Content-Type': 'application/json',
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        ...(signal ? { signal } : {}),
      });

      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}`, status: response.status };
      }

      // A 200 with a body that is not JSON is a proxy or a login page, not Home
      // Assistant. Treated the same as any other failure: we simply do not know
      // anything, and the caller carries on without it.
      try {
        return { ok: true, value: (await response.json()) as T };
      } catch {
        return { ok: false, error: 'response was not JSON', status: response.status };
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      return { ok: false, error: reason };
    }
  }

  /** Home Assistant's own API, behind Supervisor's proxy. */
  #request<T>(path: string, init: { method: string; body?: unknown }): Promise<HaResult<T>> {
    return this.#send<T>(`${this.#baseUrl}${path}`, init);
  }

  /**
   * This add-on's own slug, for building an ingress link.
   *
   * `/addons/self/info` is Supervisor's own API rather than Home Assistant's,
   * needs no extra permission beyond the token every add-on already has, and is
   * the only honest way to know where we are mounted. The alternative is
   * hardcoding an install slug, which would quietly break the "open the app"
   * tap on her notification the day the add-on is reinstalled from a different
   * repository — exactly the kind of silent breakage that is impossible to
   * diagnose from a phone.
   */
  async getSelfSlug(): Promise<string | null> {
    const result = await this.#send<{ data?: { slug?: unknown } }>(
      `${this.#supervisorUrl}/addons/self/info`,
      { method: 'GET' },
    );

    if (!result.ok) return null;

    const slug = result.value?.data?.slug;

    return typeof slug === 'string' && slug !== '' ? slug : null;
  }

  /** One entity's current state, or a failure. `404` when the id is wrong. */
  getState(entityId: string): Promise<HaResult<HaEntityState>> {
    return this.#request<HaEntityState>(`/states/${encodeURIComponent(entityId)}`, {
      method: 'GET',
    });
  }

  /**
   * Creates or updates an entity.
   *
   * Worth knowing: entities created this way are **not persisted across a Home
   * Assistant restart**. They live in the state machine and nothing writes them
   * to the registry, so after a reboot they are simply gone until something
   * posts them again. That is why the sensor publisher runs on a heartbeat
   * rather than only when the garden changes.
   */
  setState(
    entityId: string,
    state: string,
    attributes: Record<string, unknown>,
  ): Promise<HaResult<HaEntityState>> {
    return this.#request<HaEntityState>(`/states/${encodeURIComponent(entityId)}`, {
      method: 'POST',
      body: { state, attributes },
    });
  }

  /**
   * Calls a service, optionally asking for its response.
   *
   * `return_response=true` is what makes the forecast reachable at all: since
   * 2024.4 the forecast is no longer an attribute of the weather entity, and
   * `weather.get_forecasts` is the only way to read it.
   */
  callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
    returnResponse = false,
  ): Promise<HaResult<unknown>> {
    const query = returnResponse ? '?return_response=true' : '';

    return this.#request<unknown>(
      `/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}${query}`,
      { method: 'POST', body: data },
    );
  }
}
