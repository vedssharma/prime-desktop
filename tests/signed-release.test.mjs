import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySignedApp } from '../scripts/verify-signed-release.mjs';
const identity='Authority=Developer ID Application: Example (ABC123)\nTeamIdentifier=ABC123\nCodeDirectory flags=0x10000(runtime)\n';
test('signed release requires all native checks including a stapled ticket',()=>{
 const calls=[];
 const checks=verifySignedApp('/app','darwin',(cmd,args)=>{calls.push([cmd,args]);return {status:0,stdout:cmd==='codesign'&&args[0]==='--display'?identity:''};});
 assert.equal(checks.stapled,true);assert.deepEqual(calls.map(call=>call[0]),['codesign','codesign','spctl','xcrun']);
 for(const fail of ['codesign','spctl','xcrun']) assert.throws(()=>verifySignedApp('/app','darwin',(cmd)=>({status:cmd===fail?1:0,stdout:identity})),/refusing/);
});
test('ad-hoc signing, missing runtime or team, and non-macOS hosts fail closed',()=>{
 for(const details of ['',identity.replace('runtime','adhoc'),identity.replace('TeamIdentifier=ABC123','TeamIdentifier=not set'),identity.replace('Developer ID Application','Apple Development')]) assert.throws(()=>verifySignedApp('/app','darwin',()=>({status:0,stdout:details})),/Developer ID/);
 assert.throws(()=>verifySignedApp('/app','linux'),/macOS/);
});
