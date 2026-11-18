const $=id=>document.getElementById(id);
const MODES={chat:["Just chat","Answer clearly and helpfully."],explain:["Explain simply","Explain like a patient tutor: start with the core idea in plain words, then an everyday example, then a short recap. Avoid jargon or define it."],quiz:["Quiz me","Act as a quiz coach: ask ONE question at a time, wait for the answer, then give feedback and the next question. Adjust difficulty to how I do."],summary:["Summarize","Give concise study notes: key points as short bullets, important terms in bold, and a one-line takeaway."]};
const S={mem:[],docs:[],msgs:[],mode:"explain",conversationId:null,conversations:[],controller:null,provider:"",model:"",subject:"",subjects:[]};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
// Math must be protected from the markdown parser (it would eat _ and * inside formulas).
const MATH=/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(?<![\\$\w])\$(?=\S)[^$\n]*?\S\$(?![\w$])/g;
const md=t=>{
  if(window.marked&&window.DOMPurify){
    const math=[];
    const guarded=t.replace(MATH,m=>{
      // single-$ math becomes \(...\) so a stray "$5 and $10" is never typeset by mistake
      if(m[0]==="$"&&m[1]!=="$")m="\\("+m.slice(1,-1)+"\\)";
      return "@@M"+(math.push(m)-1)+"@@";
    });
    const html=window.DOMPurify.sanitize(window.marked.parse(guarded,{gfm:true,breaks:true}));
    return html.replace(/@@M(\d+)@@/g,(_,i)=>esc(math[+i]));
  }
  return esc(t).replace(/\n/g,"<br>");
};
const MATH_DELIMS=[{left:"$$",right:"$$",display:true},{left:"\\[",right:"\\]",display:true},{left:"\\(",right:"\\)",display:false}];
function typeset(el){if(window.renderMathInElement)window.renderMathInElement(el,{delimiters:MATH_DELIMS,throwOnError:false})}
async function api(url,options={}){
  const response=await fetch(url,options);
  if(!response.ok){
    let message="Something went wrong. Please try again.";
    try{message=(await response.json()).error||message}catch{}
    throw new Error(message);
  }
  return response.status===204?null:response.json();
}
function setMessage(el,text,error=false){
  el.textContent=text;
  el.className=error?"sub err":"sub";
}
function saveMemory(text){
  return api("/api/memory",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text})});
}

/* sidebar */
function renderSide(){
  $("modes").innerHTML="";
  for(const key in MODES){
    const button=document.createElement("button");
    button.type="button";button.textContent=MODES[key][0];
    button.setAttribute("aria-pressed",S.mode===key);
    button.onclick=()=>{S.mode=key;renderSide()};
    $("modes").append(button);
  }
  $("mem").innerHTML=S.mem.length?"":'<p class="sub">Nothing yet. Add facts about you and your courses.</p>';
  S.mem.forEach(memory=>{
    const item=document.createElement("div");item.className="note";
    item.innerHTML="<span></span><button type='button' class='memory-edit' aria-label='Edit this memory'>Edit</button><button type='button' class='memory-pin' aria-label='Pin this memory'>Pin</button><button type='button' aria-label='Forget this memory'>✕</button>";
    item.firstChild.textContent=memory.text;
    item.querySelector(".memory-edit").onclick=async()=>{
      const text=prompt("Edit memory:",memory.text);
      if(text===null||!text.trim())return;
      try{
        const updated=await api("/api/memory/"+memory.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:text.trim()})});
        memory.text=updated.text;memory.pinned=updated.pinned;renderSide();
      }catch(error){setMessage($("fileMsg"),error.message,true)}
    };
    const pin=item.querySelector(".memory-pin");
    pin.textContent=memory.pinned?"Unpin":"Pin";
    pin.onclick=async()=>{
      try{
        const updated=await api("/api/memory/"+memory.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({pinned:!memory.pinned})});
        memory.pinned=updated.pinned;renderSide();
      }catch(error){setMessage($("fileMsg"),error.message,true)}
    };
    item.lastChild.onclick=async()=>{
      try{await api("/api/memory/"+memory.id,{method:"DELETE"});S.mem=S.mem.filter(entry=>entry.id!==memory.id);renderSide()}
      catch(error){setMessage($("fileMsg"),error.message,true)}
    };
    $("mem").append(item);
  });
  $("docs").innerHTML=S.docs.length?"":'<p class="sub">No documents yet.</p>';
  S.docs.forEach(documentInfo=>{
    const item=document.createElement("div");item.className="doc";
    item.innerHTML="<span></span><button type='button' class='flashcards'>Flashcards</button><button type='button' class='summarize'>Summarize</button><button type='button' aria-label='Remove document'>Remove</button>";
    item.firstChild.textContent=documentInfo.name+(documentInfo.subject? " · "+documentInfo.subject:"")+" ("+documentInfo.chunks+" parts)";
    item.querySelector(".flashcards").onclick=async()=>{
      setMessage($("fileMsg"),"Making flashcards from "+documentInfo.name+"…");
      try{
        const cards=await api("/api/documents/"+documentInfo.id+"/flashcards",{method:"POST"});
        S.conversationId=cards.conversationId;S.mode="quiz";
        S.msgs=[
          {role:"user",text:"Make flashcards from "+documentInfo.name},
          {role:"bot",text:cards.reply,src:cards.sources}
        ];
        S.conversations=await api("/api/conversations");renderSide();renderLog();
        $("side").classList.remove("open");
        setMessage($("fileMsg"),"Flashcards are ready.");
      }catch(error){setMessage($("fileMsg"),error.message,true)}
    };
    item.querySelector(".summarize").onclick=async()=>{
      setMessage($("fileMsg"),"Summarizing "+documentInfo.name+"…");
      try{
        const summary=await api("/api/documents/"+documentInfo.id+"/summarize",{method:"POST"});
        S.conversationId=summary.conversationId;S.mode="summary";
        S.msgs=[
          {role:"user",text:"Summarize "+documentInfo.name},
          {role:"bot",text:summary.reply,src:summary.sources}
        ];
        S.conversations=await api("/api/conversations");renderSide();renderLog();
        $("side").classList.remove("open");
        setMessage($("fileMsg"),"Summary is ready.");
      }catch(error){setMessage($("fileMsg"),error.message,true)}
    };
    item.lastChild.onclick=async()=>{
      try{await api("/api/documents/"+documentInfo.id,{method:"DELETE"});S.docs=S.docs.filter(doc=>doc.id!==documentInfo.id);renderSide()}
      catch(error){setMessage($("fileMsg"),error.message,true)}
    };
    $("docs").append(item);
  });
  renderChats();
}
function renderChats(){
  $("chats").innerHTML=S.conversations.length?"":'<p class="sub">No chats yet.</p>';
  S.conversations.forEach(conversation=>{
    const row=document.createElement("div");row.className="chat-item";
    const open=document.createElement("button");open.type="button";open.className="chat-open";
    open.textContent=conversation.title;open.setAttribute("aria-current",String(S.conversationId===conversation.id));
    open.onclick=()=>openConversation(conversation.id);
    const rename=document.createElement("button");rename.type="button";rename.className="chat-del";
    rename.textContent="Rename";rename.setAttribute("aria-label","Rename chat: "+conversation.title);
    rename.onclick=async()=>{
      const title=prompt("Rename chat:",conversation.title);
      if(title===null||!title.trim())return;
      try{
        const updated=await api("/api/conversations/"+conversation.id,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:title.trim()})});
        conversation.title=updated.title;renderSide();
      }catch(error){setMessage($("fileMsg"),error.message,true)}
    };
    const del=document.createElement("button");del.type="button";del.className="chat-del";
    del.textContent="✕";del.setAttribute("aria-label","Delete chat: "+conversation.title);
    del.onclick=async()=>{
      if(!confirm("Delete this chat?"))return;
      try{
        await api("/api/conversations/"+conversation.id,{method:"DELETE"});
        S.conversations=S.conversations.filter(c=>c.id!==conversation.id);
        if(S.conversationId===conversation.id){S.conversationId=null;S.msgs=[];renderLog()}
        renderSide();
      }catch(error){setMessage($("fileMsg"),error.message,true)}
    };
    row.append(open,rename,del);$("chats").append(row);
  });
}
async function refreshLists(){
  [S.mem,S.docs,S.conversations,S.providerData]=await Promise.all([
    api("/api/memory"),api("/api/documents"),api("/api/conversations"),api("/api/providers")
  ]);
  renderProviderControls();
  renderSubjectControls();
  renderSide();
}
function renderProviderControls(){
  const provider=$("provider"),model=$("model");
  provider.innerHTML='<option value="">Default</option>';
  (S.providerData?.providers||[]).forEach(item=>{
    if(!item.configured)return;
    const option=document.createElement("option");option.value=item.id;option.textContent=item.label;provider.append(option);
  });
  provider.value=S.provider||"";
  renderModelOptions();
}
function renderModelOptions(){
  const providerInfo=(S.providerData?.providers||[]).find(item=>item.id===($("provider").value||S.providerData.defaultProvider));
  const model=$("model");model.innerHTML='<option value="">Default</option>';
  (providerInfo?.models||[]).forEach(value=>{
    const option=document.createElement("option");option.value=value;option.textContent=value;model.append(option);
  });
  if(S.model&&providerInfo?.models?.includes(S.model))model.value=S.model;
}
function renderSubjectControls(){
  const subjects=[...new Set(S.docs.map(doc=>doc.subject).filter(Boolean))].sort();
  const select=$("subject");select.innerHTML='<option value="">All subjects</option>';
  subjects.forEach(subject=>{
    const option=document.createElement("option");option.value=subject;option.textContent=subject;select.append(option);
  });
  if(subjects.includes(S.subject))select.value=S.subject;
}
$("provider").onchange=()=>{
  S.provider=$("provider").value;S.model="";renderModelOptions();
};
$("model").onchange=()=>{S.model=$("model").value};
$("subject").onchange=()=>{S.subject=$("subject").value};
async function openConversation(id){
  try{
    const chat=await api("/api/conversations/"+id);
    S.conversationId=chat.id;S.mode=chat.mode;S.msgs=chat.messages.map(message=>({
      role:message.role,text:message.text,src:message.sources||[]
    }));
    renderSide();renderLog();
    $("side").classList.remove("open");
    $("q").focus();
  }catch(error){setMessage($("fileMsg"),error.message,true)}
}
async function newConversation(){
  S.conversationId=null;S.msgs=[];S.mode="explain";
  renderSide();renderLog();$("side").classList.remove("open");$("q").focus();
}
$("memAdd").onclick=async()=>{
  const value=$("memIn").value.trim();if(!value)return;
  try{const item=await saveMemory(value);S.mem.push(item);$("memIn").value="";renderSide()}
  catch(error){setMessage($("fileMsg"),error.message,true)}
};
$("memIn").onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();$("memAdd").click()}};
$("clear").onclick=newConversation;
$("open").onclick=()=>$("side").classList.add("open");
$("close").onclick=()=>$("side").classList.remove("open");

/* documents */
$("file").onchange=async event=>{
  const message=$("fileMsg");message.className="sub";
  for(const file of event.target.files){
    setMessage(message,"Uploading "+file.name+"…");
    try{
      const body=new FormData();body.append("file",file);
      if($("docSubject").value.trim())body.append("subject",$("docSubject").value.trim());
      const documentInfo=await api("/api/documents",{method:"POST",body});
      S.docs.push(documentInfo);renderSide();
      setMessage(message,"Added "+file.name+".");
    }catch(error){setMessage(message,error.message,true)}
  }
  event.target.value="";
};

/* chat */
function renderLog(){
  const log=$("log");log.innerHTML="";
  if(!S.msgs.length){
    log.innerHTML='<div class="empty"><b>What are we studying today?</b><p>Ask anything, add your notes or textbook PDFs on the left, and tell me things to remember about you.</p></div>';
    return;
  }
  S.msgs.forEach(message=>{
    const item=document.createElement("div");item.className="msg "+(message.role==="user"?"user":"bot");
    if(message.role==="user")item.textContent=message.text;
    else{item.innerHTML=md(message.text);typeset(item)}
    if(message.role!=="user"&&!message.err){
      const meta=document.createElement("div");meta.className="meta";
      if(message.src&&message.src.length)meta.append("From: "+message.src.join(", "));
      const save=document.createElement("button");save.type="button";save.textContent="Save to memory";
      save.onclick=async()=>{
        const value=prompt("Save this to memory:",message.text.slice(0,200));
        if(!value||!value.trim())return;
        try{S.mem.push(await saveMemory(value.trim()));renderSide()}
        catch(error){setMessage($("fileMsg"),error.message,true)}
      };
      meta.append(save);item.append(meta);
    }
    if(message.err)item.classList.add("err");
    log.append(item);
  });
  log.scrollTop=log.scrollHeight;
}
function showSkeleton(){
  const item=document.createElement("div");item.className="msg bot skeleton";item.id="pending";
  item.setAttribute("role","status");item.setAttribute("aria-label","Study Buddy is thinking");
  item.innerHTML="<span></span><span></span><span></span>";$("log").append(item);
}
const parseSseData=line=>{
  try{return JSON.parse(line.slice(6))}
  catch(error){console.error("Ignored malformed SSE data",error);return null}
};
function appendStreamText(text){
  let pending=$("pending");
  if(!pending){
    pending=document.createElement("div");pending.className="msg bot";pending.id="pending";
    $("log").append(pending);
  }
  pending.removeAttribute("role");pending.removeAttribute("aria-label");pending.classList.remove("skeleton");
  pending.innerHTML=md(text);
  typeset(pending);
  $("log").scrollTop=$("log").scrollHeight;
}
async function ask(){
  const message=$("q").value.trim();if(!message||S.controller)return;
  $("q").value="";S.msgs.push({role:"user",text:message});renderLog();
  const remembered=message.match(/^remember(?:\s+that)?[\s:,-]+(.{3,})$/is);
  if(remembered)saveMemory(remembered[1].trim().slice(0,2000)).then(item=>{S.mem.push(item);renderSide()}).catch(error=>setMessage($("fileMsg"),error.message,true));
  $("send").disabled=true;$("send").textContent="Thinking…";$("stop").hidden=false;
  showSkeleton();
  const controller=new AbortController();S.controller=controller;
  let partial="";
  try{
    const response=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({messages:S.msgs.filter(item=>!item.err).slice(-20).map(({role,text})=>({role,text})),mode:S.mode,conversationId:S.conversationId,provider:S.provider||undefined,model:S.model||undefined,subject:S.subject||undefined,stream:true}),
      signal:controller.signal});
    if(!response.ok){
      let payload={};try{payload=await response.json()}catch{}
      throw new Error(payload.error||"Couldn’t get a response. Please try again.");
    }
    if(!response.body)throw new Error("Streaming is unavailable in this browser.");
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer="",result={sources:[]};
    while(true){
      const {value,done}=await reader.read();if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      const events=buffer.split("\n\n");buffer=events.pop();
      for(const event of events){
        const line=event.split("\n").find(part=>part.startsWith("data: "));
        if(!line)continue;
        const data=parseSseData(line);
        if(!data)continue;
        if(data.conversationId&&!data.done)S.conversationId=data.conversationId;
        if(data.delta){partial+=data.delta;appendStreamText(partial)}
        if(data.done)result=data;
        if(data.error)throw new Error(data.error);
      }
    }
    if(buffer.trim()){
      const line=buffer.split("\n").find(part=>part.startsWith("data: "));
      if(line){const data=parseSseData(line);if(data){if(data.delta)partial+=data.delta;if(data.done)result=data;if(data.error)throw new Error(data.error)}}
    }
    S.conversationId=result.conversationId||S.conversationId;
    if(result.warnings?.length)setMessage($("fileMsg"),result.warnings.join(" "),true);
    S.msgs.push({role:"bot",text:partial,src:result.sources||[]});
    S.conversations=await api("/api/conversations");renderSide();renderLog();
  }catch(error){
    $("pending")?.remove();
    if(error.name==="AbortError"){
      if(partial)S.msgs.push({role:"bot",text:partial,src:[]});
      else S.msgs.pop();
      api("/api/conversations").then(list=>{S.conversations=list;renderChats()}).catch(()=>{});
    }else S.msgs.push({role:"bot",text:"Sorry, I couldn’t answer that. "+error.message,err:true});
    renderLog();
  }finally{
    S.controller=null;$("send").disabled=false;$("send").textContent="Send";$("stop").hidden=true;
    $("q").focus();
  }
}
$("f").onsubmit=event=>{event.preventDefault();ask()};
$("stop").onclick=()=>S.controller?.abort();
$("q").onkeydown=event=>{
  if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();$("f").requestSubmit()}
};

/* chat export */
$("export").onclick=()=>{
  if(!S.msgs.length)return;
  const markdown=S.msgs.map(message=>{
    const role=message.role==="user"?"You":"Study Buddy";
    const citations=message.src?.length?`\n\nSources: ${message.src.map(name=>`[${name}]`).join(", ")}`:"";
    return `## ${role}\n\n${message.text}${citations}`;
  }).join("\n\n---\n\n");
  const blob=new Blob([markdown],{type:"text/markdown;charset=utf-8"});
  const link=document.createElement("a");link.href=URL.createObjectURL(blob);
  link.download="study-buddy-chat.md";link.click();URL.revokeObjectURL(link.href);
};

renderSide();renderLog();
refreshLists().catch(error=>{
  setMessage($("fileMsg"),"Couldn’t connect to Study Buddy. Make sure the server is running.",true);
  console.error(error);
});
