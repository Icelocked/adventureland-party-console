import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';

const root='/opt/party-seed',out='/tmp/dependency-update-evidence';
await mkdir(out,{recursive:true});
process.chdir(root);
const {buildCandidate}=await import(root+'/tools/console-build/builder.ts');
const {ConsoleBuildStore}=await import(root+'/tools/console-build/store.ts');
const store=new ConsoleBuildStore(root),hash=value=>createHash('sha256').update(value).digest('hex');
async function links(directory,relative=''){
  const result=[];
  for(const entry of await readdir(path.join(directory,relative),{withFileTypes:true})){
    const name=relative?relative+'/'+entry.name:entry.name;
    if(entry.isSymbolicLink())result.push(name);
    else if(entry.isDirectory())result.push(...await links(directory,name));
  }
  return result;
}
async function record(name,value){await writeFile(path.join(out,name+'.json'),JSON.stringify(value,null,2));}
if(process.argv[2]==='legacy'){
  for(const relative of ['', 'dashboard','.caracal'])await rm(path.join(root,relative,'node_modules/.package-lock.json'),{force:true});
  const errors=[];
  for(let attempt=0;attempt<2;attempt++){
    await assert.rejects(buildCandidate(root,store),error=>{
      errors.push(String(error));return /Artifact refuses links: .*node_modules\/\.bin\//.test(String(error));
    });
  }
  const ids=await readdir(path.join(store.directory,'dependencies'));
  assert.equal(ids.length,1);
  const id=ids[0],directory=path.join(store.directory,'dependencies',id);
  const linkNames=await links(directory);assert.ok(linkNames.length>0);
  const complete=await readFile(path.join(directory,'complete.json'));
  await record('legacy',{id,errors,links:linkNames,completeHash:hash(complete)});
}else{
  const legacy=JSON.parse(await readFile(path.join(out,'legacy.json'),'utf8'));
  const first=await buildCandidate(root,store);await store.verify(first.manifest.id);
  assert.notEqual(first.manifest.dependencyId,legacy.id);
  assert.deepEqual(await links(path.join(store.directory,'dependencies',first.manifest.dependencyId)),[]);
  assert.equal(hash(await readFile(path.join(store.directory,'dependencies',legacy.id,'complete.json'))),legacy.completeHash);
  const {ImmutableDashboard}=await import(root+'/tools/console-build/dashboard.ts');
  const {ConsoleBuildController}=await import(root+'/tools/console-build/controller.ts');
  const {createDeploymentDriver}=await import(root+'/tools/console-build/driver.ts');
  const {consoleBuildRoutes}=await import(root+'/tools/console-build/routes.ts');
  const dashboard=new ImmutableDashboard();await dashboard.listen(3030);
  const unexpected=async()=>{throw Error('Dashboard-only update attempted game lifecycle change');};
  const driver=createDeploymentDriver({stopCoordinator:unexpected,startCoordinator:unexpected,reloadCharacters:unexpected,
    activateDashboard:async(directory,signal)=>dashboard.activate(await store.verify(path.basename(path.dirname(directory))),signal),
    observe:async()=>({dashboardHash:dashboard.currentHash,characters:{}})});
  const controller=new ConsoleBuildController(store,driver),routes=consoleBuildRoutes(controller);
  const server=createServer((req,res)=>void routes.route(req,res,new URL(req.url,'http://localhost').pathname));
  await new Promise(resolve=>server.listen(3031,'127.0.0.1',resolve));
  try{
    await dashboard.activate(first,AbortSignal.timeout(120000));
    await store.setReferences({...await store.references(),active:first.manifest.id});
    const page=async()=>{const response=await fetch('http://127.0.0.1:3030/');assert.equal(response.status,200);return response.text();};
    const before=await page();assert.ok(before.includes('Party Console'));
    await writeFile(path.join(out,'before.html'),before);
    const header=path.join(root,'dashboard/features/party/party-header.tsx');
    const source=await readFile(header,'utf8');assert.ok(source.includes('>Party Console</h1>'));
    await writeFile(header,source.replace('>Party Console</h1>','>Party Console Docker Update</h1>'));
    const next=await buildCandidate(root,store);await store.verify(next.manifest.id);
    assert.equal(next.manifest.dependencyId,first.manifest.dependencyId);
    assert.equal(next.manifest.components.coordinator,first.manifest.components.coordinator);
    assert.equal(next.manifest.components.characters,first.manifest.components.characters);
    assert.notEqual(next.manifest.components.dashboard,first.manifest.components.dashboard);
    assert.equal((await store.references()).active,first.manifest.id);
    assert.equal(dashboard.currentHash,first.manifest.components.dashboard);
    assert.ok(!(await page()).includes('Party Console Docker Update'));
    const response=await fetch('http://127.0.0.1:3031/console-build/deploy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({buildId:next.manifest.id,mode:'now'})});
    assert.equal(response.status,202);
    const deadline=Date.now()+120000;
    while((await store.journal())?.phase!=='complete'){
      assert.ok(Date.now()<deadline,'Deployment deadline');assert.notEqual((await store.journal())?.phase,'failed');
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    assert.equal((await store.references()).active,next.manifest.id);
    assert.equal(dashboard.currentHash,next.manifest.components.dashboard);
    const after=await page();assert.ok(after.includes('Party Console Docker Update'));
    await writeFile(path.join(out,'after.html'),after);
    await record('update',{first:first.manifest,next:next.manifest,journal:await store.journal(),references:await store.references(),legacyRetained:true});
    // Arbitrary links remain prohibited, including after successful migration.
    const {symlink}=await import('node:fs/promises');
    const escape=path.join(first.directory,'unexpected-link');await symlink('/etc/passwd',escape);
    await assert.rejects(store.verify(first.manifest.id),/Candidate refuses links/);await rm(escape);
    await record('security',{unexpectedLinkRejected:true,newCacheLinks:[]});
  }finally{await dashboard.stop();await new Promise(resolve=>server.close(resolve));}
}
console.log('Dependency update phase passed:',process.argv[2]);
