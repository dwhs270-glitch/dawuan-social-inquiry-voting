const API = window.APP_CONFIG.API_URL;
let token = sessionStorage.getItem("dwhs_vote_admin_token") || "";
let snapshot = null;
let ready = false, busy = false, settingsDirty = false;
let adminRead = null;
const $ = id => document.getElementById(id);

async function callApi(action,payload={}){
  if (!API || API.includes("PASTE_YOUR")) throw new Error("尚未設定後端 API 網址。");
  let res;
  try { res=await fetch(API,{signal:AbortSignal.timeout(60000),method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action,token,...payload})}); }
  catch(e){ throw new Error(action === "getAdminData" ? "讀取逾時或連線中斷，請重新整理。" : "連線中斷，尚未確認操作結果。請重新讀取確認後再操作，避免重複提交。"); }
  const data=await res.json();
  if(!data.ok) throw new Error(data.error||"操作失敗");
  return data;
}
function msg(id,text,type=""){ const e=$(id);e.hidden=false;e.className="message "+type;e.textContent=text; }
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

function controls(){
  ["settingTitle","settingDescription","settingMaxVotes","settingOpen","saveSettings","newOptionName","newOptionDesc","addOption","refreshAdmin","exportCsv"].forEach(id=>$(id).disabled=!ready||busy||!!adminRead);
  document.querySelectorAll("#adminOptions button").forEach(b=>b.disabled=!ready||busy||!!adminRead);
}
function updateStatus(){
  const status=snapshot?.poll?.open ? "開放投票" : "關閉投票";
  $("savedStatus").textContent="目前已儲存狀態："+status+(settingsDirty ? "（有尚未儲存的修改）" : "");
}
async function login(){
  if(busy)return;
  busy=true;$("loginBtn").disabled=true;$("loginBtn").textContent="登入中…";
  try{
    const d=await callApi("adminLogin",{username:$("adminUser").value.trim(),password:$("adminPass").value});
    token=d.token; sessionStorage.setItem("dwhs_vote_admin_token",token);
    $("adminPass").value="";$("loginCard").hidden=true;$("adminPanel").hidden=false;
    busy=false;await loadAdmin();
  }catch(e){msg("loginMessage",e.message,"error")}
  finally{busy=false;$("loginBtn").disabled=false;$("loginBtn").textContent="登入後台";controls();}
}
$("loginBtn").addEventListener("click",login);
$("adminPass").addEventListener("keydown",e=>{if(e.key==="Enter")login()});
$("logoutBtn").addEventListener("click",()=>{const old=token;sessionStorage.removeItem("dwhs_vote_admin_token");token="";callApi("adminLogout",{token:old}).catch(()=>{});$("adminPanel").hidden=true;$("loginCard").hidden=false;ready=false;snapshot=null;controls();});

function applyAdmin(d){
  snapshot=d;
  if(!settingsDirty){
    $("settingTitle").value=d.poll.title||"";
    $("settingDescription").value=d.poll.description||"";
    $("settingMaxVotes").value=d.poll.maxVotes||1;
    $("settingOpen").value=String(!!d.poll.open);
  }
  renderOptions(d.poll.options||[]);renderResults(d.results||[]);renderVotes(d.votes||[]);
  ready=true;updateStatus();
}
async function loadAdmin(){
  if(adminRead)return adminRead;
  controls();msg("adminMessage","正在讀取資料，首次連線可能需要數秒…");
  adminRead=(async()=>{
    try{applyAdmin(await callApi("getAdminData"));msg("adminMessage","資料已更新。","success");return true;}
    catch(e){
      if(/登入|權限|token/i.test(e.message)){
        sessionStorage.removeItem("dwhs_vote_admin_token");token="";ready=false;
        $("adminPanel").hidden=true;$("loginCard").hidden=false;msg("loginMessage",e.message,"error");
      }else msg("adminMessage",e.message,"error");
      return false;
    }finally{adminRead=null;controls();}
  })();controls();return adminRead;
}
["settingTitle","settingDescription","settingMaxVotes","settingOpen"].forEach(id=>{
  $(id).addEventListener("input",()=>{settingsDirty=true;updateStatus();});
  $(id).addEventListener("change",()=>{settingsDirty=true;updateStatus();});
});
async function mutate(button,action,payload,onSuccess){
  if(!ready||busy||adminRead)return;
  busy=true;controls();const label=button.textContent;button.textContent="處理中…";
  msg("adminMessage","正在儲存，請稍候…");
  try{const d=await callApi(action,payload);await onSuccess(d);msg("adminMessage","已儲存成功。","success");}
  catch(e){msg("adminMessage",e.message,"error");}
  finally{busy=false;button.textContent=label;controls();}
}
function renderOptions(options){
  const box=$("adminOptions");box.innerHTML="";
  options.forEach(o=>{
    const el=document.createElement("div");el.className="admin-option";
    el.innerHTML=`<div class="meta"><strong>${esc(o.name)}</strong><span>${esc(o.description||"")}</span></div>
      <button class="danger" data-id="${esc(o.id)}">停用</button>`;
    el.querySelector("button").onclick=async()=>{if(confirm(`確定停用「${o.name}」？歷史投票仍保留。`)){await mutate(el.querySelector("button"),"deleteOption",{id:o.id},async()=>{if(!await loadAdmin())throw new Error("已停用，但資料更新失敗，請重新整理確認。");});}};
    box.appendChild(el);
  });
}
function renderResults(results){
  const box=$("adminResults");box.innerHTML="";
  const max=Math.max(1,...results.map(x=>x.count));
  results.forEach(r=>{
    const el=document.createElement("div");el.className="result-row";
    el.innerHTML=`<div class="result-name">${esc(r.name)}</div><div class="bar"><span style="width:${Math.round(r.count/max*100)}%"></span></div><div class="count">${r.count} 票</div>`;
    box.appendChild(el);
  });
}
function renderVotes(votes){
  $("votesTable").innerHTML=votes.map(v=>`<tr>
    <td>${esc(v.timestamp)}</td><td>${esc(v.studentClass)}</td><td>${esc(v.studentNo)}</td>
    <td>${esc(v.studentName)}</td><td>${esc(v.choiceNames.join("、"))}</td></tr>`).join("");
}
$("saveSettings").onclick=()=>{
  const payload={title:$("settingTitle").value.trim(),description:$("settingDescription").value.trim(),maxVotes:Number($("settingMaxVotes").value),open:$("settingOpen").value==="true"};
  if(!Number.isInteger(payload.maxVotes)||payload.maxVotes<1||payload.maxVotes>99)return msg("adminMessage","每人票數請填 1～99 的整數。","error");
  mutate($("saveSettings"),"saveSettings",payload,()=>{
    settingsDirty=false;snapshot.poll={...snapshot.poll,...payload};updateStatus();
  });
};
$("addOption").onclick=()=>{
  const name=$("newOptionName").value.trim(),description=$("newOptionDesc").value.trim();
  if(!name)return msg("adminMessage","請輸入候選名稱。","error");
  mutate($("addOption"),"addOption",{name,description},async()=>{
    $("newOptionName").value="";$("newOptionDesc").value="";if(!await loadAdmin())throw new Error("已新增，但資料更新失敗，請重新整理確認。");
  });
};
$("refreshAdmin").onclick=loadAdmin;
$("exportCsv").onclick=()=>{
  const rows=[["時間","班級","座號","姓名","投票內容"],...(snapshot?.votes||[]).map(v=>[v.timestamp,v.studentClass,v.studentNo,v.studentName,v.choiceNames.join("、")])];
  const csv="\uFEFF"+rows.map(r=>r.map(x=>`"${String(/^[=+@\-\t\r]/.test(String(x??"")) ? "\'"+x : x??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="大灣高中票選紀錄.csv";a.click();URL.revokeObjectURL(a.href);
};
controls();
if(token){$("loginCard").hidden=true;$("adminPanel").hidden=false;loadAdmin();}
