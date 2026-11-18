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
  var version = 0;
  function message(text, error) { status.textContent = text; status.classList.toggle('error', Boolean(error)); }
  document.getElementById('clear-existing-qr').addEventListener('click', function () {
    version++; upload.value = ''; captureInput.value = ''; input.value = ''; input.readOnly = false; save.disabled = false;
    message('No existing code linked. A new code will be generated when you save.');
  });
  async function readImage(file) {
    if (!file) return;
    var current = ++version;
    input.value = ''; input.readOnly = true; save.disabled = true;
    var url;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) throw new Error('Choose a JPG, PNG or WebP image smaller than 15 MB.');
      message('Reading the QR image…');
      url = URL.createObjectURL(file);
      var img = new Image(); img.src = url; await img.decode();
      if (current !== version) return;
      if (img.naturalWidth * img.naturalHeight > 32000000) throw new Error('This photo is too large. Take a closer photo at a lower resolution.');
      var scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      await CameraTools.library();
      if (current !== version) return;
      var reader = new ZXingBrowser.BrowserQRCodeReader();
      var code;
      for (var turn = 0; turn < 4 && !code; turn++) {
        var rotated = document.createElement('canvas');
        rotated.width = turn % 2 ? canvas.height : canvas.width;
        rotated.height = turn % 2 ? canvas.width : canvas.height;
        var ctx = rotated.getContext('2d');
        ctx.translate(rotated.width / 2, rotated.height / 2); ctx.rotate(turn * Math.PI / 2);
        ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
        try { code = reader.decodeFromCanvas(rotated).getText(); } catch (error) { /* Try the next orientation. */ }
        rotated.width = rotated.height = 0;
      }
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
      if (canvas) canvas.width = canvas.height = 0;
      if (current === version) { upload.value = ''; captureInput.value = ''; }
    }
  }
  upload.addEventListener('change', function () { readImage(upload.files[0]); });
  captureInput.addEventListener('change', function () { readImage(captureInput.files[0]); });

  var camera = document.getElementById('product-qr-camera');
  var video = document.getElementById('product-camera-video');
  var cameraStatus = document.getElementById('product-camera-status');
  var shutter = document.getElementById('product-camera-capture');
  var stream, liveDecoder, scanTimer, cameraVersion = 0;
  function releaseCamera() {
    cameraVersion++; clearTimeout(scanTimer);
    if (liveDecoder) liveDecoder.dispose();
    liveDecoder = null;
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    stream = null; video.srcObject = null; shutter.disabled = true;
  }
  function closeCamera() { releaseCamera(); camera.close(); }
  document.getElementById('existing-qr-take-photo').addEventListener('click', async function () {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      message('Only the QR code is kept by this app. Your device camera may keep its own photo copy.');
      captureInput.click(); return;
    }
    releaseCamera(); camera.showModal();
    cameraStatus.textContent = 'Opening camera…';
    var active = cameraVersion;
    try {
      var requested = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:3840},height:{ideal:2160},frameRate:{ideal:12,max:15}},audio:false});
      if (active !== cameraVersion || !camera.open) { requested.getTracks().forEach(function (track) { track.stop(); }); return; }
      stream = requested; video.srcObject = stream; await video.play();
      if (active !== cameraVersion) return;
      var track = stream.getVideoTracks()[0];
      var caps = track.getCapabilities ? track.getCapabilities() : {};
      // Ask the selected camera for its reported maximum, retaining its usable
      // initial stream when the browser rejects an optional quality adjustment.
      if (caps.width && caps.height) {
        try { await track.applyConstraints({width:{ideal:caps.width.max},height:{ideal:caps.height.max},frameRate:{ideal:12,max:15},resizeMode:{ideal:'none'}}); } catch (error) { /* Keep the working resolution. */ }
      }
      if (active !== cameraVersion) return;
      if (caps.focusMode && caps.focusMode.includes('continuous')) {
        try { await track.applyConstraints(Object.assign({}, track.getConstraints(), {advanced:[{focusMode:'continuous'}]})); } catch (error) { /* Optional focus support. */ }
      }
      if (active !== cameraVersion) return;
      shutter.disabled = false;
      cameraStatus.textContent = 'Centre the QR and hold steady.';
      scanLive(active);
    } catch (error) {
      if (active !== cameraVersion) return;
      releaseCamera();
      cameraStatus.textContent = error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow access or choose an image instead.' : 'Camera unavailable. Close other camera apps or choose an image instead.';
    }
  });
  async function scanLive(active) {
    liveDecoder = new CameraTools.Decoder('qr');
    var engine = liveDecoder;
    async function nextFrame() {
      if (!stream || !camera.open || active !== cameraVersion) return;
      try {
        var code = await engine.decode(video);
        if (code && active === cameraVersion) {
          code = code.split('|')[0].trim();
          if (!code || code.length > 100 || /[\x00-\x1f\x7f]/.test(code)) {
            cameraStatus.textContent = 'Use a product QR with a code of up to 100 characters.';
          } else {
            version++; closeCamera(); input.value = code; input.readOnly = false; save.disabled = false;
            upload.value = ''; captureInput.value = '';
            message('QR recognised. Only its code is saved.');
            return;
          }
        }
      } catch (error) { /* Retry or let the user choose a photo instead. */ }
      if (stream && camera.open && active === cameraVersion) scanTimer = setTimeout(nextFrame, engine.delay);
    }
    nextFrame();
  }
  shutter.addEventListener('click', function () {
    if (!stream || !video.videoWidth) return;
    shutter.disabled = true;
    var active = cameraVersion;
    var frame = document.createElement('canvas');
    frame.width = video.videoWidth; frame.height = video.videoHeight;
    frame.getContext('2d').drawImage(video, 0, 0);
    frame.toBlob(function (blob) {
      frame.width = frame.height = 0;
      if (active !== cameraVersion || !camera.open) return;
      closeCamera();
      if (blob) readImage(new File([blob], 'qr-photo.png', {type:'image/png'}));
      else message('Could not capture this photo. Please try again.', true);
    }, 'image/png');
  });
  document.getElementById('product-camera-close').addEventListener('click', closeCamera);
  document.getElementById('product-camera-upload').addEventListener('click', function () { closeCamera(); upload.click(); });
  camera.addEventListener('cancel', releaseCamera);
  camera.addEventListener('close', function () { if (!camera.open) releaseCamera(); });
  window.addEventListener('pagehide', releaseCamera);
  document.addEventListener('visibilitychange', function () { if (document.hidden && camera.open) closeCamera(); });
})();
