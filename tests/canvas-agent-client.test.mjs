import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvasAgentWatcher, mergeAgentRunMessages } from '../public/js/canvas-agent-client.js'
import { serializeDesignAgentRun } from '../public/js/design-agent-harness.js'
import { assessImageDelivery } from '../public/js/image-delivery.js'
import { canvasDraftKey } from '../public/js/canvas-drafts.js'

test('server run restoration keeps an active job and repeated snapshots do not duplicate messages', () => {
  const run={id:'r',projectId:'p',conversationId:'c',execution:'server',jobId:'job-r',phase:'planning',context:{},tasks:[],events:[]}
  const restored=serializeDesignAgentRun(run,{restore:true})
  assert.equal(restored.phase,'planning')
  assert.equal(restored.jobId,'job-r')
  const snapshot={run,userMessage:'画两个茶壶'}
  let messages=mergeAgentRunMessages([],snapshot)
  messages=mergeAgentRunMessages(messages,snapshot)
  assert.equal(messages.length,2)
  snapshot.run={...run,phase:'completed',tasks:[{id:'i',status:'completed',assetId:'image1',title:'作品'}]}
  messages=mergeAgentRunMessages(messages,snapshot)
  assert.equal(messages.length,2)
  assert.equal(messages[1].loading,false)
  assert.match(messages[1].images[0].dataUrl,/^\/api\/results\/image1\?projectId=p$/)
  assert.match(messages[1].content,/1\/1/)
})

test('changing account scope discards the old read without replaying submissions', async () => {
  let resolveOld, resolveNew
  const old=new Promise(resolve=>{resolveOld=resolve}), done=new Promise(resolve=>{resolveNew=resolve})
  const seen=[], calls=[]
  const watcher=createCanvasAgentWatcher({getJson:async url=>{calls.push(url);return url.includes('old')?old:{runs:[]}}, onSnapshot:value=>{seen.push(value);resolveNew()},interval:100000})
  watcher.start('old','account-a')
  watcher.start('new','account-b')
  resolveOld({runs:[]})
  await done
  watcher.stop()
  assert.deepEqual(seen.map(v=>v.ownerId),['account-b'])
  assert.equal(calls.length,2)
})

test('draft scope and delivery checks distinguish accounts, real pixels and requested ratio', () => {
  assert.notEqual(canvasDraftKey('a','p'),canvasDraftKey('b','p'))
  assert.notEqual(canvasDraftKey('a','p'),canvasDraftKey('a','q'))
  assert.equal(canvasDraftKey('','p'),'')
  assert.equal(assessImageDelivery({width:512,height:512,resolution:'1k',aspectRatio:'1:1'}).status,'mismatch')
  assert.equal(assessImageDelivery({width:1254,height:1254,resolution:'1k',aspectRatio:'1:1'}).status,'passed')
  assert.equal(assessImageDelivery({width:2048,height:1024,resolution:'2k',aspectRatio:'auto'}).status,'passed')
  assert.equal(assessImageDelivery({width:0,height:0,resolution:'1k'}).status,'unknown')
})
