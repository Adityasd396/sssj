/* Reused worker buffers; native detection first and local codec only when needed. */
self.window=self;
var readers={},nativeReaders={},canvas,context,rotated,rotatedContext,libraryLoaded=false;
function library(){if(!libraryLoaded){importScripts('vendor/zxing-browser-0.2.1.min.js');libraryLoaded=true;}}
async function nativeReader(mode){
 if(nativeReaders[mode]!==undefined)return nativeReaders[mode];
 nativeReaders[mode]=null;
 if(self.BarcodeDetector){try{var supported=await BarcodeDetector.getSupportedFormats(),formats=(mode==='qr'?['qr_code']:['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e']).filter(function(f){return supported.includes(f);});if(formats.length)nativeReaders[mode]=new BarcodeDetector({formats:formats});}catch(ignore){/* Bundled fallback. */}}
 return nativeReaders[mode];
}
self.onmessage=async function(event){
 var data=event.data,bitmap=data.frame||data.bitmap,code=null;
 if(data.init){if(!await nativeReader(data.mode))library();return;}
 try{
  var crop=data.crop,w=crop?crop.targetW:bitmap.width,h=crop?crop.targetH:bitmap.height;
  if(!canvas){canvas=new OffscreenCanvas(w,h);context=canvas.getContext('2d',{willReadFrequently:true});}
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}context.imageSmoothingEnabled=false;
  if(crop)context.drawImage(bitmap,crop.sx,crop.sy,crop.width,crop.height,0,0,w,h);else context.drawImage(bitmap,0,0);
  var detector=await nativeReader(data.mode);if(detector){try{var hits=await detector.detect(canvas);if(hits.length)code=hits[0].rawValue;}catch(ignore){/* Local fallback. */}}
  if(!code){library();var reader=readers[data.mode]||(readers[data.mode]=data.mode==='qr'?new ZXingBrowser.BrowserQRCodeReader():new ZXingBrowser.BrowserMultiFormatReader());try{code=reader.decodeFromCanvas(canvas).getText();}catch(ignore){/* Try another crop on the next frame. */}if(!code&&data.rotate&&data.mode!=='qr'){if(!rotated){rotated=new OffscreenCanvas(h,w);rotatedContext=rotated.getContext('2d',{willReadFrequently:true});}if(rotated.width!==h||rotated.height!==w){rotated.width=h;rotated.height=w;}rotatedContext.setTransform(0,1,-1,0,h,0);rotatedContext.drawImage(canvas,0,0);try{code=reader.decodeFromCanvas(rotated).getText();}catch(ignore){/* No rotated barcode. */}}}
  self.postMessage({id:data.id,code:code});
 }catch(ignore){self.postMessage({id:data.id,error:'decoder-unavailable'});}finally{if(bitmap)bitmap.close();}
};
