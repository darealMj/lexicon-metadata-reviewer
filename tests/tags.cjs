const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const elements={};const el=id=>elements[id]??=( {value:'',textContent:'',innerHTML:'',disabled:false,classList:{toggle(){}},options:[{text:'test'}],selectedIndex:0});
const context={document:{querySelector:s=>el(s),querySelectorAll:()=>[]},window:{addEventListener(){}},console:{info(){},error(){},warn(){}},localStorage:{setItem(){},getItem(){return null},removeItem(){}},URLSearchParams,performance, setTimeout, clearTimeout,alert(){},confirm:()=>false,fetch:()=>{throw Error('Unexpected network')}};vm.createContext(context);vm.runInContext(require('./helpers/frontend.cjs').loadSource(),context);
const run=s=>vm.runInContext(s,context);
(async()=>{
run("window.setAdvanced(true)");
const fixture={data:{categories:[{id:1,label:'Genre'},{id:6,label:'Subgenre'}],tags:[{id:108,categoryId:6,label:'Funk'},{id:125,categoryId:1,label:'R&B'}]}};
context.fixture=fixture;
let calls=[];context.mockApi=async(path,opts={})=>{calls.push({path,...opts});throw Error('Unexpected request '+path)};
run('api=mockApi;parseTags(fixture)');
assert.equal((await run('ensureTag(" funk ",1)')).id,108);assert.equal(calls.length,0);
run('allTags=[]');context.mockApi=async(path,opts={})=>{calls.push({path,...opts});return fixture};run('api=mockApi');
assert.equal((await run('ensureTag("R&B",1)')).id,125);assert.equal(calls.length,1);assert.equal(calls[0].path,'/v1/tags');
// Another client creates the same label after our refresh but before our POST.
let reads=0;calls=[];
context.mockApi=async(path,opts={})=>{calls.push({path,...opts});if(opts.method==='POST')throw Error('A tag with this label already exists');reads++;return reads===1?{data:{categories:fixture.data.categories,tags:[]}}:fixture};run('api=mockApi;allTags=[]');
assert.equal((await run('ensureTag("R&B",1)')).id,125);assert.equal(calls.filter(c=>c.method==='POST').length,1);
// Cache a newly created tag correctly for reuse on the next song.
calls=[];context.mockApi=async(path,opts={})=>{calls.push({path,...opts});return opts.method==='POST'?{data:{id:999,categoryId:1,label:'New tag'}}:{data:{categories:fixture.data.categories,tags:[]}}};run('api=mockApi;allTags=[]');
assert.equal((await run('ensureTag("New tag",1)')).id,999);assert.equal((await run('ensureTag("New tag",1)')).id,999);assert.equal(calls.filter(c=>c.method==='POST').length,1);
// Non-duplicate errors must not become success or be retried blindly.
context.mockApi=async(path,opts={})=>{if(opts.method==='POST')throw Error('Permission denied');return {data:{categories:fixture.data.categories,tags:[]}}};run('api=mockApi;allTags=[]');await assert.rejects(run('ensureTag("No permission",1)'),/Permission denied/);
assert.throws(()=>run('createdEntity({data:{label:"oops"}},"tag")'),/valid tag ID/);
// A successful update preserves fresh tags and uses Lexicon's documented envelope.
calls=[];context.mockApi=async(path,opts={})=>{calls.push({path,...opts});if(path.startsWith('/v1/track?id='))return {data:{track:{id:2,tags:[76,999]}}};if(opts.method==='PATCH')return {};throw Error('Unexpected request '+path)};
run('api=mockApi;parseTags(fixture);makeRows([{id:2,title:"Song (Clean)",artist:"Artist",tags:[76]}]);rows[0].reference={strAlbum:"Album",strGenre:"Funk"};rows[0].fields={AlbumTitle:"record"};rows[0].genreTags=["Funk"];rows[0].decision="accepted";rows[0].error="Lexicon write failed: old error"');
await run('applyOne(rows[0])');const sent=calls.find(c=>c.method==='PATCH');assert.equal(sent.path,'/v1/track');assert.deepEqual(JSON.parse(sent.body),{id:2,edits:{albumTitle:'Album',tags:[76,999,108]}});assert.equal(calls.some(c=>c.method==='POST'),false);assert.equal(run('rows[0].applied'),true);assert.equal(run('rows[0].error'),null);
// Missing current tag data blocks all mutations.
calls=[];context.mockApi=async(path,opts={})=>{calls.push({path,...opts});return {data:{track:{id:2}}}};run('api=mockApi;rows[0].applied=false');await assert.rejects(run('applyOne(rows[0])'),/current track tags/);assert.equal(calls.some(c=>c.method),false);
// A duplicate category is also resolved by refreshing, not repeatedly created.
reads=0;calls=[];context.mockApi=async(path,opts={})=>{calls.push({path,...opts});if(opts.method==='POST')throw Error('Category already exists');reads++;return reads===1?{data:{categories:[],tags:[]}}:fixture};run('api=mockApi;tagCategories=[];allTags=[]');assert.equal((await run('ensureGenreCategory()')).id,1);assert.equal(calls.filter(c=>c.method==='POST').length,1);
console.log('PASS: cross-category reuse, stale cache, duplicate race recovery, creation cache, error propagation, fresh tag preservation, documented PATCH envelope, missing-data refusal and category duplicate recovery. No live writes.');
})().catch(e=>{console.error(e);process.exit(1)});
