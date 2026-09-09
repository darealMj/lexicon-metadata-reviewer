const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const elements={};const el=id=>elements[id]??=( {value:'',textContent:'',innerHTML:'',disabled:false,classList:{toggle(){}},options:[{text:'test'}],selectedIndex:0});
const context={document:{querySelector:s=>el(s),querySelectorAll:()=>[]},window:{addEventListener(){}},console:{info(){},error(){},warn(){}},localStorage:{setItem(){},getItem(){return null},removeItem(){}},URLSearchParams,performance, setTimeout, clearTimeout,alert(){},confirm:()=>false,fetch:()=>{throw Error('Unexpected network')}};vm.createContext(context);vm.runInContext(require('./helpers/frontend.cjs').loadSource(),context);
const run=s=>vm.runInContext(s,context);
(async()=>{
run('makeRows([{id:1,title:"Song",artist:"Artist",tags:[7,8]},{id:2,title:"Other",artist:"Artist",tags:[7]}]);async function api(){return {data:{track:{id:1,tags:[7,8,9]}}}};async function ensureTag(){return {id:10}};async function patchTrack(id,patch){globalThis.sent=patch};rows[0].genreTags=["Pop"]');
await run('applyOne(rows[0])');assert.deepEqual(JSON.parse(run('JSON.stringify(sent.tags)')),[7,8,9,10]);
run('rows[0].applied=false;rows[0].decision="accepted";window.setTagMode(1,"replace")');assert.equal(run('rows[0].decision'),'pending');assert.equal(run('rows[1].tagMode'),'add');assert.equal(run('bulkEligible(rows[0])'),false);
await run('applyOne(rows[0])');assert.deepEqual(JSON.parse(run('JSON.stringify(sent.tags)')),[10]);
run('rows[0].applied=false;window.allGenreTags(1,false)');await run('applyOne(rows[0])');assert.deepEqual(JSON.parse(run('JSON.stringify(sent.tags)')),[]);
assert.match(run('applyConfirmation([rows[0]])'),/CLEAR ALL CUSTOM TAGS/);assert.match(run('tagHTML(rows[0])'),/all custom tags will be cleared/);
run('rows[0].applied=false;window.decide(1,"accepted")');const csv=run('parseCSV(reviewedCSV())');assert.equal(csv[0].at(-1),'CustomTagAction');assert.equal(csv[1].at(-1),'replace');
run('window.allFields(1,"current")');assert.equal(run('rows[0].tagMode'),'add');assert.equal(run('rows[0].decision'),'pending');
console.log('PASS: add preserves fresh tags, replacement writes exactly selected tags, empty replacement clears tags, per-song isolation, approval reset, explicit confirmation, CSV action and All current reset. No live writes.');
})().catch(e=>{console.error(e);process.exit(1)});
