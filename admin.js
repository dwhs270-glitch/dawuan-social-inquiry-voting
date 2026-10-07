const API = window.APP_CONFIG.API_URL;
let token = sessionStorage.getItem("dwhs_vote_admin_token") || "";
let snapshot = null;
const $ = id => document.getElementById(id);

async function callApi(action,payload={}){
  if (!API || API.includes("PASTE_YOUR")) throw new Error("尚未設定後端 API 網址。");
  const res=await fetch(API,{signal:AbortSignal.timeout(30000),method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action,token,...payload})});
  const data=await res.json();
  if(!data.ok) throw new Error(data.error||"操作失敗");
  return data;
}
function msg(id,text,type=""){ const e=$(id);e.hidden=false;e.className="message "+type;e.textContent=text; }
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

async function login(){
  try{
    const d=await callApi("adminLogin",{username:$("adminUser").value.trim(),password:$("adminPass").value});
    token=d.token; sessionStorage.setItem("dwhs_vote_admin_token",token);
    $("loginCard").hidden=true;$("adminPanel").hidden=false;await loadAdmin();
  }catch(e){msg("loginMessage",e.message,"error")}
}
$("loginBtn").addEventListener("click",login);
$("adminPass").addEventListener("keydown",e=>{if(e.key==="Enter")login()});
$("logoutBtn").addEventListener("click",async()=>{try{await callApi("adminLogout")}catch(e){}sessionStorage.removeItem("dwhs_vote_admin_token");token="";location.reload()});

async function loadAdmin(){
  try{
    const d=await callApi("getAdminData"); snapshot=d;
    $("settingTitle").value=d.poll.title||"";
    $("settingDescription").value=d.poll.description||"";
    $("settingMaxVotes").value=d.poll.maxVotes||1;
    $("settingOpen").value=String(!!d.poll.open);
    renderOptions(d.poll.options||[]);
    renderResults(d.results||[]);
    renderVotes(d.votes||[]);
  }catch(e){
    if(/登入|權限|token/i.test(e.message)){sessionStorage.removeItem("dwhs_vote_admin_token");location.reload();}
    else alert(e.message);
  }
}
function renderOptions(options){
  const box=$("adminOptions");box.innerHTML="";
  options.forEach(o=>{
    const el=document.createElement("div");el.className="admin-option";
    el.innerHTML=`<div class="meta"><strong>${esc(o.name)}</strong><span>${esc(o.description||"")}</span></div>
      <button class="danger" data-id="${esc(o.id)}">停用</button>`;
    el.querySelector("button").onclick=async()=>{if(confirm(`確定停用「${o.name}」？歷史投票仍保留。`)){await callApi("deleteOption",{id:o.id});await loadAdmin();}};
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
$("saveSettings").onclick=async()=>{
  try{
    await callApi("saveSettings",{title:$("settingTitle").value.trim(),description:$("settingDescription").value.trim(),maxVotes:Number($("settingMaxVotes").value),open:$("settingOpen").value==="true"});
    alert("設定已儲存");await loadAdmin();
  }catch(e){alert(e.message)}
};
$("addOption").onclick=async()=>{
  const name=$("newOptionName").value.trim(),description=$("newOptionDesc").value.trim();
  if(!name)return alert("請輸入候選名稱");
  try{await callApi("addOption",{name,description});$("newOptionName").value="";$("newOptionDesc").value="";await loadAdmin();}
  catch(e){alert(e.message)}
};
$("refreshAdmin").onclick=loadAdmin;
$("exportCsv").onclick=()=>{
  const rows=[["時間","班級","座號","姓名","投票內容"],...(snapshot?.votes||[]).map(v=>[v.timestamp,v.studentClass,v.studentNo,v.studentName,v.choiceNames.join("、")])];
  const csv="\uFEFF"+rows.map(r=>r.map(x=>`"${String(/^[=+@\-\t\r]/.test(String(x??"")) ? "\'"+x : x??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="大灣高中票選紀錄.csv";a.click();URL.revokeObjectURL(a.href);
};
if(token){$("loginCard").hidden=true;$("adminPanel").hidden=false;loadAdmin();}
