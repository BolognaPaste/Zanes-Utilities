const $=s=>document.querySelector(s),out=$('#out'),dz=$('#dz');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const R={H:'Most likely',M:'Possible',L:'Contributing'},O={H:0,M:1,L:2};

function render(r){
 const s=document.createElement('section');
 r.findings.sort((a,b)=>O[a.s]-O[b.s]);
 const rep=['Crash analysis: '+r.name,...r.findings.map((f,i)=>(i+1)+'. ['+R[f.s]+'] '+f.t+': '+f.w+' Try: '+f.x+(f.e?' ('+f.e.split('\n')[0]+')':''))].join('\n');
 let h='<h2>'+esc(r.name)+'</h2>';
 if(r.err)h+='<p class="err">'+esc(r.err)+'</p>';
 h+=r.findings.length?r.findings.map(f=>'<div class="f '+f.s+'"><b>'+esc(f.t)+'</b><span class="tag">'+R[f.s]+'</span><p>'+esc(f.w)+'</p><p class="fx">Try: '+esc(f.x)+'</p>'+(f.e?'<pre>'+esc(f.e)+'</pre>':'')+'</div>').join(''):(r.err?'':'<div class="f"><b>No known crash pattern found</b><p>Nothing in this file matched the built-in rules. The key lines below are the best place to start.</p></div>');
 if(r.facts.length)h+='<h3>Details</h3><div class="tw"><table>'+r.facts.map(([k,v])=>'<tr><th>'+esc(k)+'</th><td>'+esc(v)+'</td></tr>').join('')+'</table></div>';
 if(r.key&&r.key.length)h+='<h3>Key lines</h3><pre>'+esc(r.key.join('\n'))+'</pre>';
 if(r.html)h+=r.html;
 if(r.mods&&r.mods.length)h+='<details><summary>'+r.mods.length+' loaded modules</summary><pre>'+esc(r.mods.join('\n'))+'</pre></details>';
 if(r.findings.length)h+='<button type="button">Copy summary</button>';
 s.innerHTML=h;
 const b=s.querySelector('button');
 if(b)b.onclick=()=>{navigator.clipboard.writeText(rep).then(()=>{b.textContent='Copied'}).catch(()=>{b.textContent='Copy blocked by browser'})};
 out.append(s);
 if(!r.err)addHist(r);
}

// Crash files are read and scanned on a worker thread (crash-worker.js), so a large log or dump never freezes the
// window. If a worker cannot start, the scan runs here as before.
let crashWorker=null;
function crashScan(f){
 try{crashWorker=crashWorker||new Worker('crash-worker.js')}catch{return scanFile(f)}
 const w=crashWorker;
 return new Promise(res=>{
  w.onmessage=e=>res(e.data);
  w.onerror=e=>{e.preventDefault();w.terminate();crashWorker=null;res(scanFile(f))};
  w.postMessage(f);
 });
}
async function handle(files){
 out.innerHTML='';
 for(const f of files){
  let r=await crashScan(f);
  if(r.xml!==undefined){try{r=window.anXml?window.anXml(f.name,r.xml):anText(f.name,r.xml)}catch(e){r={name:f.name,facts:[],findings:[],err:e.message}}}
  render(r);
 }
 if(crashWorker){crashWorker.terminate();crashWorker=null}
 out.scrollIntoView({block:'start'});
}
document.querySelectorAll('.nv').forEach(b=>b.onclick=()=>{
 const own=b.closest('.ng');document.querySelectorAll('nav .ng').forEach(g=>{const inG=g===own;g.classList.toggle('has-cur',inG);if(inG)g.open=true});
 document.querySelectorAll('.nv').forEach(x=>x===b?x.setAttribute('aria-current','page'):x.removeAttribute('aria-current'));
 document.querySelectorAll('.pg').forEach(p=>{p.hidden=p.id!=='p-'+b.dataset.p});
 if(b.dataset.p==='hist')hrender();if(b.dataset.p==='home')homeRender();
 document.querySelector('main').classList.toggle('wide',b.dataset.p==='next'||b.dataset.p==='media'||b.dataset.p==='games'||b.dataset.p==='fmhy'||b.dataset.p==='vault'||b.dataset.p==='phone'||b.dataset.p==='ssh'||b.dataset.p==='shred'||b.dataset.p==='crash'||b.dataset.p==='hist'||b.dataset.p==='opt'||b.dataset.p==='drv'||b.dataset.p==='settings'||b.dataset.p==='test'||b.dataset.p==='home');document.querySelector('main').classList.remove('full');document.querySelector('main').classList.toggle('fmw',b.dataset.p==='fmhy'||b.dataset.p==='vault');if(b.dataset.p==='fmhy'){if(window.fmEnter)fmEnter()}else if(window.fmPause)fmPause();if(b.dataset.p==='media')jopen();else if(window.lvPause)lvPause();if(b.dataset.p==='games'){if(window.gmEnter)gmEnter()}else if(window.gmPause)gmPause();if(b.dataset.p==='phone'){if(window.phEnter)phEnter()}else if(window.phPause)phPause();closeMenu();
});

document.querySelectorAll('#p-drv [data-j]').forEach(b=>b.onclick=()=>{
 const t=document.getElementById(b.dataset.j);if(!t)return;
 if(t.tagName==='DETAILS')t.open=true;
 t.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
 document.querySelectorAll('#p-drv [data-j]').forEach(x=>x.removeAttribute('data-on'));b.dataset.on='1';
});

document.querySelectorAll('[data-go]').forEach(c=>c.onclick=()=>document.querySelector('.nv[data-p="'+c.dataset.go+'"]').click());

(()=>{
 document.querySelectorAll('nav .ng').forEach(g=>{
  const K='gca-nav-'+g.id.replace(/^ng-/,'');
  try{if(localStorage.getItem(K)==='1')g.open=true}catch(e){}
  g.addEventListener('toggle',()=>{try{localStorage.setItem(K,g.open?'1':'0')}catch(e){}});
 });
})();

(()=>{
 const b=$('#ntg'),K='gca-nav';
 const set=c=>{document.body.classList.toggle('nc',c);b.setAttribute('aria-expanded',String(!c));b.textContent=c?'☰':'☰ Zane\'s Utilities';try{localStorage.setItem(K,c?'1':'0')}catch(e){}};
 let c=false;try{c=localStorage.getItem(K)==='1'}catch(e){}
 set(c);b.onclick=()=>set(!document.body.classList.contains('nc'));
})();

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
const tidy=n=>{let t=n.replace(/_+/g,' ').replace(/[ .-]v?\d+(\.\d+)+$/i,'');if(!/\s/.test(t)&&(t.match(/\./g)||[]).length>0)t=t.replace(/\./g,' ');return t.replace(/\s+/g,' ').trim()||n};
const exeName=p=>p.split(/[\\/]/).pop();
const exeDir=p=>/[\\/]/.test(p)?p.replace(/[\\/][^\\/]*$/,''):'';
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
setTimeout(async()=>{if(!canDir()){const m=$('#gm');m.textContent=noDir();m.hidden=false;return}for(const st of['Steam','Epic']){if((await hget(st)).length)await findGames(st)}lpend()},1500);
$('#gpb').onclick=async()=>{for(const st of[...pend])await findGames(st,{ask:1,noPick:1});lpend()};
$('#hcmp').onclick=cmp;
$('#hd').onclick=()=>{const ids=new Set([...document.querySelectorAll('#hl input:checked')].map(i=>i.value));hsave(hload().filter(x=>!ids.has(x.id)));hrender()};
let cf;$('#hx').onclick=e=>{const b=e.target;if(b.dataset.a){hsave([]);delete b.dataset.a;b.textContent='Clear all';clearTimeout(cf);hrender()}else{b.dataset.a=1;b.textContent='Click again to confirm';cf=setTimeout(()=>{delete b.dataset.a;b.textContent='Clear all'},4000)}};
$('#fi').onchange=e=>{if(e.target.files.length)handle([...e.target.files])};
['dragenter','dragover'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();dz.classList.add('on')}));
['dragleave','drop'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();dz.classList.remove('on')}));
dz.addEventListener('drop',e=>{if(e.dataTransfer.files.length)handle([...e.dataTransfer.files])});
const JK='gca-jellyfin-last';
try{localStorage.removeItem('gca-jellyfin');localStorage.removeItem('gca-jellyfin-device')}catch(e){}
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
document.addEventListener('error',e=>{
 const t=e.target;
 if(t instanceof HTMLImageElement&&t.dataset.oe)t.remove();
},true);

