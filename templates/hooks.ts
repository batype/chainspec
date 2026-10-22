import useSWR, { type SWRConfiguration, type SWRResponse } from "swr";
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
export type QueryOptions<R> = RequestOptions & {
  enabled?: boolean;
  swr?: SWRConfiguration<R, Error>;
};
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
  useRequest(...args: QueryArgs<P, B, R, H, Required>): SWRResponse<R, Error>;
};
export type MutationEndpoint<
  P,
  B,
  R,
  H extends boolean,
  Required extends boolean,
> = Endpoint<P, B, R, H, Required> & {
  useRequest: MutationHook<P, B, R, H, Required>;
  useMutation: MutationHook<P, B, R, H, Required>;
};
export function withQuery<P, B, R, H extends boolean, Required extends boolean>(
  endpoint: Endpoint<P, B, R, H, Required>,
): QueryEndpoint<P, B, R, H, Required> {
  function useRequest(...args: QueryArgs<P, B, R, H, Required>) {
    const { options } = splitArgs(endpoint.definition, args);
    const config = options as QueryOptions<R>;
    const requestArgs = args as unknown as RequestArgs<P, B, H, Required>;
    return useSWR<R, Error>(
      args[0] !== null && config.enabled !== false
        ? endpoint.getKey(...requestArgs)
        : null,
      () => endpoint.request(...requestArgs),
      config.swr,
    );
  }
  return Object.assign(endpoint, { useRequest });
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
  return Object.assign(endpoint, {
    useRequest: useMutation,
    useMutation,
  }) as MutationEndpoint<P, B, R, H, Required>;
}
