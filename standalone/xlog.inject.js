// xlog.inject.js — minimal snippet for programmatic injection
// Usage: page.addScriptTag({ path: 'xlog.inject.js' })
//        chrome.scripting.executeScript({ target: { tabId }, files: ['xlog.inject.js'] })
//        Copy-paste into browser console
// Config: var __xlog_server__ = 'http://127.0.0.1:2718';
;(function(s){
  "use strict";
  var Q=[],orig={},flushing=false;
  var ms=["log","info","warn","error","debug","trace","table","dir","dirxml",
          "group","groupCollapsed","groupEnd","assert","count","countReset",
          "time","timeLog","timeEnd"];
  function send(){
    if(!Q.length||flushing)return;
    flushing=true;
    var b=Q.splice(0,50);
    try{
      if(typeof XMLHttpRequest!=="undefined"){
        var x=new XMLHttpRequest();
        x.open("POST",s+"/api/x-log",true);
        x.setRequestHeader("content-type","application/json");
        x.send(JSON.stringify({logs:b}));
      }else if(typeof fetch==="function"){
        fetch(s+"/api/x-log",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({logs:b})});
      }
    }catch(e){}
    flushing=false;
  }
  ms.forEach(function(m){
    if(typeof console[m]!=="function")return;
    orig[m]=console[m];
    console[m]=function(){
      var a=Array.prototype.slice.call(arguments);
      try{orig[m].apply(console,a);}catch(e){}
      if(m==="assert"&&a[0])return;
      var now=Date.now();
      Q.push({level:m==="assert"?"error":m,method:m,kind:"console",
              args:a,occurredAt:new Date(now).toISOString(),occurredAtMs:now});
      if(Q.length>=20)send();
    };
  });
  setInterval(function(){if(Q.length)send()},800);
  var t=typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:null;
  if(t&&typeof t.addEventListener==="function"){
    t.addEventListener("error",function(e){
      var now=Date.now();
      Q.push({level:"error",method:"error",kind:"window.error",
              args:[e.message,e.error||{message:e.message,filename:e.filename,lineno:e.lineno,colno:e.colno}],
              occurredAt:new Date(now).toISOString(),occurredAtMs:now});
    });
    t.addEventListener("unhandledrejection",function(e){
      var now=Date.now();
      Q.push({level:"error",method:"error",kind:"unhandledrejection",
              args:[e.reason],occurredAt:new Date(now).toISOString(),occurredAtMs:now});
    });
  }
  if(typeof window!=="undefined"){
    var onU=function(){send()};
    window.addEventListener("pagehide",onU);
    window.addEventListener("beforeunload",onU);
  }
})(typeof __xlog_server__!=="undefined"?__xlog_server__:"http://127.0.0.1:2718");
