/* Bounded customer lookup; only names/contacts and current server balances. */
(function(){
 'use strict';
 function select(){return document.getElementById('client_id');}
 function option(id){return Array.from(select().options).find(function(o){return o.value===String(id);});}
 function add(c){var o=option(c.id);if(!o){o=new Option('',String(c.id));select().add(o);}o.text=c.name+' ('+c.phone+')';o.dataset.search=(c.name+' '+c.phone).toLowerCase();o.dataset.balance=c.balance;o.dataset.gstin=c.gstin||'';return o;}
 async function request(params,signal){var r=await fetch('/api/clients?'+params,{signal:signal,headers:{Accept:'application/json'}});if(!r.ok||r.redirected)throw new Error('Customer search unavailable. Check your connection and sign-in, then retry.');var data=await r.json();if(!Array.isArray(data.clients))throw new Error('Customer search unavailable.');return data.clients;}
 async function ensure(id){if(!id||option(id))return;var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},10000);try{var rows=await request(new URLSearchParams({id:String(id)}),controller.signal);if(!rows.length)throw new Error('Customer no longer available.');rows.forEach(add);}finally{clearTimeout(timer);}}
 function init(){
  var box=document.getElementById('client-search'),sel=select(),hint=document.getElementById('client-hint');if(!box||!sel)return;
  var timer,controller,serial=0;
  box.addEventListener('input',function(){
   clearTimeout(timer);if(controller)controller.abort();var current=++serial;box.dataset.first='';
   timer=setTimeout(async function(){
    controller=new AbortController();var timeout=setTimeout(function(){controller.abort();},10000);
    try{
     var rows=await request(new URLSearchParams({q:box.value.trim()}),controller.signal);if(current!==serial)return;
     var keep=[sel.value];try{keep=keep.concat(JSON.parse(sessionStorage.getItem('billing-recent-clients-'+document.getElementById('invoice-form').dataset.user)||'[]').slice(0,3));}catch(ignore){/* Search needs no storage. */}
     Array.from(sel.options).forEach(function(o){if(o.value&&!keep.includes(o.value))o.remove();});
     rows.forEach(add);box.dataset.first=rows.length?String(rows[0].id):'';
     hint.textContent=rows.length?'Showing '+rows.length+' matches'+(rows.length===30?' — narrow your search':'')+' · Enter to select first':'No customers found. You can add a customer here.';
    }catch(error){if(current===serial)hint.textContent='Customer search unavailable. Check your connection and type again to retry.';}
    finally{clearTimeout(timeout);}
   },250);
  });
 }
 window.ClientLookup={ensure:ensure,add:add};
 document.addEventListener('DOMContentLoaded',init);
})();
