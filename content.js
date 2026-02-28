// checkpoint: content.js@v0.5.6_add_ui_profile_detection
(async () => {

  // ------------------------------
  // Utilities
  // ------------------------------

  function pad2(n) { return String(n).padStart(2, "0"); }

  function nowStamp() {
    const d = new Date();
    return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  }

  function safeForFilename(s) {
    const raw = (s ?? "").toString().trim();
    if (!raw) return "untitled";
    let out = raw.replace(/\s+/g, "_");
    out = out.replace(/[\\\/:\*\?"<>\|\(\)\[\]\{\},;`'~!#$%^&+=]+/g, "_");
    out = out.replace(/[^0-9A-Za-z가-힣._@-]+/g, "_");
    out = out.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    return out || "untitled";
  }

  function basenameLike(token) {
    let t = (token ?? "").trim();
    t = t.replace(/^["'`<\(\[\{]+/, "").replace(/["'`>\)\]\}]+$/, "");
    const parts = t.split(/[\/\\]+/);
    return (parts[parts.length-1] || "").trim();
  }

  function extractExtFromToken(token) {
    const t = (token ?? "").trim();
    const lastDot = t.lastIndexOf(".");
    if (lastDot < 0) return "";
    const after = t.slice(lastDot + 1);
    const m = after.match(/^([A-Za-z0-9_]+)(?:$|[^A-Za-z0-9_])/);
    return m?.[1] ?? "";
  }

  function splitTitleProjectAndKey(title) {
    const t = (title ?? "").toString();
    const parts = t.split(" - ");
    if (parts.length >= 2) {
      return { project: parts[0].trim(), key: parts.slice(1).join(" - ").trim() };
    }
    return { project: "project", key: t.trim() || "conversation" };
  }

  const EXT_WHITELIST = new Set([
    "py","js","ts","sh","rb","html","css","json","yaml","yml",
    "txt","md","cpp","c","h","go","rs","java"
  ]);

  // ------------------------------
  // ZIP (UTF-8 filename flag)
  // ------------------------------

  function crc32(buf) {
    let crc = ~0;
    for (let i=0;i<buf.length;i++){
      crc ^= buf[i];
      for (let k=0;k<8;k++){
        crc = (crc>>>1) ^ (0xEDB88320 & -(crc & 1));
      }
    }
    return ~crc>>>0;
  }

  function u16(n){ return new Uint8Array([n&0xff,(n>>>8)&0xff]); }
  function u32(n){ return new Uint8Array([n&0xff,(n>>>8)&0xff,(n>>>16)&0xff,(n>>>24)&0xff]); }

  function concatBytes(parts){
    const len = parts.reduce((s,p)=>s+p.length,0);
    const out = new Uint8Array(len);
    let off=0;
    for(const p of parts){ out.set(p,off); off+=p.length; }
    return out;
  }

  function strBytes(s){ return new TextEncoder().encode(s); }

  function makeZip(files){
    const UTF8_FLAG = 0x0800;
    const localParts=[];
    const centralParts=[];
    let offset=0;

    for(const f of files){
      const nameBytes=strBytes(f.name);
      const dataBytes=f.data;
      const crc=crc32(dataBytes);

      const localHeader=concatBytes([
        u32(0x04034b50),
        u16(20),
        u16(UTF8_FLAG),
        u16(0),
        u16(0),u16(0),
        u32(crc),
        u32(dataBytes.length),
        u32(dataBytes.length),
        u16(nameBytes.length),
        u16(0)
      ]);

      localParts.push(localHeader,nameBytes,dataBytes);

      const centralHeader=concatBytes([
        u32(0x02014b50),
        u16(20),u16(20),
        u16(UTF8_FLAG),
        u16(0),
        u16(0),u16(0),
        u32(crc),
        u32(dataBytes.length),
        u32(dataBytes.length),
        u16(nameBytes.length),
        u16(0),u16(0),u16(0),u16(0),
        u32(0),
        u32(offset)
      ]);

      centralParts.push(centralHeader,nameBytes);
      offset += localHeader.length + nameBytes.length + dataBytes.length;
    }

    const centralDir=concatBytes(centralParts);
    const localData=concatBytes(localParts);

    const end=concatBytes([
      u32(0x06054b50),
      u16(0),u16(0),
      u16(files.length),u16(files.length),
      u32(centralDir.length),
      u32(localData.length),
      u16(0)
    ]);

    return concatBytes([localData,centralDir,end]);
  }

  async function downloadBlob(blob,filename){
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }

  async function downloadZip(zipBytes,filename){
    const blob=new Blob([zipBytes],{type:"application/zip"});
    return downloadBlob(blob,filename);
  }

  async function downloadHtml(html,filename){
    const blob=new Blob([html],{type:"text/html;charset=utf-8"});
    return downloadBlob(blob,filename);
  }

  // ------------------------------
  // Conversation key
  // ------------------------------

  const {project:projectRaw,key:convKeyRaw}=splitTitleProjectAndKey(document.title);
  const project=safeForFilename(projectRaw)||"project";
  const conversation_key=safeForFilename(convKeyRaw)||"conversation";
  const stamp=nowStamp();

  const zipNameCode=`chatgpt__${project}__${conversation_key}_${stamp}_code.zip`;
  const zipNameText=`chatgpt__${project}__${conversation_key}_${stamp}_text.zip`;
  const fullHtmlName=`chatgpt__${project}__${conversation_key}_${stamp}_full.html`;

  // ------------------------------
  // Filename detection
  // ------------------------------

  function scanLinesForId(lines){
    for(const line of lines){
      const m=line.match(/checkpoint\s*:\s*(.+)$/i);
      if(m?.[1]) return {type:"checkpoint",value:basenameLike(m[1])};
    }

    for(const line of lines){
      const m=line.match(/^\s*(?:#|\/\/|;|--)\s*([^\s]+)\s*$/);
      if(m?.[1]){
        const token=basenameLike(m[1]);
        if(extractExtFromToken(token))
          return {type:"comment",value:token};
      }
    }

    return null;
  }

  function getContextLines(codeEl){
    const codeText=(codeEl.innerText||codeEl.textContent||"").replace(/\r\n/g,"\n");
    const codeHeadLines=codeText.split("\n").slice(0,30).map(s=>s.trim());

    const messageRoot=
      codeEl.closest('[data-message-author-role]')||
      codeEl.closest("article")||
      codeEl.parentElement;

    let aboveLines=[];

    if(messageRoot){
      const clone=messageRoot.cloneNode(true);
      clone.querySelectorAll("pre").forEach(p=>p.remove());
      const txt=(clone.innerText||"").trim();
      if(txt){
        const lines=txt.split("\n").map(s=>s.trim()).filter(Boolean);
        aboveLines=lines.slice(-5);
      }
    }

    return {aboveLines,codeHeadLines,codeText};
  }

  // ------------------------------
  // UI detection (code blocks)
  // ------------------------------

  function selectUiProfile(){
    function count(sel){ return document.querySelectorAll(sel).length; }

    const profiles=[
      {
        id:"ui_pre_code",
        detail:"pre code",
        detect:()=>count("pre code"),
        get:()=>Array.from(document.querySelectorAll("pre code"))
      },
      {
        id:"ui_pre_only",
        detail:"pre (no code tag)",
        detect:()=>{
          const pre=count("pre");
          const code=count("pre code");
          return pre>0 && code==0 ? pre : 0;
        },
        get:()=>Array.from(document.querySelectorAll("pre"))
      },
      {
        id:"ui_testid_code",
        detail:"data-testid*='code'",
        detect:()=>count("[data-testid*='code'], [data-testid*='Code']"),
        get:()=>Array.from(document.querySelectorAll("[data-testid*='code'], [data-testid*='Code']"))
      }
    ];

    let best=null;
    for(const p of profiles){
      const score=Number(p.detect()||0);
      if(!best || score>best.score){
        best={profile:p,score};
      }
    }

    if(!best || best.score<=0){
      const fallbackEls=Array.from(document.querySelectorAll("pre"));
      return {id:"fallback_pre",detail:"pre",score:0,elements:fallbackEls};
    }

    return {
      id:best.profile.id,
      detail:best.profile.detail,
      score:best.score,
      elements:best.profile.get()
    };
  }

  const uiSelection=selectUiProfile();

  // ------------------------------
  // Collect code blocks
  // ------------------------------

  const codeEls=uiSelection.elements;
  const encoder=new TextEncoder();
  const usedNames=new Set();
  const codeFiles=[];

  for(let i=0;i<codeEls.length;i++){

    const codeblockId=String(i+1).padStart(3,"0");
    const {aboveLines,codeHeadLines,codeText}=getContextLines(codeEls[i]);

    const found=scanLinesForId([...aboveLines,...codeHeadLines]);
    let filename="";

    if(found){
      filename=safeForFilename(found.value);

      // checkpoint는 "." 유지, 중복 시 _NNN
      if(usedNames.has(filename)){
        filename=`${filename}_${codeblockId}`;
      }
    }

    if(!filename){
      let ext="";
      const candidateLines=[...aboveLines,...codeHeadLines];

      for(const line of candidateLines){
        const tokens=line.split(/\s+/).map(basenameLike).filter(Boolean);
        for(const t of tokens){
          const e=extractExtFromToken(t);
          if(e){ ext=e; break; }
        }
        if(ext) break;
      }

      let suffix="";
      if(ext){
        if(EXT_WHITELIST.has(ext)){
          suffix="."+ext;
        }else{
          suffix="_"+ext; // auto에서만 "_" 처리
        }
      }

      filename=`@auto__${conversation_key}__block_generic_${codeblockId}${suffix}`;
    }

    usedNames.add(filename);

    codeFiles.push({
      name:filename.slice(0,180),
      data:encoder.encode(codeText)
    });
  }

  // ------------------------------
  // Conversation Markdown
  // ------------------------------

  function roleTitle(role){
    const map={user:"User",assistant:"Assistant",system:"System",tool:"Tool"};
    return map[role] || role || "Message";
  }

  function extractCodeBlock(preEl){
    const codeEl=preEl.querySelector("code");
    let codeText=(codeEl?.innerText || preEl.innerText || "").replace(/\r\n/g,"\n");
    codeText=codeText.replace(/\n+$/g,"");
    let lang="";
    if(codeEl){
      const m=codeEl.className.match(/language-([a-z0-9_+-]+)/i);
      if(m?.[1]) lang=m[1];
    }
    return {codeText,lang};
  }

  function renderMessageMarkdown(msgEl){
    const role=msgEl.getAttribute("data-message-author-role") || "message";
    const roleLabel=roleTitle(role);
    const clone=msgEl.cloneNode(true);

    const preEls=Array.from(clone.querySelectorAll("pre"));
    preEls.forEach((pre,idx)=>{
      pre.replaceWith(document.createTextNode(`\n[[CODEBLOCK_${idx}]]\n`));
    });

    let text=(clone.innerText || "").replace(/\r\n/g,"\n").trim();
    let md=`## ${roleLabel}\n`;
    if(text) md+=`${text}\n`;

    const originalPres=Array.from(msgEl.querySelectorAll("pre"));
    originalPres.forEach((pre,idx)=>{
      const {codeText,lang}=extractCodeBlock(pre);
      if(!codeText) return;
      const fence="```" + (lang || "");
      const block=fence + "\n" + codeText + "\n```";
      const marker=`[[CODEBLOCK_${idx}]]`;
      if(md.includes(marker)){
        while(md.includes(marker)) md=md.replace(marker,block);
      }else{
        md+="\n" + block + "\n";
      }
    });

    return md.trim();
  }

  function buildConversationMarkdown(){
    const messages=Array.from(document.querySelectorAll("[data-message-author-role]"));
    if(!messages.length){
      const body=(document.body.innerText || "").replace(/\r\n/g,"\n").trim();
      return `# Conversation\n\n${body}\n`;
    }
    const parts=["# Conversation"];
    for(const msg of messages){
      parts.push(renderMessageMarkdown(msg));
    }
    return parts.join("\n\n").trim() + "\n";
  }

  // ------------------------------
  // Text export
  // ------------------------------

  const plainText=document.body.innerText || "";
  const markdownText=buildConversationMarkdown();

  const textFiles=[{
    name:`chatgpt__${project}__${conversation_key}_${stamp}.txt`,
    data:encoder.encode(plainText)
  },{
    name:`chatgpt__${project}__${conversation_key}_${stamp}.md`,
    data:encoder.encode(markdownText)
  }];

  await downloadZip(makeZip(textFiles),zipNameText);

  if(codeFiles.length){
    await downloadZip(makeZip(codeFiles),zipNameCode);
  }

  await downloadHtml(document.documentElement.outerHTML,fullHtmlName);

  const uiInfo=`${uiSelection.id} (${uiSelection.detail}), blocks=${codeEls.length}`;

  alert(`Export done.\n- ${zipNameText}\n- ${codeFiles.length?zipNameCode:"(no code zip)"}\n- ${fullHtmlName}\n- ui: ${uiInfo}`);

})();
