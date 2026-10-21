import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root=fileURLToPath(new URL('../',import.meta.url))
async function tests(relative,pattern) {
  const result=[]
  for(const item of await readdir(path.join(root,relative),{withFileTypes:true})) {
    if(item.name==='node_modules') continue
    const file=path.join(relative,item.name)
    if(item.isDirectory()) result.push(...await tests(file,pattern))
    else if(pattern.test(item.name)) result.push(path.join(root,file))
  }
  return result
}
const args=process.argv.slice(2)
if(args.includes('--help')) {
  console.log('Usage: node scripts/test.mjs [--unit | --db | --ui]\nNo flag runs all groups. Node24 required. DB: PGLITE_MODULE; UI: PLAYWRIGHT_MODULE and installed Chrome. All service calls are mocked or in-memory.')
} else if(args.length>1 || args.some(arg=>!['--unit','--db','--ui'].includes(arg))) {
  console.error('Unknown test group. Use --help.'); process.exitCode=2
} else {
  const groups=args.length ? [args[0].slice(2)] : ['unit','db','ui']
  for(const group of groups) {
    if(group==='db' && !process.env.PGLITE_MODULE) {
      console.error('PGLITE_MODULE must name a locally installed PGlite module. No dependency is downloaded.'); process.exitCode=1; continue
    }
    const files=group==='unit'
      ? [...await tests('app/src',/\.test\.mjs$/),...await tests('supabase/functions',/\.test\.ts$/),...await tests('scripts',/\.test\.mjs$/)]
      : await tests(group==='db'?'supabase/tests':'app/tests',/\.test\.mjs$/)
    console.log(`Running ${group}: ${files.length} test files`)
    const result=spawnSync(process.execPath,['--test',...files],{
      cwd:group==='ui'?path.join(root,'app'):root,env:process.env,stdio:'inherit',windowsHide:true,
    })
    if(result.error) console.error(result.error.message)
    if(result.error || result.status!==0) process.exitCode=1
  }
}
