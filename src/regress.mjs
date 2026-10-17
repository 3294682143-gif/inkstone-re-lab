// P6 回归：3 组独立新会话，每组两轮（新建+追问），全部走最小客户端 HTTP 路径。
// 结果写 05-validation/regression.json。不打印凭证。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { SSEFrameParser, ChatStreamMerger } from './stream-parser.mjs';
import { buildChatSendBody, buildChatNewBody, CHAT_SEND_PATH, CHAT_NEW_PATH } from './build-chat-request.mjs';

const _req = createRequire('/home/ma-user/.dsh/profiles/web/package.json');
const { ProxyAgent } = await import(_req.resolve('undici'));
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:9999';
const BASE = 'https://discovery.intern-ai.org.cn';
function arg(n,d=undefined){const i=process.argv.indexOf(`--${n}`);return i>=0?(process.argv[i+1]??true):d;}
const STORAGE = arg('storage-state','01-evidence/private/inkstone-auth.json');
const N = Number(arg('n', 3));
const MARK = arg('mark','INKSTONE-RE-REG');
mkdirSync('05-validation',{recursive:true});
const d=JSON.parse(readFileSync(STORAGE,'utf8'));
const cookie=(d.cookies||[]).filter(c=>'discovery.intern-ai.org.cn'.endsWith(c.domain.replace(/^\./,''))||c.domain.includes('openxlab')).map(c=>`${c.name}=${c.value}`).join('; ');
const token=(d.cookies||[]).find(c=>c.name==='uaa-token')?.value;
const H={ 'content-type':'application/json','accept':'text/event-stream, application/json','origin':BASE,'referer':BASE+'/chat/','cookie':cookie,'authorization':'Bearer '+token,'user-agent':'Mozilla/5.0'};
const dispatcher=new ProxyAgent(PROXY);

async function send(chatId, text){
  const res=await fetch(BASE+CHAT_SEND_PATH,{method:'POST',headers:H,body:JSON.stringify(buildChatSendBody({chatId,query:text,model:'Auto',thinkingMode:true,planningMode:false})),dispatcher});
  if(!res.ok) return {ok:false,status:res.status};
  const p=new SSEFrameParser(), m=new ChatStreamMerger(), r=res.body.getReader();
  for(;;){const {done,value}=await r.read();if(done)break;m.applyAll(p.push(value));if(m.finished)break;}
  m.applyAll(p.flush());
  return {ok:true,status:res.status,finished:m.finished,cid:m.cid,answer:m.answer};
}
const results=[];
for(let i=1;i<=N;i++){
  const mark=`${MARK}-0${i}`;
  const rNew=await fetch(BASE+CHAT_NEW_PATH,{method:'POST',headers:H,body:JSON.stringify(buildChatNewBody({})),dispatcher});
  const jn=await rNew.json();
  const chatId=jn?.data?.id;
  if(jn.code!==0||!chatId){ results.push({session:i,error:'chat/new code='+jn.code}); continue; }
  const t1=await send(chatId, `${mark}：请只回复 OK。`);
  const t2=await send(chatId, '请复述我上一条消息中的测试标记。');
  results.push({session:i, chatId, turn1:t1, turn2:t2,
    turn2_has_marker: !!(t2.answer&&t2.answer.includes(mark)),
    ok: t1.ok&&t1.finished&&t2.ok&&t2.finished});
  await new Promise(r=>setTimeout(r,1500));
}
const summary={ n:N, allOk: results.every(r=>r.ok), sessions: results.map(r=>({session:r.session,chatId:r.chatId,ok:r.ok,
  turn1:{status:r.turn1?.status,finished:r.turn1?.finished,answerLen:r.turn1?.answer?.length},
  turn2:{status:r.turn2?.status,finished:r.turn2?.finished,answerLen:r.turn2?.answer?.length,hasMarker:r.turn2_has_marker}}))};
writeFileSync('05-validation/regression.json', JSON.stringify({summary,results},null,2));
console.log(JSON.stringify(summary,null,2));
