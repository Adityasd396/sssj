/* Recover a changed CSRF session once, without clearing an unfinished bill. */
(function(){
 'use strict';
 async function post(url,makeBody,options){
  options=options||{};
  function send(){return fetch(url,{method:'POST',body:makeBody(),signal:options.signal,headers:{Accept:'application/json'}});}
  var response=await send();
  if(response.status!==400)return response;
  var error;try{error=await response.clone().json();}catch(ignore){return response;}
  if(error.code!=='csrf_expired')return response;
  var session=await fetch(options.sessionUrl||'/api/session',{signal:options.signal,headers:{Accept:'application/json'}});
  if(!session.ok||session.redirected)throw new Error('Sign in again in another tab, then retry. Your bill stays here.');
  var data=await session.json(), form=document.getElementById('invoice-form');
  if(form&&String(data.user_id)!==form.dataset.user)throw new Error('The signed-in account changed. Return to the original account before continuing this bill.');
  document.querySelectorAll('input[name=csrf_token]').forEach(function(input){input.value=data.csrf_token;input.defaultValue=data.csrf_token;});
  return send();
 }
 window.ShopRequest={post:post};
})();
