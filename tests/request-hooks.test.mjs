import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {generateSDK} from '../lib/core/index.js';
import * as React from 'react';
import {create,act} from 'react-test-renderer';
import {SWRConfig,unstable_serialize} from 'swr';
const dir=await mkdtemp(join(process.cwd(),'.verify-request-'));
after(()=>rm(dir,{recursive:true,force:true}));
const responses={200:{description:'OK',content:{'application/json':{schema:{type:'object',properties:{value:{type:'string'}},required:['value']}}}}};
const paths={};
for(const method of ['get','post','put','patch','delete']) paths[`/items/${method}`]={[method]:{operationId:method,parameters:[{in:'query',name:'id',required:true,schema:{type:'string'}}],...(method!=='get'?{requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties:{name:{type:'string'}},required:['name']}}}}}:{}),responses}};
paths['/items/ping']={post:{operationId:'ping',responses}};
paths['/items/empty']={post:{...paths['/items/post'].post,operationId:'empty',responses:{204:{description:'No content'}}}};
const generated=generateSDK({openapi:'3.0.3',info:{title:'Hook fixture',version:'1'},paths});
for(const [name,text] of Object.entries(generated.files)) await writeFile(join(dir,name),text);
const compiled=spawnSync(resolve('node_modules/.bin/tsc'),['--ignoreConfig','--strict','--skipLibCheck','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--lib','ES2022,DOM,DOM.Iterable','--outDir',join(dir,'js'),...Object.keys(generated.files).filter(n=>n.endsWith('.ts')).map(n=>join(dir,n))],{encoding:'utf8'});
assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
const {createReactAPI}=await import(pathToFileURL(join(dir,'js/react.js')));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const tick=()=>new Promise(r=>setTimeout(r,15));
function wrapper(Component,props,cache=new Map(),swr={}){return React.createElement(SWRConfig,{value:{provider:()=>cache,shouldRetryOnError:false,dedupingInterval:0,...swr}},React.createElement(Component,props));}

test('all HTTP methods useRequest auto-fetch once, body/params changes fetch, useMutation remains lazy',async()=>{
 const calls=[];let hooks={};
 const API=createReactAPI({request:async ctx=>{calls.push(ctx);return {status:200,headers:new Headers(),data:{value:ctx.method}};}});
 function View({id}){for(const method of ['get','post','put','patch','delete']) hooks[method]=method==='get'?API.main.items[method].useRequest({query:{id}}):API.main.items[method].useRequest({query:{id}},{name:id});hooks.lazy=API.main.items.post.useMutation({query:{id}},{name:'lazy'});return null;}
 const cache=new Map();let root;
 await act(async()=>{root=create(wrapper(View,{id:'one'},cache));await tick();});
 assert.deepEqual(calls.map(c=>c.method).sort(),['DELETE','GET','PATCH','POST','PUT']);
 for(const method of ['get','post','put','patch','delete']) assert.equal(hooks[method].data.value,method.toUpperCase());
 await act(async()=>{root.update(wrapper(View,{id:'two'},cache));await tick();});
 assert.equal(calls.length,10);
 assert(calls.slice(5).every(c=>c.url.includes('id=two')));
 await act(async()=>{await hooks.lazy.trigger();});assert.equal(calls.length,11);assert.equal(calls.at(-1).body.name,'lazy');
 await act(async()=>root.unmount());
});

test('enabled:false blocks automatic reads/writes; trigger and refresh update data, expose loading, keep stable references and isolate body cache',async()=>{
 const calls=[],cache=new Map();let apiState,getState,resolveNext,block=false;
 const API=createReactAPI({request:async ctx=>{calls.push(ctx);if(block)await new Promise(r=>resolveNext=r);return {status:200,headers:new Headers(),data:{value:ctx.body?.name??'get'}};}});
 function View({name='first'}){apiState=API.main.items.post.useRequest({query:{id:'one'}},{name},{enabled:false});getState=API.main.items.get.useRequest({query:{id:'one'}},{enabled:false});return null;}
 let root;await act(async()=>{root=create(wrapper(View,{},cache));await tick();});assert.equal(calls.length,0);
 const originalTrigger=apiState.trigger,originalRefresh=apiState.refresh;
 block=true;let pending;
 await act(async()=>{pending=apiState.trigger();await tick();});
 assert.equal(apiState.isMutating,true);assert.equal(apiState.isLoading,true);assert.equal(apiState.isValidating,true);
 await act(async()=>{resolveNext();await pending;});block=false;
 assert.equal(calls.length,1);assert.equal(apiState.data.value,'first');assert.equal(apiState.isMutating,false);
 await act(async()=>{await apiState.refresh();});assert.equal(calls.length,2);
 await act(async()=>{await apiState.trigger({name:'override'});});assert.equal(calls.length,3);assert.equal(apiState.data.value,'override');
 const baseKey=API.main.items.post.getKey({query:{id:'one'}},{name:'first'});
 const otherKey=API.main.items.post.getKey({query:{id:'one'}},{name:'override'});
 assert.equal(cache.get(unstable_serialize(baseKey)).data.value,'first');assert.equal(cache.get(unstable_serialize(otherKey)).data.value,'override');
 await act(async()=>{await apiState.refresh();});assert.equal(calls.length,4);assert.equal(calls.at(-1).body.name,'override');
 assert.equal(apiState.trigger,originalTrigger);assert.equal(apiState.refresh,originalRefresh);
 await act(async()=>{await getState.trigger();await getState.refresh();});assert.equal(calls.length,6);assert.equal(getState.data.value,'get');
 await act(async()=>{root.update(wrapper(View,{name:'changed'},cache));await tick();});assert.equal(calls.length,6);
 await act(async()=>{await apiState.refresh();});assert.equal(calls.at(-1).body.name,'changed');
 await act(async()=>root.unmount());
});

test('refresh works from an effect, uses latest options, and manual body changes do not cause duplicate automatic requests',async()=>{
 const calls=[];let state;let root;const cache=new Map();
 const API=createReactAPI({request:async ctx=>{calls.push(ctx);return {status:200,headers:new Headers(),data:{value:ctx.body.name}};}});
 function View({revision,header}){
  state=API.main.items.post.useRequest({query:{id:'one'}},{name:'preset'},{headers:{'X-Version':header},enabled:false});
  const {refresh}=state;React.useEffect(()=>{if(revision)void refresh();},[revision,refresh]);return null;
 }
 await act(async()=>{root=create(wrapper(View,{revision:0,header:'first'},cache));await tick();});assert.equal(calls.length,0);
 await act(async()=>{root.update(wrapper(View,{revision:1,header:'second'},cache));await tick();});assert.equal(calls.length,1);assert.equal(calls[0].headers.get('X-Version'),'second');
 await act(async()=>root.unmount());
 function Automatic(){state=API.main.items.post.useRequest({query:{id:'auto'}},{name:'original'});return null;}
 await act(async()=>{root=create(wrapper(Automatic,{},cache));await tick();});assert.equal(calls.length,2);
 await act(async()=>{await state.trigger({name:'replacement'});await tick();});assert.equal(calls.length,3);assert.equal(state.data.value,'replacement');
 await act(async()=>{await state.refresh();await tick();});assert.equal(calls.length,4);assert.equal(calls.at(-1).body.name,'replacement');
 await act(async()=>root.unmount());
});

test('manual errors update error and reject, throwOnError:false suppresses rejection, refresh clears error, null params block manual fetch',async()=>{
 let state,fail=true;const calls=[];
 const API=createReactAPI({request:async ctx=>{calls.push(ctx);if(fail)throw new Error('fixture failure');return {status:200,headers:new Headers(),data:{value:'recovered'}};}});
 function View({paused=false}){state=API.main.items.post.useRequest(paused?null:{query:{id:'one'}},{name:'preset'},{enabled:false});return null;}
 const cache=new Map();let root;await act(async()=>{root=create(wrapper(View,{},cache));});
 await act(async()=>{await assert.rejects(state.trigger(),/fixture failure/);});assert.equal(state.error.message,'fixture failure');assert.equal(state.isMutating,false);
 await act(async()=>{assert.equal(await state.trigger(undefined,{throwOnError:false}),undefined);});assert(state.error); // Missing required body is rejected without a transport call.
 assert.equal(calls.length,1);
 fail=false;await act(async()=>{await state.trigger({name:'valid'});});assert.equal(state.error,undefined);assert.equal(state.data.value,'recovered');
 await act(async()=>{root.update(wrapper(View,{paused:true},cache));});
 await assert.rejects(state.trigger(),/params/);await assert.rejects(state.refresh(),/params/);assert.equal(calls.length,2);
 await act(async()=>root.unmount());
});

test('deferred required bodies stay manual; overlapping manual calls retain the latest body and result',async()=>{
 let state;const pending=[];
 const API=createReactAPI({request:async ctx=>{return await new Promise(resolve=>pending.push({ctx,resolve}));}});
 function View(){state=API.main.items.post.useRequest({query:{id:'one'}},undefined,{enabled:false});return null;}
 let root;await act(async()=>{root=create(wrapper(View,{}));});assert.equal(pending.length,0);
 let first,second;
 await act(async()=>{first=state.trigger({name:'old'});second=state.trigger({name:'new'});await tick();});assert.equal(pending.length,2);
 await act(async()=>{pending[1].resolve({status:200,headers:new Headers(),data:{value:'new'}});await second;});assert.equal(state.data.value,'new');
 await act(async()=>{pending[0].resolve({status:200,headers:new Headers(),data:{value:'old'}});await first;});assert.equal(state.data.value,'new');assert.equal(state.isMutating,false);
 await act(async()=>root.unmount());
});

test('request hook types enforce auto bodies, deferred manual bodies, no-body triggers and typed refresh results',async()=>{
 const file=join(dir,'contract.ts');await writeFile(file,`import {createReactAPI} from './react.js';
const API=createReactAPI();const p={query:{id:'1'}};
function View(){
const automatic=API.main.items.post.useRequest(p,{name:'A'});
automatic.trigger();automatic.trigger({name:'B'});automatic.refresh();
// @ts-expect-error automatic required body cannot be missing
API.main.items.post.useRequest(p,undefined);
// @ts-expect-error deferral needs enabled:false
API.main.items.post.useRequest(p,undefined,{enabled:true});
const deferred=API.main.items.post.useRequest(p,undefined,{enabled:false});
deferred.trigger({name:'valid'});
// @ts-expect-error deferred body required
 deferred.trigger();
// @ts-expect-error body schema checked
 automatic.trigger({name:123});
const get=API.main.items.get.useRequest(p,{enabled:false});get.trigger();get.refresh();
// @ts-expect-error GET has no body
get.trigger({name:'unexpected'});
const ping=API.main.items.ping.useRequest();ping.trigger();
const lazy=API.main.items.put.useMutation(p,undefined);lazy.trigger({name:'valid'});
async function load(){const result=await automatic.refresh();if(result){const text:string=result.value;void text;
// @ts-expect-error response types preserved
const n:number=result.value;}}
return null;}
`);
 const checked=spawnSync(resolve('node_modules/.bin/tsc'),['--ignoreConfig','--strict','--noEmit','--skipLibCheck','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',file],{encoding:'utf8'});
 assert.equal(checked.status,0,checked.stdout+checked.stderr);
});


test('enabled transitions auto-fetch once; disabled polling/suspense stay off, including after a manual trigger',async()=>{
 const calls=[];let state;const cache=new Map();
 const API=createReactAPI({request:async ctx=>{calls.push(ctx);return {status:200,headers:new Headers(),data:{value:'ok'}};}});
 function View({enabled}){state=API.main.items.get.useRequest({query:{id:'one'}},{enabled,swr:{refreshInterval:enabled?0:5,revalidateOnMount:true,suspense:true}});return null;}
 let root;await act(async()=>{root=create(wrapper(View,{enabled:false},cache));await tick();});assert.equal(calls.length,0);
 await act(async()=>{await state.trigger();await tick();});assert.equal(calls.length,1);assert.equal(state.data.value,'ok');
 await act(async()=>{root.update(wrapper(View,{enabled:true},cache));await tick();});assert.equal(calls.length,2);
 await act(async()=>{root.update(wrapper(View,{enabled:false},cache));await tick();});assert.equal(calls.length,2);
 await act(async()=>{root.update(wrapper(View,{enabled:true},cache));await tick();});assert.equal(calls.length,3);
 await act(async()=>root.unmount());
});

test('empty responses do not duplicate automatic writes after trigger changes the body',async()=>{
 let state;const calls=[];const API=createReactAPI({request:async ctx=>{calls.push(ctx);return {status:204,headers:new Headers(),data:undefined};}});
 function View(){state=API.main.items.empty.useRequest({query:{id:'one'}},{name:'first'});return null;}
 let root;await act(async()=>{root=create(wrapper(View,{}));await tick();});assert.equal(calls.length,1);
 await act(async()=>{await state.trigger({name:'second'});await tick();});assert.equal(calls.length,2);assert.equal(state.isLoading,false);assert.equal(state.isMutating,false);
 await act(async()=>{await state.refresh();await tick();});assert.equal(calls.length,3);
 await act(async()=>root.unmount());
});


test('manual trigger/refresh execute request interceptors and SWR success/error callbacks',async()=>{
 const events=[];let state,fail=false;
 const API=createReactAPI({beforeRequest:[()=>{events.push('before');}],afterResponse:[()=>{events.push('after');}],onError:[()=>{events.push('requestError');}],request:async()=>{events.push('request');if(fail)throw Error('callback failure');return {status:200,headers:new Headers(),data:{value:'ok'}};}});
 function View(){state=API.main.items.get.useRequest({query:{id:'callbacks'}},{enabled:false,swr:{onSuccess:data=>{events.push('success:'+data.value);},onError:error=>{events.push('error:'+error.message);}}});return null;}
 let root;await act(async()=>{root=create(wrapper(View,{}));});
 await act(async()=>{await state.trigger();});assert.deepEqual(events,['before','request','after','success:ok']);
 events.length=0;await act(async()=>{await state.refresh();});assert.deepEqual(events,['before','request','after','success:ok']);
 events.length=0;fail=true;await act(async()=>{await assert.rejects(state.refresh(),/callback failure/);});assert.deepEqual(events,['before','request','requestError','error:callback failure']);
 await act(async()=>root.unmount());
});


test('SWRConfig success callbacks apply to automatic and manual fetching when no local override exists',async()=>{
 let state;const success=[];
 const API=createReactAPI({request:async()=>({status:200,headers:new Headers(),data:{value:'ok'}})});
 function View(){state=API.main.items.get.useRequest({query:{id:'global-callback'}});return null;}
 let root;await act(async()=>{root=create(wrapper(View,{},new Map(),{onSuccess:data=>success.push(data.value)}));await tick();});
 assert.deepEqual(success,['ok']);await act(async()=>{await state.refresh();});assert.deepEqual(success,['ok','ok']);
 await act(async()=>root.unmount());
});
