const API = window.APP_CONFIG.API_URL;
let poll = null;
let selected = new Set();

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
    signal: AbortSignal.timeout(30000),
    method: "POST",
    headers: {"Content-Type":"text/plain;charset=utf-8"},
    body: JSON.stringify({action, ...payload})
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "操作失敗");
  return data;
}

async function loadPoll(){
  try{
    const data = await callApi("getPublicPoll");
    poll = data.poll;
    $("pollTitle").textContent = poll.title || "課程票選";
    $("pollDescription").textContent = poll.description || "";
    $("maxVotes").textContent = poll.maxVotes;
    $("selectedLimit").textContent = poll.maxVotes;
    const badge = $("statusBadge");
    badge.textContent = poll.open ? "開放投票" : "目前已關閉";
    badge.className = "badge " + (poll.open ? "open" : "closed");
    renderOptions();
    renderResults(data.results || []);
  }catch(err){
    $("statusBadge").textContent = "連線失敗";
    $("statusBadge").className = "badge closed";
    showMessage(err.message, "error");
  }
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
  $("submitVote").disabled = !poll?.open || selected.size === 0;
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
    showMessage("投票成功！感謝你的參與。","success");
    renderResults(data.results || []);
    document.querySelectorAll("#options input").forEach(i=>i.disabled=true);
  }catch(err){
    showMessage(err.message,"error"); updateSelected();
  }
});

$("refreshResults").addEventListener("click", async ()=>{
  try{ const d=await callApi("getPublicPoll"); renderResults(d.results||[]); }
  catch(e){ showMessage(e.message,"error"); }
});

function escapeHtml(v){ return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }
loadPoll();
