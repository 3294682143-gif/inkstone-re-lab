# 网页端 A6：模型与思考模式切换（契约）

- 采集日期：2026-10-20
- 目标页：`https://discovery.intern-ai.org.cn/chat`
- 确认等级：**已观察**（列表结构与本地偏好）；模型选择器下拉项未取到

## 模型列表

| 项 | 值 |
| --- | --- |
| 方法/路径 | `GET /api/orbit/v1/models` |
| 鉴权 | 必须带 `Authorization: Bearer <jwt>`；裸请求返回 `401 / code=-10002` |
| 响应 | `200`、`code=0`、`data.models[]` |
| 条目字段 | **仅 `name` / `tags` / `icon`**（无 id/key） |
| 数量 | 8 |

实测模型名（顺序按接口返回）：

```
Default
书生-Agents-A1
书生-S2
书生-Atria-Dawn-Preview
Qwen3.7-Plus
Qwen3.8-Flash
DeepSeek-V4-Flash
Kimi-K2.7-Code
```

> 关键结论：**网页端用模型"名称"作为标识**，发送请求里的 `model` 字段就是这些字符串，不存在独立 model key。

## 发送请求体（实测）

```json
{
  "scenario": 1,
  "thinking_mode": true,
  "planning_mode": false,
  "model": "书生-S2",
  "query": "<用户输入>",
  "chat_id": 1150742
}
```

## 切换行为

| 项 | 事实 |
| --- | --- |
| 思考模式控件 | 两个按钮 `快速` / `深度`（class `_thinkSwitchOpt_*`，激活项带 `_active_`） |
| 思考模式持久化 | 写入 `localStorage["discovery:science-thinking-mode-preference"]`，观测值 `"true"`（深度）/ `"false"`（快速） |
| 模型控件 | `button[title="选择模型"]`（class `_modelPill_*`），按钮文本即当前模型名 |
| 模型持久化 | 写入 `localStorage["discovery:science-model-preference"]`，值为模型名（观测 `"书生-S2"`） |
| 输入区设置 | `localStorage["repository-detail-chat-input-settings"] = {"thinkingMode":bool,"selectedModelName":string}` |
| 切换后影响 | 下一次 `POST /api/orbit/v1/chat` 的 `thinking_mode` / `model` 字段随之改变；已发起的流不受影响（推断，未专测） |

## 未确认（保留 UNKNOWN）

1. 模型选择器下拉项的 DOM 结构与渲染容器（portal 未命中，未取到选项节点）。
2. `tags` / `icon` 的取值语义与前端筛选规则（例如是否按套餐/权限过滤）。
3. 切换模型是否改变历史会话可见性（未测）。
4. `planning_mode` 的取值来源与 UI 入口（本次始终观测为 `false`）。
