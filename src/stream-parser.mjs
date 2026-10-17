// stream-parser.mjs — 针对已实测的 Intern InkStone 聊天 SSE 协议。
// 协议（见 04-contracts/event-protocol.md）：
//   - 响应 Content-Type: text/event-stream，UTF-8
//   - 帧：以空行分隔；每帧一行 `data: <JSON>`（无 `event:` 行，类型在 JSON 的 event 字段）
//   - 事件类型：workflow_started | message | message_end | followup | workflow_finished
//   - message.thinking / message.answer 为**增量 delta**，需按序拼接
//   - 无 [DONE] 标记；结束以 workflow_finished 表示
//
// 纪律：不预设 [DONE]、不预设未知事件的具体语义；未知帧不破坏状态，显式记录为 unknown。

/** 把任意 chunk 归一化为字符串（字节按 UTF-8 流式解码，处理中文跨块）。 */
export class SSEFrameParser {
  constructor() {
    this._dec = new TextDecoder('utf-8');
    this._buf = '';
  }
  /** @param {Uint8Array|Buffer|string} chunk */
  push(chunk) {
    this._buf += (typeof chunk === 'string')
      ? chunk
      : this._dec.decode(chunk, { stream: true });
    return this._drain();
  }
  flush() {
    this._buf += this._dec.decode(); // 冲掉解码器残留
    const out = this._drain();
    if (this._buf.trim()) { const e = this._parse(this._buf); this._buf = ''; if (e) out.push(e); }
    return out;
  }
  _drain() {
    const events = [];
    const normalized = this._buf.replace(/\r\n/g, '\n');
    const parts = normalized.split('\n\n');
    this._buf = parts.pop() ?? '';
    for (const p of parts) { const e = this._parse(p); if (e) events.push(e); }
    return events;
  }
  _parse(block) {
    if (!block || !block.trim()) return null;
    let data = null, evName = null;
    for (const raw of block.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (line === '' || line.startsWith(':')) continue;         // 注释/心跳
      if (line.startsWith('event:')) evName = line.slice(6).trim();
      else if (line.startsWith('data:')) data = (data === null ? '' : data + '\n') + line.slice(5).replace(/^ /, '');
    }
    if (data === null) return null;
    if (data === '[DONE]') return { type: 'done', data: null };   // 仅兼容，不依赖
    try {
      const j = JSON.parse(data);
      return { type: j.event ?? evName ?? 'unknown', data: j };
    } catch {
      return { type: 'unknown', raw: data };
    }
  }
}

/** 把事件流合并为一条消息。 */
export class ChatStreamMerger {
  constructor() { this.reset(); }
  reset() {
    this.cid = null; this.mid = null;
    this.thinking = ''; this.answer = '';
    this.followups = []; this.finished = false;
    this.unknown = []; this.events = 0;
  }
  apply(ev) {
    this.events++;
    if (!ev || ev.type === 'unknown' || !ev.data) { this.unknown.push(ev); return; }
    const d = ev.data;
    if (d.cid != null) this.cid = d.cid;
    if (d.mid != null) this.mid = d.mid;
    switch (ev.type) {
      case 'message':
        if (typeof d.thinking === 'string') this.thinking += d.thinking;
        if (typeof d.answer === 'string') this.answer += d.answer;
        break;
      case 'followup':
        if (Array.isArray(d.followup)) this.followups.push(...d.followup);
        break;
      case 'workflow_finished':
        this.finished = true;
        break;
      case 'workflow_started':
      case 'message_end':
      case 'done':
        break;              // 已知但无需累积
      default:
        this.unknown.push(ev); // 未知类型不破坏状态
    }
  }
  /** 便捷：消费一组事件。 */
  applyAll(events) { for (const e of events) this.apply(e); return this; }
}

/** 一次性解析完整字符串（离线测试用）。 */
export function parseAll(text) {
  const p = new SSEFrameParser();
  return [...p.push(text), ...p.flush()];
}
