# 请求流分析（P3）

- 确认等级：**源码可证 + 部分运行时观察（A0）**；发送/流式行为**待 A1**
- 主要来源：S-MOCE（space-common-provider）、S-597

## 已观察（A0，未登录）

```
GET  /chat/                         → 200 页面外壳                       (R001)
GET  /api/orbit/v1/models           → 401（未登录）                     (R002)
GET  /api/spacebe/v1/space/list     → 401（未登录）                     (R003)
POST https://aurora.openxlab.org.cn/v1/web/start → 200                 (R004)
GET  https://aurora.openxlab.org.cn/v1/web/tags  → 200                 (R005)
```

## 源码推导的发送流程（S-MOCE，待 A1 验证）

```
用户点击发送
  └─ submitProperties = {app_id, scene_code, scene_name, model_id, conversation_id?, turn_index, depth_mode: deep|quick, has_attachment, project_id}
  └─ onSubmit(value, files, modelKey, thinkingMode, topic)
       └─ POST /api/orbit/v1/chat/new   {scenario:1, space_id?}
             ↳ 期望 {code:0, data:{id}}      # 新建会话，拿到 chat_id
       └─ 组装发送体:
             { chat_id: <new id>, query, prompt, thinkingMode, model: <modelKey>,
               spaceId, files?, isNewChat:true }
       └─ 跳转 /repo/repository/<spaceId>?chatid=<id>（新会话暂存 sessionStorage: pending-new-chat:<spaceId>）
```

## 关键字段（源码可证）

| 字段 | 来源 | 含义 |
| --- | --- | --- |
| `scenario` | 字面量 `1` | 场景标识（chat/new、chat/list 均见） |
| `chat_id` / `conversation_id` | chat/new 返回 / 组件入参 | 会话标识（**待 A1 确认真实返回字段名**） |
| `query` / `prompt` | 用户输入 | 正文（两个字段填相同值） |
| `turn_index` | 组件入参 | 轮次序号 |
| `model` / `model_id` | 选中的模型（`modelKey`/`id`/`name`） | 模型选择 |
| `thinkingMode` | 思考模式开关 | 对应 API 的 thinking/reasoning 参数（**待 A1**） |
| `space_id` / `spaceId` | 空间 | 空间（仓库）归属 |
| `files` | 附件 | 附件数组（第一轮不涉及） |
| `isNewChat` | 字面量 true/false | 是否新会话 |

## 会话/消息关联（源码可证）

- 历史消息链：从某条消息沿 `parent_id` 上溯，最多 3 层，`unshift` 成链条（S-MOCE）。
- 历史列表：`/api/orbit/v1/chat/list`，默认 `{page:1,size:20,scenario:1}`（S-597）。
- 会话详情：`GET /api/orbit/v1/chat/{id}/detail`；标题：`POST /api/orbit/v1/chat/{id}/title`。

## 未知 / 待 A1 补齐

- **U3**：发送消息的实际请求（URL、方法、Content-Type）与**流式读取方式**未在已加载脚本中定位到——极可能位于聊天页按需加载的 chunk（Module Federation 或懒加载 chunk）。**必须由 A1（登录后发送）实测确定。**
- 鉴权凭证类别与位置（Header/Cookie/Query）。
- `aurora.openxlab.org.cn/v1/web/*` 与主站业务的关系。
- 统一响应约定：源码中 `code===0`/`success===true`/`code===200` 均出现，需实测确认。
