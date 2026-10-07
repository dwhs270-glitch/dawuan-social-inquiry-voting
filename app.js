const API = window.APP_CONFIG.API_URL;
let poll = null;
let selected = new Set();
let loading = null, submitted = false;

const $ = (id) => document.getElementById(id);

function showMessage(text, type="") {
  const el = $("message");
  el.hidden = false;
  el.className = "message " + type;
  el.textContent = text;
}
function hideMessage(){ $("message").hidden = true; }

async function callApi(action, payload={}) {
  if (!API || API.includes("PASTE_YOUR")) throw new Error("尚未設定後端 API 網址。");
  const res = await fetch(API, {
    signal: AbortSignal.timeout(60000),
    method: "POST",
    headers: {"Content-Type":"text/plain;charset=utf-8"},
    body: JSON.stringify({action, ...payload})
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "操作失敗");
  return data;
}

function applyPoll(data){
  const before=JSON.stringify(poll?.options), oldSelection=new Set(selected);
  poll=data.poll;
  $("pollTitle").textContent=poll.title||"課程票選";
  $("pollDescription").textContent=poll.description||"";
  $("maxVotes").textContent=poll.maxVotes;$("selectedLimit").textContent=poll.maxVotes;
  $("statusBadge").textContent=poll.open?"開放投票":"目前已關閉";
  $("statusBadge").className="badge "+(poll.open?"open":"closed");
  if(before!==JSON.stringify(poll.options)){
    renderOptions();
    document.querySelectorAll("#options input").forEach(i=>{
      if(oldSelection.has(i.value)&&selected.size<poll.maxVotes){i.checked=true;selected.add(i.value);i.closest("label").classList.add("selected");}
    });
  }
  document.querySelectorAll("#options input").forEach(i=>i.disabled=!poll.open||submitted);
  if(selected.size>poll.maxVotes){selected.clear();document.querySelectorAll("#options input").forEach(i=>{i.checked=false;i.closest("label").classList.remove("selected");});}
  updateSelected();renderResults(data.results||[]);
}
async function loadPoll(){
  if(loading)return loading;
  const btn=$("refreshResults");btn.disabled=true;btn.textContent="更新中…";
  loading=(async()=>{
    try{const data=await callApi("getPublicPoll");applyPoll(data);try{sessionStorage.setItem("dwhs_public_poll",JSON.stringify({at:Date.now(),data}));}catch(e){}}
    catch(err){
      $("statusBadge").textContent="連線失敗";$("statusBadge").className="badge closed";
      showMessage(err.name==="TimeoutError"?"連線逾時，請按重新整理再試。":err.message,"error");
    }finally{loading=null;btn.disabled=false;btn.textContent="重新整理";}
  })();return loading;
}

function renderOptions(){
  const box = $("options");
  box.innerHTML = "";
  selected.clear();
  updateSelected();
  (poll.options || []).forEach(opt=>{
    const label = document.createElement("label");
    label.className = "option-card";
    label.innerHTML = `
      <input type="checkbox" value="${escapeHtml(opt.id)}" ${poll.open ? "" : "disabled"}>
      <div><div class="option-name">${escapeHtml(opt.name)}</div>
      <div class="option-desc">${escapeHtml(opt.description || "")}</div></div>`;
    const checkbox = label.querySelector("input");
    checkbox.addEventListener("change", ()=>{
      if(checkbox.checked){
        if(selected.size >= poll.maxVotes){
          checkbox.checked = false;
          showMessage(`每人最多可投 ${poll.maxVotes} 票。`, "error");
          return;
        }
        selected.add(opt.id); label.classList.add("selected");
      }else{
        selected.delete(opt.id); label.classList.remove("selected");
      }
      hideMessage(); updateSelected();
    });
    box.appendChild(label);
  });
}

function updateSelected(){
  $("selectedCount").textContent = selected.size;
  $("submitVote").disabled = submitted || !poll?.open || selected.size === 0;
}

function renderResults(results){
  const box = $("results"); box.innerHTML = "";
  const max = Math.max(1,...results.map(x=>x.count));
  if(!results.length){ box.innerHTML='<p class="muted">目前尚無票數。</p>'; return; }
  results.forEach(r=>{
    const row=document.createElement("div"); row.className="result-row";
    row.innerHTML=`<div class="result-name">${escapeHtml(r.name)}</div>
      <div class="bar"><span style="width:${Math.round(r.count/max*100)}%"></span></div>
      <div class="count">${r.count} 票</div>`;
    box.appendChild(row);
  });
}

$("submitVote").addEventListener("click", async ()=>{
  const studentClass=$("studentClass").value.trim();
  const studentNo=$("studentNo").value.trim();
  const studentName=$("studentName").value.trim();
  if(!studentClass || !studentNo || !studentName){ showMessage("請先完整填寫班級、座號與姓名。","error"); return; }
  if(selected.size<1 || selected.size>poll.maxVotes){ showMessage(`請選擇 1～${poll.maxVotes} 個項目。`,"error"); return; }
  if(!confirm(`確認送出 ${selected.size} 票嗎？送出後不可重複投票。`)) return;
  $("submitVote").disabled=true;
  try{
    const data=await callApi("submitVote",{studentClass,studentNo,studentName,choices:[...selected]});
    submitted=true;showMessage("投票成功！感謝你的參與。","success");
    renderResults(data.results || []);
    document.querySelectorAll("#options input").forEach(i=>i.disabled=true);
  }catch(err){
    showMessage(err.message,"error"); updateSelected();
  }
});

$("refreshResults").addEventListener("click",loadPoll);

function escapeHtml(v){ return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }
try{
  const cached=JSON.parse(sessionStorage.getItem("dwhs_public_poll")||"null");
  if(cached&&Date.now()-cached.at<300000){
    applyPoll(cached.data);$("statusBadge").textContent="正在確認最新狀態…";
    $("submitVote").disabled=true;document.querySelectorAll("#options input").forEach(i=>i.disabled=true);
  }
}catch(e){}
loadPoll();
