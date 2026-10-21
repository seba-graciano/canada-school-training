import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { syncLegacy } from './sync-legacy.mjs'

test('legacy synchronization updates maintained sources, keeps environment and history, and reports drift', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'canada-legacy-sync-'))
  const source=path.join(root,'main'),target=path.join(root,'2','canada-school-training-develop')
  await mkdir(path.join(source,'app','src'),{recursive:true})
  await mkdir(path.join(source,'scripts'),{recursive:true})
  await mkdir(path.join(source,'supabase','migrations'),{recursive:true})
  await mkdir(path.join(target,'app'),{recursive:true})
  await mkdir(path.join(target,'supabase','migrations'),{recursive:true})
  await writeFile(path.join(source,'app','src','App.tsx'),'export default function App(){return null}\n')
  await writeFile(path.join(source,'scripts','test.mjs'),"console.log('Usage: test runner')\n")
  await writeFile(path.join(source,'app','.env'),'do-not-copy')
  await writeFile(path.join(target,'app','.env'),'keep-local')
  await writeFile(path.join(source,'supabase','migrations','0001_schema.sql'),'select 1;\n')
  await writeFile(path.join(target,'supabase','migrations','0001_schema.sql'),'select 1;\r\n')
  await writeFile(path.join(source,'supabase','migrations','20261020205312_audit.sql'),'revoke all on function demo() from public;\n')
  const before=await syncLegacy(source,target,{check:true})
  assert.ok(before.length>0)
  await syncLegacy(source,target)
  assert.deepEqual(await syncLegacy(source,target,{check:true}),[])
  assert.equal(await readFile(path.join(target,'scripts','test.mjs'),'utf8'),"console.log('Usage: test runner')\n")
  assert.equal(await readFile(path.join(target,'app','.env'),'utf8'),'keep-local')
  assert.equal(await readFile(path.join(target,'supabase','migrations','0001_schema.sql'),'utf8'),'select 1;\r\n')
  assert.match(await readFile(path.join(target,'supabase','migrations','20261020205312_audit.sql'),'utf8'),/revoke all/)
  assert.match(await readFile(path.join(root,'2','AdminDashboard.tsx'),'utf8'),/export \{ default \}/)
})

test('synchronization fails closed if an applied migration differs semantically', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'canada-legacy-history-'))
  const source=path.join(root,'main'),target=path.join(root,'legacy')
  for(const dir of [source,target]) await mkdir(path.join(dir,'supabase','migrations'),{recursive:true})
  await writeFile(path.join(source,'supabase','migrations','0001_schema.sql'),'select 1;')
  await writeFile(path.join(target,'supabase','migrations','0001_schema.sql'),'drop table students;')
  await assert.rejects(syncLegacy(source,target),/migration.*differs/i)
  assert.equal(await readFile(path.join(target,'supabase','migrations','0001_schema.sql'),'utf8'),'drop table students;')
})
