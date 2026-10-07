/**
 * 大灣高中社會探究與實作票選系統後端
 * Google Apps Script Web App + Google Sheet
 *
 * 首次使用：
 * 1. 建立空白 Google 試算表。
 * 2. 擴充功能 → Apps Script。
 * 3. 貼上本檔內容。
 * 4. 執行 setup() 一次並授權。
 * 5. 部署 → 新增部署作業 → 網頁應用程式。
 *    執行身分：我
 *    存取權：任何人
 * 6. 將 Web App URL 貼回 config.js。
 */

const SHEET_SETTINGS = "Settings";
const SHEET_OPTIONS = "Options";
const SHEET_VOTES = "Votes";
const PROP_ADMIN_USER = "ADMIN_USER_HASH";
const PROP_ADMIN_PASS = "ADMIN_PASS_HASH";
const BACKEND_VERSION = "20261007-1328";
let requestDb = null;
function invalidatePublic_(){PropertiesService.getScriptProperties().setProperty("PUBLIC_REV",Utilities.getUuid());}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  if (!ss) throw new Error("請從專用 Google 試算表開啟 Apps Script。");
  const user = props.getProperty("ADMIN_USER");
  const pass = props.getProperty("ADMIN_PASSWORD");
  if (!user || !pass) throw new Error("請先在專案設定的指令碼屬性設定 ADMIN_USER 與 ADMIN_PASSWORD。");
  props.setProperty("SPREADSHEET_ID", ss.getId());
  if (!ss.getSheetByName(SHEET_SETTINGS)) {
    const sh=ss.insertSheet(SHEET_SETTINGS);
    sh.getRange(1,1,5,2).setValues([["key","value"],["title","優秀同學／作品票選"],["description","請依課程表現與作品內容進行票選。"],["maxVotes","2"],["open","false"]]);
  }
  if (!ss.getSheetByName(SHEET_OPTIONS)) ss.insertSheet(SHEET_OPTIONS).appendRow(["id","name","description","active"]);
  if (!ss.getSheetByName(SHEET_VOTES)) ss.insertSheet(SHEET_VOTES).appendRow(["timestamp","studentClass","studentNo","studentName","studentKey","choiceIds","choiceNames","userAgent"]);
  props.setProperty(PROP_ADMIN_USER, sha256_(user));
  props.setProperty(PROP_ADMIN_PASS, sha256_(pass));
  props.deleteProperty("ADMIN_USER"); props.deleteProperty("ADMIN_PASSWORD");
}
function db_() {
  if(requestDb)return requestDb;
  const id=PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("系統尚未完成初始化。");
  return requestDb=SpreadsheetApp.openById(id);
}

function doGet() {
  return json_({ok:true, message:"Dawuan voting API is running.",version:BACKEND_VERSION});
}

function doPost(e) {
  requestDb=null;
  try {
    const data = JSON.parse((e.postData && e.postData.contents) || "{}");
    const action = data.action || "";
    const mutating=["submitVote","saveSettings","addOption","deleteOption","deleteVote","resetPoll"].includes(action);
    const lock=mutating?LockService.getScriptLock():null;
    if(lock)lock.waitLock(20000);
    try {
    switch(action){
      case "getPublicPoll": return json_(publicPoll_());
      case "submitVote": return json_(submitVote_(data));
      case "adminLogin": return json_(adminLogin_(data));
      case "adminLogout": CacheService.getScriptCache().remove("session:"+String(data.token||"")); return json_({ok:true});
      case "getAdminData": requireAdmin_(data.token); return json_(adminData_());
      case "saveSettings": requireAdmin_(data.token); return json_(saveSettings_(data));
      case "addOption": requireAdmin_(data.token); return json_(addOption_(data));
      case "deleteOption": requireAdmin_(data.token); return json_(deleteOption_(data));
      case "deleteVote": requireAdmin_(data.token); return json_(deleteVote_(data));
      case "resetPoll": requireAdmin_(data.token); return json_(resetPoll_(data));
      default: throw new Error("未知操作");
    }
    } finally { if(lock)lock.releaseLock(); }
  } catch(err) {
    return json_({ok:false,error:err.message || String(err)});
  }
}

function publicPoll_(){
  const revision=PropertiesService.getScriptProperties().getProperty("PUBLIC_REV")||"initial";
  const cache=CacheService.getScriptCache(),key="public:"+revision;
  const saved=cache.get(key);
  if(saved){try{const data=JSON.parse(saved);data.poll=effectivePoll_(data.poll);return data;}catch(e){}}
  const poll=readPoll_();
  const data={ok:true,poll,results:results_(poll.options)};
  const encoded=JSON.stringify(data);
  // 只快取公开候選與彙總票數；沒有姓名、班級、座號或登入憑證。
  if(encoded.length<20000)cache.put(key,encoded,10);
  return data;
}

function submitVote_(d){
  const poll = readPoll_();
  if(poll.ended) throw new Error("已超過投票截止時間。");
  if(!poll.open) throw new Error("目前已關閉投票。");
  const rawClass=String(d.studentClass||"").normalize("NFKC").trim();
  const rawNo=String(d.studentNo||"").normalize("NFKC").trim();
  if(!/^\d{3}$/.test(rawClass)||Number(rawClass)<100) throw new Error("班級請填三位數，例如 502。");
  if(!/^\d{1,2}$/.test(rawNo)||Number(rawNo)<1||Number(rawNo)>99) throw new Error("座號請填 1～99 的整數。");
  const studentClass=String(Number(rawClass)), studentNo=String(Number(rawNo));
  const studentName = clean_(d.studentName,20);
  const choices = Array.isArray(d.choices) ? [...new Set(d.choices.map(String))] : [];
  if(!studentClass || !studentNo || !studentName) throw new Error("班級、座號、姓名不可空白。");
  if(choices.length < 1 || choices.length > poll.maxVotes) throw new Error(`每人可投 1～${poll.maxVotes} 票。`);

  const valid = new Map(poll.options.map(o=>[o.id,o.name]));
  for(const id of choices) if(!valid.has(id)) throw new Error("包含無效候選項目。");

  const studentKey = `${studentClass}-${studentNo}`;
  const sh = db_().getSheetByName(SHEET_VOTES);

    const values = sh.getDataRange().getValues();
    const exists = values.slice(1).some(r=>String(r[4])===studentKey);
    if(exists) throw new Error("此班級與座號已完成投票，無法重複提交。");
    const choiceNames = choices.map(id=>valid.get(id));
    const row=[new Date(),studentClass,studentNo,sheetText_(studentName),studentKey,choices.join("|"),sheetText_(choiceNames.join("、")),clean_(d.userAgent||"",150)];
    sh.appendRow(row);invalidatePublic_();
  return {ok:true,results:results_(poll.options,[...values.slice(1),row])};
}

function adminLogin_(d){
  const props=PropertiesService.getScriptProperties();
  if(sha256_(String(d.username||""))!==props.getProperty(PROP_ADMIN_USER) ||
     sha256_(String(d.password||""))!==props.getProperty(PROP_ADMIN_PASS)) throw new Error("帳號或密碼錯誤。");
  const token=Utilities.getUuid()+Utilities.getUuid();
  CacheService.getScriptCache().put("session:"+token,"1",21600);
  return {...adminData_(),token};
}
function requireAdmin_(token){
  if(!token || !CacheService.getScriptCache().get("session:"+token)) throw new Error("後台登入已失效，請重新登入。");
}

function adminData_(rows){
  const poll=readPoll_();
  if(!rows)rows=db_().getSheetByName(SHEET_VOTES).getDataRange().getValues().slice(1);
  return {ok:true,poll,features:{deadline:true,deleteVote:true,resetPoll:true},version:BACKEND_VERSION,results:results_(poll.options,rows),votes:readVotes_(poll.options,rows)};
}

function parseDeadline_(value){
  const text=String(value||"").trim();if(!text)return "";
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(text) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(text))throw new Error("截止時間格式不正確，請重新選擇。");
  const time=Date.parse(text);
  if(!Number.isFinite(time))throw new Error("截止時間無效。");
  const normalized=new Date(time).toISOString();
  const calendar=text.endsWith("Z")?normalized:new Date(time+8*3600000).toISOString();
  if(calendar.slice(0,16)!==text.slice(0,16))throw new Error("截止日期或時間無效。");
  return normalized;
}
function effectivePoll_(poll){
  const now=Date.now(),deadline=Date.parse(poll.deadlineAt||"");
  const manualOpen=poll.manualOpen===undefined?!!poll.open:!!poll.manualOpen;
  const ended=Number.isFinite(deadline)&&now>=deadline;
  return {...poll,manualOpen,ended,open:manualOpen&&!ended,serverNow:now};
}
function saveSettings_(d){
  const maxVotes=Number(d.maxVotes);
  if(!Number.isInteger(maxVotes)||maxVotes<1||maxVotes>99)throw new Error("票數請填 1～99 的整數。");
  const sh=db_().getSheetByName(SHEET_SETTINGS),rows=sh.getDataRange().getValues();
  const existing={};rows.slice(1).forEach(r=>existing[String(r[0])]=String(r[1]||""));
  const deadlineAt=parseDeadline_(Object.prototype.hasOwnProperty.call(d,"deadlineAt")?d.deadlineAt:(existing.deadlineAt||""));
  const manualOpen=d.open===true||d.open==="true";
  if(manualOpen&&deadlineAt&&Date.now()>=Date.parse(deadlineAt))throw new Error("截止時間已過；請設定未來的時間，或將投票狀態設為關閉。");
  const map={title:clean_(d.title,100)||"課程票選",description:clean_(d.description,500),maxVotes:String(maxVotes),open:String(manualOpen),deadlineAt};
  const values=rows.slice(1).map(r=>[r[0],Object.prototype.hasOwnProperty.call(map,r[0])?sheetText_(map[r[0]]):r[1]]);
  Object.keys(map).forEach(key=>{if(!values.some(r=>r[0]===key))values.push([key,sheetText_(map[key])]);});
  sh.getRange(2,1,values.length,2).setValues(values);invalidatePublic_();
  return {ok:true,settings:effectivePoll_({title:map.title,description:map.description,maxVotes,open:manualOpen,manualOpen,deadlineAt})};
}
function voteId_(row){
  const timestamp=row[0] instanceof Date?row[0].getTime():String(row[0]);
  return sha256_(JSON.stringify([timestamp,String(row[4]),String(row[5]),String(row[6])]));
}
function deleteVote_(d){
  const id=String(d.voteId||""),sh=db_().getSheetByName(SHEET_VOTES);
  if(!/^[a-f0-9]{64}$/.test(id))throw new Error("投票紀錄識別碼無效。");
  const rows=sh.getDataRange().getValues().slice(1),matches=[];
  rows.forEach((r,i)=>{if(voteId_(r)===id)matches.push(i);});
  if(matches.length!==1)throw new Error("找不到唯一的投票紀錄，請重新整理後再操作。");
  const index=matches[0];sh.deleteRow(index+2);rows.splice(index,1);invalidatePublic_();
  return adminData_(rows);
}
function resetPoll_(d){
  if(d.confirmation!=="刪除本次票選")throw new Error("請輸入「刪除本次票選」確認重設。");
  const ss=db_();
  // 先關閉票選，避免重設途中有新的選票進入。
  const settings=ss.getSheetByName(SHEET_SETTINGS);
  const rows=settings.getDataRange().getValues();
  const index=rows.findIndex(r=>r[0]==="open");if(index>=0)settings.getRange(index+1,2).setValue("false");
  invalidatePublic_();
  ss.getSheetByName(SHEET_VOTES).clearContents();
  ss.getSheetByName(SHEET_VOTES).getRange(1,1,1,8).setValues([["timestamp","studentClass","studentNo","studentName","studentKey","choiceIds","choiceNames","userAgent"]]);
  ss.getSheetByName(SHEET_OPTIONS).clearContents();
  ss.getSheetByName(SHEET_OPTIONS).getRange(1,1,1,4).setValues([["id","name","description","active"]]);
  settings.clearContents();
  settings.getRange(1,1,6,2).setValues([["key","value"],["title","優秀同學／作品票選"],["description","請依課程表現與作品內容進行票選。"],["maxVotes","2"],["open","false"],["deadlineAt",""]]);
  invalidatePublic_();return adminData_([]);
}

function addOption_(d){
  const name=clean_(d.name,100),description=clean_(d.description,300);
  if(!name) throw new Error("候選名稱不可空白。");
  const id=Utilities.getUuid();
  db_().getSheetByName(SHEET_OPTIONS).appendRow([id,sheetText_(name),sheetText_(description),"true"]);
  invalidatePublic_();
  return {ok:true,option:{id,name,description}};
}
function deleteOption_(d){
  const id=String(d.id||"");
  const sh=db_().getSheetByName(SHEET_OPTIONS);
  const values=sh.getDataRange().getValues();
  for(let i=1;i<values.length;i++){
    if(String(values[i][0])===id){ sh.getRange(i+1,4).setValue("false");invalidatePublic_();return {ok:true,id}; }
  }
  throw new Error("找不到候選項目。");
}

function readPoll_(){
  const ss=db_();
  const s=ss.getSheetByName(SHEET_SETTINGS).getDataRange().getValues();
  const cfg={}; s.slice(1).forEach(r=>cfg[String(r[0])]=String(r[1]));
  const o=ss.getSheetByName(SHEET_OPTIONS).getDataRange().getValues().slice(1)
    .filter(r=>String(r[3]).toLowerCase()!=="false")
    .map(r=>({id:String(r[0]),name:String(r[1]),description:String(r[2]||"")}));
  return effectivePoll_({title:cfg.title||"課程票選",description:cfg.description||"",maxVotes:Math.max(1,Number(cfg.maxVotes)||1),open:String(cfg.open).toLowerCase()==="true",deadlineAt:cfg.deadlineAt||"",options:o});
}
function results_(options,rows){
  const counts={}; options.forEach(o=>counts[o.id]=0);
  if(!rows)rows=db_().getSheetByName(SHEET_VOTES).getDataRange().getValues().slice(1);
  rows.forEach(r=>String(r[5]||"").split("|").filter(Boolean).forEach(id=>{if(counts.hasOwnProperty(id))counts[id]++}));
  return options.map(o=>({id:o.id,name:o.name,count:counts[o.id]||0})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,"zh-Hant"));
}
function readVotes_(options,rows){
  if(!rows)rows=db_().getSheetByName(SHEET_VOTES).getDataRange().getValues().slice(1);
  return [...rows].reverse().map(r=>{
    return {
      voteId:voteId_(r),
      timestamp:r[0] instanceof Date ? Utilities.formatDate(r[0],Session.getScriptTimeZone()||"Asia/Taipei","yyyy-MM-dd HH:mm:ss") : String(r[0]),
      studentClass:String(r[1]),studentNo:String(r[2]),studentName:String(r[3]),
      choiceNames:String(r[6]||"").split("、").filter(Boolean)
    };
  });
}
function clean_(v,max){return String(v==null?"":v).replace(/[<>]/g,"").trim().slice(0,max)}
function sha256_(s){
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8)
    .map(b=>(b+256)%256).map(b=>b.toString(16).padStart(2,"0")).join("");
}
function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheetText_(v){return /^[=+@\-\t\r]/.test(String(v)) ? "\'"+v : v;}
