export const example = {
  openapi: "3.0.3",
  info: { title: "Workspace API", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/v1/api/users": {
      get: {
        operationId: "ListUsers",
        tags: ["用户管理"],
        summary: "获取成员列表",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "keyword", in: "query", schema: { type: "string" } },
        ],
        responses: {
          200: {
            description: "成员列表",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/User" },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: "CreateUser",
        tags: ["用户管理"],
        summary: "邀请新成员",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateUser" },
            },
          },
        },
        responses: {
          201: {
            description: "新成员",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
        },
      },
    },
    "/v1/api/users/{id}": {
      get: {
        operationId: "GetUser",
        tags: ["用户管理"],
        summary: "查看成员详情",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "成员",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
        },
      },
    },
    "/v1/api/projects": {
      get: {
        operationId: "ListProjects",
        tags: ["项目管理"],
        summary: "获取项目列表",
        responses: {
          200: {
            description: "项目列表",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Project" },
                },
              },
            },
          },
        },
      },
    },
    "/v1/api/projects/{id}": {
      delete: {
        operationId: "DeleteProject",
        tags: ["项目管理"],
        summary: "归档项目",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { 204: { description: "已归档" } },
      },
    },
    "/v1/api/files/upload": {
      post: {
        operationId: "Upload",
        tags: ["文件管理"],
        summary: "上传附件",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: { file: { type: "string", format: "binary" } },
                required: ["file"],
              },
            },
          },
        },
        responses: {
          200: {
            description: "上传结果",
            content: { "application/json": { schema: { type: "string" } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: "object",
        properties: {
          id: { type: "string", readOnly: true },
          name: { type: "string" },
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["admin", "member"] },
        },
        required: ["id", "name", "email", "role"],
      },
      CreateUser: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          password: { type: "string", writeOnly: true },
        },
        required: ["name", "email"],
      },
      Project: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          owner: { $ref: "#/components/schemas/User" },
          status: { type: "string", enum: ["active", "archived"] },
        },
        required: ["id", "title"],
      },
    },
  },
};
export const exampleText = JSON.stringify(example, null, 2);
