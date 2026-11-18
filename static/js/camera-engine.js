/* Shared, bounded camera decoding for product entry and checkout. */
(function () {
  'use strict';
  var script=document.currentScript, workerUrl=script.dataset.worker, libraryUrl=script.dataset.library, loading;
  function library() {
    if(window.ZXingBrowser)return Promise.resolve();
    if(!loading)loading=new Promise(function(resolve,reject){var tag=document.createElement('script');tag.src=libraryUrl;tag.onload=resolve;tag.onerror=function(){loading=null;tag.remove();reject(new Error('Decoder could not load. Check the connection and retry.'));};document.head.appendChild(tag);});
    return loading;
  }
  function Decoder(mode) {
    this.mode=mode||'multi';this.attempt=0;this.delay=220;this.disposed=false;this.pending=null;this.native=null;this.worker=null;
    var self=this;
    this.ready=(async function(){
      if(window.BarcodeDetector){try{var supported=await BarcodeDetector.getSupportedFormats();var formats=(mode==='qr'?['qr_code']:['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e']).filter(function(f){return supported.includes(f);});if(formats.length)self.native=new BarcodeDetector({formats:formats});}catch(error){/* Local fallback. */}}
      if(!self.disposed&&window.Worker&&window.OffscreenCanvas&&window.createImageBitmap){try{self.worker=new Worker(workerUrl);self.worker.onmessage=function(event){var p=self.pending;if(!p||p.id!==event.data.id)return;clearTimeout(p.timer);self.pending=null;if(event.data.error)p.reject(new Error('worker'));else p.resolve(event.data.code);};self.worker.onerror=function(){self.failWorker();};}catch(error){/* Older browsers use bounded local decoding. */}}
    })();
  }
  Decoder.prototype.failWorker=function(){if(this.worker)this.worker.terminate();this.worker=null;var p=this.pending;this.pending=null;if(p){clearTimeout(p.timer);p.reject(new Error('worker'));}};
  Decoder.prototype.dispose=function(){this.disposed=true;this.failWorker();if(this.canvas)this.canvas.width=this.canvas.height=0;};
  Decoder.prototype.decode=async function(video){
    await this.ready;if(this.disposed||!video.videoWidth)return null;
    var began=performance.now(), bitmap, videoFrame, self=this, code=null;
    var fraction=[0.5,0.25,0.125,1][this.attempt++%4];
    var width=Math.round(video.videoWidth*fraction),height=Math.round(video.videoHeight*fraction);
    var scale=Math.min(fraction<=0.25?2:1,1280/Math.max(width,height));
    var targetW=Math.max(1,Math.round(width*scale)),targetH=Math.max(1,Math.round(height*scale));
    var sx=Math.round((video.videoWidth-width)/2),sy=Math.round((video.videoHeight-height)/2);
    try{
      // VideoFrame transfers the camera buffer without cropping it on the UI thread.
      // The worker performs both resizing and recognition on capable browsers.
      if(this.worker&&window.VideoFrame){
        try{videoFrame=new VideoFrame(video,{timestamp:Math.round(performance.now()*1000)});}catch(error){/* Older video sources use ImageBitmap below. */}
        if(videoFrame){
          if(this.native){try{var nativeHits=await this.native.detect(video);if(nativeHits.length)return nativeHits[0].rawValue;}catch(error){/* Local worker fallback. */}}
          if(this.disposed)return null;
          try{
            return await new Promise(function(resolve,reject){var id=self.attempt;self.pending={id:id,resolve:resolve,reject:reject,timer:setTimeout(function(){self.failWorker();},20000)};self.worker.postMessage({id:id,mode:self.mode,frame:videoFrame,crop:{sx:sx,sy:sy,width:width,height:height,targetW:targetW,targetH:targetH}},[videoFrame]);videoFrame=null;});
          }catch(error){this.failWorker();if(this.disposed)return null;}
        }
      }
      if(window.createImageBitmap){try{bitmap=await createImageBitmap(video,sx,sy,width,height,{resizeWidth:targetW,resizeHeight:targetH,resizeQuality:'pixelated'});}catch(error){/* Canvas fallback for older browsers. */}}
      if(this.disposed)return null;
      if(this.native&&bitmap){try{var found=await this.native.detect(bitmap);if(found.length)code=found[0].rawValue;}catch(error){/* Worker handles native misses. */}}
      if(this.disposed||code)return code;
      if(this.worker&&bitmap){
        try{code=await new Promise(function(resolve,reject){var id=self.attempt;self.pending={id:id,resolve:resolve,reject:reject,timer:setTimeout(function(){self.failWorker();},20000)};self.worker.postMessage({id:id,mode:self.mode,bitmap:bitmap},[bitmap]);bitmap=null;});return code;}catch(error){this.failWorker();if(this.disposed)return null;}
      }
      await library();if(this.disposed)return null;
      var canvas=this.canvas||(this.canvas=document.createElement('canvas'));canvas.width=targetW;canvas.height=targetH;
      var ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;
      ctx.drawImage(video,sx,sy,width,height,0,0,targetW,targetH);
      var reader=this.reader||(this.reader=this.mode==='qr'?new ZXingBrowser.BrowserQRCodeReader():new ZXingBrowser.BrowserMultiFormatReader());
      try{return reader.decodeFromCanvas(canvas).getText();}catch(error){return null;}
    }finally{
      if(videoFrame)videoFrame.close();if(bitmap)bitmap.close();if(this.canvas)this.canvas.width=this.canvas.height=0;
      this.delay=Math.min(1800,Math.max(this.worker?180:350,(performance.now()-began)*1.7));
    }
  };
  window.CameraTools={Decoder:Decoder,library:library};
})();
