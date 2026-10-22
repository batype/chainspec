import useSWR, { type SWRConfiguration, type SWRResponse } from "swr";
import useSWRMutation, {
  type SWRMutationConfiguration,
  type SWRMutationResponse,
} from "swr/mutation";
import type { Endpoint, RequestArgs, RequestOptions } from "./runtime.js";
export type QueryOptions<R> = {
  enabled?: boolean;
  request?: RequestOptions;
  swr?: SWRConfiguration<R, Error>;
};
export type QueryArgs<I, R> = {} extends I
  ? [input?: I | null, options?: QueryOptions<R>]
  : [input: I | null, options?: QueryOptions<R>];
export type MutationOptions<I, R> = {
  request?: RequestOptions;
  swr?: SWRMutationConfiguration<R, Error, readonly unknown[], I>;
};
export type QueryEndpoint<I, R> = Endpoint<I, R> & {
  useRequest(...args: QueryArgs<I, R>): SWRResponse<R, Error>;
};
export type MutationEndpoint<I, R> = Endpoint<I, R> & {
  useRequest(
    options?: MutationOptions<I, R>,
  ): SWRMutationResponse<R, Error, readonly unknown[], I>;
  useMutation(
    options?: MutationOptions<I, R>,
  ): SWRMutationResponse<R, Error, readonly unknown[], I>;
};
export function withQuery<I, R>(endpoint: Endpoint<I, R>): QueryEndpoint<I, R> {
  return Object.assign(endpoint, {
    useRequest(...[input, options]: QueryArgs<I, R>) {
      const enabled = input !== null && options?.enabled !== false;
      return useSWR<R, Error>(
        enabled ? endpoint.getKey(input ?? undefined, options?.request) : null,
        () =>
          endpoint.request(
            ...([input ?? undefined, options?.request] as RequestArgs<I>),
          ),
        options?.swr,
      );
    },
  });
}
export function withMutation<I, R>(
  endpoint: Endpoint<I, R>,
): MutationEndpoint<I, R> {
  function useMutation(options?: MutationOptions<I, R>) {
    return useSWRMutation<R, Error, readonly unknown[], I>(
      endpoint.getKey(undefined, options?.request),
      (_key, { arg }) =>
        endpoint.request(...([arg, options?.request] as RequestArgs<I>)),
      options?.swr,
    );
  }
  return Object.assign(endpoint, { useRequest: useMutation, useMutation });
}
