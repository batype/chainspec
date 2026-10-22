# 1.x → 2.0 迁移

2.0改变生成SDK的调用签名。已下载的1.x源码仍可保留；要使用新签名，请用2.0重新生成并更新调用处。不要将新旧runtime/client/hooks/types文件混用。

## 无body操作

```ts
// 以前
getUser.request({path:{id:'42'},headers:{'X-App':'web'}}, {signal});
getUser.useRequest({path:{id:'42'}},{request:{headers:{'X-App':'web'}},enabled:true});
// 2.0
getUser.request({path:{id:'42'}},{headers:{'X-App':'web'},signal});
getUser.useRequest({path:{id:'42'}},{headers:{'X-App':'web'},enabled:true});
```

## 有body操作

```ts
// 以前
createUser.request({query:{notify:true},body:{name:'Ada'},headers:{'X-App':'web'}},{signal});
// 2.0
createUser.request({query:{notify:true}},{name:'Ada'},{headers:{'X-App':'web'},signal});
```

文档未声明请求体的POST/DELETE等，仍为params/options两段。有body声明但body可选时，request(params, undefined, options)可以只传options。固定位置避免把恰好含headers/signal字段的body误判为配置。

## 写hook的手动触发

```ts
// 以前
const action=createUser.useRequest({request:{headers:{'X-App':'web'}}});
// 事件中：action.trigger({query:{notify:true},body:{name:'Ada'}})

// 2.0：params/options先绑定，body提交时再提供
const action=createUser.useRequest({query:{notify:true}},undefined,{headers:{'X-App':'web'}});
// 事件中：action.trigger({name:'Ada'})

// 也可预先绑定body，事件中action.trigger()；trigger(newBody)覆盖body
const actionBound=createUser.useRequest({query:{notify:true}},{name:'Ada'},{headers:{'X-App':'web'}});
```

params变化时让组件重新渲染；不要把新的path/query塞进trigger参数，trigger的第一个参数现在仅是body。trigger第二个参数仍是SWR的单次触发配置（如throwOnError）。没有body的写hook先useRequest(params,options)，再trigger()。

## 类型与其他行为

Operations的input拆为params/body/headers；headers类型用于查阅声明，options.headers接收标准HeadersInit（Header值需要字符串化）。生成的Endpoint和Hook泛型随之更新。空params限制为对象，防止把原始值或旧body信封误放第一位。

缓存key仍隔离客户端、身份、参数及显式headers，现在还明确包含独立body。动态认证请继续维护cacheScope。全局headers与前置处理仍可注入必填header，必填header在前置链后校验。认证、错误传播、AbortSignal、编码及写hook手动触发方式保持原有约定。
