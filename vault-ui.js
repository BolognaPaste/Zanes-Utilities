/* Bitwarden-style vault UI for Zane's Utilities */
(function () {
  'use strict';

  // ─── CSS ─────────────────────────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    #vt-host{display:flex;background:var(--bg);position:relative;border:1px solid var(--bd);box-sizing:border-box;}
    /* lock */
    .vt-lock-wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);}
    .vt-card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:32px;width:100%;max-width:400px;box-shadow:0 4px 24px rgba(0,0,0,.08);}
    .vt-lock-icon{text-align:center;color:var(--acc);margin-bottom:14px;}
    .vt-lock-title{font:700 1.25rem/1 system-ui,sans-serif;color:var(--fg);text-align:center;margin:0 0 4px;}
    .vt-lock-sub{font-size:.8125rem;color:var(--mut);text-align:center;margin:0 0 22px;}
    .vt-tabs{display:flex;border-bottom:2px solid var(--bd);margin-bottom:20px;}
    .vt-tab{flex:1;padding:9px 0;font:.625rem/1 system-ui,sans-serif;font-size:.875rem;font-weight:600;color:var(--mut);background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:color .15s,border-color .15s;}
    .vt-tab.active{color:var(--acc);border-bottom-color:var(--acc);}
    .vt-tab:hover:not(.active){color:var(--fg);}
    /* form */
    .vt-label{display:block;font-size:.75rem;font-weight:600;color:var(--fg);margin-bottom:4px;}
    .vt-field{margin-bottom:12px;}
    .vt-iw{position:relative;}
    .vt-iw .vt-inp{padding-right:38px;}
    .vt-inp{width:100%;padding:9px 12px;font-size:.875rem;border:1.5px solid var(--bd);border-radius:8px;background:var(--card);color:var(--fg);outline:none;transition:border-color .15s,box-shadow .15s;box-sizing:border-box;}
    .vt-inp:focus{border-color:var(--acc);box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 22%,transparent);}
    .vt-inp:disabled{background:var(--code);cursor:not-allowed;}
    .vt-eye{position:absolute;right:9px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--mut);padding:3px;display:flex;line-height:0;}
    .vt-eye:hover{color:var(--acc);}
    /* strength */
    .vt-segs{display:flex;gap:4px;margin-bottom:6px;}
    .vt-seg{flex:1;height:4px;border-radius:2px;background:var(--bd);transition:background .2s;}
    .vt-seg.s1{background:#ef4444;}.vt-seg.s2{background:#f97316;}.vt-seg.s3{background:#eab308;}.vt-seg.s4{background:#22c55e;}.vt-seg.s5{background:#10b981;}
    .vt-str-lbl{font-size:.75rem;color:var(--mut);margin-bottom:12px;}
    /* buttons */
    .vt-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 16px;font-size:.875rem;font-weight:600;border-radius:8px;border:none;cursor:pointer;transition:background .15s,opacity .15s;white-space:nowrap;line-height:1;}
    .vt-btn:disabled{opacity:.45;cursor:not-allowed;}
    .vt-btn-p{background:var(--acc);color:var(--card);width:100%;}
    .vt-btn-p:hover:not(:disabled){background:color-mix(in srgb,var(--acc) 85%,#000);}
    .vt-btn-s{background:transparent;color:var(--acc);border:1.5px solid var(--acc);}
    .vt-btn-s:hover:not(:disabled){background:color-mix(in srgb,var(--acc) 10%,transparent);}
    .vt-btn-g{background:transparent;color:var(--fg);border:1.5px solid var(--bd);}
    .vt-btn-g:hover:not(:disabled){background:var(--code);color:var(--fg);}
    .vt-btn-d{background:var(--h);color:var(--card);}
    .vt-btn-d:hover:not(:disabled){background:color-mix(in srgb,var(--h) 85%,#000);}
    .vt-pick-row{display:flex;gap:8px;align-items:center;margin-bottom:12px;}
    .vt-pick-name{flex:1;font-size:.8125rem;color:var(--mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
    /* sidebar (same look as the app's menu) */
    .vt-sb{width:224px;flex:none;background:var(--card);border-right:1px solid var(--bd);display:flex;flex-direction:column;height:100%;overflow:hidden;}
    .vt-sb-head{padding:16px;border-bottom:1px solid var(--bd);flex:none;}
    .vt-sb-name{font-size:.875rem;font-weight:700;color:var(--fg);display:flex;align-items:center;gap:8px;overflow:hidden;}
    .vt-sb-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .vt-sb-bytes{font-size:.6875rem;color:var(--mut);margin-top:3px;}
    .vt-sb-sect{font-size:.625rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);padding:14px 16px 6px;}
    .vt-sb-list{flex:1;overflow-y:auto;padding:0 8px;}
    .vt-sb-item{display:flex;align-items:center;gap:8px;padding:8px;border-radius:4px;font-size:.8125rem;color:var(--fg);cursor:pointer;transition:background .12s,color .12s;margin-bottom:2px;line-height:1;}
    .vt-sb-item:hover{background:var(--code);}
    .vt-sb-item.active{background:#52258f;color:#fff;font-weight:600;}
    .vt-sb-cnt{margin-left:auto;font-size:.625rem;background:var(--code);color:var(--mut);border-radius:10px;padding:2px 7px;}
    .vt-sb-item.active .vt-sb-cnt{background:rgba(255,255,255,.2);color:#fff;}
    .vt-sb-foot{padding:10px 8px;border-top:1px solid var(--bd);display:flex;flex-direction:column;gap:3px;flex:none;}
    .vt-sb-act{display:flex;align-items:center;gap:8px;padding:8px;border-radius:4px;font-size:.8125rem;color:var(--fg);cursor:pointer;background:none;border:none;width:100%;text-align:left;transition:background .12s,color .12s;line-height:1;}
    .vt-sb-act:hover{background:var(--code);}
    /* main */
    .vt-main{flex:1;display:flex;flex-direction:column;height:100%;overflow:hidden;min-width:0;}
    .vt-toolbar{display:flex;align-items:center;gap:10px;padding:12px 20px;border-bottom:1px solid var(--bd);background:var(--card);flex:none;}
    .vt-sw{position:relative;flex:1;}
    .vt-si{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--mut);pointer-events:none;display:flex;}
    .vt-sinp{width:100%;padding:8px 10px 8px 34px;font-size:.875rem;border:1.5px solid var(--bd);border-radius:8px;background:var(--code);color:var(--fg);outline:none;transition:border-color .15s;box-sizing:border-box;}
    .vt-sinp:focus{border-color:var(--acc);background:var(--card);}
    .vt-selbar{display:flex;align-items:center;gap:10px;padding:9px 20px;background:color-mix(in srgb,var(--acc) 12%,var(--card));border-bottom:1px solid color-mix(in srgb,var(--acc) 35%,var(--bd));flex:none;}
    .vt-sel-count{font-size:.875rem;font-weight:600;color:var(--acc);flex:1;}
    .vt-table-wrap{flex:1;overflow-y:auto;background:var(--card);}
    table.vt-t{width:100%;border-collapse:collapse;font-size:.8125rem;}
    table.vt-t th{position:sticky;top:0;background:var(--code);font-size:.6875rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);padding:10px 14px;border-bottom:1.5px solid var(--bd);white-space:nowrap;text-align:left;}
    table.vt-t td{padding:9px 14px;border-bottom:1px solid var(--bd);color:var(--fg);vertical-align:middle;}
    table.vt-t tr:last-child td{border-bottom:none;}
    table.vt-t tr:hover td{background:var(--code);}
    .vt-cb-col{width:36px;}.vt-bd-col{width:60px;}.vt-sz-col{width:76px;text-align:right!important;}.vt-dt-col{width:100px;}
    table.vt-t .vt-sz-col,table.vt-t .vt-dt-col{color:var(--mut);}
    .vt-fn{font-weight:500;}.vt-fp{font-size:.75rem;color:var(--mut);margin-top:1px;}
    .vt-badge{display:inline-flex;font-size:.625rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:4px;}
    .vt-statusbar{display:flex;align-items:center;gap:10px;padding:8px 20px;border-top:1px solid var(--bd);background:var(--code);font-size:.75rem;color:var(--mut);flex:none;}
    .vt-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-right:4px;}
    .vt-sep{color:var(--bd);}
    /* empty */
    .vt-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:var(--mut);}
    .vt-empty svg{margin-bottom:12px;opacity:.35;}
    /* overlay */
    .vt-overlay{position:absolute;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:100;backdrop-filter:blur(2px);}
    .vt-modal{background:var(--card);border-radius:12px;padding:28px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.2);}
    .vt-modal-title{font-size:1rem;font-weight:700;color:var(--fg);margin:0 0 16px;display:flex;align-items:center;gap:8px;}
    .vt-modal-btns{display:flex;gap:8px;margin-top:20px;}
    .vt-modal-btns .vt-btn{flex:1;}
    /* progress */
    .vt-prog-card{background:var(--card);border-radius:12px;padding:28px;width:100%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,.2);text-align:center;}
    .vt-prog-ttl{font-size:.875rem;font-weight:600;color:var(--fg);margin-bottom:4px;}
    .vt-prog-f{font-size:.75rem;color:var(--mut);margin-bottom:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .vt-prog-bar{background:var(--bd);border-radius:4px;height:8px;overflow:hidden;margin-bottom:16px;}
    .vt-prog-fill{height:100%;background:var(--acc);transition:width .1s;border-radius:4px;}
    /* toast */
    .vt-toast{position:absolute;bottom:20px;right:20px;z-index:200;display:flex;flex-direction:column;gap:8px;pointer-events:none;}
    .vt-ti{display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:8px;font-size:.8125rem;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.14);max-width:320px;pointer-events:auto;background:var(--card);}
    .vt-ti.ok{border-left:4px solid #22c55e;color:var(--fg);}
    .vt-ti.err{border-left:4px solid var(--h);color:var(--fg);}
    /* err box */
    .vt-err{background:color-mix(in srgb,var(--h) 10%,var(--card));border:1px solid color-mix(in srgb,var(--h) 35%,var(--bd));border-radius:8px;padding:10px 14px;font-size:.8125rem;color:var(--h);margin-bottom:12px;}
    /* na */
    .vt-na{flex:1;display:flex;align-items:center;justify-content:center;}
    .vt-na-card{text-align:center;padding:40px;}
    .vt-na-card svg{color:var(--mut);margin-bottom:12px;}
    .vt-na-title{font-size:1rem;font-weight:600;color:var(--fg);margin:0 0 8px;}
    .vt-na-sub{font-size:.875rem;color:var(--mut);margin:0;}
    /* checkbox */
    .vt-cb{accent-color:var(--acc);width:15px;height:15px;cursor:pointer;}
    /* scrollbars */
    .vt-sb-list::-webkit-scrollbar,.vt-table-wrap::-webkit-scrollbar{width:5px;}
    .vt-sb-list::-webkit-scrollbar-track,.vt-table-wrap::-webkit-scrollbar-track{background:transparent;}
    .vt-sb-list::-webkit-scrollbar-thumb{background:var(--bd);border-radius:3px;}
    .vt-table-wrap::-webkit-scrollbar-thumb{background:var(--bd);border-radius:3px;}
    @keyframes vt-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    .vt-spin{animation:vt-spin 1s linear infinite;}
  `;
  document.head.appendChild(styleEl);

  // ─── Refs ─────────────────────────────────────────────────────────────────
  const api = window.vault;
  const pg = document.getElementById('p-vault');     // the whole page (title + box), shown and hidden by the menu
  const page = document.getElementById('vt-host');   // the box the vault draws into
  if (!pg || !page) return;

  // ─── Icons ────────────────────────────────────────────────────────────────
  const I = {
    shield40: `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/></svg>`,
    shield16: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"/></svg>`,
    folder: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"/></svg>`,
    files: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>`,
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z"/></svg>`,
    plus: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>`,
    download: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>`,
    trash: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>`,
    lock: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>`,
    key: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"/></svg>`,
    eyeOn: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
    eyeOff: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/></svg>`,
    spinner: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" class="vt-spin"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity=".2"/><path d="M22 12a10 10 0 01-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
    x: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>`,
    emptyFile: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>`,
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const $ = id => document.getElementById(id);
  const fmtSize = b => {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1).replace(/\.0$/,'') + ' KB';
    if (b < 1073741824) return (b/1048576).toFixed(1).replace(/\.0$/,'') + ' MB';
    return (b/1073741824).toFixed(2) + ' GB';
  };
  const fmtDate = ts => {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  };
  const fname = p => p.includes('/') ? p.split('/').pop() : p;
  const fdir  = p => p.includes('/') ? p.split('/').slice(0,-1).join('/') : '';

  const TYPES = {
    pdf:{c:'#ef4444',b:'#fef2f2',l:'PDF'}, doc:{c:'#2563eb',b:'#eff6ff',l:'DOC'}, docx:{c:'#2563eb',b:'#eff6ff',l:'DOCX'},
    xls:{c:'#16a34a',b:'#f0fdf4',l:'XLS'}, xlsx:{c:'#16a34a',b:'#f0fdf4',l:'XLSX'},
    ppt:{c:'#ea580c',b:'#fff7ed',l:'PPT'}, pptx:{c:'#ea580c',b:'#fff7ed',l:'PPTX'},
    jpg:{c:'#7c3aed',b:'#f5f3ff',l:'IMG'}, jpeg:{c:'#7c3aed',b:'#f5f3ff',l:'IMG'},
    png:{c:'#7c3aed',b:'#f5f3ff',l:'IMG'}, gif:{c:'#7c3aed',b:'#f5f3ff',l:'GIF'},
    webp:{c:'#7c3aed',b:'#f5f3ff',l:'IMG'}, svg:{c:'#7c3aed',b:'#f5f3ff',l:'SVG'},
    mp4:{c:'#0e7490',b:'#ecfeff',l:'MP4'}, mov:{c:'#0e7490',b:'#ecfeff',l:'VID'},
    mkv:{c:'#0e7490',b:'#ecfeff',l:'MKV'}, mp3:{c:'#db2777',b:'#fdf2f8',l:'MP3'},
    wav:{c:'#db2777',b:'#fdf2f8',l:'WAV'}, flac:{c:'#db2777',b:'#fdf2f8',l:'FLAC'},
    zip:{c:'#b45309',b:'#fffbeb',l:'ZIP'}, rar:{c:'#b45309',b:'#fffbeb',l:'RAR'},
    '7z':{c:'#b45309',b:'#fffbeb',l:'7Z'},
    txt:{c:'#475569',b:'#f1f5f9',l:'TXT'}, md:{c:'#475569',b:'#f1f5f9',l:'MD'},
    json:{c:'#059669',b:'#ecfdf5',l:'JSON'}, js:{c:'#d97706',b:'#fefce8',l:'JS'},
    ts:{c:'#2563eb',b:'#eff6ff',l:'TS'}, py:{c:'#2563eb',b:'#eff6ff',l:'PY'},
    exe:{c:'#374151',b:'#f3f4f6',l:'EXE'},
  };
  const typeOf = name => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const t = TYPES[ext] || { c:'#6b7280', l: ext.toUpperCase().slice(0,4) || 'FILE' };
    return { c: t.c, b: 'color-mix(in srgb,' + t.c + ' 15%,transparent)', l: t.l };
  };

  // ─── State ────────────────────────────────────────────────────────────────
  let vaultData  = null;
  let sel        = new Set();
  let folderFlt  = null;
  let searchQ    = '';
  let busy       = false;
  let pickedFile = null;
  let offProg    = null;

  // ─── Scaffold ─────────────────────────────────────────────────────────────
  if (!api) {
    page.innerHTML = `<div class="vt-na"><div class="vt-na-card">${I.shield40}<h2 class="vt-na-title">Encrypted vault</h2><p class="vt-na-sub">Only works in the Zane's Utilities<br>desktop app on Windows.</p></div></div>`;
    return;
  }

  page.innerHTML = `
    <div id="vt-lock" class="vt-lock-wrap"></div>
    <div id="vt-browser" style="display:none;flex:1;flex-direction:row;height:100%;overflow:hidden;">
      <aside class="vt-sb">
        <div class="vt-sb-head">
          <div class="vt-sb-name">${I.shield16}<span id="vt-sb-nm">Vault</span></div>
          <div class="vt-sb-bytes" id="vt-sb-by"></div>
        </div>
        <div class="vt-sb-sect">Folders</div>
        <div class="vt-sb-list" id="vt-sb-list"></div>
        <div class="vt-sb-foot">
          <button class="vt-sb-act" id="vt-cpb">${I.key} Change password</button>
          <button class="vt-sb-act" id="vt-lockb">${I.lock} Lock vault</button>
        </div>
      </aside>
      <div class="vt-main">
        <div class="vt-toolbar">
          <div class="vt-sw"><span class="vt-si">${I.search}</span>
            <input class="vt-sinp" id="vt-search" type="search" placeholder="Search files…" autocomplete="off">
          </div>
          <button class="vt-btn vt-btn-p" id="vt-addf" style="flex:none">${I.plus} Add files</button>
          <button class="vt-btn vt-btn-g" id="vt-addd" style="flex:none">${I.folder} Folder</button>
        </div>
        <div class="vt-selbar" id="vt-selbar" style="display:none">
          <span class="vt-sel-count" id="vt-sel-count"></span>
          <button class="vt-btn vt-btn-s" id="vt-ext" style="padding:6px 12px;font-size:.8125rem">${I.download} Extract</button>
          <button class="vt-btn vt-btn-d" id="vt-rm" style="padding:6px 12px;font-size:.8125rem">${I.trash} Remove</button>
          <button class="vt-btn vt-btn-g" id="vt-sel-clr" style="padding:6px 10px;font-size:.8125rem">${I.x}</button>
        </div>
        <div class="vt-table-wrap" id="vt-table-wrap"></div>
        <div class="vt-statusbar">
          <span><span class="vt-dot"></span>Unlocked</span>
          <span class="vt-sep">·</span><span id="vt-stat-n">0 files</span>
          <span class="vt-sep">·</span><span id="vt-stat-s">0 B</span>
        </div>
      </div>
    </div>
    <div id="vt-prog" class="vt-overlay" style="display:none">
      <div class="vt-prog-card">
        <div style="color:var(--acc);display:flex;justify-content:center;margin-bottom:12px">${I.spinner}</div>
        <div class="vt-prog-ttl" id="vt-prog-ttl">Working…</div>
        <div class="vt-prog-f" id="vt-prog-f"></div>
        <div class="vt-prog-bar"><div class="vt-prog-fill" id="vt-prog-fill" style="width:0%"></div></div>
        <button class="vt-btn vt-btn-g" id="vt-cancel" style="width:100%">${I.x} Cancel</button>
      </div>
    </div>
    <div id="vt-cpmodal" class="vt-overlay" style="display:none">
      <div class="vt-modal">
        <div class="vt-modal-title">${I.key} Change password</div>
        <div id="vt-cp-err"></div>
        <div class="vt-field"><label class="vt-label">Current password</label>
          <div class="vt-iw"><input class="vt-inp" type="password" id="vt-cp-old" autocomplete="off" placeholder="Current password">
          <button class="vt-eye" data-eye="vt-cp-old">${I.eyeOn}</button></div></div>
        <div class="vt-field"><label class="vt-label">New password</label>
          <div class="vt-iw"><input class="vt-inp" type="password" id="vt-cp-new" autocomplete="new-password" placeholder="At least 12 characters">
          <button class="vt-eye" data-eye="vt-cp-new">${I.eyeOn}</button></div></div>
        <div class="vt-field"><label class="vt-label">Confirm new password</label>
          <div class="vt-iw"><input class="vt-inp" type="password" id="vt-cp-new2" autocomplete="new-password" placeholder="Repeat new password">
          <button class="vt-eye" data-eye="vt-cp-new2">${I.eyeOn}</button></div></div>
        <div class="vt-modal-btns">
          <button class="vt-btn vt-btn-g" id="vt-cpx">Cancel</button>
          <button class="vt-btn vt-btn-p" id="vt-cps">Change password</button>
        </div>
      </div>
    </div>
    <div id="vt-toast" class="vt-toast"></div>
  `;

  // ─── Toast ────────────────────────────────────────────────────────────────
  function toast(msg, kind) {
    const tc = $('vt-toast'), el = document.createElement('div');
    el.className = `vt-ti ${kind || 'ok'}`;
    el.innerHTML = (kind === 'err' ? I.x : I.check) + ' ' + esc(msg);
    tc.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // ─── Progress overlay ─────────────────────────────────────────────────────
  function showProg(title) {
    $('vt-prog-ttl').textContent = title;
    $('vt-prog-f').textContent = '';
    $('vt-prog-fill').style.width = '0%';
    $('vt-prog').style.display = 'flex';
    if (offProg) { offProg(); offProg = null; }
    offProg = api.onProgress(m => {
      if (m.t === 'p') {
        $('vt-prog-f').textContent = m.name || '';
        const pct = m.total ? Math.round(100 * m.done / m.total) : 0;
        $('vt-prog-fill').style.width = pct + '%';
      } else if (m.t === 'locked') {
        hideProg(); setLocked(m.reason === 'idle' ? 'Vault locked after 10 minutes of inactivity.' : null);
      }
    });
  }
  function hideProg() {
    $('vt-prog').style.display = 'none';
    if (offProg) { offProg(); offProg = null; }
    // showProg() replaced the idle-lock listener with the progress one, so put it back while a vault is open.
    if (vaultData) listenIdle();
  }

  // ─── Lock screen ──────────────────────────────────────────────────────────
  function renderLock(tab) {
    tab = tab || 'open';
    const el = $('vt-lock');

    const openTab = () => `
      <div class="vt-pick-row">
        <button class="vt-btn vt-btn-g" id="vt-pick" style="font-size:.8125rem;padding:7px 12px">Browse…</button>
        <span class="vt-pick-name" id="vt-pick-name">${pickedFile ? esc(pickedFile.name) : 'No vault file chosen'}</span>
      </div>
      <div class="vt-field"><div class="vt-iw">
        <input class="vt-inp" type="password" id="vt-pw" placeholder="Vault password" autocomplete="off" ${!pickedFile?'disabled':''}>
        <button class="vt-eye" data-eye="vt-pw">${I.eyeOn}</button>
      </div></div>
      <button class="vt-btn vt-btn-p" id="vt-unlock" ${!pickedFile?'disabled':''}>Unlock vault</button>`;

    const createTab = () => `
      <div class="vt-field"><div class="vt-iw">
        <input class="vt-inp" type="password" id="vt-np" placeholder="New password (≥12 characters)" autocomplete="new-password">
        <button class="vt-eye" data-eye="vt-np">${I.eyeOn}</button>
      </div></div>
      <div class="vt-field"><div class="vt-iw">
        <input class="vt-inp" type="password" id="vt-np2" placeholder="Repeat password" autocomplete="new-password">
        <button class="vt-eye" data-eye="vt-np2">${I.eyeOn}</button>
      </div></div>
      <div class="vt-segs">${[1,2,3,4,5].map(n=>`<div class="vt-seg" id="vt-seg-${n}"></div>`).join('')}</div>
      <div class="vt-str-lbl" id="vt-str-lbl">Enter a password</div>
      <div class="vt-str-lbl">There is no password recovery: if you forget it, nobody can open the files.</div>
      <button class="vt-btn vt-btn-p" id="vt-create">Create vault…</button>`;

    el.innerHTML = `<div class="vt-card">
      <div class="vt-lock-icon">${I.shield40}</div>
      <h1 class="vt-lock-title">Encrypted Vault</h1>
      <p class="vt-lock-sub">AES-256 · scrypt · zero knowledge</p>
      <div class="vt-tabs">
        <button class="vt-tab ${tab==='open'?'active':''}" id="vt-tab-open">Open vault</button>
        <button class="vt-tab ${tab==='create'?'active':''}" id="vt-tab-create">Create new</button>
      </div>
      <div id="vt-ls-err"></div>
      ${tab === 'open' ? openTab() : createTab()}
    </div>`;

    // Tabs
    $('vt-tab-open').onclick = () => renderLock('open');
    $('vt-tab-create').onclick = () => renderLock('create');

    if (tab === 'open') {
      $('vt-pick').onclick = doPick;
      $('vt-unlock').onclick = doUnlock;
      const pw = $('vt-pw');
      if (pw) pw.onkeydown = e => { if (e.key === 'Enter') doUnlock(); };
    } else {
      const np = $('vt-np');
      if (np) np.oninput = () => updateStrength(np.value);
      $('vt-create').onclick = doCreate;
    }
  }

  function lsErr(msg) {
    const el = $('vt-ls-err');
    if (el) el.innerHTML = msg ? `<div class="vt-err">${esc(msg)}</div>` : '';
  }

  function updateStrength(pw) {
    let s = 0;
    if (pw.length >= 8)  s++;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    const lbl = $('vt-str-lbl');
    if (lbl) lbl.textContent = pw ? ['','Weak','Fair','Good','Strong','Very strong'][s] : 'Enter a password';
    [1,2,3,4,5].forEach(n => {
      const seg = $('vt-seg-' + n);
      if (seg) seg.className = 'vt-seg' + (n <= s ? ' s'+s : '');
    });
  }

  async function doPick() {
    if (busy) return;
    const r = await api.pick();
    if (r && r.ok && r.data) { pickedFile = r.data; renderLock('open'); }
  }

  async function doUnlock() {
    if (busy || !pickedFile) return;
    const pw = $('vt-pw'); if (!pw || !pw.value) { lsErr('Enter the password.'); return; }
    busy = true; showProg('Unlocking vault…');
    const r = await api.open(pickedFile.file, pw.value).finally(() => { busy = false; hideProg(); });
    if (r.ok) setUnlocked(r.data);
    else if (!r.declined) lsErr(r.error || 'Failed to unlock.');
  }

  async function doCreate() {
    if (busy) return;
    const np = $('vt-np'), np2 = $('vt-np2');
    if (!np || !np.value) { lsErr('Enter a new password.'); return; }
    if (np.value.length < 12) { lsErr('Use at least 12 characters.'); return; }
    if (np.value !== np2.value) { lsErr('Passwords do not match.'); return; }
    busy = true; showProg('Creating vault…');
    const r = await api.create(np.value).finally(() => { busy = false; hideProg(); });
    if (r.ok) setUnlocked(r.data);
    else if (!r.declined) lsErr(r.error || 'Failed to create vault.');
  }

  // ─── Browser rendering ────────────────────────────────────────────────────
  function renderBrowser() {
    if (!vaultData) return;
    $('vt-sb-nm').textContent = vaultData.name;
    $('vt-sb-by').textContent = fmtSize(vaultData.bytes);
    renderFolderList();
    renderTable();
    updateStatus();
    updateSelBar();
  }

  function filteredFiles() {
    let files = vaultData ? vaultData.files : [];
    if (folderFlt) files = files.filter(f => { const d = fdir(f.name); return d === folderFlt || d.startsWith(folderFlt+'/'); });
    if (searchQ)   files = files.filter(f => f.name.toLowerCase().includes(searchQ.toLowerCase()));
    return files;
  }

  function renderFolderList() {
    const list = $('vt-sb-list');
    const files = vaultData ? vaultData.files : [];
    const dirs = new Set();
    files.forEach(f => { const p = f.name.split('/'); for (let i=1;i<p.length;i++) dirs.add(p.slice(0,i).join('/')); });
    const sorted = [...dirs].sort();

    list.innerHTML = `
      <div class="vt-sb-item ${folderFlt===null?'active':''}" id="vt-sb-all">${I.files} All files
        <span class="vt-sb-cnt">${files.length}</span></div>
      ${sorted.map(f => {
        const depth = f.split('/').length - 1;
        const label = f.split('/').pop();
        const cnt = files.filter(x => { const d=fdir(x.name); return d===f||d.startsWith(f+'/'); }).length;
        return `<div class="vt-sb-item ${folderFlt===f?'active':''}" data-folder="${esc(f)}" style="padding-left:${8+depth*12}px">
          ${I.folder} ${esc(label)}<span class="vt-sb-cnt">${cnt}</span></div>`;
      }).join('')}`;

    list.querySelectorAll('.vt-sb-item').forEach(item => {
      item.onclick = () => {
        folderFlt = item.id === 'vt-sb-all' ? null : (item.dataset.folder || null);
        sel.clear(); renderBrowser();
      };
    });
  }

  function renderTable() {
    const wrap = $('vt-table-wrap');
    const files = filteredFiles();
    if (!files.length) {
      wrap.innerHTML = `<div class="vt-empty">${I.emptyFile}<div>${esc(searchQ||folderFlt ? 'No files match.' : 'No files yet. Click Add files to get started.')}</div></div>`;
      return;
    }
    const allChk = files.every(f => sel.has(f.id));
    const someChk = !allChk && files.some(f => sel.has(f.id));

    wrap.innerHTML = `<table class="vt-t"><thead><tr>
      <th class="vt-cb-col"><input type="checkbox" class="vt-cb" id="vt-all-cb" ${allChk?'checked':''}></th>
      <th class="vt-bd-col">Type</th><th>Name</th>
      <th class="vt-sz-col">Size</th><th class="vt-dt-col">Modified</th>
    </tr></thead><tbody>
    ${files.map(f => {
      const t = typeOf(fname(f.name)), dir = fdir(f.name);
      return `<tr>
        <td class="vt-cb-col"><input type="checkbox" class="vt-cb vt-row-cb" data-id="${esc(f.id)}" ${sel.has(f.id)?'checked':''}></td>
        <td><span class="vt-badge" style="color:${t.c};background:${t.b}">${esc(t.l)}</span></td>
        <td><div class="vt-fn">${esc(fname(f.name))}</div>${dir?`<div class="vt-fp">${esc(dir)}</div>`:''}</td>
        <td class="vt-sz-col">${fmtSize(f.size)}</td>
        <td class="vt-dt-col">${fmtDate(f.mtime)}</td>
      </tr>`;
    }).join('')}
    </tbody></table>`;

    const allCb = $('vt-all-cb');
    allCb.indeterminate = someChk;
    allCb.onchange = () => {
      if (allCb.checked) files.forEach(f => sel.add(f.id));
      else files.forEach(f => sel.delete(f.id));
      renderTable(); updateSelBar();
    };
    wrap.querySelectorAll('.vt-row-cb').forEach(cb => {
      cb.onchange = () => {
        if (cb.checked) sel.add(cb.dataset.id); else sel.delete(cb.dataset.id);
        updateSelBar();
        const a = files.every(f => sel.has(f.id)), s = !a && files.some(f => sel.has(f.id));
        allCb.checked = a; allCb.indeterminate = s;
      };
    });
  }

  function updateSelBar() {
    const bar = $('vt-selbar'), n = sel.size;
    bar.style.display = n > 0 ? 'flex' : 'none';
    if (n > 0) $('vt-sel-count').textContent = n + ' file' + (n!==1?'s':'') + ' selected';
  }
  function updateStatus() {
    if (!vaultData) return;
    $('vt-stat-n').textContent = vaultData.files.length + ' file' + (vaultData.files.length!==1?'s':'');
    $('vt-stat-s').textContent = fmtSize(vaultData.bytes);
  }

  // ─── State transitions ────────────────────────────────────────────────────
  function setLocked(msg) {
    vaultData = null; sel.clear(); folderFlt = null; searchQ = '';
    $('vt-lock').style.display = 'flex';
    $('vt-browser').style.display = 'none';
    renderLock('open');
    if (msg) toast(msg, 'err');
    // Re-register idle listener after lock
    if (offProg) { offProg(); offProg = null; }
  }

  function setUnlocked(data) {
    vaultData = data; sel.clear(); folderFlt = null;
    $('vt-lock').style.display = 'none';
    $('vt-browser').style.display = 'flex';
    renderBrowser();
    listenIdle();
  }

  function listenIdle() {
    if (offProg) { offProg(); offProg = null; }
    offProg = api.onProgress(m => {
      if (m.t === 'locked') {
        if (offProg) { offProg(); offProg = null; }
        setLocked(m.reason === 'idle' ? 'Vault locked after 10 minutes of inactivity.' : null);
      }
    });
  }

  // ─── Change password modal ────────────────────────────────────────────────
  function openCpModal() {
    $('vt-cp-err').innerHTML = '';
    ['vt-cp-old','vt-cp-new','vt-cp-new2'].forEach(id => { const el=$(id); if(el) el.value=''; });
    $('vt-cpmodal').style.display = 'flex';
    $('vt-cp-old').focus();
  }
  function closeCpModal() { $('vt-cpmodal').style.display = 'none'; }

  async function doChangePassword() {
    if (busy) return;
    const old = $('vt-cp-old').value, nw = $('vt-cp-new').value, nw2 = $('vt-cp-new2').value;
    const errEl = $('vt-cp-err');
    if (!old) { errEl.innerHTML = `<div class="vt-err">Enter the current password.</div>`; return; }
    if (!nw)  { errEl.innerHTML = `<div class="vt-err">Enter a new password.</div>`; return; }
    if (nw.length < 12) { errEl.innerHTML = `<div class="vt-err">Use at least 12 characters.</div>`; return; }
    if (nw !== nw2) { errEl.innerHTML = `<div class="vt-err">Passwords do not match.</div>`; return; }
    closeCpModal(); busy = true; showProg('Changing password…');
    const r = await api.changePassword(old, nw).finally(() => { busy = false; hideProg(); });
    if (r.ok) toast('Password changed successfully.', 'ok');
    else toast(r.error || 'Failed to change password.', 'err');
  }

  // ─── Vault operations ─────────────────────────────────────────────────────
  async function doAdd(kind) {
    if (busy) return; busy = true;
    showProg(kind === 'folders' ? 'Adding folders…' : 'Adding files…');
    const r = await api.add(kind).finally(() => { busy = false; hideProg(); });
    if (r.ok) {
      vaultData = r.data.vault; renderBrowser();
      const { added, replaced, failed } = r.data;
      if (added) toast(`Added ${added} file${added!==1?'s':''}${replaced?`, replaced ${replaced}`:''}`,'ok');
      if (failed && failed.length) toast(`${failed.length} file${failed.length!==1?'s':''} could not be added`, 'err');
    } else if (!r.declined) toast(r.error || 'Failed.', 'err');
  }

  async function doExtract() {
    if (busy || !sel.size) return; busy = true;
    showProg('Extracting…');
    const r = await api.extract([...sel]).finally(() => { busy = false; hideProg(); });
    if (r.ok) {
      const { count, failed, cancelled } = r.data;
      if (count) toast(`Extracted ${count} file${count!==1?'s':''}`,'ok');
      if (failed && failed.length) toast(`${failed.length} failed`, 'err');
      if (cancelled) toast('Extraction cancelled.', 'err');
    } else if (!r.declined) toast(r.error || 'Extraction failed.', 'err');
  }

  async function doRemove() {
    if (busy || !sel.size) return; busy = true;
    showProg('Removing…');
    const r = await api.remove([...sel]).finally(() => { busy = false; hideProg(); });
    if (r.ok) {
      vaultData = r.data.vault; sel.clear(); renderBrowser();
      toast(`Removed ${r.data.removed} file${r.data.removed!==1?'s':''}`, 'ok');
    } else if (!r.declined) toast(r.error || 'Remove failed.', 'err');
  }

  async function doLock() { if (busy) return; await api.lock(); setLocked(); }

  // ─── Event delegation ─────────────────────────────────────────────────────
  page.addEventListener('click', e => {
    const btn = e.target.closest('[id]');
    const id = btn && btn.id;
    if (!id) return;
    // Eye toggles (always)
    if (e.target.closest('.vt-eye')) {
      const eye = e.target.closest('.vt-eye');
      const inp = $(eye.dataset.eye);
      if (inp) { inp.type = inp.type === 'password' ? 'text' : 'password'; eye.innerHTML = inp.type === 'password' ? I.eyeOn : I.eyeOff; }
      return;
    }
    if (id === 'vt-addf') doAdd('files');
    else if (id === 'vt-addd') doAdd('folders');
    else if (id === 'vt-ext') doExtract();
    else if (id === 'vt-rm') doRemove();
    else if (id === 'vt-sel-clr') { sel.clear(); updateSelBar(); renderTable(); }
    else if (id === 'vt-lockb') doLock();
    else if (id === 'vt-cpb') openCpModal();
    else if (id === 'vt-cps') doChangePassword();
    else if (id === 'vt-cpx') closeCpModal();
    else if (id === 'vt-cancel') api.cancel();
  });

  page.addEventListener('input', e => {
    if (e.target.id === 'vt-search') { searchQ = e.target.value; sel.clear(); renderTable(); updateSelBar(); }
  });

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    const r = await api.state();
    if (r.ok && r.data) setUnlocked(r.data);
    else setLocked();
  }

  let inited = false;
  new MutationObserver(() => {
    if (!pg.hidden && !inited) { inited = true; init(); }
  }).observe(pg, { attributes: true, attributeFilter: ['hidden'] });
  if (!pg.hidden) { inited = true; init(); }

})();
