const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(file,storage={}){
 const els=new Map(),calls=[],pending=[];
 function el(id){if(!els.has(id))els.set(id,{value:'',textContent:'',hidden:false,disabled:false,innerHTML:'',events:{},addEventListener(name,fn){this.events[name]=fn;}});return els.get(id);}
 const context=vm.createContext({window:{APP_CONFIG:{API_URL:'https://example.test'}},document:{getElementById:el,querySelectorAll(){return[]}},sessionStorage:{getItem(k){return storage[k]||null},setItem(k,v){storage[k]=v},removeItem(k){delete storage[k]}},fetch(url,options){calls.push(JSON.parse(options.body));return new Promise(resolve=>pending.push(data=>resolve({json:async()=>data})))},AbortSignal,Set,Map,JSON,Date,Number,String,Promise,console,confirm(){return true}});
 vm.runInContext(fs.readFileSync(file,'utf8'),context);return {context,el,calls,pending};
}
const poll={title:'測試票選',description:'測試',maxVotes:2,open:false,options:[]};
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const h=harness('admin.js',{dwhs_vote_admin_token:'mock-token'});
 assert.equal(h.el('saveSettings').disabled,true);assert.equal(h.calls.length,1);
 vm.runInContext('loadAdmin()',h.context);assert.equal(h.calls.length,1);
 h.pending.shift()({ok:true,poll:{...poll},results:[],votes:[]});await tick();
 assert.equal(h.el('saveSettings').disabled,false);
 h.el('settingOpen').value='true';h.el('settingOpen').events.change();
 h.el('saveSettings').onclick();assert.equal(h.calls[1].open,true);
 h.el('saveSettings').onclick();assert.equal(h.calls.length,2);
 h.pending.shift()({ok:true});await tick();
 assert.equal(h.calls.length,2);assert.match(h.el('savedStatus').textContent,/開放投票/);
 const reading=vm.runInContext('loadAdmin()',h.context);
 h.el('settingOpen').value='false';h.el('settingOpen').events.change();
 h.pending.shift()({ok:true,poll:{...poll,open:true},results:[],votes:[]});await reading;
 assert.equal(h.el('settingOpen').value,'false');
 const fast=harness('admin.js');fast.el('adminUser').value='mock-user';fast.el('adminPass').value='mock-password';
 const logging=vm.runInContext('login()',fast.context);
 fast.pending.shift()({ok:true,token:'mock-token',poll:{...poll},results:[],votes:[]});await logging;
 assert.equal(fast.calls.length,1,'新版後端登入只需一次請求');assert.equal(fast.el('saveSettings').disabled,false);
 const f=harness('app.js');f.pending.shift()({ok:true,poll:{...poll},results:[]});await tick();
 assert.equal(f.el('statusBadge').textContent,'目前已關閉');
 f.el('refreshResults').events.click();f.el('refreshResults').events.click();assert.equal(f.calls.length,2);
 f.pending.shift()({ok:true,poll:{...poll,open:true,maxVotes:3},results:[]});await tick();
 assert.equal(f.el('statusBadge').textContent,'開放投票');assert.equal(f.el('maxVotes').textContent,3);
 console.log('PASS: 慢速載入保護、读取合併、開放狀態提交、單次儲存、重複點擊保護、晚到讀取、前台狀態更新');
})().catch(e=>{console.error(e);process.exitCode=1});
