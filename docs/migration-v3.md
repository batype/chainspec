# v3：统一 useRequest 行为

v3 生成的 SDK 中，所有 HTTP 方法的 useRequest 都默认自动请求；useMutation 继续手动。原有 request 的 params/body/options、headers、拦截器、类型及 CLI 配置格式保持不变。旧 SDK 源码需重新生成才会改变。

## 保持原有写操作为手动

v2：

```tsx
const {trigger} = API.main.users.createUser.useRequest({}, undefined, options);
```

v3 两种等价迁移方式：

```tsx
const {trigger} = API.main.users.createUser.useMutation({}, undefined, options);
// 或：
const {trigger, refresh} = API.main.users.createUser.useRequest({}, undefined, {
  ...options,
  enabled: false,
});
```

必填 body 未提供时，只有 enabled:false 的 useRequest 重载可用，首次 trigger(body) 必须提供正确 body。自动模式需在 useRequest 的第二位置提供 body。useMutation 原有 body/options 和 typed trigger 继续保留。

## 自动与重新请求

```tsx
const {data, error, isLoading, trigger, refresh} =
  API.main.users.createUser.useRequest({}, body); // 默认自动

const onReload = () => refresh();
const onNewBody = () => trigger(nextBody);
```

refresh 使用当前 params 和最近一次提交的 body。trigger(newBody) 改用新 body 的缓存键，不覆盖旧 body 的缓存；参数/body/headers 或身份 scope 改变后清除这个手动绑定。两函数引用稳定，可在事件、useEffect 或自定义 Hook 回调中调用；Hook 自身仍只能在组件/自定义 Hook 顶层调用。enabled:false 后 refresh 仍能主动请求；null params 不能手动请求。

所有请求继续执行 ClientConfig / 单次 options 的 beforeRequest、afterResponse 和 onError。手动调用拒绝的 Promise 需要处理。POST 等非查询请求默认禁用聚焦、重连、轮询、错误自动重试；显式 swr 配置可启用。GET/HEAD 保留原查询策略。参数改变可能自动发送请求，提交/删除事件请使用 useMutation 或 enabled:false。

## 类型与缓存接口

React 入口新增 RequestHookOptions、RequestResult、RequestTriggerOptions；QueryOptions 作为别名保留。useRequest 的 swr 是普通 SWR 配置，不再是 Mutation 配置；乐观更新等 SWRMutation 特有选项继续放在 useMutation 中。useRequest 的 trigger 第二参数支持 throwOnError；返回的 mutate 保留 SWR 缓存语义，refresh/trigger 用于明确发起网络请求。
