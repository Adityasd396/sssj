(function () {
 'use strict';
 const status=document.getElementById('passkey-status');
 const login=document.getElementById('passkey-login');
 const register=document.getElementById('passkey-register');
 if(!login&&!register)return;
 const csrf=document.querySelector('input[name=csrf_token]').value;
 function decode(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
 function encode(b){return b?btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''):null;}
 async function post(url,data){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':csrf},body:JSON.stringify(data)});if(r.redirected)throw Error('Sign in again, then retry.');let body;try{body=await r.json();}catch(e){throw Error('Request expired or connection failed. Refresh and try again.');}if(!r.ok)throw Error(body.error||'Please try again.');return body;}
 function supported(){if(!window.isSecureContext||!window.PublicKeyCredential)throw Error('Passkeys need a supported browser and the shop’s HTTPS address. Use your password here.');}
 async function run(button,create){button.disabled=true;status.textContent='Follow the prompt on your device…';try{supported();const options=await post('/passkeys/'+(create?'register':'login')+'/options',create?{password:document.getElementById('key-password').value}:{});options.challenge=decode(options.challenge);if(create){options.user.id=decode(options.user.id);(options.excludeCredentials||[]).forEach(c=>c.id=decode(c.id));}else{(options.allowCredentials||[]).forEach(c=>c.id=decode(c.id));}const key=await navigator.credentials[create?'create':'get']({publicKey:options});const response={clientDataJSON:encode(key.response.clientDataJSON)};if(create){response.attestationObject=encode(key.response.attestationObject);response.transports=key.response.getTransports?key.response.getTransports():[];}else{response.authenticatorData=encode(key.response.authenticatorData);response.signature=encode(key.response.signature);response.userHandle=encode(key.response.userHandle);}const credential={id:key.id,rawId:encode(key.rawId),type:key.type,response,clientExtensionResults:key.getClientExtensionResults()};const result=await post('/passkeys/'+(create?'register':'login')+'/verify',create?{credential,name:document.getElementById('key-name').value}:credential);location.href=create?'/account/passkeys':result.redirect;}catch(e){status.textContent=e.name==='NotAllowedError'?'Cancelled or no matching passkey found. Try again or use your password.':e.message;}finally{button.disabled=false;if(create)document.getElementById('key-password').value='';}}
 if(login)login.addEventListener('click',()=>run(login,false));
 if(register)register.addEventListener('submit',e=>{e.preventDefault();run(register.querySelector('[type=submit]'),true);});
})();
