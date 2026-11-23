(function () {
  'use strict';
  var form = document.getElementById('product-form');
  if (!form) return;
  Object.entries(window.productFormValues || {}).forEach(function (entry) {
    var field = form.elements.namedItem(entry[0]);
    if (field && field.type !== 'file' && field.name !== 'csrf_token') field.value = entry[1];
  });
  if (window.syncUnit) window.syncUnit(form.elements.unit.value);
  var upload = document.getElementById('existing-qr-upload');
  var captureInput = document.getElementById('existing-qr-capture');
  var input = document.getElementById('existing_code');
  var status = document.getElementById('existing-qr-status');
  var save = form.querySelector('[type="submit"]');
  var version = 0, photoController;
  function message(text, error) { status.textContent = text; status.classList.toggle('error', Boolean(error)); }
  document.getElementById('clear-existing-qr').addEventListener('click', function () {
    if(control&&control.isOpen())control.close();if(photoController)photoController.abort();version++; upload.value = ''; captureInput.value = ''; input.value = ''; input.readOnly = false; save.disabled = false;
    message('No existing code linked. A new code will be generated when you save.');
  });
  async function readImage(file) {
    if (!file) return;
    if(control&&control.isOpen())control.close();
    if(photoController)photoController.abort();photoController=new AbortController();var current = ++version;
    input.value = ''; input.readOnly = true; save.disabled = true;
    var url;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) throw new Error('Choose a JPG, PNG or WebP image smaller than 15 MB.');
      message('Reading the QR image…');
      url = URL.createObjectURL(file);
      var img = new Image(); img.src = url; await img.decode();
      if (current !== version) return;
      if (img.naturalWidth * img.naturalHeight > 32000000) throw new Error('This photo is too large. Take a closer photo at a lower resolution.');
      var code = await CameraTools.readImage(img, 'multi', photoController.signal);
      if (current !== version) return;
      if (!code) throw new Error('No QR code found. Choose a clearer photo or remove this image and enter the code.');
      code = code.split('|')[0].trim();
      if (!code || code.length > 100 || /[\x00-\x1f\x7f]/.test(code)) throw new Error('This QR does not contain a supported product code (up to 100 characters).');
      input.value = code;
      message('QR recognised. Photo discarded; only this code will be saved with the product.');
      input.readOnly = false; save.disabled = false;
    } catch (error) {
      if (current === version) message(error.message || 'Could not read this image. Try another photo.', true);
      // Keep Save disabled until the failed image is removed or replaced.
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (img) img.src = '';
      if (current === version) { upload.value = ''; captureInput.value = ''; }
    }
  }
  upload.addEventListener('change', function () { readImage(upload.files[0]); });
  captureInput.addEventListener('change', function () { readImage(captureInput.files[0]); });

  var camera=document.getElementById('product-qr-camera');
  form.querySelector('.existing-qr-section').appendChild(camera);
  var control=CameraTools.panel(camera),video=document.getElementById('product-camera-video'),cameraStatus=document.getElementById('product-camera-status');
  var stream,liveDecoder,scanTimer,cameraVersion=0;
  function releaseCamera(){cameraVersion++;clearTimeout(scanTimer);if(liveDecoder)liveDecoder.dispose();liveDecoder=null;CameraTools.stop(stream);CameraTools.stop(video.srcObject);stream=null;video.srcObject=null;}
  camera.addEventListener('cameraclose',releaseCamera);
  video.addEventListener('pointerup',function(event){CameraTools.focus(video,stream,event);});
  document.getElementById('existing-qr-take-photo').addEventListener('click',async function(){
    if(!isSecureContext||!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){captureInput.click();return;}
    releaseCamera();control.open();cameraStatus.textContent='Opening camera…';var active=cameraVersion;
    function current(){return active===cameraVersion&&control.isOpen()&&!document.hidden;}
    liveDecoder=new CameraTools.Decoder('multi');var decoder=liveDecoder;
    try{var requested=await CameraTools.start(video,current);if(!requested)return;stream=requested;cameraStatus.textContent='Point at the code. Tap to focus.';
      async function frame(){if(!current()||!stream)return;try{var code=await decoder.decode(video);if(code&&current()){code=code.split('|')[0].trim();if(code&&code.length<=100&&!/[\x00-\x1f\x7f]/.test(code)){version++;control.close();input.value=code;input.readOnly=false;save.disabled=false;upload.value='';captureInput.value='';message('Code recognised. Only its code is saved.');return;}}}catch(ignore){/* Next fresh frame. */}if(current())scanTimer=setTimeout(frame,decoder.delay);}
      frame();
    }catch(error){if(!current())return;releaseCamera();cameraStatus.textContent=error.name==='NotAllowedError'?'Camera permission was denied. Choose an image above.':'Camera unavailable. Choose an image above.';}
  });
  document.addEventListener('visibilitychange',function(){if(document.hidden&&control.isOpen())control.close();});
})();
