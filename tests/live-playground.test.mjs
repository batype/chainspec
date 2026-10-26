import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {generateSDK} from '../lib/core/index.js';
const root=await mkdtemp(join(process.cwd(),'.verify-live-'));
after(()=>rm(root,{recursive:true,force:true}));
const compile=spawnSync(resolve('node_modules/.bin/tsc'),['--ignoreConfig','--strict','--skipLibCheck','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--jsx','react-jsx','--outDir',root,'src/components/Playground.tsx'],{encoding:'utf8'});
assert.equal(compile.status,0,compile.stdout+compile.stderr);
async function extensions(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await extensions(p);else if(p.endsWith('.js'))await writeFile(p,(await readFile(p,'utf8')).replace(/from (["'])(\.[^"']+)\1/g,(all,q,v)=>v.endsWith('.js')?all:`from ${q}${v}.js${q}`));}}
await extensions(root);
const {default:Playground}=await import(pathToFileURL(join(root,'src/components/Playground.js')));
const {liveConnection,validateConnection,connectionHeaders,createLiveFetch}=await import(pathToFileURL(join(root,'src/playground-live.js')));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const tick=(ms=40)=>new Promise(r=>setTimeout(r,ms));
const requests=[];
const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push({url:req.url,method:req.method,headers:req.headers,body:raw?JSON.parse(raw):undefined});res.writeHead(req.url.includes('failure')?401:200,{'Content-Type':'application/json','X-Fixture':'real'});res.end(JSON.stringify(req.url.includes('failure')?{message:'unauthorized fixture'}:{from:'HTTP server',value:requests.at(-1).body}));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
after(()=>{server.closeAllConnections();server.close();});
const baseUrl=`http://127.0.0.1:${server.address().port}`;
const document={openapi:'3.0.3',info:{title:'Live fixture',version:'1'},servers:[{url:baseUrl}],paths:{}};
document.paths['/echo/{id}']={post:{
 operationId:'send',parameters:[{in:'path',name:'id',required:true,schema:{type:'string'}},{in:'query',name:'page',schema:{type:'integer'}}],
 requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties:{name:{type:'string'}}}}}},
 responses:{200:{description:'ok',content:{'application/json':{schema:{type:'object',properties:{from:{type:'string'}}}}}}}
}};
const project=generateSDK(document,{target:'react'}),op=project.operations[0];
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):n?.children?text(n.children):'';
const button=(view,label)=>view.root.findAllByType('button').find(n=>text(n.props.children)===label);
const props={project,op,document,hooks:true,demo:false,connection:liveConnection(baseUrl),onConnection:()=>{}};

test('imported document is live but never sends on mount or Hook selection; request/trigger/refresh use real HTTP and actual arguments',async()=>{
 requests.length=0;let view;const connection={...props.connection,auth:'bearer',token:'synthetic-test-token'};
 await act(async()=>{view=create(React.createElement(Playground,{...props,connection}));await tick();});assert.equal(requests.length,0);
 await act(async()=>{view.root.findByProps({id:'play-params'}).props.onChange({target:{value:'{"path":{"id":"42"},"query":{"page":3}}'}});view.root.findByProps({id:'play-body'}).props.onChange({target:{value:'{"name":"fixture"}'}});view.root.findByProps({id:'play-headers'}).props.onChange({target:{value:'{"X-Client":"test"}'}});});
 await act(async()=>button(view,'应用参数').props.onClick());
 await act(async()=>{button(view,'▶ 运行 request').props.onClick();await tick(100);});
 assert.equal(requests.length,1);assert.equal(requests[0].url,'/echo/42?page=3');assert.equal(requests[0].method,'POST');assert.deepEqual(requests[0].body,{name:'fixture'});assert.equal(requests[0].headers.authorization,'Bearer synthetic-test-token');assert.equal(requests[0].headers['x-client'],'test');assert.match(JSON.stringify(view.toJSON()),/HTTP server/);
 await act(async()=>{button(view,'React · useRequest').props.onClick();await tick();});assert.equal(requests.length,1);
 await act(async()=>{button(view,'trigger()').props.onClick();await tick(100);});assert.equal(requests.length,2);
 await act(async()=>{button(view,'↻ refresh()').props.onClick();await tick(100);});assert.equal(requests.length,3);
 await act(async()=>{view.root.findAllByType('input').find(n=>n.props.type==='checkbox'&&n.parent.type==='label'&&text(n.parent.props.children).includes('自动请求')).props.onChange({target:{checked:true}});});await act(async()=>{await tick(100);});assert.equal(requests.length,4);
 await act(async()=>view.unmount());
});

test('built-in demo retains network-free simulation and mode switch removes mock data',async()=>{
 requests.length=0;let view;await act(async()=>{view=create(React.createElement(Playground,{...props,demo:true}));});
 await act(async()=>{button(view,'▶ 运行 request').props.onClick();await tick(400);});assert.equal(requests.length,0);assert.match(JSON.stringify(view.toJSON()),/本地模拟响应/);
 await act(async()=>button(view,'真实请求').props.onClick());assert.doesNotMatch(JSON.stringify(view.toJSON()),/本地模拟响应/);assert.equal(requests.length,0);
 await act(async()=>view.unmount());
});

test('real HTTP failures expose status and server response, no simulated success fallback',async()=>{
 let view;await act(async()=>{view=create(React.createElement(Playground,props));});
 await act(async()=>view.root.findByProps({id:'play-params'}).props.onChange({target:{value:'{"path":{"id":"failure"}}'}}));await act(async()=>button(view,'应用参数').props.onClick());
 await act(async()=>{button(view,'▶ 运行 request').props.onClick();await tick(100);});const json=JSON.stringify(view.toJSON());assert.match(json,/HTTP 401/);assert.match(json,/unauthorized fixture/);assert.doesNotMatch(json,/本地模拟响应/);await act(async()=>view.unmount());
});

test('live transport validates destination/auth, forwards credentials deliberately, bounds responses and supports abort/timeout',async()=>{
 for(const baseUrl of ['/api','file:///tmp/test','https://user:pass@example.com','https://example.com?token=x','https://{host}.com'])assert.throws(()=>validateConnection(liveConnection(baseUrl)));
 assert.throws(()=>validateConnection({...liveConnection(baseUrl),auth:'bearer'}));
 assert.equal(connectionHeaders({...liveConnection(baseUrl),auth:'basic',username:'测试',password:'demo'}).Authorization,'Basic '+Buffer.from('测试:demo').toString('base64'));
 let info,init;const controllers=new Set();const transport=createLiveFetch({...liveConnection(baseUrl),credentials:true},controllers,value=>info=value,async(_input,options)=>{init=options;return new Response('{"ok":true}',{status:200,headers:{'Content-Type':'application/json'}});});
 const response=await transport(baseUrl,{method:'POST',body:'{}'});assert.equal(init.credentials,'include');assert.equal(init.redirect,'error');assert.deepEqual(await response.json(),{ok:true});assert.equal(info.status,200);assert.equal(controllers.size,0);
 const tooLarge=createLiveFetch(liveConnection(baseUrl),controllers,()=>{},async()=>new Response('12345'),{bytes:4,timeout:100});await assert.rejects(tooLarge(baseUrl),/8 MiB/);assert.equal(controllers.size,0);
 const aborting=createLiveFetch(liveConnection(baseUrl),controllers,()=>{},async(_input,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason))),{bytes:4,timeout:1000});const pending=aborting(baseUrl);controllers.forEach(c=>c.abort());await assert.rejects(pending,{name:'AbortError'});assert.equal(controllers.size,0);
 const timeout=createLiveFetch(liveConnection(baseUrl),controllers,()=>{},async(_input,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason))),{bytes:4,timeout:10});await assert.rejects(timeout(baseUrl),{name:'TimeoutError'});
});
