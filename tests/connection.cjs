const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const elements={};const el=id=>elements[id]??=( {value:'',textContent:'',innerHTML:'',disabled:false,classList:{toggle(){}},options:[{text:'test'}],selectedIndex:0});
const context={document:{querySelector:s=>el(s),querySelectorAll:()=>[]},window:{addEventListener(){}},console:{info(){},error(){},warn(){}},localStorage:{setItem(){},getItem(){return null},removeItem(){}},URLSearchParams,performance, setTimeout, clearTimeout,alert(){},confirm:()=>false,fetch:()=>{throw Error('Unexpected network')}};vm.createContext(context);vm.runInContext(require('./helpers/frontend.cjs').loadSource(),context);
const run=s=>vm.runInContext(s,context);
(async()=>{
context.setTimeout=()=>{throw Error('Automatic retry is disabled')};context.clearTimeout=()=>{};
context.alert=()=>{throw Error('Connection errors must be inline')};
run('async function api(){throw Error("offline")}');await run('connectLexicon()');
assert.equal(run('connected'),false);assert.match(elements['#connectionError'].textContent,/Settings → Integrations/);assert.equal(elements['#lexSearch'].disabled,true);
run('async function api(path){return path.includes("tracks")?{data:{tracks:[]}}:{data:{categories:[],tags:[]}}}');await run('connectLexicon()');
assert.equal(run('connected'),true);assert.equal(elements['#connectionError'].textContent,'');assert.equal(elements['#lexSearch'].disabled,false);assert.ok(html.includes('id="retryConnection"')); 
assert.ok(!html.includes('id="connectBtn"'));assert.ok(require('./helpers/frontend.cjs').loadSource().includes('await connectLexicon()'));
console.log('PASS: automatic connection, inline setup error, disabled disconnected controls, manual retry recovery, and no popup. No live writes.');
})().catch(e=>{console.error(e);process.exit(1)});
