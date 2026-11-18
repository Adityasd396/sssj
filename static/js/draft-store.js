/* Bounded, account-scoped draft recovery. Never store passwords or CSRF tokens. */
(function () {
  'use strict';
  var tab;
  try { tab=sessionStorage.getItem('billing-tab-id');if(!tab){tab=String(Date.now())+'-'+Math.random().toString(36).slice(2);sessionStorage.setItem('billing-tab-id',tab);} } catch(error){tab='current';}
  var ttl=86400000, loadedAt=Date.now(), signedOut={};
  function signoutTime(user){try{return Number(localStorage.getItem('billing-signout-'+user)||0);}catch(error){return 0;}}
  function isSignedOut(user){return Boolean(signedOut[user]||signoutTime(user)>=loadedAt);}
  function sessionKey(user){return 'billing-draft-v1-'+user;}
  function deviceKey(user){return 'billing-device-drafts-v2-'+user;}
  function completedKey(user){return 'billing-completed-v2-'+user;}
  function readJSON(kind,key,fallback){try{return JSON.parse(window[kind].getItem(key)||'null')||fallback;}catch(error){return fallback;}}
  function device(user){var rows=readJSON('localStorage',deviceKey(user),[]);return Array.isArray(rows)?rows:[];}
  function completions(user){var rows=readJSON('localStorage',completedKey(user),[]);return Array.isArray(rows)?rows.filter(function(row){return row&&Date.now()-row.savedAt<ttl;}):[];}
  function completed(user,key){return completions(user).find(function(row){return row.key===key;});}
  function valid(user,data){return data&&data.savedAt>signoutTime(user)&&data.fields&&Array.isArray(data.rows)&&data.rows.length<=200&&Number.isFinite(data.savedAt)&&Date.now()-data.savedAt<ttl&&data.savedAt<=Date.now()+60000&&!completed(user,data.fields.submission_key);}
  function read(user){
    var current=readJSON('sessionStorage',sessionKey(user),null);
    if(valid(user,current))return current;
    try{sessionStorage.removeItem(sessionKey(user));}catch(error){/* Storage may be blocked. */}
    return device(user).filter(function(row){return valid(user,row.data);}).sort(function(a,b){return b.data.savedAt-a.data.savedAt;}).map(function(row){return row.data;})[0]||null;
  }
  function write(user,data){
    if(isSignedOut(user))return 'signed-out';
    if(completed(user,data.fields.submission_key))return 'completed';
    var mode='unavailable';
    try{sessionStorage.setItem(sessionKey(user),JSON.stringify(data));mode='tab';}catch(error){/* Try device storage. */}
    try{
      var rows=device(user).filter(function(row){return row.tab!==tab&&valid(user,row.data)&&row.data.fields.submission_key!==data.fields.submission_key;});
      rows.unshift({tab:tab,data:data});localStorage.setItem(deviceKey(user),JSON.stringify(rows.slice(0,3)));mode='device';
    }catch(error){/* A private browser may only allow tab storage. */}
    return mode;
  }
  function remove(user,key){
    var current=readJSON('sessionStorage',sessionKey(user),null);
    if(current&&current.fields&&current.fields.submission_key===key){try{sessionStorage.removeItem(sessionKey(user));}catch(error){/* Storage blocked. */}}
    try{localStorage.setItem(deviceKey(user),JSON.stringify(device(user).filter(function(row){return row.data&&row.data.fields&&row.data.fields.submission_key!==key;})));}catch(error){/* Storage blocked. */}
  }
  function complete(user,key,url){
    if(!key)return;
    remove(user,key);
    try{var rows=completions(user).filter(function(row){return row.key!==key;});rows.unshift({key:key,url:url,savedAt:Date.now()});localStorage.setItem(completedKey(user),JSON.stringify(rows.slice(0,12)));}catch(error){/* Server submission keys remain authoritative. */}
  }
  function clear(user){
    signedOut[user]=true;try{localStorage.setItem('billing-signout-'+user,String(Date.now()));}catch(error){/* Per-tab clearing still works. */}
    try{sessionStorage.removeItem(sessionKey(user));sessionStorage.removeItem('billing-recent-clients-'+user);}catch(error){/* Storage blocked. */}
    try{localStorage.removeItem(deviceKey(user));localStorage.removeItem(completedKey(user));}catch(error){/* Storage blocked. */}
  }
  window.BillDraftStorage={read:read,write:write,remove:remove,complete:complete,completed:completed,clear:clear,isSignedOut:isSignedOut};
})();
