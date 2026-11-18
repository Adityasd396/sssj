(function () {
  'use strict';
  var root=document.getElementById('bill-sharing');if(!root)return;
  var link=document.getElementById('wa-link'), text=document.getElementById('share-message');
  var pdfButton=document.getElementById('share-pdf'), status=document.getElementById('share-status'), file, busy=false, objectUrl;
  function update(){if(link)link.href='https://wa.me/'+root.dataset.phone+'?text='+encodeURIComponent(text.value);}
  text.addEventListener('input',update);update();
  function download(){objectUrl=URL.createObjectURL(file);var a=document.createElement('a');a.href=objectUrl;a.download=root.dataset.filename;a.click();setTimeout(function(){URL.revokeObjectURL(objectUrl);objectUrl=null;},10000);status.textContent='PDF downloaded. You can attach it in the customer’s WhatsApp chat.';}
  pdfButton.addEventListener('click',function(){
    if(busy)return;
    if(file){
      if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
        // Call directly from this click, preserving user activation even on a slow server.
        navigator.share({files:[file],title:root.dataset.filename,text:text.value}).then(function(){status.textContent='Shared through your selected app.';}).catch(function(error){status.textContent=error.name==='AbortError'?'Sharing cancelled.':'Could not share. Use Download PDF or the customer’s WhatsApp button.';});
      }else download();
      return;
    }
    busy=true;pdfButton.disabled=true;pdfButton.textContent='Preparing PDF…';status.textContent='';
    var controller=new AbortController(), timer=setTimeout(function(){controller.abort();},30000);
    fetch(root.dataset.pdf,{headers:{Accept:'application/pdf'},signal:controller.signal}).then(async function(response){
      if(response.redirected||!response.ok||!(response.headers.get('Content-Type')||'').includes('application/pdf'))throw new Error('Could not prepare the PDF. Check your sign-in and retry.');
      var blob=await response.blob();if(blob.size>10*1024*1024)throw new Error('This PDF is too large for file sharing. Use Download PDF.');
      file=new File([blob],root.dataset.filename,{type:'application/pdf'});
      var canShare=navigator.share&&navigator.canShare&&navigator.canShare({files:[file]});
      pdfButton.textContent=canShare?'Share prepared PDF':'Download prepared PDF';
      status.textContent=canShare?'PDF ready. Tap Share prepared PDF, then choose WhatsApp and the customer.':'PDF ready. Tap Download prepared PDF to attach it in WhatsApp.';
    }).catch(function(error){pdfButton.textContent='Prepare PDF';status.textContent=error.name==='AbortError'?'The request timed out. Tap to retry.':error.message;}).finally(function(){clearTimeout(timer);busy=false;pdfButton.disabled=false;});
  });
  window.addEventListener('pagehide',function(){if(objectUrl)URL.revokeObjectURL(objectUrl);file=null;});
})();
