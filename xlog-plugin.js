// xlog-plugin.js — 拷贝到项目里，config 加一行引用
// 零 npm install，自动检测本地 xlog server
// 有 server 就上报日志，没有就排队等 server 启动，不影响项目运行
// 支持所有场景：普通页面、Web Worker、浏览器扩展 background/popup/content/sidepanel

var DEFAULT_SERVER = 'http://127.0.0.1:2718';
var XLOG_MARK = '__xlog';

var CONSOLE_METHODS = [
  'log','info','warn','error','debug','trace','table','dir','dirxml',
  'group','groupCollapsed','groupEnd','assert','count','countReset',
  'time','timeLog','timeEnd'
];

// ── 内联运行时 ─────────────────────────────────────────────────────
// 完整功能：18 个 console 方法、序列化、堆栈解析、capture 系统、
// 环境检测、错误监听、重试退避、噪声过滤

var RUNTIME = [
  ';(function(opts){',
  '"use strict";',
  'var S=(opts&&opts.server)||__XLOG_SERVER_URL__;',
  'var T=(opts&&opts.tool)||(typeof document!=="undefined"?"browser":"worker");',
  'var FI=500,MB=20,MR=5,RC=30000,CT=300000,MD=4,MI=24,MT=6000,MF=12;',
  'var MS=["log","info","warn","error","debug","trace","table","dir","dirxml","group","groupCollapsed","groupEnd","assert","count","countReset","time","timeLog","timeEnd"];',
  'var NP=["/@vite/client","/@react-refresh","reload-html-","[wxt]","vite connected","vite connecting","vite ping","hmr","hot updated"];',
  'var SH=["xlog","installXLog","xlogConsole","__xlog","virtual:xlog"];',
  'var CR=/^\\s*at (?:(.*?)\\s+\\()?(.+):(\\d+):(\\d+)\\)?$/;',
  'var FR=/^(.*?)@(.*):(\\d+):(\\d+)$/;',
  'var AN=["/src/","/app/","/pages/","/components/","/packages/","/node_modules/","/chunks/","/@vite/"];',
  'if(typeof globalThis!=="undefined"&&globalThis.__xlog_state__)return;',

  // Helpers
  'function ci(){if(typeof crypto!=="undefined"&&typeof crypto.randomUUID==="function")return crypto.randomUUID();return"xlog-"+Date.now()+"-"+Math.random().toString(16).slice(2);}',
  'function sl(v){return String(v||"unknown-project").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"project";}',
  'function np(i){if(!i)return undefined;var v=String(i).trim();if(!v)return undefined;return sl(v.replace(/([a-z0-9])([A-Z])/g,"$1-$2").replace(/[^a-zA-Z0-9]+/g,"-"));}',

  // Environment detection
  'function ds(ex){if(ex){var v=String(ex).trim().toLowerCase();if(v)return v;}var pn=typeof location!=="undefined"?String(location.pathname||"").toLowerCase():"";if(typeof window==="undefined")return pn.indexOf("background")!==-1?"background":"worker";if(pn.indexOf("sidepanel")!==-1)return"sidepanel";if(pn.indexOf("popup")!==-1)return"popup";if(pn.indexOf("options")!==-1)return"options";if(pn.indexOf("dashboard")!==-1)return"dashboard";if(pn.indexOf("content")!==-1)return"content";return"page";}',
  'function pm(){var hL=typeof location!=="undefined",hD=typeof document!=="undefined",hN=typeof navigator!=="undefined";return{url:hL?location.href:null,origin:hL?location.origin:null,title:hD?document.title:null,referrer:hD?document.referrer:null,userAgent:hN?navigator.userAgent:null};}',
  'function gp(){if(typeof document!=="undefined"&&document.title){var n=np(document.title);if(n)return n||document.title;}if(typeof location!=="undefined"&&location.pathname){var segs=location.pathname.split("/").filter(Boolean);if(segs.length){var n=np(segs[segs.length-1]);if(n)return n||segs[segs.length-1];}}return"unknown-project";}',

  // Serialization
  'function sv(v,d,se){if(v===null)return{type:"null"};if(v===undefined)return{type:"undefined"};var t=typeof v;if(t==="string")return{type:"string",value:v.length>MT?v.slice(0,MT)+"…":v};if(t==="number")return{type:"number",value:Number.isFinite(v)?v:String(v)};if(t==="boolean")return{type:"boolean",value:v};if(t==="bigint")return{type:"bigint",value:String(v)};if(t==="symbol")return{type:"symbol",value:String(v)};if(t==="function")return{type:"function",name:v.name||"anonymous"};if(t!=="object")return{type:"string",value:String(v)};if(d>=MD){if(Array.isArray(v))return{type:"array",items:[],truncated:v.length>0};var ct=v.constructor&&v.constructor.name!=="Object"?v.constructor.name:null;return{type:"object",ctor:ct,entries:[],truncated:Object.keys(v).length>0};}if(!se)se=typeof WeakSet!=="undefined"?new WeakSet():null;if(se){if(se.has(v))return{type:"circular"};se.add(v);}if(v instanceof Error)return{type:"error",name:v.name||"Error",message:v.message||"",stack:v.stack||""};if(v instanceof Date)return{type:"date",value:v.toISOString()};if(v instanceof RegExp)return{type:"regexp",value:String(v)};if(v instanceof URL)return{type:"url",value:v.href};if(typeof HTMLElement!=="undefined"&&v instanceof HTMLElement)return{type:"dom",tagName:v.tagName||"element",id:v.id||null,className:v.className||null};if(Array.isArray(v)){var it=[],tr=v.length>MI;for(var i=0;i<Math.min(v.length,MI);i++)it.push(sv(v[i],d+1,se));return{type:"array",items:it,truncated:tr};}if(typeof Map!=="undefined"&&v instanceof Map){var en=[],ci2=0;v.forEach(function(val,k){if(ci2<MI)en.push({key:sv(k,d+1,se),value:sv(val,d+1,se)});ci2++;});return{type:"map",size:v.size,entries:en,truncated:ci2>MI};}if(typeof Set!=="undefined"&&v instanceof Set){var va=[],si2=0;v.forEach(function(val){if(si2<MI)va.push(sv(val,d+1,se));si2++;});return{type:"set",size:v.size,values:va,truncated:si2>MI};}if(ArrayBuffer.isView&&ArrayBuffer.isView(v))return{type:"typed-array",ctor:v.constructor&&v.constructor.name||"TypedArray",length:v.length};if(v instanceof ArrayBuffer)return{type:"array-buffer",byteLength:v.byteLength};var oc=v.constructor&&v.constructor.name!=="Object"?v.constructor.name:null;var oe=[],ks=Object.keys(v),ot=ks.length>MI;for(var ki=0;ki<Math.min(ks.length,MI);ki++){try{oe.push({key:ks[ki],value:sv(v[ks[ki]],d+1,se)});}catch(e){oe.push({key:ks[ki],value:{type:"thrown",value:e.message||"error"}});}}return{type:"object",ctor:oc,entries:oe,truncated:ot};}',

  'function sfs(v){if(v===null||v===undefined)return"";var t=typeof v;if(t==="string"||t==="number"||t==="boolean"||t==="bigint")return String(v);if(t==="function")return v.name||"";if(t!=="object")return"";if(v instanceof Error)return[v.name,v.message,v.stack].filter(Boolean).join(" ");if(Array.isArray(v))return v.map(sfs).join(" ");if(typeof v.message==="string")return v.message;if(typeof v.text==="string")return v.text;try{return JSON.stringify(v);}catch(e){return"";}}',
  'function sa(a){var r=[];for(var i=0;i<a.length;i++)r.push(sv(a[i],0));return r;}',
  'function att(a){var p=[];for(var i=0;i<a.length;i++){var s=sfs(a[i]);if(s)p.push(s);}var t=p.join(" ");return t.length>MT?t.slice(0,MT)+"…":t;}',
  'function hss(v,se,d){if(!v||typeof v!=="object")return false;if(typeof v.stack==="string"&&v.stack.trim())return true;if(d>=2)return false;if(!se)se=typeof WeakSet!=="undefined"?new WeakSet():null;if(se&&se.has(v))return false;if(se)se.add(v);if(Array.isArray(v)){for(var i=0;i<v.length;i++){if(hss(v[i],se,d+1))return true;}return false;}var ks=Object.keys(v);for(var k=0;k<Math.min(ks.length,8);k++){try{if(hss(v[ks[k]],se,d+1))return true;}catch(e){}}return false;}',

  // Stack parsing
  'function nu(u){if(!u)return u;var px=["http://","https://","chrome-extension://","moz-extension://","safari-web-extension://"];for(var i=0;i<px.length;i++){if(u.indexOf(px[i])===0){var p=u.slice(px[i].length).replace(/^[^/]+/,"");return p||u;}}return u;}',
  'function cf(p){if(!p)return"";var n=String(p).replace(/\\\\/g,"/");for(var i=0;i<AN.length;i++){var idx=n.lastIndexOf(AN[i]);if(idx!==-1)return n.slice(idx+1);}return n;}',
  'function ps(raw){if(!raw||typeof raw!=="string")return{raw:raw||null,frames:[]};var ls=raw.split(/\\r?\\n/),fr=[];for(var i=0;i<ls.length;i++){var l=ls[i].trim();if(!l)continue;var m=CR.exec(l),fn,file,col,ln;if(m){fn=m[1]||null;file=m[2]||"";ln=Number(m[3])||0;col=Number(m[4])||0;}else{m=FR.exec(l);if(!m)continue;fn=m[1]||null;file=m[2]||"";ln=Number(m[3])||0;col=Number(m[4])||0;}var sk=false;for(var h=0;h<SH.length;h++){if(l.indexOf(SH[h])!==-1){sk=true;break;}}if(sk)continue;fr.push({functionName:fn,file:cf(nu(file)),url:file,line:ln,column:col});if(fr.length>=MF)break;}return{raw:raw,frames:fr};}',
  'function cs(){try{throw new Error();}catch(e){return ps(e.stack);}}',
  'function rc(meta,st){if(meta&&meta.file)return{source:"transform",file:cf(meta.file),line:meta.line||0,column:meta.column||0,functionName:meta.functionName||null};if(st&&st.frames&&st.frames.length){var f=st.frames[0];return{source:"stack",file:f.file||null,line:f.line||0,column:f.column||0,functionName:f.functionName||null};}return{source:"none",file:null,line:0,column:0,functionName:null};}',

  // Noise filter
  'function itn(r){var h=[r.text||"",r.callsite?r.callsite.file||"":"",r.stack?r.stack.raw||"":""].join(" ").toLowerCase();for(var i=0;i<NP.length;i++){if(h.indexOf(NP[i])!==-1)return true;}return false;}',

  // Capture system
  'function gck(p){return"__xlog_capture__:"+sl(p);}',
  'function ges(){try{if(typeof browser!=="undefined"&&browser.storage&&browser.storage.session)return{area:browser.storage.session,mode:"promise"};if(typeof chrome!=="undefined"&&chrome.storage&&chrome.storage.session)return{area:chrome.storage.session,mode:"callback"};if(typeof browser!=="undefined"&&browser.storage&&browser.storage.local)return{area:browser.storage.local,mode:"promise"};if(typeof chrome!=="undefined"&&chrome.storage&&chrome.storage.local)return{area:chrome.storage.local,mode:"callback"};}catch(e){}return null;}',
  'function rdc(key,cb){var ext=ges();if(ext){try{if(ext.mode==="promise"){ext.area.get(key).then(function(r){cb(r?r[key]||null:null);}).catch(function(){cb(null);});return;}ext.area.get(key,function(r){var err=typeof chrome!=="undefined"&&chrome.runtime&&chrome.runtime.lastError;cb(err?null:(r?r[key]||null:null));});return;}catch(e){}}if(typeof localStorage!=="undefined"){try{var raw=localStorage.getItem(key);cb(raw?JSON.parse(raw):null);return;}catch(e){}}cb(null);}',
  'function wrc(key,value,cb){var ext=ges();if(ext){try{var obj={};obj[key]=value;if(ext.mode==="promise"){ext.area.set(obj).then(function(){if(cb)cb(true);}).catch(function(){if(cb)cb(false);});return;}ext.area.set(obj,function(){var err=typeof chrome!=="undefined"&&chrome.runtime&&chrome.runtime.lastError;if(cb)cb(!err);});return;}catch(e){}}if(typeof localStorage!=="undefined"){try{localStorage.setItem(key,JSON.stringify(value));if(cb)cb(true);return;}catch(e){}}if(cb)cb(false);}',

  // Transport
  'function snd(ep,body,beacon){if(beacon&&typeof navigator!=="undefined"&&typeof navigator.sendBeacon==="function"){try{var blob=new Blob([body],{type:"application/json"});if(navigator.sendBeacon(ep,blob))return true;}catch(e){}}if(typeof XMLHttpRequest!=="undefined"){try{var x=new XMLHttpRequest();x.open("POST",ep,true);x.setRequestHeader("content-type","application/json");x.send(body);return true;}catch(e){}}if(typeof fetch==="function"){try{fetch(ep,{method:"POST",mode:"cors",headers:{"content-type":"application/json"},body:body,keepalive:beacon});return true;}catch(e){}}return false;}',

  // State
  'var src=ds(opts&&opts.source);',
  'var pn=np(opts&&opts.project)||gp();',
  'var sid=ci(),sa2=new Date().toISOString();',
  'var st={installed:true,source:src,pn:pn,sid:sid,sa:sa2,cid:null,cst:null,cum:0,q:[],seq:0,fl:false,ft:null,rc2:0,rt:null,ld:false,oc:{}};',

  // Capture resolution
  'function ica(cap,now){return cap&&cap.id&&cap.updatedAtMs&&now-cap.updatedAtMs<=CT;}',
  'function rvc(cb){var now=Date.now(),key=gck(pn);rdc(key,function(ex){if(ica(ex,now)){st.cid=ex.id;st.cst=ex.startedAt;st.cum=Number(ex.updatedAtMs||0);if(cb)cb();return;}var now2=new Date(now).toISOString();var cand={id:ci(),startedAt:now2,updatedAtMs:now,pn:pn};wrc(key,cand,function(){st.cid=cand.id;st.cst=cand.startedAt;st.cum=now;if(cb)cb();});});}',
  'function enc(cb){var now=Date.now();if(st.cid&&now-st.cum<=CT){st.cum=now;var up={id:st.cid,startedAt:st.cst||sa2,updatedAtMs:now,pn:pn};wrc(gck(pn),up,function(){if(cb)cb();});return;}rvc(cb);}',

  // Build payload
  'function bp(logs){return{project:{name:pn,tool:T},source:src,capture:st.cid?{id:st.cid,startedAt:st.cst||sa2}:null,session:{id:sid,startedAt:sa2},page:pm(),logs:logs};}',

  // Flush
  'function hff(){st.rc2++;if(st.rc2<MR)return;st.ld=true;st.q.length=0;if(!st.rt&&typeof setTimeout==="function"){st.rt=setTimeout(function(){st.rt=null;st.ld=false;st.rc2=0;},RC);}}',
  'function fl(opts2){if(st.ld){st.q.length=0;return;}if(!st.q.length||st.fl)return;st.fl=true;enc(function(){var logs=st.q.splice(0,MB);var body=JSON.stringify(bp(logs));var ep=S+"/api/x-log";var beacon=opts2&&opts2.beacon;var sent=snd(ep,body,beacon);st.fl=false;if(!sent&&!beacon)hff();else if(!beacon)st.rc2=0;if(st.q.length)sch();});}',
  'function sch(){if(st.ld){st.q.length=0;return;}if(st.ft)return;if(typeof setTimeout!=="function"){fl();return;}st.ft=setTimeout(function(){st.ft=null;fl();},FI);}',
  'function enq(rec){if(st.ld)return;st.q.push(rec);if(src==="background"||src==="worker")fl();else if(st.q.length>=MB)fl();else sch();}',

  // Capture entry
  'function ce(lv,me,ki,args,meta,echo){if(echo){var o=st.oc[me]||st.oc[lv];if(o)o.apply(console,args);}var stack=cs();var csi=rc(meta,stack);var nowMs=Date.now(),now=new Date(nowMs).toISOString();var ps2=(stack&&stack.frames&&stack.frames.length&&!args.some(function(a){return hss(a,null,0);}))?stack:null;var rec={kind:ki,level:lv||"log",method:me,source:src,sequence:++st.seq,occurredAt:now,occurredAtMs:nowMs,args:sa(args),text:att(args),callsite:csi,stack:ps2,tags:["browser",src?"source:"+src:null,ki,me].filter(Boolean),extra:{}};if(itn(rec))return rec;enq(rec);return rec;}',

  // Console interception
  'for(var mi=0;mi<MS.length;mi++){(function(method){if(typeof console[method]!=="function")return;st.oc[method]=console[method].bind(console);console[method]=function(){var a=Array.prototype.slice.call(arguments);if(method==="assert"&&a[0])return st.oc.assert.apply(console,a);var lv=method==="assert"?"error":method;return ce(lv,method,"console",a,null,true);};})(MS[mi]);}',

  // Error listeners
  'var et=(typeof globalThis!=="undefined"&&typeof globalThis.addEventListener==="function")?globalThis:(typeof window!=="undefined"&&typeof window.addEventListener==="function"?window:null);',
  'if(et){et.addEventListener("error",function(e){ce("error","error","window.error",[e.message,e.error||{name:"ErrorEvent",message:e.message,filename:e.filename,lineno:e.lineno,colno:e.colno}],null,false);});et.addEventListener("unhandledrejection",function(e){ce("error","error","unhandledrejection",[e.reason],null,false);});}',
  'var pt=(typeof window!=="undefined"&&typeof window.addEventListener==="function")?window:null;',
  'if(pt){var ou=function(){fl({beacon:true})};pt.addEventListener("pagehide",ou);pt.addEventListener("beforeunload",ou);}',

  // Startup
  'if(typeof globalThis!=="undefined")globalThis.__xlog_state__={installed:true,source:src,projectName:pn,sessionId:sid};rvc();',
  '})(typeof __xlog_config__!=="undefined"?__xlog_config__:{});'
].join('\n');


// ── Babel 插件部分 ──────────────────────────────────────────────────

function buildMeta(loc, method, types) {
  if (!loc) return null;
  return types.objectExpression([
    types.objectProperty(
      types.identifier(XLOG_MARK),
      types.objectExpression([
        types.objectProperty(types.identifier('f'), types.stringLiteral(loc.filename || '')),
        types.objectProperty(types.identifier('l'), types.numericLiteral(loc.start.line)),
        types.objectProperty(types.identifier('c'), types.numericLiteral(loc.start.column || 0)),
        types.objectProperty(types.identifier('m'), types.stringLiteral(method || ''))
      ])
    )
  ]);
}

function isAlreadyTagged(first) {
  if (!first || first.type !== 'ObjectExpression') return false;
  var props = first.properties;
  return props && props.length === 1 &&
    props[0].key && props[0].key.name === XLOG_MARK;
}

function babelVisitor(path, state) {
  var t = state.types;
  var callee = path.node.callee;

  if (!t.isMemberExpression(callee)) return;
  if (!t.isIdentifier(callee.object, { name: 'console' })) return;
  if (!t.isIdentifier(callee.property)) return;

  var method = callee.property.name;
  if (CONSOLE_METHODS.indexOf(method) === -1) return;
  if (isAlreadyTagged(path.node.arguments[0])) return;

  var meta = buildMeta(path.node.loc, method, t);
  if (meta) path.node.arguments.unshift(meta);
}

// ── 主入口：同时支持 Vite 和 Babel ──────────────────────────────────

export default function xlogPlugin(babelOrOpts, maybeOpts) {
  // 兼容 Babel (api, options) 和 Vite (options) 两种调用方式
  var opts = (babelOrOpts && babelOrOpts.types) ? (maybeOpts || {}) : (babelOrOpts || {});
  var server = opts.server || DEFAULT_SERVER;
  var runtime = RUNTIME.replace('__XLOG_SERVER_URL__', JSON.stringify(server));

  return {
    name: 'xlog',

    // Vite: 注入 interceptor script 到 HTML
    transformIndexHtml: function () {
      return [{
        tag: 'script',
        attrs: {},
        children: runtime,
        injectTo: 'head'
      }];
    },

    // Babel: AST transform — console.* 调用注入源码位置元数据
    visitor: {
      CallExpression: babelVisitor
    }
  };
}
