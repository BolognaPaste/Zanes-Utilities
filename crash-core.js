// Crash analyzer core: rule tables, minidump parser and text scan. Loaded by index.html for the page (app.js and
// xml-deep.js use these names) and by crash-worker.js, which runs scanFile on its own thread.
/* exported scanFile */
const E={
C0000005:['Access violation','The game read or wrote memory it was not allowed to touch (bad pointer, freed object, or corrupt data).','Verify game files, disable mods and overlays, update GPU drivers. If it happens in several games, test your RAM.'],
C000001D:['Illegal instruction','The CPU met an instruction it cannot run. Usually a build needing newer CPU features, or corrupted code in memory.','Check the CPU requirements, undo CPU overclock/undervolt, verify game files.'],
C0000094:['Divide by zero','A bug in game or mod code divided a number by zero.','Update the game and mods, or disable recently added mods.'],
C0000096:['Privileged instruction','Code tried to run an instruction only the OS may run, often from corrupted memory or a broken copy-protection wrapper.','Verify files; remove cracked/patched executables; test RAM.'],
C00000FD:['Stack overflow','Runaway recursion or a huge call chain used up the stack. Nearly always a game or mod bug.','Remove or update recent mods; send the dump to the developer.'],
C0000409:['Stack buffer overrun / fail-fast','The program detected memory corruption or deliberately aborted itself.','Disable mods and overlays, verify files, update drivers, test RAM if it repeats.'],
C0000374:['Heap corruption','The memory allocator found a corrupted heap: a buffer overflow or double free happened earlier.','Disable mods, injectors and overlays; verify files; test RAM.'],
C0000006:['In-page error (file read failed)','Windows could not read part of a file mapped into memory. Often a failing drive, disconnected disk, or corrupt install.','Check drive health (SMART, chkdsk) and reinstall the game on a healthy drive.'],
C0000017:['Out of memory','A memory allocation failed because none was available.','Close other apps, enlarge the page file, lower texture settings. 32-bit games top out near 2-4 GB.'],
C0000008:['Invalid handle','The game used a closed or invalid system handle. Often a bug or a conflicting hook.','Disable overlays and third-party tools, update the game.'],
C0000420:['Assertion failure','A built-in sanity check in the game failed.','Verify files, disable mods, send the dump to the developer.'],
C0000135:['DLL not found','A required DLL is missing.','Install the latest Visual C++ Redistributables and DirectX runtime, then verify game files.'],
C000007B:['Bad image format','A 32-bit/64-bit DLL mismatch, or a corrupt DLL.','Reinstall the Visual C++ Redistributables (x86 and x64) and verify game files.'],
C0000142:['DLL initialization failed','A DLL failed to start, often due to a missing runtime or a conflicting program.','Reinstall the Visual C++ Redistributables; close overlays and security tools.'],
80000003:['Breakpoint / deliberate abort','The program stopped itself on purpose, usually after detecting an unrecoverable internal error.','Check the game log next to this dump for the reason it aborted.'],
E06D7363:['Unhandled C++ exception','The game threw an error nothing caught (for example out of memory or a bad file).','Check the game log; verify files; disable mods.'],
E0434352:['Unhandled .NET exception','A managed (.NET/Unity/Mono) exception went uncaught.','Check the game or mod log for the exception name; update or remove mods.'],
'887A0005':['GPU device removed','The graphics card or driver dropped out (crash, power, overheating, or driver timeout).','Clean-install the GPU driver, lower overclocks, check temperatures and power supply.'],
'887A0006':['GPU device hung','The GPU stopped responding and Windows reset it.','Clean-install the GPU driver, lower overclocks, check temperatures.'],
'887A0007':['GPU driver reset','The graphics driver was reset mid-game.','Update or clean-install the GPU driver; check temperatures.'],
'887A0020':['GPU driver internal error','The graphics driver reported an internal error.','Clean-install the GPU driver; try a different driver version.']
};

const M=[
{r:/nvwgf2um|nvlddmkm|nvd3dum|nvoglv|nvcuda/i,k:'gpu',t:'Crash inside the NVIDIA graphics driver',w:'The faulting code is in the NVIDIA driver, so the driver, GPU stability, or a bad request from the game is involved.',x:'Clean-install the latest driver (DDU in safe mode), remove GPU overclocks, check temperatures.'},
{r:/atidxx|amdxx|aticfx|amdvlk|atio6axx|amdgfx/i,k:'gpu',t:'Crash inside the AMD graphics driver',w:'The faulting code is in the AMD driver, so the driver, GPU stability, or a bad request from the game is involved.',x:'Clean-install the latest driver, remove GPU overclocks and undervolts, check temperatures.'},
{r:/igd\w*umd|ig9icd|igxelpicd|igdrcl|igc64/i,k:'gpu',t:'Crash inside the Intel graphics driver',w:'The faulting code is in the Intel integrated-graphics driver.',x:'Update the Intel graphics driver; if you have a dedicated GPU, make sure the game uses it.'},
{r:/gameoverlayrenderer|discordhook|rtsshooks|nahimic|reshade|medal|graphics-hook|nvspcap|overwolf|afterburner|steamoverlay|fraps|bandicam/i,k:'ov',t:'Overlay or injected hook module',w:'A capture/overlay/injector DLL is loaded in the game process. These hook into rendering and commonly cause crashes.',x:'Turn off Steam/Discord/GeForce overlays, Afterburner/RTSS, ReShade and similar tools, then test again.'},
{r:/easyanticheat|beclient|battleye|vgk|faceit|equ8|xigncode/i,k:'ov',t:'Anti-cheat module involved',w:'An anti-cheat module is loaded. Conflicts with security software, drivers or injected tools can crash it.',x:'Repair the anti-cheat from the game launcher, close overlay and monitoring tools, add exclusions in your antivirus.'},
{r:/xaudio|audioses|wasapi|fmod|wwise|dsound|nahimic|realtek/i,k:'au',t:'Audio library or driver involved',w:'The faulting code is in an audio component.',x:'Update audio drivers, switch the default playback device, disable audio enhancements (Nahimic, Sonic Studio).'},
{r:/^(ntdll|kernelbase|kernel32|ucrtbase|msvcrt|vcruntime\d*|msvcp\d*|combase|rpcrt4)\.dll$/i,k:'rt',t:'Crash reported by a Windows or C++ runtime library',w:'The failure surfaced inside a system library, which usually means the game passed it bad data. The real culprit is further up the call stack, so the exception code matters more here.',x:'Rely on the exception finding above, and check the game log for the step before the crash.'}
];

const T=[
[/out of memory|outofmemoryerror|bad_alloc|not enough memory|insufficient memory|VK_ERROR_OUT_OF_(HOST|DEVICE)_MEMORY|failed to allocate/i,'H','Out of memory','The game or GPU ran out of memory.','Close other apps, raise the page file, lower texture quality and resolution, remove memory-heavy mods.'],
[/DXGI_ERROR_DEVICE_(REMOVED|HUNG|RESET)|device (was )?removed|gpu (crash|hang)|VK_ERROR_DEVICE_LOST|display driver stopped responding|device lost|nvlddmkm/i,'H','GPU crash or driver reset','The graphics card or driver stopped responding and was reset.','Clean-install the GPU driver, lower overclocks, check temperatures and PSU headroom.'],
[/access violation|EXCEPTION_ACCESS_VIOLATION|0xC0000005|SIGSEGV|segmentation fault|signal 11/i,'H','Memory access violation','The game touched memory it should not have (bad pointer or corrupt data).','Verify files, disable mods and overlays, update drivers, test RAM if it recurs.'],
[/stack overflow|StackOverflowError|0xC00000FD/i,'H','Stack overflow','Runaway recursion exhausted the stack, usually a game or mod bug.','Remove or update recent mods; report it to the developer.'],
[/heap corruption|0xC0000374|double free|corrupted (double-linked|size)|free\(\): invalid/i,'H','Heap corruption','Memory was corrupted earlier and the allocator caught it.','Disable mods, injectors and overlays; verify files; test RAM.'],
[/NullPointerException|NullReferenceException|attempt to (index|call|read) .*nil|null pointer|nullptr/i,'M','Null reference in game, script or mod code','Code used something that did not exist. Typical of mod or script bugs.','Disable the most recently added mod, update mods to match the game version.'],
[/NoSuchMethodError|NoClassDefFoundError|ClassNotFoundException|mixin (apply|transformation)|InvalidInjectionException|incompatible mod|duplicate mod|missing (required )?dependenc|requires mod|mod(s)? (conflict|incompatible)/i,'M','Mod conflict or mismatched mod versions','A mod depends on something missing or clashes with another mod or the game version.','Update all mods and loaders together; remove mods one at a time (or halve the list) to find the culprit.'],
[/could not load library|failed to load .*\.dll|dll (was )?not found|missing .*\.dll|0xC0000135|0xC000007B|vcruntime\d*.*(not found|missing)|msvcp\d+.*(not found|missing)/i,'M','Missing or broken DLL / runtime','A required library could not be loaded.','Install the latest Visual C++ Redistributables (x86 and x64) and DirectX runtime; verify game files.'],
[/assertion failed|assert(ion)? failure|check failed|ensure condition failed/i,'M','Assertion failure','A sanity check inside the game failed.','Verify files, disable mods, report it to the developer with the log.'],
[/no space left|disk full|i\/o error|cannot read file|failed to (open|read) .*(pak|archive|bundle|asset)|corrupt(ed)? (file|data|archive|pak|save)|crc (check|mismatch)|checksum mismatch/i,'M','Corrupt or unreadable game files','The game could not read some of its data, from a bad install or a failing or full drive.','Verify or reinstall the game, check drive health and free space.'],
[/unsupported (gpu|graphics|directx|opengl)|no suitable (gpu|graphics)|directx 1\d.*(not supported|required)|requires (a )?(gpu|graphics)|outdated (gpu )?driver|driver.*out of date/i,'M','Unsupported or outdated graphics hardware/driver','The game reported that your GPU or graphics API does not meet a requirement.','Update the GPU driver and check the game\'s system requirements.'],
[/failed to compile shader|shader.*(compile|compilation).*(error|fail)/i,'L','Shader compilation error','A graphics shader failed to build, often a driver issue or a stale shader cache.','Delete the game\'s shader cache and update the GPU driver.'],
[/timed out|not responding|watchdog|hang detected|hung/i,'L','Hang or timeout before the crash','The game froze or a task timed out shortly before closing.','Look at what happened just before this line; check for drive, network or GPU stalls.']
];

const base=n=>n.split(/[\\/]/).pop();
const hex=(n,w)=>n.toString(16).toUpperCase().padStart(w||8,'0');

function parseDmp(buf){
 const v=new DataView(buf);
 if(v.getUint32(0,true)!==0x504D444D)return null;
 const n=v.getUint32(8,true),dir=v.getUint32(12,true),r={ts:v.getUint32(20,true),mods:[]};
 const str=o=>{const l=v.getUint32(o,true);let s='';for(let i=0;i<l&&i<1040;i+=2)s+=String.fromCharCode(v.getUint16(o+4+i,true));return s};
 for(let i=0;i<n;i++){
  const o=dir+i*12,t=v.getUint32(o,true),p=v.getUint32(o+8,true);
  if(t===6){
   const e=p+8;r.tid=v.getUint32(p,true);r.code=v.getUint32(e,true);r.addr=v.getBigUint64(e+16,true);
   const np=Math.min(v.getUint32(e+24,true),15);r.par=[];
   for(let j=0;j<np;j++)r.par.push(v.getBigUint64(e+32+j*8,true));
  }else if(t===4){
   const c=v.getUint32(p,true);
   for(let j=0;j<c&&j<4000;j++){const m=p+4+j*108;r.mods.push({b:v.getBigUint64(m,true),s:v.getUint32(m+8,true),n:str(v.getUint32(m+20,true))})}
  }else if(t===7){
   r.arch=v.getUint16(p,true);r.os=v.getUint32(p+8,true)+'.'+v.getUint32(p+12,true)+' build '+v.getUint32(p+16,true);
  }
 }
 return r;
}

function anDmp(name,buf){
 let d;try{d=parseDmp(buf)}catch(e){return{name,findings:[],facts:[],err:'This looks like a minidump but it is truncated or damaged, so it could not be fully read.'}}
 const F=[],facts=[];
 let fm=null;
 if(d.addr!=null)fm=d.mods.find(m=>d.addr>=m.b&&d.addr<m.b+BigInt(m.s));
 if(d.code!=null){
  const h=hex(d.code),e=E[h];
  const f={s:'H',t:e?e[0]:'Unknown exception 0x'+h,w:e?e[1]:'This exception code is not in the built-in list.',x:e?e[2]:'Search the code (0x'+h+') online with the game name, and check the game log beside the dump.'};
  if(d.code===0xC0000005&&d.par&&d.par.length>1){
   const op=d.par[0]===0n?'read':d.par[0]===1n?'write':'execute (DEP)',tg=d.par[1];
   f.e='Tried to '+op+' address 0x'+tg.toString(16);
   if(tg<0x10000n)f.w+=' The target address is near zero, which means a null pointer was used.';
  }
  F.push(f);
  facts.push(['Exception code','0x'+h+(e?' ('+e[0]+')':'')],['Fault address','0x'+d.addr.toString(16)]);
 }else F.push({s:'M',t:'No exception record in this dump',w:'The dump was not written by a crash exception. It may be a manual capture or a hang dump.',x:'Look at the game log for the cause, or capture a dump when the crash actually happens.'});
 if(fm){
  const fn=base(fm.n);facts.push(['Faulting module',fn+' +0x'+(d.addr-fm.b).toString(16)]);
  const mr=M.find(x=>x.r.test(fn));
  if(mr)F.push({s:mr.k==='rt'?'M':'H',t:mr.t,w:mr.w,x:mr.x,e:fn});
  else F.push({s:'M',t:'Crash inside '+fn,w:'The fault happened in this module. If it is the game executable or one of its own DLLs, the bug is in the game or a mod; if it is a third-party DLL, that program is the suspect.',x:'Search the module name with the game name; update or remove the software that owns it.',e:fm.n});
 }else if(d.addr!=null)facts.push(['Faulting module','Not in any loaded module (jumped into invalid memory)']);
 const ctx=[];
 for(const m of d.mods){const n=base(m.n);const r=M.find(x=>x.k==='ov'&&x.r.test(n));if(r&&!(fm&&fm===m))ctx.push(n)}
 if(ctx.length)F.push({s:'L',t:'Overlay, hook or anti-cheat modules were loaded',w:'These are common crash contributors because they hook into the game process.',x:'Disable them one by one and retest.',e:[...new Set(ctx)].join('\n')});
 if(d.ts)facts.push(['Crash time (UTC)',new Date(d.ts*1000).toUTCString()]);
 if(d.os)facts.push(['Windows',d.os],['Architecture',{0:'x86',9:'x64',12:'ARM64'}[d.arch]||String(d.arch)]);
 if(d.mods.length)facts.push(['Main module',base(d.mods[0].n)]);
 if(d.tid!=null)facts.push(['Crashing thread ID',String(d.tid)]);
 return{name,findings:F,facts,mods:d.mods.map(m=>'0x'+m.b.toString(16)+'  '+m.n)};
}

function anText(name,txt){
 const L=txt.split(/\r?\n/).map(l=>l.length>4000?l.slice(0,4000):l),F=[];
 for(const [re,s,t,w,x] of T){
  const i=L.findIndex(l=>re.test(l));
  if(i>=0)F.push({s,t,w,x,e:'line '+(i+1)+': '+L[i].trim().slice(0,220)});
 }
 for(const m of M){
  if(m.k==='rt'||m.k==='au')continue;
  const i=L.findIndex(l=>m.r.test(l));
  if(i>=0)F.push({s:m.k==='ov'?'L':'M',t:m.t.replace('Crash inside','Mentions'),w:m.w,x:m.x,e:'line '+(i+1)+': '+L[i].trim().slice(0,220)});
 }
 const key=[];
 for(let i=0;i<L.length&&key.length<10;i++)if(/fatal|exception|caused by|crash|error/i.test(L[i]))key.push((i+1)+': '+L[i].trim().slice(0,180));
 return{name,findings:F,facts:[['Lines read',String(L.length)]],key};
}

// Reads one crash file and analyses it. Runs on crash-worker.js's thread when it can, so a large log or dump never
// freezes the window. XML comes back as text for the page to analyse, because only the page has an XML parser.
async function scanFile(f){
 try{
  const head=new Uint8Array(await f.slice(0,1024).arrayBuffer());
  const sig=String.fromCharCode(...head.slice(0,8));
  if(sig.startsWith('MDMP')){
   if(f.size>800e6)throw Error('This dump is over 800 MB, which is too large to read in a browser.');
   return anDmp(f.name,await f.arrayBuffer());
  }
  if(sig.startsWith('PAGEDU'))return{name:f.name,facts:[],findings:[{s:'M',t:'Windows kernel (blue screen) dump',w:'This is a system-level dump, not a game crash dump. It needs WinDbg to read.',x:'Open it in WinDbg and run !analyze -v, or use the Windows Reliability Monitor for a summary.'}]};
  const u16=head[0]===0xFF&&head[1]===0xFE;
  if(!u16&&head.filter(x=>x===0).length>8)throw Error('This is a binary file in a format this tool does not recognize.');
  const txt=new TextDecoder(u16?'utf-16le':'utf-8').decode(await f.slice(0,30e6).arrayBuffer());
  if(/^\s*<(\?xml|[A-Za-z!])/.test(txt.slice(0,300).replace(/^\uFEFF/,'')))return{name:f.name,xml:txt};
  return anText(f.name,txt);
 }catch(e){return{name:f.name,facts:[],findings:[],err:e.message}}
}
