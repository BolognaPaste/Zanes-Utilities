// Main page script (was an inline <script> in index.html; moved out so the Content-Security-Policy can forbid inline scripts).
const $=s=>document.querySelector(s),out=$('#out'),dz=$('#dz');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const R={H:'Most likely',M:'Possible',L:'Contributing'},O={H:0,M:1,L:2};

/* Windows exception codes: [name, meaning, fix] */
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

/* Module rules. k: gpu | ov (overlay/anti-cheat/injector) | rt (runtime/system) | au (audio) */
const M=[
{r:/nvwgf2um|nvlddmkm|nvd3dum|nvoglv|nvcuda/i,k:'gpu',t:'Crash inside the NVIDIA graphics driver',w:'The faulting code is in the NVIDIA driver, so the driver, GPU stability, or a bad request from the game is involved.',x:'Clean-install the latest driver (DDU in safe mode), remove GPU overclocks, check temperatures.'},
{r:/atidxx|amdxx|aticfx|amdvlk|atio6axx|amdgfx/i,k:'gpu',t:'Crash inside the AMD graphics driver',w:'The faulting code is in the AMD driver, so the driver, GPU stability, or a bad request from the game is involved.',x:'Clean-install the latest driver, remove GPU overclocks and undervolts, check temperatures.'},
{r:/igd\w*umd|ig9icd|igxelpicd|igdrcl|igc64/i,k:'gpu',t:'Crash inside the Intel graphics driver',w:'The faulting code is in the Intel integrated-graphics driver.',x:'Update the Intel graphics driver; if you have a dedicated GPU, make sure the game uses it.'},
{r:/gameoverlayrenderer|discordhook|rtsshooks|nahimic|reshade|medal|graphics-hook|nvspcap|overwolf|afterburner|steamoverlay|fraps|bandicam/i,k:'ov',t:'Overlay or injected hook module',w:'A capture/overlay/injector DLL is loaded in the game process. These hook into rendering and commonly cause crashes.',x:'Turn off Steam/Discord/GeForce overlays, Afterburner/RTSS, ReShade and similar tools, then test again.'},
{r:/easyanticheat|beclient|battleye|vgk|faceit|equ8|xigncode/i,k:'ov',t:'Anti-cheat module involved',w:'An anti-cheat module is loaded. Conflicts with security software, drivers or injected tools can crash it.',x:'Repair the anti-cheat from the game launcher, close overlay and monitoring tools, add exclusions in your antivirus.'},
{r:/xaudio|audioses|wasapi|fmod|wwise|dsound|nahimic|realtek/i,k:'au',t:'Audio library or driver involved',w:'The faulting code is in an audio component.',x:'Update audio drivers, switch the default playback device, disable audio enhancements (Nahimic, Sonic Studio).'},
{r:/^(ntdll|kernelbase|kernel32|ucrtbase|msvcrt|vcruntime\d*|msvcp\d*|combase|rpcrt4)\.dll$/i,k:'rt',t:'Crash reported by a Windows or C++ runtime library',w:'The failure surfaced inside a system library, which usually means the game passed it bad data. The real culprit is further up the call stack, so the exception code matters more here.',x:'Rely on the exception finding above, and check the game log for the step before the crash.'}
];

/* Text-log rules: [regex, severity, title, why, fix] */
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

function render(r){
 const s=document.createElement('section');
 r.findings.sort((a,b)=>O[a.s]-O[b.s]);
 const rep=['Crash analysis: '+r.name,...r.findings.map((f,i)=>(i+1)+'. ['+R[f.s]+'] '+f.t+': '+f.w+' Try: '+f.x+(f.e?' ('+f.e.split('\n')[0]+')':''))].join('\n');
 let h='<h2>'+esc(r.name)+'</h2>';
 if(r.err)h+='<p class="err">'+esc(r.err)+'</p>';
 h+=r.findings.length?r.findings.map(f=>'<div class="f '+f.s+'"><b>'+esc(f.t)+'</b><span class="tag">'+R[f.s]+'</span><p>'+esc(f.w)+'</p><p class="fx">Try: '+esc(f.x)+'</p>'+(f.e?'<pre>'+esc(f.e)+'</pre>':'')+'</div>').join(''):(r.err?'':'<div class="f"><b>No known crash pattern found</b><p>Nothing in this file matched the built-in rules. The key lines below are the best place to start.</p></div>');
 if(r.facts.length)h+='<h3>Details</h3><div class="tw"><table>'+r.facts.map(([k,v])=>'<tr><th>'+esc(k)+'</th><td>'+esc(v)+'</td></tr>').join('')+'</table></div>';
 if(r.key&&r.key.length)h+='<h3>Key lines</h3><pre>'+esc(r.key.join('\n'))+'</pre>';
 if(r.mods&&r.mods.length)h+='<details><summary>'+r.mods.length+' loaded modules</summary><pre>'+esc(r.mods.join('\n'))+'</pre></details>';
 if(r.findings.length)h+='<button type="button">Copy summary</button>';
 s.innerHTML=h;
 const b=s.querySelector('button');
 if(b)b.onclick=()=>{navigator.clipboard.writeText(rep).then(()=>{b.textContent='Copied'}).catch(()=>{b.textContent='Copy blocked by browser'})};
 out.append(s);
 if(!r.err)addHist(r);
}

async function handle(files){
 out.innerHTML='';
 for(const f of files){
  try{
   const head=new Uint8Array(await f.slice(0,1024).arrayBuffer());
   const sig=String.fromCharCode(...head.slice(0,8));
   if(sig.startsWith('MDMP')){
    if(f.size>800e6)throw Error('This dump is over 800 MB, which is too large to read in a browser.');
    render(anDmp(f.name,await f.arrayBuffer()));
   }else if(sig.startsWith('PAGEDU')){
    render({name:f.name,facts:[],findings:[{s:'M',t:'Windows kernel (blue screen) dump',w:'This is a system-level dump, not a game crash dump. It needs WinDbg to read.',x:'Open it in WinDbg and run !analyze -v, or use the Windows Reliability Monitor for a summary.'}]});
   }else{
    const u16=head[0]===0xFF&&head[1]===0xFE;
    if(!u16&&head.filter(x=>x===0).length>8)throw Error('This is a binary file in a format this tool does not recognize.');
    const buf=await f.slice(0,30e6).arrayBuffer();
    render(anText(f.name,new TextDecoder(u16?'utf-16le':'utf-8').decode(buf)));
   }
  }catch(e){render({name:f.name,facts:[],findings:[],err:e.message})}
 }
 out.scrollIntoView({block:'start'});
}
document.querySelectorAll('.nv').forEach(b=>b.onclick=()=>{
 const own=b.closest('.ng');document.querySelectorAll('nav .ng').forEach(g=>{const inG=g===own;g.classList.toggle('has-cur',inG);if(inG)g.open=true});
 document.querySelectorAll('.nv').forEach(x=>x===b?x.setAttribute('aria-current','page'):x.removeAttribute('aria-current'));
 document.querySelectorAll('.pg').forEach(p=>{p.hidden=p.id!=='p-'+b.dataset.p});
 if(b.dataset.p==='hist')hrender();if(b.dataset.p==='home')homeRender();
 document.querySelector('main').classList.toggle('wide',b.dataset.p==='next'||b.dataset.p==='media'||b.dataset.p==='games'||b.dataset.p==='fmhy'||b.dataset.p==='vault'||b.dataset.p==='phone'||b.dataset.p==='ssh'||b.dataset.p==='shred'||b.dataset.p==='crash'||b.dataset.p==='hist'||b.dataset.p==='opt'||b.dataset.p==='drv'||b.dataset.p==='settings'||b.dataset.p==='test'||b.dataset.p==='home');document.querySelector('main').classList.remove('full');document.querySelector('main').classList.toggle('fmw',b.dataset.p==='fmhy'||b.dataset.p==='vault');if(b.dataset.p==='fmhy'){if(window.fmEnter)fmEnter()}else if(window.fmPause)fmPause();if(b.dataset.p==='media')jopen();else if(window.lvPause)lvPause();if(b.dataset.p==='games'){if(window.gmEnter)gmEnter()}else if(window.gmPause)gmPause();if(b.dataset.p==='phone'){if(window.phEnter)phEnter()}else if(window.phPause)phPause();closeMenu();
});

/* Driver updater: sidebar buttons scroll the main pane to a section */
document.querySelectorAll('#p-drv [data-j]').forEach(b=>b.onclick=()=>{
 const t=document.getElementById(b.dataset.j);if(!t)return;
 if(t.tagName==='DETAILS')t.open=true;
 t.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
 document.querySelectorAll('#p-drv [data-j]').forEach(x=>x.removeAttribute('data-on'));b.dataset.on='1';
});

document.querySelectorAll('[data-go]').forEach(c=>c.onclick=()=>document.querySelector('.nv[data-p="'+c.dataset.go+'"]').click());

/* Menu dropdowns: remember which ones are open (the Game tools key is kept from the old single dropdown) */
(()=>{
 document.querySelectorAll('nav .ng').forEach(g=>{
  const K='gca-nav-'+g.id.replace(/^ng-/,'');
  try{if(localStorage.getItem(K)==='1')g.open=true}catch(e){}
  g.addEventListener('toggle',()=>{try{localStorage.setItem(K,g.open?'1':'0')}catch(e){}});
 });
})();

/* Collapsible menu */
(()=>{
 const b=$('#ntg'),K='gca-nav';
 const set=c=>{document.body.classList.toggle('nc',c);b.setAttribute('aria-expanded',String(!c));b.textContent=c?'☰':'☰ Zane\'s Utilities';try{localStorage.setItem(K,c?'1':'0')}catch(e){}};
 let c=false;try{c=localStorage.getItem(K)==='1'}catch(e){}
 set(c);b.onclick=()=>set(!document.body.classList.contains('nc'));
})();

/* Past scans: saved in this browser's localStorage */
const HK='gca-history';let hfail=false;
const hload=()=>{try{return JSON.parse(localStorage.getItem(HK))||[]}catch(e){return[]}};
const hsave=a=>{try{localStorage.setItem(HK,JSON.stringify(a.slice(0,30)));hfail=false}catch(e){hfail=true}homeRender()};
function addHist(r){
 const a=hload();
 a.unshift({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),name:r.name,at:Date.now(),f:r.findings.map(f=>({s:f.s,t:f.t,e:(f.e||'').split('\n')[0].slice(0,120)})),facts:r.facts.slice(0,12)});
 hsave(a);
}
function hrender(){
 const a=hload();
 $('#hc').innerHTML='';
 $('#hb').hidden=!a.length;
 $('#hl').innerHTML=(hfail?'<p class="err">This browser is blocking saved history, so new scans are not being kept.</p>':'')+(a.length?a.map(x=>'<label class="hi"><input type="checkbox" value="'+esc(x.id)+'"><span><b>'+esc(x.name)+'</b><small>'+esc(new Date(x.at).toLocaleString())+'</small><small>'+(x.f[0]?esc(x.f[0].t):'No known crash pattern')+'</small></span></label>').join(''):'<div class="empty"><b>No scans yet</b><span class="fx">Scan a crash file and it will be listed here.</span></div>');
}
function cmp(){
 const ids=[...document.querySelectorAll('#hl input:checked')].map(i=>i.value),a=hload(),c=$('#hc');
 if(ids.length!==2){c.innerHTML='<p class="err">Tick exactly two scans to compare.</p>';return}
 const [x,y]=ids.map(i=>a.find(z=>z.id===i));
 const mx=new Map(x.f.map(f=>[f.t,f])),my=new Map(y.f.map(f=>[f.t,f]));
 const both=[...mx.keys()].filter(t=>my.has(t)),ox=[...mx.keys()].filter(t=>!my.has(t)),oy=[...my.keys()].filter(t=>!mx.has(t));
 const g=(s,k)=>(s.facts.find(f=>f[0]===k)||[])[1],gm=s=>(g(s,'Faulting module')||'').split(' +')[0];
 const same=g(x,'Exception code')?(g(x,'Exception code')===g(y,'Exception code')&&gm(x)===gm(y)):!!(x.f[0]&&y.f[0]&&x.f[0].t===y.f[0].t);
 const v=same?'These look like the same crash: the top cause matches in both scans.':both.length?'Some causes overlap, but the crashes are not identical.':'No causes in common. These look like different problems.';
 const lab=(s,l)=>l+': '+esc(s.name)+'<br><small class="fx">'+esc(new Date(s.at).toLocaleString())+'</small>';
 const list=(arr,m)=>arr.length?arr.map(t=>'<div class="f '+m.get(t).s+'"><b>'+esc(t)+'</b><span class="tag">'+R[m.get(t).s]+'</span>'+(m.get(t).e?'<pre>'+esc(m.get(t).e)+'</pre>':'')+'</div>').join(''):'<p class="fx">None</p>';
 const keys=[...new Set([...x.facts,...y.facts].map(f=>f[0]))];
 c.innerHTML='<h2>Comparison</h2><p><b>'+v+'</b></p><div class="tw"><table class="ct"><tr><th></th><th>'+lab(x,'A')+'</th><th>'+lab(y,'B')+'</th></tr>'+keys.map(k=>{const p=g(x,k)||'-',q=g(y,k)||'-';return '<tr'+(p===q?'':' class="df"')+'><th>'+esc(k)+'</th><td>'+esc(p)+'</td><td>'+esc(q)+'</td></tr>'}).join('')+'</table></div><h3>Causes in both</h3>'+list(both,mx)+'<h3>Only in A</h3>'+list(ox,mx)+'<h3>Only in B</h3>'+list(oy,my);
}
/* Game library: reads launcher manifest files, kept in this browser */
const LK='gca-library';
let lib=(()=>{try{return JSON.parse(localStorage.getItem(LK))||[]}catch(e){return[]}})();
const lsave=()=>{try{localStorage.setItem(LK,JSON.stringify(lib))}catch(e){}};
const lu=x=>x.launch||(x.app?'steam://run/'+x.app:'');
const gb=n=>n?(n>=1073741824?(n/1073741824).toFixed(1)+' GB':Math.round(n/1048576)+' MB'):'';
function pSteam(t){
 const k=n=>(t.match(new RegExp('"'+n+'"\\s+"([^"]*)"','i'))||[])[1];
 const id=(k('appid')||'').replace(/\D/g,''),nm=k('name');
 return id&&nm?{store:'Steam',id:'s'+id,app:id,name:nm,dir:k('installdir')||'',size:+k('SizeOnDisk')||0,upd:+k('LastUpdated')||0}:null;
}
function pEpic(t){
 try{const j=JSON.parse(t);return j.DisplayName?{store:'Epic',id:'e'+(j.CatalogItemId||j.AppName||j.DisplayName),name:j.DisplayName,dir:j.InstallLocation||'',size:+j.InstallSize||0,ver:j.AppVersionString||'',launch:j.AppName?'com.epicgames.launcher://apps/'+(j.CatalogNamespace&&j.CatalogItemId?[j.CatalogNamespace,j.CatalogItemId,j.AppName]:[j.AppName]).map(encodeURIComponent).join('%3A')+'?action=launch&silent=true':''}:null}catch(e){return null}
}
function mergeGames(got){
 const old=new Map(lib.map(x=>[x.id,x])),ids=new Set(got.map(g=>g.id));
 lib=lib.filter(x=>!ids.has(x.id)).concat(got.map(g=>Object.assign({},old.get(g.id)||{},g)));
 lsave();lrender();
}
async function loadGames(files,store){
 const p=store==='Steam'?pSteam:pEpic,got=[];
 for(const f of files){if(f.size>2e6)continue;const g=p(await f.text());if(g)got.push(g)}
 if(!got.length){lrender('No '+store+' games found in those files. Make sure you selected the '+(store==='Steam'?'appmanifest_*.acf':'.item')+' files.');return}
 mergeGames(got);
}
let sortBy='name',filt='all',cmGame=null,tt;
const save=()=>{lsave();lrender()};
const toast=t=>{const s=$('#ts');s.textContent=t;s.hidden=false;clearTimeout(tt);tt=setTimeout(()=>{s.hidden=true},2200)};
const hue=s=>[...s].reduce((n,c)=>(n*31+c.charCodeAt(0))%360,7);
function visible(){
 const q=$('#gq').value.trim().toLowerCase();
 let a=lib.filter(x=>x.name.toLowerCase().includes(q));
 if(filt==='fav')a=a.filter(x=>x.fav);
 else if(filt==='Steam'||filt==='Epic'||filt==='Custom')a=a.filter(x=>x.store===filt);
 else if(filt.startsWith('c:'))a=a.filter(x=>(x.cols||[]).includes(filt.slice(2)));
 const by={name:(x,y)=>x.name.localeCompare(y.name),upd:(x,y)=>(y.upd||0)-(x.upd||0)||x.name.localeCompare(y.name),size:(x,y)=>(y.size||0)-(x.size||0)||x.name.localeCompare(y.name)};
 return a.sort(by[sortBy]);
}
const SC='https://cdn.cloudflare.steamstatic.com/steam/apps/';
const arts=x=>x.app?[SC+x.app+'/library_600x900.jpg',SC+x.app+'/header.jpg']:[];
const tile=x=>{const a=arts(x);return '<div class="t" tabindex="0" data-id="'+esc(x.id)+'" title="'+esc(x.name)+'"><div class="fb" style="--h:'+hue(x.name)+'"><span>'+esc(x.name)+'</span></div>'+(a.length?'<img alt="" loading="lazy" data-n="1" src="'+esc(a[0])+'">':'')+(x.fav?'<i class="fv" title="Favorite">★</i>':'')+'<span class="pl">'+esc(x.store)+(x.size?' '+esc(gb(x.size)):'')+'</span></div>'};
function lrender(msg){
 homeRender();
 const m=$('#gm');m.hidden=!msg;m.textContent=msg||'';
 const cols=[...new Set(lib.flatMap(g=>g.cols||[]))].sort(),n=s=>lib.filter(x=>x.store===s).length;
 const fo=[['all','All Games'],['fav','Favorites'],['Steam','Steam'],['Epic','Epic Games'],['Custom','Added manually'],...cols.map(c=>['c:'+c,c])].filter(o=>!['Steam','Epic','Custom'].includes(o[0])||n(o[0]));
 if(!fo.some(o=>o[0]===filt))filt='all';
 $('#gf').innerHTML=fo.map(o=>'<option value="'+esc(o[0])+'"'+(o[0]===filt?' selected':'')+'>'+esc(o[1])+'</option>').join('');
 const v=visible();
 $('#gc').textContent='('+v.length+')';
 $('#gb').hidden=!lib.length;
  $('#gl').innerHTML=v.length?v.map(tile).join(''):(lib.length?'<p class="fx">No games match.</p>':'<div class="empty"><b>No games loaded</b><span class="fx">Use the "Add games" menu above to find your installed Steam and Epic games, or to add game .exe files yourself.</span></div>');
}
function closeMenu(){$('#cm').hidden=true;cmGame=null}
function closeDlg(){$('#dl').hidden=true}
function dialog(t,h){const d=$('#dl');d.innerHTML='<div class="dlb" role="dialog" aria-modal="true" aria-label="'+esc(t)+'"><h2>'+esc(t)+'</h2>'+h+'</div>';d.hidden=false;const f=d.querySelector('input,button');if(f)f.focus()}
const mi=(a,t,o={})=>'<button type="button" class="mi'+(o.k?' '+o.k:'')+'" role="menuitem" data-a="'+a+'"'+(o.v!=null?' data-v="'+esc(o.v)+'"':'')+(o.d?' disabled':'')+'>'+esc(t)+'</button>';
const smn=(t,items)=>'<div class="mi has" tabindex="0" role="menuitem" aria-haspopup="true">'+t+'<b class="ar">›</b><div class="smn" role="menu">'+items+'</div></div>';
function openMenu(x,px,py,kb){
 cmGame=x;
 const cols=[...new Set(lib.flatMap(g=>g.cols||[]))].sort(),mine=x.cols||[],cm=$('#cm');
 const add=cols.filter(c=>!mine.includes(c)).map(c=>mi('addc',c,{v:c})).join('')+mi('newc','New collection…');
 const rem=mine.map(c=>mi('rmc',c,{v:c})).join('')||'<span class="mi off">Not in any collection</span>';
 const man=mi('copy',x.store==='Steam'?'Copy install folder name':x.store==='Custom'?'Copy executable path':'Copy install path')+(x.store==='Custom'?mi('setexe','Set executable path…'):'')+(x.app?mi('store','Open Steam store page')+mi('unin','Uninstall…'):'')+mi('del','Remove from this library');
 cm.innerHTML=(x.store==='Custom'?mi('play','⬇  Get launcher (.bat)',{k:'play'}):mi('play','▶  Play',{k:'play',d:!lu(x)}))+mi('fav',x.fav?'Remove from Favorites':'Add to Favorites')+smn('Add to',add)+smn('Remove from',rem)+smn('Manage',man)+'<hr>'+mi('props','Properties…');
 cm.hidden=false;
 const w=cm.offsetWidth,h=cm.offsetHeight,l=Math.max(4,Math.min(px,innerWidth-w-8));
 cm.style.left=l+'px';cm.style.top=Math.max(4,Math.min(py,innerHeight-h-8))+'px';
 cm.classList.toggle('flip',l+w+210>innerWidth);
 if(kb)cm.querySelector('.play').focus();
}
function props(x){
 const bn=x.app?SC+x.app+'/header.jpg':'',lg=x.app?SC+x.app+'/logo.png':'';
 const head=bn?'<div class="pb"><img class="bn" alt="" src="'+esc(bn)+'" data-oe="rm">'+(lg?'<img class="lg" alt="" src="'+esc(lg)+'" data-oe="rm">':'')+'</div>':'';
 const r=[['Name',x.name],['Store',x.store==='Epic'?'Epic Games':x.store==='Custom'?'Added manually':'Steam'],x.app&&['Steam app ID',x.app],x.exe&&['Main executable',x.exe.replace(/\//g,'\\')],['Install folder',x.dir||'-'],['Size on disk',gb(x.size)||'-'],x.upd&&['Last updated',new Date(x.upd*1000).toLocaleString()],x.ver&&['Version',x.ver],['Collections',(x.cols||[]).join(', ')||'None'],['Favorite',x.fav?'Yes':'No']].filter(Boolean);
 dialog('Properties',head+'<div class="tw"><table>'+r.map(([k,v])=>'<tr><th>'+esc(k)+'</th><td>'+esc(v)+'</td></tr>').join('')+'</table></div><div class="bar"><button type="button" data-x>Close</button></div>');
}
function act(a,x,v){
 if(!x)return;
 const go=u=>{const l=document.createElement('a');l.href=u;document.body.append(l);l.click();l.remove()};
 if(a==='play'){if(x.store==='Custom'){if(x.path)mkbat(x);else setExe(x,1)}else{const u=lu(x);if(u)go(u)}}
 else if(a==='fav'){x.fav=!x.fav;save()}
 else if(a==='addc'){x.cols=x.cols||[];if(!x.cols.includes(v))x.cols.push(v);save()}
 else if(a==='rmc'){x.cols=(x.cols||[]).filter(c=>c!==v);save()}
 else if(a==='newc'){
  dialog('New collection','<input type="text" id="dn" maxlength="40" placeholder="Collection name" aria-label="Collection name"><div class="bar"><button type="button" id="dok">Create</button><button type="button" class="alt" data-x>Cancel</button></div>');
  const mk=()=>{const n=$('#dn').value.trim();if(!n)return;x.cols=x.cols||[];if(!x.cols.includes(n))x.cols.push(n);closeDlg();save()};
  $('#dok').onclick=mk;$('#dn').onkeydown=e=>{if(e.key==='Enter')mk()};
 }
 else if(a==='copy')(navigator.clipboard?navigator.clipboard.writeText(x.store==='Custom'?(x.path||(x.exe||'').replace(/\//g,'\\')||x.dir||''):x.dir||''):Promise.reject()).then(()=>toast('Copied'),()=>toast('Copy blocked by browser'));
 else if(a==='store')window.open('https://store.steampowered.com/app/'+x.app,'_blank','noopener');
 else if(a==='unin')go('steam://uninstall/'+x.app);
 else if(a==='del'){lib=lib.filter(g=>g!==x);save()}
 else if(a==='props')props(x);
 else if(a==='setexe')setExe(x);
}
const gl=$('#gl'),tg=e=>{const t=e.target.closest('.t');return t?lib.find(g=>g.id===t.dataset.id):null};
gl.addEventListener('contextmenu',e=>{const x=tg(e);if(!x)return;e.preventDefault();const r=e.target.closest('.t').getBoundingClientRect(),kb=!e.clientX&&!e.clientY;openMenu(x,kb?r.left+r.width/2:e.clientX,kb?r.top+r.height/2:e.clientY,kb)});
gl.addEventListener('dblclick',e=>{const x=tg(e);if(x)act('play',x)});
gl.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.classList.contains('t'))act('play',tg(e))});
gl.addEventListener('error',e=>{const i=e.target;if(i.tagName!=='IMG')return;const t=i.closest('.t'),x=t&&lib.find(g=>g.id===t.dataset.id),n=+i.dataset.n||0,a=x?arts(x):[];if(a[n]){i.dataset.n=n+1;i.src=a[n]}else i.remove()},true);
$('#cm').addEventListener('click',e=>{const b=e.target.closest('[data-a]');if(b){if(b.disabled)return;const x=cmGame,a=b.dataset.a,v=b.dataset.v;closeMenu();act(a,x,v)}else{const h=e.target.closest('.has');if(h)h.classList.toggle('open')}});
document.addEventListener('click',e=>{if(!e.target.closest('#cm'))closeMenu()});
document.addEventListener('contextmenu',e=>{if(!e.target.closest('.t')&&!e.target.closest('#cm'))closeMenu()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMenu();closeDlg();$('#ld').open=false}});
document.addEventListener('click',e=>{if(!e.target.closest('#ld'))$('#ld').open=false});
window.addEventListener('resize',closeMenu);
window.addEventListener('scroll',closeMenu,true);
$('#dl').addEventListener('click',e=>{if(e.target.id==='dl'||e.target.closest('[data-x]'))closeDlg()});
$('#gf').onchange=e=>{filt=e.target.value;lrender()};
$('#gsort').onchange=e=>{sortBy=e.target.value;lrender()};
/* Delete all data (Home page) */
async function wipeIdb(){
 let names=[];
 try{if(indexedDB.databases)names=(await indexedDB.databases()).map(d=>d.name).filter(Boolean)}catch(e){}
 if(!names.includes(HDB))names.push(HDB);
 await Promise.all(names.map(n=>new Promise(r=>{try{const q=indexedDB.deleteDatabase(n);q.onsuccess=q.onerror=q.onblocked=()=>r()}catch(e){r()}})));
}
$('#dd-x').onclick=()=>{
 $('#dd-m').hidden=true;
 dialog('Delete all data?','<p class="fx"><b>Are you sure you want to delete all data?</b></p><p class="fx">This permanently deletes your game library, past scans, settings, remembered folders, shredding stats, Jellyfin sign-in, Coolmath and FMHY site data, and cached video thumbnails. It cannot be undone.</p><p class="fx">Your vault files, downloaded installers and any files you extracted are not touched. Your app lock password is kept too.</p><div class="bar"><button type="button" class="alt" data-x>Cancel</button><button type="button" id="dwy">Yes, delete all data</button><label class="fx" style="display:inline-flex;align-items:center;gap:3px;margin:0;font-size:.75rem"><input type="checkbox" id="dwa" style="margin:0;width:auto;padding:0">Also delete converted audio</label></div>');
 $('#dwy').onclick=async()=>{
  const b=$('#dwy'),wa=$('#dwa').checked;b.disabled=true;$('#dwa').disabled=true;b.textContent='Deleting…';
  try{
   try{if(window.vault&&vault.lock)await vault.lock()}catch(e){}
   try{localStorage.clear();sessionStorage.clear()}catch(e){}
   await wipeIdb();
   const r=window.appData&&appData.wipe?await appData.wipe({audio:wa}):{ok:true};
   if(!r||!r.ok)throw new Error((r&&r.error)||'Deleting failed.');
   if(!(window.appData&&appData.wipe))location.reload();
  }catch(e){
   closeDlg();
   const m=$('#dd-m');m.textContent=String((e&&e.message)||e);m.hidden=false;
  }
 };
};
$('#fs').onchange=e=>{const f=[...e.target.files];e.target.value='';if(f.length)loadGames(f,'Steam')};
$('#fe').onchange=e=>{const f=[...e.target.files];e.target.value='';if(f.length)loadGames(f,'Epic')};
$('#gq').oninput=()=>lrender();
let cg;$('#gx').onclick=e=>{const b=e.target;if(b.dataset.a){lib=[];lsave();delete b.dataset.a;b.textContent='Clear library';clearTimeout(cg);lrender()}else{b.dataset.a=1;b.textContent='Click again to confirm';cg=setTimeout(()=>{delete b.dataset.a;b.textContent='Clear library'},4000)}};
lrender();
/* Find games automatically: remembers the folders you pick (File System Access API, Chrome/Edge) */
const HDB='gca-handles',DEF={Steam:'C:\\Program Files (x86)\\Steam\\steamapps',Epic:'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests'};
const canDir=()=>typeof window.showDirectoryPicker==='function';
const noDir=()=>{
 if(canDir())return '';
 const u=navigator.userAgent;
 if(!window.isSecureContext)return 'Folder scanning is off because this page was opened over plain http. Open the file straight from your computer, or serve it over https.';
 if(navigator.brave)return 'Brave turns folder access off by default. Open brave://flags/#file-system-access-api, set it to Enabled, and restart Brave.';
 if(/firefox/i.test(u))return 'Firefox cannot scan folders. Use Chrome or Edge, or choose the files manually.';
 if(/safari/i.test(u)&&!/chrome|chromium|edg/i.test(u))return 'Safari cannot scan folders. Use Chrome or Edge, or choose the files manually.';
 if(window.top!==window)return 'This page is running inside another page, which can hide folder access. Open the file in its own browser tab.';
 return 'This browser does not offer folder access. Use a current Chrome or Edge, or choose the files manually.';
};
const idb=()=>new Promise((res,rej)=>{const r=indexedDB.open(HDB,1);r.onupgradeneeded=()=>r.result.createObjectStore('h');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
async function hget(k){try{const d=await idb();return await new Promise(res=>{const q=d.transaction('h').objectStore('h').get(k);q.onsuccess=()=>res((window.efsRe||(x=>x))(q.result||[]));q.onerror=()=>res([])})}catch(e){return[]}}
async function hput(k,v){try{const d=await idb();await new Promise(res=>{const t=d.transaction('h','readwrite');t.objectStore('h').put(v,k);t.oncomplete=res;t.onerror=res;t.onabort=res})}catch(e){}}
const am=t=>{$('#afm').textContent=t||''};
const pend=new Set(),lpend=()=>{$('#gp').hidden=!pend.size};
async function sub(h,parts){for(const p of parts)h=await h.getDirectoryHandle(p);return h}
async function scanFolder(h,store){
 const dirs=[h],paths=store==='Steam'?[['steamapps']]:[['Data','Manifests'],['EpicGamesLauncher','Data','Manifests'],['Manifests']];
 for(const p of paths){try{dirs.push(await sub(h,p))}catch(e){}}
 const re=store==='Steam'?/^appmanifest_\d+\.acf$/i:/\.item$/i,parse=store==='Steam'?pSteam:pEpic,games=[];let libs=[];
 // Every manifest in a folder is read at the same time instead of one after another (same results, same order).
 for(const d of dirs){
  const jobs=[];
  for await(const[n,e]of d.entries()){
   if(e.kind!=='file')continue;
   if(re.test(n))jobs.push((async()=>{const f=await e.getFile();if(f.size>2e6)return null;return parse(await f.text())})());
   else if(store==='Steam'&&n.toLowerCase()==='libraryfolders.vdf')jobs.push((async()=>{const t=await(await e.getFile()).text();libs=[...t.matchAll(/"path"\s+"([^"]+)"/gi)].map(m=>m[1].replace(/\\\\/g,'\\'));return null})());
  }
  for(const g of await Promise.all(jobs))if(g)games.push(g);
 }
 return{games,libs};
}
async function ensure(h,ask){const o={mode:'read'};try{if(await h.queryPermission(o)==='granted')return true;return !!ask&&(await h.requestPermission(o))==='granted'}catch(e){return false}}
async function findGames(store,o={}){
 if(!canDir()){if(o.ask){am(noDir()+' The manual option below still works.');$('#lman').open=true}return}
 const hs=await hget(store);let found=[],libs=[],good=0;pend.delete(store);
 if(!o.add)for(const h of hs){
  if(!await ensure(h,o.ask)){pend.add(store);continue}
  try{const r=await scanFolder(h,store);found=found.concat(r.games);libs=libs.concat(r.libs);good++}catch(e){pend.add(store)}
 }
 if(o.ask&&!o.noPick&&(o.add||!good)){
  am('Choose your '+store+' folder: '+DEF[store]);
  try{
   const h=await window.showDirectoryPicker({id:'gca-'+store.toLowerCase(),mode:'read'});
   const r=await scanFolder(h,store);
   if(!r.games.length){am('No '+store+' games found in that folder. Try '+DEF[store]+'.');return}
   found=found.concat(r.games);libs=libs.concat(r.libs);
   let dup=false;for(const g of hs){try{if(await g.isSameEntry(h))dup=true}catch(e){}}
   if(!dup){hs.push(h);await hput(store,hs);good++}
  }catch(e){am(e.name==='AbortError'?'':'Your browser would not open that folder ('+e.name+'). Use "Choose files manually" below.');return}
 }
 if(!found.length){if(o.ask)am('No saved '+store+' folder could be read. Use "Add another '+store+' folder" to pick it again.');return}
 const seen=new Set();found=found.filter(g=>!seen.has(g.id)&&seen.add(g.id));
 mergeGames(found);toast('Found '+found.length+' '+store+' game'+(found.length===1?'':'s'));
 const ex=[...new Set(libs)];
 am('Found '+found.length+' '+store+' game'+(found.length===1?'':'s')+' in '+good+' folder'+(good===1?'':'s')+'.'+(store==='Steam'&&ex.length>good?' Steam lists '+ex.length+' library folders ('+ex.join(', ')+'); use "Add another Steam folder" to include the rest.':''));
}
/* Custom games: .exe files added by hand. A page cannot start programs, so Play builds a .bat launcher. */
const tidy=n=>{let t=n.replace(/_+/g,' ').replace(/[ .-]v?\d+(\.\d+)+$/i,'');if(!/\s/.test(t)&&(t.match(/\./g)||[]).length>0)t=t.replace(/\./g,' ');return t.replace(/\s+/g,' ').trim()||n};
const exeName=p=>p.split(/[\\/]/).pop();
const exeDir=p=>/[\\/]/.test(p)?p.replace(/[\\/][^\\/]*$/,''):'';
// Desktop app: native dialog that returns full paths. Plain browser: a file input, which only gives names.
async function pickExes(){
 if(window.efs&&typeof window.efs.pickExe==='function'){
  const ps=await window.efs.pickExe();
  return Promise.all((ps||[]).map(async p=>{let st=null;try{st=await window.efs.stat(p)}catch(e){}return{path:p,size:st?st.size:0,mtime:st?st.mtimeMs:0}}));
 }
 return new Promise(res=>{
  const i=$('#afxf');
  i.onchange=()=>{const f=[...i.files];i.value='';res(f.map(x=>({path:'',name:x.name,mtime:x.lastModified})))};
  i.oncancel=()=>res([]);
  i.click();
 });
}
async function addExes(){
 let got;
 try{got=await pickExes()}catch(e){am('Could not open the file picker.');return}
 const seen=new Set(),rows=[];
 for(const g of got||[]){
  const file=exeName(g.path||g.name||'');
  if(!/\.exe$/i.test(file))continue;
  const key=(g.path||file).toLowerCase();
  if(seen.has(key))continue;
  seen.add(key);rows.push(Object.assign({},g,{file}));
 }
 if(!rows.length){am('');return}
 dialog('Add games','<p class="fx">Name each game as you want it to appear in the library.'+(rows.some(r=>!r.path)?' Your browser does not reveal file locations, so you will be asked for each game\'s full path the first time you press Play.':'')+'</p><div style="max-height:50vh;overflow:auto">'+
  rows.map((r,i)=>'<p class="fx" style="margin:10px 0 4px;word-break:break-all">'+esc(r.path||r.file)+'</p><input type="text" data-r="'+i+'" maxlength="80" autocomplete="off" aria-label="Name for '+esc(r.file)+'" value="'+esc(tidy(r.file.replace(/\.exe$/i,'')))+'">').join('')+
  '</div><div class="bar"><button type="button" id="axo">Add '+rows.length+' game'+(rows.length===1?'':'s')+'</button><button type="button" class="alt" data-x>Cancel</button></div>');
 const ins=[...document.querySelectorAll('#dl [data-r]')];
 const ok=()=>{
  const games=rows.map((r,i)=>({store:'Custom',id:'x:'+(r.path||r.file).toLowerCase(),name:(ins[i].value||'').trim()||tidy(r.file.replace(/\.exe$/i,'')),dir:exeDir(r.path||''),size:0,upd:r.mtime?Math.round(r.mtime/1000):0,exe:r.file,path:r.path||''}));
  closeDlg();mergeGames(games);
  toast('Added '+games.length+' game'+(games.length===1?'':'s'));am('Added '+games.length+' game'+(games.length===1?'':'s')+' to the library.');
 };
 $('#axo').onclick=ok;ins.forEach(i=>{i.onkeydown=e=>{if(e.key==='Enter')ok()}});
}
// Asks for the full Windows path of one game's .exe. play=1 builds the launcher right after saving.
function setExe(x,play){
 dialog('Game location','<p class="fx">Enter the full Windows path of the .exe for "'+esc(x.name)+'" (for example D:\\Games\\MyGame\\game.exe). A browser cannot read it from the file picker, and the launcher needs it to start the game.</p><input type="text" id="dpth" placeholder="D:\\Games\\MyGame\\game.exe" aria-label="Full path of the .exe" autocomplete="off" spellcheck="false" value="'+esc(x.path||'')+'"><div class="bar"><button type="button" id="dpo">Save</button><button type="button" class="alt" data-x>Cancel</button></div>');
 const go=()=>{
  const v=$('#dpth').value.trim().replace(/^"(.*)"$/,'$1');
  if(!/^([a-z]:[\\/]|\\\\)/i.test(v)||!/\.exe$/i.test(v)||v.includes('"')){toast('Enter a full path that ends in .exe');return}
  closeDlg();x.path=v;x.exe=exeName(v);x.dir=exeDir(v);save();
  if(play)mkbat(x);
 };
 $('#dpo').onclick=go;$('#dpth').onkeydown=e=>{if(e.key==='Enter')go()};
}
function mkbat(x){
 const p=x.path.replace(/%/g,'%%'),d=p.replace(/[\\/][^\\/]*$/,''),t='@echo off\r\ncd /d "'+d+'"\r\nstart "" "'+p+'"\r\n';
 const u=URL.createObjectURL(new Blob([t],{type:'text/plain'})),a=document.createElement('a');
 a.href=u;a.download=(x.name.replace(/[\\/:*?"<>|]+/g,'').trim()||'game')+'.bat';document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(u),4000);toast('Open the downloaded launcher to start the game');
}
$('#afx').onclick=addExes;
$('#afs').onclick=()=>findGames('Steam',{ask:1});
$('#afe').onclick=()=>findGames('Epic',{ask:1});
$('#afs2').onclick=()=>findGames('Steam',{ask:1,add:1});
$('#afe2').onclick=()=>findGames('Epic',{ask:1,add:1});
$('#aff').onclick=async()=>{await hput('Steam',[]);await hput('Epic',[]);am('Saved folders cleared.')};
// The saved folders are rescanned a moment after launch, not while the window is still opening.
setTimeout(async()=>{if(!canDir()){const m=$('#gm');m.textContent=noDir();m.hidden=false;return}for(const st of['Steam','Epic']){if((await hget(st)).length)await findGames(st)}lpend()},1500);
$('#gpb').onclick=async()=>{for(const st of[...pend])await findGames(st,{ask:1,noPick:1});lpend()};
$('#hcmp').onclick=cmp;
$('#hd').onclick=()=>{const ids=new Set([...document.querySelectorAll('#hl input:checked')].map(i=>i.value));hsave(hload().filter(x=>!ids.has(x.id)));hrender()};
let cf;$('#hx').onclick=e=>{const b=e.target;if(b.dataset.a){hsave([]);delete b.dataset.a;b.textContent='Clear all';clearTimeout(cf);hrender()}else{b.dataset.a=1;b.textContent='Click again to confirm';cf=setTimeout(()=>{delete b.dataset.a;b.textContent='Clear all'},4000)}};
$('#fi').onchange=e=>{if(e.target.files.length)handle([...e.target.files])};
['dragenter','dragover'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();dz.classList.add('on')}));
['dragleave','drop'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();dz.classList.remove('on')}));
dz.addEventListener('drop',e=>{if(e.dataTransfer.files.length)handle([...e.dataTransfer.files])});
/* Media player: shows your Jellyfin server's own web interface. Only the server address is saved. */
const JK='gca-jellyfin-last';
try{localStorage.removeItem('gca-jellyfin');localStorage.removeItem('gca-jellyfin-device')}catch(e){}
// Only a plain http(s) server address is ever accepted. javascript:, data:, file: and the like are dropped,
// because this address ends up in an iframe src and a link href.
const jsafe=v=>{try{const x=new URL(String(v).trim());return/^https?:$/.test(x.protocol)&&!x.username&&!x.password?x.origin+x.pathname.replace(/\/+$/,''):''}catch(e){return''}};
let J=jsafe((()=>{try{return localStorage.getItem(JK)||''}catch(e){return''}})());
function jview(load){
 const f=$('#jfr'),u=J?J+'/web/index.html':'';
 $('#jform').hidden=!!J;$('#lv').hidden=!!J;$('#japp').hidden=!J;if(J){if(window.lvPause)lvPause()}else if(!$('#p-media').hidden&&window.lvEnter)lvEnter();
 document.querySelector('main').classList.toggle('full',!!J&&!$('#p-media').hidden);$('#p-media').classList.toggle('cn',!!J);
 if(J){$('#jwho').textContent=J.replace(/^https?:\/\//,'');$('#jopen').href=u;if(load&&f.dataset.u!==u){f.dataset.u=u;f.src=u}}
 else if(f.dataset.u){f.src='about:blank';delete f.dataset.u}
}
const jopen=()=>jview(true);
$('#jfs').onclick=()=>{
 if(document.fullscreenElement){document.exitFullscreen();return}
 const e=$('#japp');(e.requestFullscreen?e.requestFullscreen():Promise.reject()).catch(()=>toast('Fullscreen is not available in this browser'));
};
document.addEventListener('fullscreenchange',()=>{$('#jfs').textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen'});
$('#jform').onsubmit=e=>{
 e.preventDefault();
 let u=$('#ju').value.trim().replace(/\/+$/,'').replace(/\/web(\/.*)?$/i,'');if(!u)return;
 if(!/^https?:\/\//i.test(u))u='http://'+u;
 const m=$('#jlm');
 u=jsafe(u);
 if(!u){m.textContent='That does not look like a valid server address.';m.hidden=false;return}
 if(location.protocol==='https:'&&/^http:/i.test(u)){m.textContent='This page is loaded over HTTPS, so the browser blocks plain http:// servers. Use an https:// address, or open this file from your computer.';m.hidden=false;return}
 m.hidden=true;J=u;try{localStorage.setItem(JK,u)}catch(x){}
 jview(true);
};
$('#jout').onclick=()=>{$('#ju').value=J;J='';try{localStorage.removeItem(JK)}catch(e){}jview(false)};
jview(false);

/* Home page previews: live numbers from saved scans, and up to 4 favorite games that launch on click */
function ago(t){const d=Math.floor((Date.now()-t)/864e5);return d<=0?'Today':d===1?'Yesterday':d<30?d+' days ago':new Date(t).toLocaleDateString()}
function homeRender(){
 const a=hload(),row=(k,v)=>'<span class="sw"><span>'+esc(k)+'</span><b>'+esc(v)+'</b></span>',none='<span class="sn">No scans yet. Analyze a crash file and the numbers show up here.</span>';
 const top=a.map(x=>x.f&&x.f[0]?x.f[0].t:'').filter(Boolean),cnt=new Map();
 top.forEach(t=>cnt.set(t,(cnt.get(t)||0)+1));
 let best='',bn=0;cnt.forEach((n,t)=>{if(n>bn){best=t;bn=n}});
 $('#hp-crash').innerHTML=a.length?row('Files analyzed',a.length)+row('Known crash pattern',top.length+' of '+a.length)+row('Most common cause',best?best+(bn>1?' (\u00d7'+bn+')':''):'None recognized'):none;
 const rep=top.filter(t=>cnt.get(t)>1).length;
 $('#hp-hist').innerHTML=a.length?row('Saved scans',a.length+' of 30')+row('Last scan',ago(a[0].at))+row('Repeat crashes',rep?rep+' scans':'None'):none;
 drvHome();
 const fv=lib.filter(x=>x.fav).sort((p,q)=>p.name.localeCompare(q.name)).slice(0,6),h=$('#hp-lib');
 h.innerHTML=fv.length?fv.map(x=>{const r=arts(x);return '<button type="button" class="gq" data-id="'+esc(x.id)+'" title="Play '+esc(x.name)+'" aria-label="Play '+esc(x.name)+'"><span class="fb" style="--h:'+hue(x.name)+'"><span>'+esc(x.name)+'</span></span>'+(r.length?'<img alt="" loading="lazy" data-n="1" src="'+esc(r[0])+'">':'')+'</button>'}).join(''):'<span class="sn">'+(lib.length?'No favorites yet. Right-click a game in the library and choose Add to Favorites.':'No games yet. Add your games in the Game library.')+'</span>';
}
function drvHome(){
 let d=null;try{d=JSON.parse(localStorage.getItem('gca-dv-last'))}catch(e){}
 const box=$('#hp-drv'),t=$('#hp-drv-t'),dflt='Find newer Microsoft-signed drivers for this PC and install the ones you pick.';
 if(!d||!Array.isArray(d.items)||!d.at){box.innerHTML='<span class="sn">No scan yet. Scan for driver updates and the results show up here.</span>';t.textContent=dflt;return}
 const it=d.items,n=it.length,row=x=>'<span class="sw"><b>'+esc(x.name)+'</b><span>'+esc(x.ver)+'</span></span>';
 const when=new Date(d.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
 t.textContent='Last scan: '+ago(d.at)+' at '+when+'. '+(n?n+' driver update'+(n>1?'s':'')+' found.':'No updates found.');
 box.innerHTML=n?(n<=3?it.map(row).join(''):it.slice(0,2).map(row).join('')+'<span class="sw"><span>+'+(n-2)+' more updates</span></span>'):'<span class="sn">Everything checked is up to date.</span>';
}
$('#hp-lib').addEventListener('click',e=>{const b=e.target.closest('.gq'),x=b&&lib.find(g=>g.id===b.dataset.id);if(!x)return;act('play',x);if(x.store!=='Custom')toast('Starting '+x.name)});
$('#hp-lib').addEventListener('error',e=>{const i=e.target;if(i.tagName!=='IMG')return;const b=i.closest('.gq'),x=b&&lib.find(g=>g.id===b.dataset.id),n=+i.dataset.n||0,r=x?arts(x):[];if(r[n]){i.dataset.n=n+1;i.src=r[n]}else i.remove()},true);
homeRender();
// Image fallbacks. These used to be inline onerror="" attributes, which the page's Content-Security-Policy does not allow.
document.addEventListener('error',e=>{
 const t=e.target;
 if(t instanceof HTMLImageElement&&t.dataset.oe)t.remove();
},true);

