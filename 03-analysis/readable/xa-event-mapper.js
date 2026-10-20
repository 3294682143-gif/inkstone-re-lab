// 出处：02-sources/original/static.openxlab.org.cn_moce_index-Cd5teKeb.js
//   MOCE 聊天模块，xa(e,t) 事件→补丁映射，@44200 附近
// 处理：reverse-toolkit rev_assess（零混淆、可静态还原）→ rev_deobfuscate（常量折叠 13 处）
// 注意：Po / ha / ba / jo / na / fa / Do / wa 等辅助函数在 bundle 其它位置，此处保留原名。
xa = (e, t) => {
  const o = ha(t);
  const a = o.includes("subagent");
  const i = Po(t.agent) ? t.agent : undefined;
  const n = Po(t.result) ? t.result : (Po(i?.result) ? i?.result : undefined);
  const s = ba(t.chat_id, t.cid, t.chatId);
  const r = ba(t.message_id, t.mid, t.messageId);
  const l = jo(t.model);
  let c = { ...e, chatId: s ?? e.chatId, messageId: r ?? e.messageId, model: l ?? e.model, updatedAt: Date.now() };
  if (Object.prototype.hasOwnProperty.call(t, "feedback")) c = { ...c, feedback: na(t.feedback) };
  if (e.isSafetyBlocked || fa(t)) return Do(c);
  if ("message" === o) c = { ...c, isWaitingForMessage: false };
  if ("message_end" === o) c = wa(c, { done: true, answerEnded: true });
  else if ("done" === o || "close" === o || "workflow_finished" === o) c = wa(c, { done: true });
  if ("error" === o) c = { ...c, error: String(t.error || t.msg || t.message || "请求出错了，请稍后再试"), isWaitingForMessage: false, hasMessageEnded: true, isAgentComplete: true };
  const d = a ? undefined : (t.answer || t.delta || t.response || ("message" === o ? t.text : undefined));
  if (typeof d === "string") c = wa(c, { responseDelta: d });
  const p = a ? undefined : (t.thinking || (o.includes("thinking") ? t.text : undefined));
  if (typeof p === "string") c = wa(c, { thinkingDelta: p });
  return c;
};
lm = new Set(["message_end", "done", "close", "error", "workflow_finished"]);
