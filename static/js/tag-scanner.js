/* Inline scan: open camera, recognise, look up current stock, add once. */
(function(){
 'use strict';var section=document.getElementById('scan-modal');if(!section)return;
 document.querySelector('main').prepend(section);
 var control=CameraTools.panel(section),video=document.getElementById('scan-video'),status=document.getElementById('scan-status'),fallback=document.getElementById('scan-fallback'),stream,engine,timer,epoch=0,lookup,photoController,starting=false,lastCode='',lastAt=0,searchRevision=0;
 function message(text,error){if(status.textContent!==text)status.textContent=text;status.classList.toggle('error',Boolean(error));}
 function stop(){if(photoController)photoController.abort();epoch++;clearTimeout(timer);starting=false;if(engine)engine.dispose();engine=null;CameraTools.stop(stream);CameraTools.stop(video.srcObject);stream=null;video.srcObject=null;}
 function active(version){return control.isOpen()&&version===epoch&&!document.hidden;}
 async function begin(keepMessage){
  if(starting||stream||!control.isOpen()||fallback.open)return;
  if(!isSecureContext||!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){message('Camera needs HTTPS. Use a photo or code.',true);fallback.open=true;return;}
  stop();var version=epoch;starting=true;engine=new CameraTools.Decoder('multi');if(!keepMessage)message('Opening camera…');
  try{var requested=await CameraTools.start(video,function(){return active(version)&&!fallback.open;});if(!requested)return;stream=requested;starting=false;if(!keepMessage)message('Point at the tag. Tap the preview to focus.');var decoder=engine;
   async function frame(){if(!active(version)||!stream)return;try{var code=await decoder.decode(video);if(code&&active(version)){var finished=await find(code,true);if(finished)return;}}catch(ignore){/* Continue with the next fresh frame. */}if(active(version))timer=setTimeout(frame,Math.max(decoder.delay,code?350:0));}
   frame();
  }catch(error){if(!active(version))return;stop();message(error.name==='NotAllowedError'?'Camera permission was denied. Use a photo or code.':'Camera unavailable. Use a photo or code.',true);fallback.open=true;}
 }
 async function find(raw,automatic){
  var code=String(raw||'').split('|')[0].trim();if(!code||code.length>100||/[\x00-\x1f\x7f]/.test(code)){message('Enter a valid product code.',true);return;}
  if(automatic&&code===lastCode&&Date.now()-lastAt<3000)return false;lastCode=code;lastAt=Date.now();if(lookup)lookup.abort();lookup=new AbortController();var requestController=lookup,sequence=++searchRevision,version=epoch,timeout=setTimeout(function(){requestController.abort();},12000);message('Finding item…');
  try{var response=await fetch(section.dataset.lookup.replace('__CODE__',encodeURIComponent(code)),{signal:lookup.signal,headers:{Accept:'application/json'}});if(response.redirected)throw new Error('Sign in again, then scan.');if(!response.ok)throw new Error('Lookup unavailable. Try again.');var data=await response.json();if(!active(version)||sequence!==searchRevision)return true;if(!data.success)throw new Error('Unknown code. Try another tag.');var product=data.product;
   if(typeof window.addProductToForm==='function'){if((product.unit==='g'?product.stock_weight:product.stock_quantity)<=0)throw new Error('This item is out of stock.');window.addProductToForm(product);control.close();if(navigator.vibrate)navigator.vibrate(25);if(window.MobileBill)MobileBill.go('items');var added=document.getElementById('items-container').lastElementChild;if(added){added.tabIndex=-1;added.setAttribute('aria-label','Added item: '+product.name);requestAnimationFrame(function(){if(added.isConnected){added.focus({preventScroll:true});added.scrollIntoView({block:'nearest',behavior:'auto'});}});}}
   else{control.close(true);location.replace(section.dataset.product.replace(/0$/,product.id));}return true;
  }catch(error){if(active(version)&&sequence===searchRevision)message(error.name==='AbortError'?'Connection timed out. Try again.':error.message,true);return false;}
  finally{clearTimeout(timeout);}
 }
 async function photo(file){
  if(!file)return;stop();photoController=new AbortController();var version=epoch,url,image;
  try{if(file.size>15*1024*1024||!/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error('Choose a JPG, PNG or WebP under 15 MB.');message('Reading code…');url=URL.createObjectURL(file);image=new Image();image.src=url;await image.decode();if(image.naturalWidth*image.naturalHeight>32000000)throw new Error('Photo too large. Crop closer to the code.');var code=await CameraTools.readImage(image,'multi',photoController.signal);if(!active(version))return;if(!code)throw new Error('No code found. Try a clearer photo.');await find(code);}catch(error){if(active(version))message(error.message,true);}finally{if(url)URL.revokeObjectURL(url);if(image)image.src='';document.getElementById('qr-upload').value='';}
 }
 section.addEventListener('cameraclose',function(){stop();if(lookup)lookup.abort();});
 fallback.addEventListener('toggle',function(){if(!control.isOpen())return;if(fallback.open)stop();else begin();});
 video.addEventListener('pointerup',function(event){CameraTools.focus(video,stream,event);});
 document.getElementById('scan-manual').addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();find(this.value);}});
 document.getElementById('qr-upload').addEventListener('change',function(){photo(this.files[0]);});
 function open(){lastCode='';lastAt=0;control.open();fallback.open=false;document.getElementById('scan-manual').value='';begin();}
 document.querySelectorAll('[data-open-scanner]').forEach(function(button){button.addEventListener('click',open);});
 document.addEventListener('visibilitychange',function(){if(document.hidden)stop();else if(control.isOpen()&&!fallback.open)begin();});
 window.openScanner=open;
})();
