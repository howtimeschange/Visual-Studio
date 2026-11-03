import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory=await mkdtemp(`${tmpdir()}/vs-project-cards-`)
after(()=>rm(directory,{recursive:true,force:true}))
await build({stdin:{contents:`export * from './functions/_lib/v2-store.ts'; export { createLoginResponse } from './functions/_lib/auth.ts'; export { onRequestGet as list } from './functions/api/canvas/projects.ts'; export { onRequestGet as shared } from './functions/api/canvas/projects/shared.ts'`,resolveDir:process.cwd(),loader:'js'},bundle:true,platform:'node',format:'esm',outfile:`${directory}/api.mjs`,logLevel:'silent'})
const api=await import(pathToFileURL(`${directory}/api.mjs`))

test('D1 project summaries use one query, preserve owner/member access and omit conversation bodies',async()=>{
  const db=new DatabaseSync(':memory:')
  try {
    for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()) db.exec(await readFile(`migrations/${file}`,'utf8'))
    const now=new Date().toISOString()
    db.prepare('INSERT INTO sessions(id,created_at,last_active_at) VALUES(?,?,?)').run('s',now,now)
    for(const id of ['a','b']) db.prepare('INSERT INTO users(id,email,name,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,`${id}@example.com`,id,'','',now,now)
    for(const [id,owner] of [['own','a'],['foreign','b'],['shared','b']]) db.prepare('INSERT INTO canvas_projects(id,session_id,owner_user_id,title,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,'s',owner,id,JSON.stringify({aiMessages:['x'.repeat(100000)]}),now,now)
    db.prepare('INSERT INTO project_members(project_id,user_id,role,created_at,updated_at) VALUES(?,?,?,?,?)').run('shared','a','viewer',now,now)
    for(const [id,type,z,data] of [['wire','connector',0,{}],['pic','image',1,{assetId:'asset1',content:'do not ship original bytes'}],['text','text',2,{content:'text'}]]) db.prepare('INSERT INTO canvas_project_elements(id,project_id,element_type,z_index,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,'own',type,z,JSON.stringify(data),now,now)
    let reads=0
    const env={VS_DB:{prepare(sql){reads++;const stmt=db.prepare(sql);return{bind(...args){return{all:async()=>({results:stmt.all(...args)})}}}}}}
    const cards=await api.listCanvasProjectCardsForUser(env,'a')
    assert.equal(reads,1);assert.deepEqual(cards.map(c=>c.id).sort(),['own','shared'])
    assert.equal(cards.find(c=>c.id==='shared').accessRole,'viewer')
    assert.equal(cards.find(c=>c.id==='own').elementCount,2)
    assert.equal(cards.find(c=>c.id==='own').previewUrl,'/api/results/asset1?projectId=own')
    assert.ok(cards.every(c=>!Object.hasOwn(c,'metadataJson')))
    assert.ok(JSON.stringify(cards).length<1000)
    assert.deepEqual(await api.listCanvasProjectCardsForUser(env,''),[])
  } finally {db.close()}
})

test('summary routes retain auth, sharing, legacy inline previews and counts without N+1 client reads',async()=>{
  const env={}
  const owner=await api.createUser(env,{email:'cards-owner@example.com',passwordHash:'',passwordSalt:''})
  const other=await api.createUser(env,{email:'cards-viewer@example.com',passwordHash:'',passwordSalt:''})
  const session=await api.ensureSession(env,undefined,owner.id)
  const p=await api.createCanvasProject(env,{sessionId:session.id,ownerUserId:owner.id,title:'Preview',metadataJson:{privatePrompt:'not needed in cards'}})
  await api.replaceCanvasProjectElements(env,p.id,[{id:'pic',type:'image',content:'data:image/png;base64,fixture'},{id:'wire',type:'connector'}])
  const cookie=async user=>(await api.createLoginResponse(env,user,new Request('http://localhost'))).setCookie.split(';')[0]
  const request=async(user,summary=true)=>new Request(`http://localhost/api/canvas/projects${summary?'?summary=1':''}`,{headers:{Cookie:user?await cookie(user):''}})
  assert.equal((await api.list({env,request:await request(null)})).status,401)
  assert.deepEqual((await(await api.list({env,request:await request(other)})).json()).projects,[])
  await api.upsertProjectMember(env,{projectId:p.id,userId:other.id,role:'viewer',invitedBy:owner.id})
  const res=await api.shared({env,request:await request(other)})
  const [card]=(await res.json()).projects
  assert.equal(card.elementCount,1);assert.equal(card.previewUrl,'data:image/png;base64,fixture')
  assert.equal(card.accessRole,'viewer');assert.equal(Object.hasOwn(card,'metadataJson'),false)
  assert.equal(res.headers.get('Cache-Control'),'no-store')
  const legacy=(await(await api.list({env,request:await request(owner,false)})).json()).projects[0]
  assert.equal(legacy.metadataJson.privatePrompt,'not needed in cards')
})

test('admin overview starts independent aggregate reads together and retains the response shape',async()=>{
  const releases=[]
  const env={VS_DB:{prepare(sql){const statement={bind(){return statement},first(){return new Promise(resolve=>releases.push(()=>resolve({total:3})))},all(){return new Promise(resolve=>releases.push(()=>resolve({results:[{status:'completed',total:2}]})))}};return statement}}}
  const pending=api.getAdminOverview(env)
  assert.equal(releases.length,8)
  releases.forEach(resolve=>resolve())
  const overview=await pending
  assert.equal(overview.users.total,3)
  assert.equal(overview.jobs.total,3)
  assert.equal(overview.jobs.byStatus.completed,2)
})
