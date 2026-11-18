/* Local decoder runs away from the UI thread. No camera frames leave the device. */
// The bundled browser codec references window for text-encoding polyfills.
// In a worker those APIs live on self; no DOM or camera access is exposed.
self.window = self;
importScripts('vendor/zxing-browser-0.2.1.min.js');
var readers = {};
self.onmessage = function (event) {
  var data = event.data, bitmap = data.frame || data.bitmap, code = null;
  try {
    var crop = data.crop;
    var canvas = new OffscreenCanvas(crop ? crop.targetW : bitmap.width, crop ? crop.targetH : bitmap.height);
    var context = canvas.getContext('2d', {willReadFrequently:true});context.imageSmoothingEnabled=false;
    if (crop) context.drawImage(bitmap,crop.sx,crop.sy,crop.width,crop.height,0,0,crop.targetW,crop.targetH);
    else context.drawImage(bitmap,0,0);
    var reader = readers[data.mode] || (readers[data.mode] = data.mode === 'qr' ? new ZXingBrowser.BrowserQRCodeReader() : new ZXingBrowser.BrowserMultiFormatReader());
    try { code = reader.decodeFromCanvas(canvas).getText(); } catch (error) { /* No code in this crop. */ }
    canvas.width = canvas.height = 0;
    self.postMessage({id:data.id, code:code});
  } catch (error) { self.postMessage({id:data.id, error:'decoder-unavailable'}); }
  finally { bitmap.close(); }
};
