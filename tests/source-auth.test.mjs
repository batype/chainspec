import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { parseConfig, DEFAULT_CONFIG, parseSourceRequest, sourceRequestOptions, fetchDocument, generateSDK } from '../lib/core/index.js';
const spec = { openapi:'3.0.3', info:{title:'Protected fixture',version:'1'}, paths:{'/ping':{get:{operationId:'ping',responses:{204:{description:'OK'}}}}} };
const basic = {auth:{type:'basic',usernameEnv:'DOC_USER',passwordEnv:'DOC_PASSWORD'}};
const bearer = {auth:{type:'bearer',tokenEnv:'DOC_TOKEN'}};
async function serverFor(handler) {
  const server = createServer(handler); server.listen(0,'127.0.0.1'); await once(server,'listening');
  return {url:`http://127.0.0.1:${server.address().port}`, close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
async function cli(config, cwd) {
  const child=spawn(process.execPath,[resolve('bin/chainspec.mjs'),'--config',config],{cwd,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr=''; child.stdout.on('data',c=>stdout+=c); child.stderr.on('data',c=>stderr+=c);
  const [status]=await once(child,'close'); return {status,stdout,stderr};
}
test('document connection config only stores env references; invalid and conflicting headers fail without exposing values',()=>{
  const config=parseConfig({...DEFAULT_CONFIG,sourceRequest:{...basic,headersEnv:{'X-Tenant':'DOC_TENANT'},credentials:'include'}});
  assert.equal(config.sourceRequest.auth.type,'basic');
  assert.equal(generateSDK(spec,config).operations.length,1);
  for(const sourceRequest of [{auth:{type:'basic',username:'secret',password:'secret'}},{auth:{type:'bearer',tokenEnv:'bad-name'}},{headers:{Authorization:'secret'}},{headersEnv:{'X-Key':'A','x-key':'B'}},{...basic,headersEnv:{Authorization:'AUTH'}},{headersEnv:{'bad header':'NAME'}},{credentials:'same-origin'},[]])
    assert.throws(()=>parseConfig({...DEFAULT_CONFIG,sourceRequest}));
  const values={DOC_USER:'测试',DOC_PASSWORD:'test:password'};
  const options=sourceRequestOptions(basic,values);
  assert.equal(options.headers.get('Authorization'),'Basic '+Buffer.from('测试:test:password').toString('base64'));
  assert.deepEqual(values,{DOC_USER:'测试',DOC_PASSWORD:'test:password'});
  assert.throws(()=>sourceRequestOptions(bearer,{}),/DOC_TOKEN/);
  const unsafe='sensitive-marker\ninvalid';
  assert.throws(()=>sourceRequestOptions(bearer,{DOC_TOKEN:unsafe}),e=>!e.message.includes('sensitive-marker'));
  assert.throws(()=>sourceRequestOptions(basic,{DOC_USER:'bad:user',DOC_PASSWORD:'test'}),/冒号/);
});
test('protected documents support Basic, Bearer, custom headers, HTTP errors, and prevent credentialed redirects',async()=>{
  let redirected=0;
  const target=await serverFor((req,res)=>{redirected++;res.end(JSON.stringify(spec));});
  const source=await serverFor((req,res)=>{
    if(req.url==='/redirect'){res.writeHead(302,{location:target.url});res.end();return;}
    if(req.url==='/forbidden'){res.writeHead(403);res.end('do not include response in errors');return;}
    const valid=req.url==='/basic' ? req.headers.authorization==='Basic '+Buffer.from('user:test-pass').toString('base64')
      :req.url==='/token' ? req.headers.authorization==='Bearer test-token' && req.headers['x-api-key']==='test-key' : false;
    res.writeHead(valid?200:401,{'content-type':'application/json'});res.end(valid?JSON.stringify(spec):'do not include secrets');
  });
  try{
    assert.equal(JSON.parse(await fetchDocument(source.url+'/basic',undefined,sourceRequestOptions(basic,{DOC_USER:'user',DOC_PASSWORD:'test-pass'}))).info.title,spec.info.title);
    assert.equal(JSON.parse(await fetchDocument(source.url+'/token',undefined,sourceRequestOptions({...bearer,headersEnv:{'X-API-Key':'KEY'}},{DOC_TOKEN:'test-token',KEY:'test-key'}))).openapi,'3.0.3');
    await assert.rejects(fetchDocument(source.url+'/basic'),/401.*认证/);
    await assert.rejects(fetchDocument(source.url,undefined,{headers:{Authorization:'sensitive-marker\ninvalid'}}),e=>!e.message.includes('sensitive-marker'));
    await assert.rejects(fetchDocument(source.url+'/forbidden'),/403.*认证/);
    await assert.rejects(fetchDocument(source.url+'/redirect',undefined,sourceRequestOptions(bearer,{DOC_TOKEN:'test-token'})),e=>/重定向/.test(e.message)&&!e.message.includes('test-token'));
    await assert.rejects(fetchDocument(source.url+'/redirect',undefined,{credentials:'include'}),/重定向/);
    assert.equal(redirected,0);
    await fetchDocument(source.url+'/redirect'); assert.equal(redirected,1);
  }finally{await source.close();await target.close();}
});
test('CLI loads .env before authenticated fetch; config and generated SDK exclude resolved credentials',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'chainspec-source-auth-'));
  let calls=0;
  const server=await serverFor((req,res)=>{
    calls++;
    assert.equal(req.headers.authorization,'Bearer fixture-private-token');
    assert.equal(req.headers['x-tenant'],'fixture-tenant');
    res.end(JSON.stringify(spec));
  });
  const configFile=join(folder,'chainspec.config.json');
  try{
    const config={...DEFAULT_CONFIG,input:server.url+'/openapi',output:'./sdk',translateNames:false,sourceRequest:{...bearer,headersEnv:{'X-Tenant':'DOC_TENANT'}}};
    await writeFile(configFile,JSON.stringify(config));
    await writeFile(join(folder,'.env'),'DOC_TOKEN=fixture-private-token\nDOC_TENANT=fixture-tenant\n');
    const result=await cli(configFile,folder); assert.equal(result.status,0,result.stderr);assert.equal(calls,1);
    for(const name of await readdir(join(folder,'sdk'))){
      const text=await readFile(join(folder,'sdk',name),'utf8');assert(!text.includes('fixture-private-token'));assert(!text.includes('fixture-tenant'));
    }
    assert.deepEqual(JSON.parse(await readFile(configFile,'utf8')),config);
    assert(!result.stdout.includes('fixture-private-token'));assert(!result.stderr.includes('fixture-private-token'));
    await rm(join(folder,'.env'));
    config.output='./missing';await writeFile(configFile,JSON.stringify(config));
    const missing=await cli(configFile,folder);assert.equal(missing.status,1);assert.match(missing.stderr,/DOC_TENANT|DOC_TOKEN/);assert.equal(calls,1);
  }finally{await server.close();await rm(folder,{recursive:true,force:true});}
});
