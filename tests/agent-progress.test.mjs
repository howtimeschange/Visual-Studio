import test from 'node:test'
import assert from 'node:assert/strict'
import {agentRunProgress} from '../public/js/agent-progress.js'
import {gptImageRequestSize,imageOptionError} from '../public/js/image-model-constraints.js'
import {assessImageDelivery} from '../public/js/image-delivery.js'
import {serializeDesignAgentRun} from '../public/js/design-agent-harness.js'

test('progress distinguishes pre-submit upload, server planning, generation and available results',()=>{
 const run={phase:'preparing',startedAt:1000,clientStage:'uploading',clientStageAt:2000,tasks:[]}
 assert.equal(agentRunProgress(run,'上传参考图 1/3',7000).elapsed,5)
 assert.equal(agentRunProgress(run,'上传参考图 1/3',7000).label,'上传参考图 1/3')
 delete run.clientStage;delete run.clientStageAt;run.phase='planning';run.events=[{type:'phase',label:'理解与规划',at:2000}]
 assert.equal(agentRunProgress(run,'',34000).stage,'planning');assert.match(agentRunProgress(run,'',34000).hint,/请勿重复提交/)
 run.phase='executing';run.tasks=[{status:'accepted'}];run.events=[{type:'task_accepted',at:3000}]
 assert.equal(agentRunProgress(run,'',5000).stage,'generating')
 run.tasks[0].assetId='ready';run.events=[{type:'progress',label:'正在检查画面',at:4000}]
 assert.equal(agentRunProgress(run,'',5000).stage,'review');assert.match(agentRunProgress(run,'',5000).hint,/现在就可以查看和下载/)
})
test('GPT custom sizes obey all pixel bounds, and 4K square is shown at its actual request size',()=>{
 assert.equal(gptImageRequestSize('16:9','4k'),'3840x2160')
 assert.equal(gptImageRequestSize('9:16','4k'),'2160x3840')
 assert.equal(gptImageRequestSize('1:1','4k'),'2880x2880')
 assert.equal(gptImageRequestSize('4:3','2k'),'2048x1536')
 assert.equal(gptImageRequestSize('1:4','4k'),'')
 for(const resolution of ['1k','2k','4k'])for(const ratio of ['1:1','3:2','2:3','4:3','3:4','16:9','9:16']){
  const [w,h]=gptImageRequestSize(ratio,resolution).split('x').map(Number)
  assert.ok(w%16===0&&h%16===0&&Math.max(w,h)<=3840&&w*h<=8294400&&w*h>=655360)
  assert.equal(imageOptionError('modeljetty','gpt-image-2.5-flare',ratio,resolution),'')
 }
 assert.match(imageOptionError('modeljetty','gpt-image-2.5-flare','1:4','4k'),/3:1/)
})
test('delivery compares native GPT limits with actual pixels without misreporting 3840px as a failed 4096px request',()=>{
 assert.equal(assessImageDelivery({modelId:'gpt-image-2.5-sunburst',width:3840,height:2160,aspectRatio:'16:9',resolution:'4k'}).status,'passed')
 assert.equal(assessImageDelivery({modelId:'gpt-image-2.5-sunburst',width:1672,height:941,aspectRatio:'16:9',resolution:'4k'}).status,'mismatch')
})
test('refresh during pre-submit preparation never claims a durable background run was accepted',()=>{
 const run={id:'r',projectId:'p',conversationId:'c',execution:'server',phase:'preparing',clientStage:'uploading',tasks:[]}
 const stored=serializeDesignAgentRun(run)
 assert.equal(serializeDesignAgentRun(stored,{restore:true}).phase,'interrupted')
 assert.equal(serializeDesignAgentRun({...run,clientStage:'submitting'},{restore:true}).phase,'awaiting_result')
})

test('upstream quality downgrade and absent model identity survive safe run serialization',()=>{
 const delivery=assessImageDelivery({modelId:'gpt-image-2.5-flare',size:'3840x2160',width:1672,height:941,
  providerDelivery:{requested:{model:'gpt-image-2.5-flare',quality:'high'},upstream:{quality:'low'},secret:'never-store'}})
 assert.equal(delivery.status,'mismatch')
 assert.ok(delivery.issues.some(v=>v.includes('low')&&v.includes('high')))
 assert.ok(delivery.issues.some(v=>v.includes('型号待核实')))
 const stored=serializeDesignAgentRun({id:'run',projectId:'p',conversationId:'c',phase:'completed',tasks:[{status:'completed',delivery,generationQuality:'high',quality:{status:'passed'}}]})
 assert.equal(stored.tasks[0].delivery.provider.reportedQuality,'low')
 assert.equal(stored.tasks[0].generationQuality,'high')
 assert.equal(stored.tasks[0].quality.status,'passed')
 assert.equal(JSON.stringify(stored).includes('never-store'),false)
})
