import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const maintainedDirectories = ['app/src','app/public','app/tests','supabase/migrations',
  'supabase/functions','supabase/tests','supabase/patches','docs']
const maintainedFiles = ['README.md','SETUP.md','package-lock.json','supabase/seed.sql','scripts/test.mjs',
  'app/package.json','app/package-lock.json','app/index.html','app/env.example',
  'app/vite.config.ts','app/tsconfig.json','app/tsconfig.app.json','app/tsconfig.node.json',
  'app/tailwind.config.js','app/postcss.config.js','app/.oxlintrc.json','app/README.md','app/ARQUITECTURA.md']
const ignored = new Set(['node_modules','.git','.temp','dist','build'])

async function exists(filename) {
  try { return await lstat(filename) } catch(error) { if(error.code==='ENOENT') return null; throw error }
}

async function files(directory,prefix='') {
  const result=[]
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    if(ignored.has(entry.name) || entry.name.startsWith('.env')) continue
    if(entry.isSymbolicLink()) throw new Error(`Refusing source symlink: ${entry.name}`)
    const relative=path.join(prefix,entry.name)
    if(entry.isDirectory()) result.push(...await files(path.join(directory,entry.name),relative))
    else if(entry.isFile()) result.push(relative)
  }
  return result
}

async function safeParents(filename) {
  let current=path.dirname(filename)
  while(current!==path.dirname(current)) {
    const info=await exists(current)
    if(info?.isSymbolicLink() || (info && !info.isDirectory())) throw new Error(`Unsafe destination: ${current}`)
    current=path.dirname(current)
  }
  if((await exists(filename))?.isSymbolicLink()) throw new Error(`Refusing destination symlink: ${filename}`)
}

/** Synchronize the maintained tree; never copy local secrets, dependencies or Git state. */
export async function syncLegacy(sourceRoot,targetRoot,{check=false}={}) {
  sourceRoot=path.resolve(sourceRoot)
  targetRoot=path.resolve(targetRoot)
  if(sourceRoot===targetRoot || targetRoot.startsWith(sourceRoot+path.sep)
    || sourceRoot.startsWith(targetRoot+path.sep)) throw new Error('Source and legacy trees must be separate')
  const sources=[]
  for(const relative of maintainedDirectories) {
    const directory=path.join(sourceRoot,relative)
    const info=await exists(directory)
    if(info?.isSymbolicLink()) throw new Error(`Refusing source symlink: ${directory}`)
    if(info) sources.push(...(await files(directory)).map(file=>path.join(relative,file)))
  }
  for(const relative of maintainedFiles) if(await exists(path.join(sourceRoot,relative))) sources.push(relative)
  const actions=[]
  for(const relative of sources) {
    const from=path.join(sourceRoot,relative),to=path.join(targetRoot,relative)
    await safeParents(to)
    if((await lstat(from)).isSymbolicLink()) throw new Error(`Refusing source symlink: ${from}`)
    const original=await readFile(from)
    const previous=await exists(to) ? await readFile(to) : null
    if(previous && original.equals(previous)) continue
    if(previous && relative.startsWith(path.join('supabase','migrations')+path.sep)) {
      if(original.toString().replace(/\r\n/g,'\n')===previous.toString().replace(/\r\n/g,'\n')) continue
      throw new Error(`Applied migration differs: ${relative}`)
    }
    actions.push({from,to})
  }
  const outer=path.dirname(targetRoot)
  const extras=[
    ['AdminDashboard.tsx',`// Compatibility entrypoint: use the maintained, tested implementation.\nexport { default } from './${path.basename(targetRoot)}/app/src/AdminDashboard'\n`],
    ['0003_aumento_cuotas_en_lote.sql',`-- Apply the complete maintained migration chain before this compatibility alias.\ndo $$ begin\n  if to_regprocedure('public.cobrar_cuota_confirmada(integer,integer)') is null then\n    raise exception 'Apply the maintained audit migrations first';\n  end if;\nend $$;\ncreate or replace function public.aumentar_cuotas_impagas() returns integer\nlanguage sql security invoker set search_path='' as $$\n  select public.aumentar_cuotas_pendientes_15();\n$$;\nrevoke all on function public.aumentar_cuotas_impagas() from public,anon;\ngrant execute on function public.aumentar_cuotas_impagas() to authenticated;\n`],
    ['SETUP.md',`# Maintained training copy\n\nFollow [the complete setup](${path.basename(targetRoot)}/SETUP.md). The loose dashboard delegates to the maintained copy; loose SQL is only a compatibility alias after all migrations.\n\nThe ZIP is an immutable historical training reference and contains known vulnerabilities. Do not deploy it. Use the extracted, synchronized source instead.\n\nRun the main repository's \`node scripts/sync-legacy.mjs --check\` to detect drift. Local environment files remain untouched.\n`],
  ]
  for(const [name,content] of extras) {
    const to=path.join(outer,name)
    await safeParents(to)
    if(!(await exists(to)) || await readFile(to,'utf8')!==content) actions.push({to,content})
  }
  // Build the entire plan before writing, so divergent historical SQL fails closed.
  if(!check) for(const action of actions) {
    await mkdir(path.dirname(action.to),{recursive:true})
    if(action.from) await copyFile(action.from,action.to)
    else await writeFile(action.to,action.content,'utf8')
  }
  return actions.map(action=>action.to)
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2)
  if(args.includes('--help')) console.log('Usage: node scripts/sync-legacy.mjs [--check]\nSynchronize the local training copy; --check reports drift without writes.')
  else if(args.some(arg=>arg!=='--check')) { console.error('Unknown option. Use --help.'); process.exitCode=2 }
  else {
    const source=fileURLToPath(new URL('../',import.meta.url))
    const target=path.resolve(source,'..','2','canada-school-training-develop')
    const changed=await syncLegacy(source,target,{check:args.includes('--check')})
    console.log(`${args.includes('--check')?'Drift':'Synchronized'}: ${changed.length} files`)
    if(args.includes('--check') && changed.length) process.exitCode=1
  }
}
