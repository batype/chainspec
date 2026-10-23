import { useCallback, useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig, unstable_serialize, type SWRConfiguration, type SWRResponse } from "swr";
import useSWRMutation, {
  type SWRMutationConfiguration,
  type SWRMutationResponse,
} from "swr/mutation";
import {
  splitArgs,
  type Endpoint,
  type RequestArgs,
  type RequestOptions,
} from "./runtime.js";
export type RequestHookOptions<R> = RequestOptions & {
  enabled?: boolean;
  swr?: SWRConfiguration<R, Error> & { throwOnError?: boolean };
};
export type QueryOptions<R> = RequestHookOptions<R>;
export type RequestTriggerOptions = { throwOnError?: boolean };
export type RequestResult<B, R, Bound extends boolean> = SWRResponse<R, Error> & {
  isMutating: boolean;
  trigger(...args: Bound extends true
    ? [body?: B, options?: RequestTriggerOptions]
    : [body: B, options?: RequestTriggerOptions]): Promise<R | undefined>;
  /** Re-run with the current params and most recently bound/submitted body. */
  refresh(): Promise<R | undefined>;
};
export type RequestHook<P, B, R, H extends boolean, Required extends boolean> = H extends true
  ? Required extends true
    ? {
        (params: P | null, body: B, options?: RequestHookOptions<R>): RequestResult<B, R, true>;
        (params: P | null, body: undefined, options: RequestHookOptions<R> & { enabled: false }): RequestResult<B, R, false>;
      }
    : (params: P | null, body?: B, options?: RequestHookOptions<R>) => RequestResult<B, R, true>
  : (...args: {} extends P
      ? [params?: P | null, options?: RequestHookOptions<R>]
      : [params: P | null, options?: RequestHookOptions<R>]) => RequestResult<never, R, true>;
export type QueryArgs<
  P,
  B,
  R,
  H extends boolean,
  Required extends boolean,
> = H extends true
  ? Required extends true
    ? [params: P | null, body: B, options?: QueryOptions<R>]
    : [params: P | null, body?: B, options?: QueryOptions<R>]
  : {} extends P
    ? [params?: P | null, options?: QueryOptions<R>]
    : [params: P | null, options?: QueryOptions<R>];
export type MutationOptions<B, R> = RequestOptions & {
  swr?: SWRMutationConfiguration<R, Error, readonly unknown[], B> & {
    throwOnError?: boolean;
  };
};
export type TriggerOptions<B, R> = SWRMutationConfiguration<
  R,
  Error,
  readonly unknown[],
  B
> & { throwOnError?: boolean };
export type MutationResult<B, R, Bound extends boolean> = Omit<
  SWRMutationResponse<R, Error, readonly unknown[], B>,
  "trigger"
> & {
  trigger(
    ...args: Bound extends true
      ? [body?: B, options?: TriggerOptions<B, R>]
      : [body: B, options?: TriggerOptions<B, R>]
  ): Promise<R | undefined>;
};
export type MutationHook<
  P,
  B,
  R,
  H extends boolean,
  Required extends boolean,
> = H extends true
  ? {
      (
        params: P,
        body: B,
        options?: MutationOptions<B, R>,
      ): MutationResult<B, R, true>;
      (
        params: P,
        body?: undefined,
        options?: MutationOptions<B, R>,
      ): MutationResult<B, R, Required extends true ? false : true>;
    }
  : (
      ...args: {} extends P
        ? [params?: P, options?: MutationOptions<never, R>]
        : [params: P, options?: MutationOptions<never, R>]
    ) => MutationResult<never, R, true>;
export type QueryEndpoint<
  P,
  B,
  R,
  H extends boolean,
  Required extends boolean,
> = Endpoint<P, B, R, H, Required> & {
  useRequest: RequestHook<P, B, R, H, Required>;
};
export type MutationEndpoint<
  P,
  B,
  R,
  H extends boolean,
  Required extends boolean,
> = Endpoint<P, B, R, H, Required> & {
  useRequest: RequestHook<P, B, R, H, Required>;
  useMutation: MutationHook<P, B, R, H, Required>;
};
export function withQuery<P, B, R, H extends boolean, Required extends boolean>(
  endpoint: Endpoint<P, B, R, H, Required>,
): QueryEndpoint<P, B, R, H, Required> {
  function useRequest(...args: unknown[]) {
    const split = splitArgs(endpoint.definition, args);
    const config = split.options as RequestHookOptions<R>;
    const boundArgs = args as unknown as RequestArgs<P, B, H, Required>;
    const boundKey = args[0] === null ? null : endpoint.getKey(...boundArgs);
    const sourceId = unstable_serialize(boundKey);
    const [submitted, setSubmitted] = useState<{ sourceId: string; body: B | undefined } | null>(null);
    const submittedRef = useRef(submitted);
    useEffect(() => {
      if (submittedRef.current?.sourceId !== sourceId) {
        submittedRef.current = null;
        setSubmitted(null);
      }
    }, [sourceId]);
    const selected = submitted?.sourceId === sourceId ? submitted : null;
    const body = selected ? selected.body : split.body;
    const requestArgs = (endpoint.definition.hasBody
      ? [split.params, body, split.options]
      : [split.params, split.options]) as unknown as RequestArgs<P, B, H, Required>;
    const key = boundKey ? endpoint.getKey(...requestArgs) : null;
    const keyId = unstable_serialize(key);
    const committedKey = useRef("");
    const [manual, setManual] = useState<Record<string, { pending: number; error?: Error }>>({});
    const runs = useRef(new Map<string, number>());
    const sequence = useRef(0);
    const swrContext = useSWRConfig();
    const { mutate, cache } = swrContext;
    const current = useRef({ sourceId, split, paused: args[0] === null, swrConfig: { ...swrContext, ...config.swr } });
    const isRead = endpoint.definition.method === "GET" || endpoint.definition.method === "HEAD";
    const enabled = config.enabled !== false;
    const swrOptions: SWRConfiguration<R, Error> = {
      // Non-read requests run automatically once, but never replay on focus,
      // reconnect, polling or error by default. Explicit local options can opt in.
      ...(!isRead ? { revalidateOnFocus: false, revalidateOnReconnect: false, refreshInterval: 0, shouldRetryOnError: false } : {}),
      ...config.swr,
      ...(selected ? { revalidateOnMount: false } : {}),
      ...(!enabled ? {
        revalidateOnMount: false, revalidateIfStale: false, revalidateOnFocus: false,
        revalidateOnReconnect: false, refreshInterval: 0, shouldRetryOnError: false,
        suspense: false, isPaused: () => true,
      } : {}),
      // Switching to a manually submitted body's key must not launch an
      // additional automatic request. The ref is released after SWR's key effect.
      isPaused: () => !enabled || Boolean(manual[keyId]?.pending)
        || Boolean(selected && committedKey.current !== keyId) || config.swr?.isPaused?.() === true,
      onSuccess: (data, serializedKey, swrConfig) => {
        setManual(previous => previous[serializedKey]?.error
          ? { ...previous, [serializedKey]: { ...previous[serializedKey], error: undefined } } : previous);
        (config.swr?.onSuccess ?? swrContext.onSuccess)?.(data, serializedKey, swrConfig);
      },
    };
    const state = useSWR<R, Error>(key, () => endpoint.request(...requestArgs), swrOptions);
    current.current = { sourceId, split, paused: args[0] === null, swrConfig: { ...swrContext, ...swrOptions } };
    useEffect(() => { committedKey.current = keyId; }, [keyId]);
    const previousConditions = useRef({ enabled, keyId });
    useEffect(() => {
      const previous = previousConditions.current;
      previousConditions.current = { enabled, keyId };
      // A disabled hook retains its key for manual cache updates. Re-enabling
      // the same key therefore needs an explicit revalidation, once only.
      if (enabled && !previous.enabled && key && previous.keyId === keyId) void state.mutate();
    }, [enabled, keyId, state.mutate]);
    const trigger = useCallback(async (...triggerArgs: unknown[]): Promise<R | undefined> => {
      const snapshot = current.current;
      if (snapshot.paused) throw new Error("params 为 null 时不能请求，请先提供参数");
      const previous = submittedRef.current?.sourceId === snapshot.sourceId ? submittedRef.current : null;
      const nextBody = triggerArgs.length ? triggerArgs[0] : previous ? previous.body : snapshot.split.body;
      if (!endpoint.definition.hasBody && nextBody !== undefined) throw new Error("此接口未声明请求体");
      const actualArgs = (endpoint.definition.hasBody
        ? [snapshot.split.params, nextBody, snapshot.split.options]
        : [snapshot.split.params, snapshot.split.options]) as unknown as RequestArgs<P, B, H, Required>;
      const actualKey = endpoint.getKey(...actualArgs), id = unstable_serialize(actualKey);
      const run = ++sequence.current;
      runs.current.set(id, run);
      const next = { sourceId: snapshot.sourceId, body: nextBody as B | undefined };
      submittedRef.current = next;
      setSubmitted(next);
      setManual(previous => ({ ...previous, [id]: { pending: (previous[id]?.pending ?? 0) + 1 } }));
      try {
        // Populate the cache of the actual body, never the previous body's key.
        // Revalidation is off to avoid issuing a second request after this one.
        const data = await mutate<R>(actualKey, () => endpoint.request(...actualArgs), {
          populateCache: true, revalidate: false, throwOnError: true,
        });
        if (runs.current.get(id) === run) snapshot.swrConfig.onSuccess?.(data as R, id, snapshot.swrConfig);
        return data;
      } catch (error) {
        if (runs.current.get(id) === run) setManual(previous => ({
          ...previous, [id]: { pending: previous[id]?.pending ?? 0, error: error instanceof Error ? error : new Error("请求失败") },
        }));
        if (runs.current.get(id) === run) snapshot.swrConfig.onError?.(
          error instanceof Error ? error : new Error("请求失败"), id, snapshot.swrConfig,
        );
        const options = triggerArgs[1] as RequestTriggerOptions | undefined;
        if (options?.throwOnError ?? (snapshot.split.options as RequestHookOptions<R>).swr?.throwOnError ?? true) throw error;
        return undefined;
      } finally {
        setManual(previous => ({ ...previous, [id]: { ...previous[id], pending: Math.max(0, (previous[id]?.pending ?? 1) - 1) } }));
      }
    }, [endpoint, mutate]);
    const refresh = useCallback(() => trigger(), [trigger]);
    const pending = Boolean(manual[keyId]?.pending);
    // A manual 204 can leave data undefined without an SWR fetch ever running.
    // Read actual cache flags instead of SWR's inferred new-key loading state.
    const cached = cache.get(keyId);
    const validating = manual[keyId] ? cached?.isValidating === true : state.isValidating;
    const loading = manual[keyId] ? cached?.isLoading === true : state.isLoading;
    return {
      ...state, error: manual[keyId]?.error ?? state.error,
      isMutating: pending, isValidating: validating || pending,
      isLoading: loading || (pending && state.data === undefined), trigger, refresh,
    };
  }
  return Object.assign(endpoint, { useRequest }) as QueryEndpoint<P, B, R, H, Required>;
}

export function withMutation<
  P,
  B,
  R,
  H extends boolean,
  Required extends boolean,
>(
  endpoint: Endpoint<P, B, R, H, Required>,
): MutationEndpoint<P, B, R, H, Required> {
  function useMutation(...args: unknown[]) {
    const {
      params,
      body: preset,
      options,
    } = splitArgs(endpoint.definition, args);
    const config = options as MutationOptions<B, R>;
    const boundArgs = (endpoint.definition.hasBody
      ? [params, preset, options]
      : [params, options]) as unknown as RequestArgs<P, B, H, Required>;
    const state = useSWRMutation<R, Error, readonly unknown[], B>(
      endpoint.getKey(...boundArgs),
      (_key, { arg }) => {
        const requestArgs = (endpoint.definition.hasBody
          ? [params, arg, options]
          : [params, options]) as unknown as RequestArgs<P, B, H, Required>;
        return endpoint.request(...requestArgs);
      },
      config.swr,
    );
    return {
      ...state,
      trigger: (...triggerArgs: unknown[]) => {
        const body = triggerArgs.length ? triggerArgs[0] : preset;
        const trigger = state.trigger as (
          body: B,
          options?: TriggerOptions<B, R>,
        ) => Promise<R | undefined>;
        return trigger(
          body as B,
          triggerArgs[1] as TriggerOptions<B, R> | undefined,
        );
      },
    };
  }
  return Object.assign(withQuery(endpoint), { useMutation }) as MutationEndpoint<P, B, R, H, Required>;
}
