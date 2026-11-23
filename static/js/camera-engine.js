/* Shared camera control and single-flight, bounded decoding. Frames stay on-device. */
(function(){
 'use strict';
 var script=document.currentScript,workerUrl=script.dataset.worker,libraryUrl=script.dataset.library,loading;
 function library(){if(window.ZXingBrowser)return Promise.resolve();if(!loading)loading=new Promise(function(resolve,reject){var tag=document.createElement('script');tag.src=libraryUrl;tag.onload=resolve;tag.onerror=function(){loading=null;tag.remove();reject(new Error('Decoder unavailable. Check the connection.'));};document.head.appendChild(tag);});return loading;}
 function stop(stream){if(stream)stream.getTracks().forEach(function(track){track.stop();});}
 async function configure(track,active){
  var caps=track.getCapabilities?track.getCapabilities():{};
  if(caps.width&&caps.height&&active()){try{await track.applyConstraints({width:{ideal:caps.width.max},height:{ideal:caps.height.max},frameRate:{ideal:15,max:15},resizeMode:{ideal:'none'}});}catch(ignore){/* Keep the working high-resolution stream. */}}
  for(var field of ['focusMode','exposureMode','whiteBalanceMode']){
   if(!active())return;
   if(Array.isArray(caps[field])&&caps[field].includes('continuous')){var option={};option[field]='continuous';try{await track.applyConstraints({advanced:[option]});}catch(ignore){/* Hardware controls are optional. */}}
  }
 }
 async function start(video,active){
  var stream;
  try{
   try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:3840},height:{ideal:2160},frameRate:{ideal:15,max:15},resizeMode:{ideal:'none'}},audio:false});}
   catch(error){if(error.name!=='OverconstrainedError')throw error;stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});}
   if(!active()){stop(stream);return null;}
   video.srcObject=stream;var playTimer;try{await Promise.race([video.play(),new Promise(function(resolve,reject){playTimer=setTimeout(function(){reject(new Error('Camera did not deliver a frame.'));},10000);})]);}finally{clearTimeout(playTimer);}if(!active()){stop(stream);return null;}
   configure(stream.getVideoTracks()[0],active).catch(function(){/* Recognition need not wait for optional hardware controls. */});if(!active()){stop(stream);return null;}return stream;
  }catch(error){stop(stream);if(active())video.srcObject=null;throw error;}
 }
 async function focus(video,stream,event){
  if(!stream)return;
  var track=stream.getVideoTracks()[0],supported=navigator.mediaDevices.getSupportedConstraints?navigator.mediaDevices.getSupportedConstraints():{};
  if(!supported.pointsOfInterest)return;
  var box=video.getBoundingClientRect(),scale=Math.max(box.width/video.videoWidth,box.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;
  if(!w||!h)return;
  var x=Math.max(0,Math.min(1,(event.clientX-box.left+(w-box.width)/2)/w)),y=Math.max(0,Math.min(1,(event.clientY-box.top+(h-box.height)/2)/h));
  try{await track.applyConstraints({advanced:[{pointsOfInterest:[{x:x,y:y}]}]});}catch(ignore){/* Continuous autofocus remains active. */}
 }
 function Decoder(mode){
  this.mode=mode||'multi';this.attempt=0;this.delay=100;this.disposed=false;this.pending=null;this.native=null;this.worker=null;this.busy=false;this.lastTime=-1;
  var self=this;this.ready=(async function(){
   if(window.BarcodeDetector){try{var supported=await BarcodeDetector.getSupportedFormats(),formats=(mode==='qr'?['qr_code']:['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e']).filter(function(f){return supported.includes(f);});if(formats.length)self.native=new BarcodeDetector({formats:formats});}catch(ignore){/* Bundled fallback. */}}
   if(!self.disposed&&window.Worker&&window.OffscreenCanvas&&window.createImageBitmap){try{self.worker=new Worker(workerUrl);self.worker.onmessage=function(event){var p=self.pending;if(!p||p.id!==event.data.id)return;clearTimeout(p.timer);self.pending=null;if(event.data.error)p.reject(new Error('worker'));else p.resolve(event.data.code);};self.worker.onerror=function(){self.failWorker();};self.worker.postMessage({init:true,mode:self.mode});}catch(ignore){self.failWorker();}}
  })();
 }
 Decoder.prototype.failWorker=function(){if(this.worker)this.worker.terminate();this.worker=null;var p=this.pending;this.pending=null;if(p){clearTimeout(p.timer);p.reject(new Error('worker'));}};
 Decoder.prototype.dispose=function(){this.disposed=true;this.failWorker();if(this.canvas)this.canvas.width=this.canvas.height=0;};
 Decoder.prototype.decode=async function(video,area){
  await this.ready;if(this.disposed||this.busy||!(video.videoWidth||video.naturalWidth))return null;
  if(video.currentTime>0&&this.lastTime===video.currentTime){this.sameFrame=(this.sameFrame||0)+1;if(this.sameFrame>3)return null;}else{this.sameFrame=0;this.lastTime=video.currentTime;}
  this.busy=true;var began=performance.now(),bitmap,frame,self=this,code=null;
  var sourceW=video.videoWidth||video.naturalWidth,sourceH=video.videoHeight||video.naturalHeight,fraction=[0.25,1,0.5,0.125][this.attempt++%4],width=Math.round(sourceW*(area?area.w:fraction)),height=Math.round(sourceH*(area?area.h:fraction)),scale=Math.min(1,1280/Math.max(width,height)),targetW=Math.max(1,Math.round(width*scale)),targetH=Math.max(1,Math.round(height*scale));
  var sx=Math.round(area?sourceW*area.x:(sourceW-width)/2),sy=Math.round(area?sourceH*area.y:(sourceH-height)/2),crop={sx:sx,sy:sy,width:width,height:height,targetW:targetW,targetH:targetH};
  function send(data,transfer){return new Promise(function(resolve,reject){var id=self.attempt;self.pending={id:id,resolve:resolve,reject:reject,timer:setTimeout(function(){self.failWorker();},8000)};data.id=id;data.mode=self.mode;data.rotate=fraction===1||Boolean(area);self.worker.postMessage(data,transfer);});}
  try{
   if(this.worker&&window.VideoFrame){try{frame=new VideoFrame(video,{timestamp:Math.round(performance.now()*1000)});}catch(ignore){/* Bitmap fallback. */}
    if(frame){try{var waiting=send({frame:frame,crop:crop},[frame]);frame=null;return await waiting;}catch(ignore){this.failWorker();if(this.disposed)return null;}}
   }
   if(window.createImageBitmap){try{bitmap=await createImageBitmap(video,sx,sy,width,height,{resizeWidth:targetW,resizeHeight:targetH,resizeQuality:'pixelated'});}catch(ignore){/* Canvas fallback. */}}
   if(this.disposed)return null;
   if(this.worker&&bitmap){try{var pending=send({bitmap:bitmap},[bitmap]);bitmap=null;return await pending;}catch(ignore){this.failWorker();if(this.disposed)return null;}}
   if(this.native&&bitmap){try{var hits=await this.native.detect(bitmap);if(hits.length)return hits[0].rawValue;}catch(ignore){/* Local fallback. */}}
   await library();if(this.disposed)return null;
   var canvas=this.canvas||(this.canvas=document.createElement('canvas'));if(canvas.width!==targetW||canvas.height!==targetH){canvas.width=targetW;canvas.height=targetH;}
   var ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;ctx.drawImage(video,sx,sy,width,height,0,0,targetW,targetH);
   var reader=this.reader||(this.reader=this.mode==='qr'?new ZXingBrowser.BrowserQRCodeReader():new ZXingBrowser.BrowserMultiFormatReader());try{code=reader.decodeFromCanvas(canvas).getText();}catch(ignore){/* No code in this crop. */}return code;
  }finally{if(frame)frame.close();if(bitmap)bitmap.close();this.busy=false;this.delay=Math.min(this.worker?800:1800,Math.max(this.worker?80:280,(performance.now()-began)*(this.worker?0.6:1.5)));}
 };
 var panels=[];
 function panel(element){
  var opener,popping=false,needsHistory=false;
  function close(skipBack){if(element.hidden)return;element.hidden=true;element.dispatchEvent(new Event('cameraclose'));needsHistory=false;if(!skipBack&&!popping&&history.state&&history.state._shopCamera===element.id){popping=true;history.back();}if(opener&&opener.isConnected)opener.focus({preventScroll:true});}
  var control={isOpen:function(){return !element.hidden;},close:close,open:function(){if(!element.hidden)return;var replacing=panels.some(function(item){return item.isOpen();});panels.forEach(function(item){if(item!==control&&item.isOpen())item.close(true);});opener=document.activeElement;element.hidden=false;try{if(popping)needsHistory=true;else history[replacing?'replaceState':'pushState'](Object.assign({},history.state||{},{_shopCamera:element.id}),'',location.href);}catch(ignore){/* Inline close remains available. */}element.scrollIntoView({block:'start',behavior:'auto'});var button=element.querySelector('[data-camera-close]');if(button)button.focus({preventScroll:true});}};
  element.querySelector('[data-camera-close]').addEventListener('click',function(){close(false);});
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&control.isOpen()){event.preventDefault();close(false);}});
  window.addEventListener('popstate',function(){if(popping){popping=false;if(needsHistory&&control.isOpen()){needsHistory=false;try{history.pushState(Object.assign({},history.state||{},{_shopCamera:element.id}),'',location.href);}catch(ignore){/* Close remains available. */}requestAnimationFrame(function(){element.scrollIntoView({block:'start',behavior:'auto'});});}return;}if(control.isOpen()&&(!history.state||history.state._shopCamera!==element.id))close(true);});
  window.addEventListener('pagehide',function(){close(true);});panels.push(control);return control;
 }
 async function readImage(image,mode,signal){
  var decoder=new Decoder(mode),areas=[{x:0,y:0,w:1,h:1},{x:.25,y:.25,w:.5,h:.5},{x:0,y:0,w:.5,h:.5},{x:.5,y:0,w:.5,h:.5},{x:0,y:.5,w:.5,h:.5},{x:.5,y:.5,w:.5,h:.5}];
  function cancel(){decoder.dispose();}if(signal)signal.addEventListener('abort',cancel,{once:true});
  try{for(var area of areas){if(signal&&signal.aborted)return null;var code=await decoder.decode(image,area);if(code)return code;await new Promise(function(resolve){setTimeout(resolve,0);});}return null;}finally{if(signal)signal.removeEventListener('abort',cancel);decoder.dispose();}
 }
 window.CameraTools={Decoder:Decoder,library:library,start:start,stop:stop,focus:focus,panel:panel,readImage:readImage};
})();
