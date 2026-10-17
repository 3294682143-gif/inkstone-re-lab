# 转换/加密核验（P3）

- 确认等级：**源码可证（未发现）**

在已加载脚本（24 项，S-MOCE/S-597/S-MAIN/S-VEND 等）中：

| 检查项 | 结论 |
| --- | --- |
| 聊天链路中的自定义签名/加密算法 | **未发现**（未见 md5/sha/hmac/AES/RSA/SM2 等被用于构造请求的迹象） |
| 压缩/编码转换 | **未发现**（未见专门的序列化包装） |
| WASM 模块 | 未见（`04-evidence` 未捕获 .wasm） |
| Worker | 未见（`MessageChannel` 命中属库代码，非聊天 Worker） |
| 环境依赖值 | 存在 `sessionStorage`（`pending-new-chat:<id>`）与 `localStorage` 用法，属前端状态；非鉴权凭证 |

## 结论

- 未观察到需要 `rev_crypto_calc` 的算法。**但**聊天发送的按需 chunk 尚未获取，该结论仅覆盖已加载脚本（见 `unknowns.md` U3）。
- 若 A1 后出现签名/加密字段，再按手册 §9 顺序：`rev_assess` → `rev_deobfuscate` → `rev_hook_generate` → `rev_extract_pure` → `rev_crypto_calc`。

## 工具可用性说明

`rev_*` 属 DSH 模型侧工具，本环境无法非交互驱动（B7）。本轮静态检索由 ripgrep 完成，未冒充 `rev_*` 调用。
