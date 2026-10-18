# 认证与本地状态（0.2.7）

- 证据：`M = out/main/index-CYl10ENn.js`（`f4b8148d…`）
- 确认等级：STATIC_CONFIRMED（结构）；真实凭据值不读取、不记录

## 1. 认证（Web SSO → 桌面 gateway authority）

- SSO origin `https://sso.openxlab.org.cn`，client_id `dagw07mkg1bazlxzoy31`，source `discovery`（M:3784/4827）。
- 登录 API：code exchange、`getUserInfo`、`logout`（M:61830 起）→ 登录状态机。
- gateway 身份头由主进程构造：`Authorization: Bearer <token>`、`id: <ssoUid>`、`Accept-Language: <locale>`（M:38165 `headers()`）。
- **不与 Web 共用 Cookie 方案**：桌面推理请求 `credentials:"omit"`（M:38102-38105）。

## 2. 凭据存储

- `SecureAuthCredentialStore`（M:62492）配合 Electron `safeStorage`（M:117161 `credentials: new SecureAuthCredentialStore(join(userDataPath,"credentials"), …)`）。
- 含旧凭据迁移入口（`legacy`）。
- 处理原则：**不复制/上传凭据库**，不尝试绕过系统加密；仅分析结构与字段、用专用测试数据。

## 3. Headless 登录前提

- `createHeadlessChatHost.assertAuthenticated`：`auth.getState().status !== "authenticated"` → 抛 `SSO_REQUIRED`（M:119018）。
- 即：须在**同一机器、同一系统用户**下先用桌面应用完成登录。`SSO_REQUIRED` **不是**要求导出 Token。

## 4. 本地数据库（结构级）

- `userData/data/app.db`、profile 根下 `profile.db`（M:7113/M:8478）。仅分析结构与专用测试数据，不搬运真实库。

## 5. UNKNOWN

- 凭据文件的具体序列化/加密形态（未解密）；
- 登录状态机的完整迁移与刷新时序；
- SQLite 表结构细节（未读取真实库）。
