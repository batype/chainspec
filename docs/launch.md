# 发布草稿（未发送）

ChainSpec：把Swagger/OpenAPI JSON变成`API.main.controller.method.request()`，React中可直接`useRequest()`。有类型、可自定义请求、可加异步拦截器，读操作用SWR，写操作由trigger触发。

15秒演示：导入合成JSON→选择getUser预览入参和返回模型→切换useRequest→选择createUser展示trigger→折叠输入→下载SDK。

明确边界：首版是常见OpenAPI子集；模型缺失会显示unknown，生成器不发送业务请求。不宣称覆盖全部规范或保证用户增长。
