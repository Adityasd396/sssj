/* Local QR/1D scanning. Never derive a price from a printed tag. */
(function () {
  'use strict';
  var dialog = document.getElementById('scan-modal');
  if (!dialog) return;
  var video = document.getElementById('scan-video');
  var status = document.getElementById('scan-status');
  var start = document.getElementById('scan-start');
  var result = document.getElementById('scan-result');
  var track, stream, liveDecoder, tick, epoch = 0, cameraBusy = false;
  var selected, facing = 'environment', method = 'camera', opener, lookupController;
  var light = false, detector;
  function message(text, error) { status.textContent = text; status.classList.toggle('error', Boolean(error)); }
  function stopCamera() {
    epoch++; clearTimeout(tick); cameraBusy = false;
    if (liveDecoder) liveDecoder.dispose();
    liveDecoder = null;
    if (stream) stream.getTracks().forEach(function (item) { item.stop(); });
    stream = null; track = null; video.srcObject = null; light = false;
    document.getElementById('scan-idle').hidden = false;
    document.getElementById('scanner-live').hidden = true;
    ['scan-switch','scan-torch','scan-zoom-wrap'].forEach(function (id) { document.getElementById(id).hidden = true; });
    start.hidden = false; start.disabled = false; start.textContent = 'Start camera';
  }
  function clearResult() { selected = null; result.hidden = true; document.getElementById('scan-add').disabled = false; }
  function chooseMethod(next) {
    stopCamera(); method = next; clearResult();
    dialog.querySelectorAll('[data-scan-tab]').forEach(function (tab) {
      var active = tab.dataset.scanTab === next;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      document.getElementById('scan-' + tab.dataset.scanTab + '-panel').hidden = !active;
    });
    message(next === 'camera' ? 'Start the camera, then hold the code inside the corners.' : next === 'photo' ? 'Choose a sharp photo with the whole code visible.' : 'Enter the number printed beneath the barcode.');
    if (next === 'code') document.getElementById('scan-manual').focus();
  }
  function open(button) {
    opener = button || document.activeElement;
    if (!dialog.open) dialog.showModal();
    chooseMethod('camera');
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      message('Camera access needs HTTPS or localhost. Upload a photo or enter the tag number on this connection.', true);
      start.disabled = true;
    } else { beginCamera(); }
  }
  async function find(raw) {
    var code = String(raw || '').split('|')[0].trim();
    if (!code || code.length > 100) { message('Enter a valid tag number (up to 100 characters).', true); return; }
    stopCamera(); clearResult();
    if (lookupController) lookupController.abort();
    lookupController = new AbortController();
    var version = epoch;
    message('Finding the item in your inventory…');
    try {
      var response = await fetch(dialog.dataset.lookup.replace('__CODE__', encodeURIComponent(code)), {signal:lookupController.signal, headers:{Accept:'application/json'}});
      if (response.redirected) throw new Error('Your session expired. Sign in again to look up this item.');
      if (!response.ok) throw new Error('Could not look up the tag. Check your connection and try again.');
      var data = await response.json();
      if (!dialog.open || version !== epoch) return;
      if (!data.success) throw new Error('No item matches “' + code + '”. Check the tag number or try another photo.');
      selected = data.product;
      document.getElementById('scan-result-name').textContent = selected.name;
      var stock = selected.unit === 'g' ? selected.stock_weight + ' g available' : selected.stock_quantity + ' pieces available';
      document.getElementById('scan-result-detail').textContent = selected.item_type.charAt(0).toUpperCase() + selected.item_type.slice(1) + ' · ' + (selected.unit === 'g' ? 'Sold by weight' : selected.weight_per_unit + ' g per piece') + ' · ' + stock;
      document.getElementById('scan-result-code').textContent = selected.barcode;
      document.getElementById('scan-open-item').href = dialog.dataset.product.replace(/0$/, selected.id);
      var inBill = typeof window.addProductToForm === 'function';
      document.getElementById('scan-add').textContent = inBill ? 'Add to this bill' : 'Create bill with item';
      document.getElementById('scan-add').disabled = (selected.unit === 'g' ? selected.stock_weight : selected.stock_quantity) <= 0;
      result.hidden = false; message('Tag recognised. Check the item below before continuing.');
      if (navigator.vibrate) navigator.vibrate(35);
      document.getElementById('scan-add').focus();
    } catch (error) { if (error.name !== 'AbortError' && dialog.open && version === epoch) message(error.message || 'Could not read the tag. Try again.', true); }
  }
  async function decoder() {
    if (detector) return detector;
    if (window.BarcodeDetector) {
      try {
        var supported = await BarcodeDetector.getSupportedFormats();
        var formats = ['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e'].filter(function (format) { return supported.includes(format); });
        if (formats.includes('code_128') && formats.includes('qr_code')) detector = new BarcodeDetector({formats:formats});
      } catch (error) { /* Bundled decoder handles unsupported native engines. */ }
    }
    return detector;
  }
  async function beginCamera() {
    if (cameraBusy || stream) return;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      message('Camera access needs HTTPS or localhost. Choose Upload photo or Enter code instead.', true); return;
    }
    clearResult(); cameraBusy = true; start.disabled = true; start.textContent = 'Opening camera…';
    var version = ++epoch;
    try {
      var requested;
      try { requested = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing}, width:{ideal:3840}, height:{ideal:2160}, frameRate:{ideal:12,max:15}, resizeMode:{ideal:'none'}}, audio:false}); }
      catch (error) {
        if (error.name === 'OverconstrainedError') requested = await navigator.mediaDevices.getUserMedia({video:{facingMode:facing},audio:false});
        else throw error;
      }
      if (!dialog.open || version !== epoch) { requested.getTracks().forEach(function (item) { item.stop(); }); return; }
      stream = requested; track = stream.getVideoTracks()[0]; video.srcObject = stream;
      await video.play();
      if (!dialog.open || version !== epoch) return;
      var caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.width && caps.height) {
        try { await track.applyConstraints({width:{ideal:caps.width.max},height:{ideal:caps.height.max},frameRate:{ideal:12,max:15},resizeMode:{ideal:'none'}}); } catch (error) { /* Keep the working resolution. */ }
      }
      if (!dialog.open || version !== epoch) return;
      if (caps.focusMode && caps.focusMode.includes('continuous')) {
        try { await track.applyConstraints(Object.assign({}, track.getConstraints(), {advanced:[{focusMode:'continuous'}]})); } catch (error) { /* Optional hardware feature. */ }
      }
      document.getElementById('scan-torch').hidden = !caps.torch;
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        var zoom = document.getElementById('scan-zoom'); zoom.min = caps.zoom.min; zoom.max = caps.zoom.max; zoom.step = caps.zoom.step || 0.1; zoom.value = track.getSettings().zoom || caps.zoom.min;
        document.getElementById('scan-zoom-wrap').hidden = false;
      }
      document.getElementById('scan-switch').hidden = false;
      document.getElementById('scan-idle').hidden = true;
      document.getElementById('scanner-live').hidden = false;
      start.hidden = true; cameraBusy = false;
      message('Centre the code and hold steady. Use zoom for a small tag.');
      liveDecoder = new CameraTools.Decoder('multi');
      var engine = liveDecoder;
      async function frame() {
        if (!stream || version !== epoch) return;
        try {
          var code = await engine.decode(video);
          if (code && version === epoch) { find(code); return; }
        } catch (error) { /* Let the user switch to upload/manual entry. */ }
        if (version === epoch) tick = setTimeout(frame, engine.delay);
      }
      frame();
    } catch (error) {
      if (version !== epoch) return;
      stopCamera();
      var descriptions = {NotAllowedError:'Camera permission was denied. Allow camera access in your browser, or upload a photo.', NotFoundError:'No camera was found. Use a photo, enter the code, or connect a USB scanner.', NotReadableError:'The camera is busy in another application. Close it there and try again.'};
      message(descriptions[error.name] || 'The camera could not start. Try again or choose another scan method.', true);
    }
  }
  async function readPhoto(file) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(file.type)) {
      message('Choose a JPG, PNG or WebP image smaller than 15 MB.', true); return;
    }
    stopCamera(); clearResult(); var version = epoch;
    message('Reading the code in your photo…');
    var url = URL.createObjectURL(file);
    try {
      var img = new Image(); img.src = url; await img.decode();
      if (!dialog.open || version !== epoch) return;
      var scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      var canvas = document.createElement('canvas'); canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      var code, native = await decoder();
      if (native) { try { var hits = await native.detect(canvas); if (hits.length) code = hits[0].rawValue; } catch (error) { /* Use local decoder. */ } }
      if (!code) {
        await CameraTools.library();
        var local = new ZXingBrowser.BrowserMultiFormatReader();
        // Try the full image and rotated images for narrow vertical tag barcodes.
        for (var turn = 0; turn < 4 && !code; turn++) {
          var rotated = document.createElement('canvas');
          rotated.width = turn % 2 ? canvas.height : canvas.width; rotated.height = turn % 2 ? canvas.width : canvas.height;
          var ctx = rotated.getContext('2d'); ctx.translate(rotated.width / 2, rotated.height / 2); ctx.rotate(turn * Math.PI / 2); ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
          try { code = local.decodeFromCanvas(rotated).getText(); } catch (error) { /* Try another orientation. */ }
        }
      }
      if (version !== epoch || !dialog.open) return;
      if (code) await find(code); else message('No code found. Retake a closer, sharper photo with the entire code visible, or enter its number.', true);
    } catch (error) { if (version === epoch && dialog.open) message('Could not read this photo. Try a different image or enter the tag number.', true); }
    finally { URL.revokeObjectURL(url); document.getElementById('qr-upload').value = ''; }
  }
  document.querySelectorAll('[data-open-scanner]').forEach(function (button) { button.addEventListener('click', function () { open(button); }); });
  function closeScanner() { stopCamera(); if (lookupController) lookupController.abort(); dialog.close(); }
  dialog.querySelector('[data-close-scanner]').addEventListener('click', closeScanner);
  dialog.addEventListener('cancel', function () { stopCamera(); if (lookupController) lookupController.abort(); });
  dialog.addEventListener('close', function () { stopCamera(); if (lookupController) lookupController.abort(); if (opener && opener.isConnected) opener.focus(); });
  dialog.querySelectorAll('[data-scan-tab]').forEach(function (tab) {
    tab.addEventListener('click', function () { chooseMethod(tab.dataset.scanTab); });
    tab.addEventListener('keydown', function (event) {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); var tabs = Array.from(dialog.querySelectorAll('[data-scan-tab]')); var index = tabs.indexOf(tab);
      index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      chooseMethod(tabs[index].dataset.scanTab); tabs[index].focus();
    });
  });
  start.addEventListener('click', beginCamera);
  document.getElementById('scan-switch').addEventListener('click', function () { stopCamera(); facing = facing === 'environment' ? 'user' : 'environment'; beginCamera(); });
  document.getElementById('scan-torch').addEventListener('click', async function () {
    if (!track) return;
    try { light = !light; await track.applyConstraints(Object.assign({}, track.getConstraints(), {advanced:[{torch:light}]})); this.textContent = light ? 'Light on' : 'Light off'; this.setAttribute('aria-pressed', String(light)); }
    catch (error) { light = false; message('This camera could not switch its light. Move the tag into a brighter area.'); }
  });
  document.getElementById('scan-zoom').addEventListener('input', async function () { if (track) { try { await track.applyConstraints(Object.assign({}, track.getConstraints(), {advanced:[{zoom:Number(this.value)}]})); } catch (error) { /* Device may reject a zoom level. */ } } });
  document.getElementById('scan-find').addEventListener('click', function () { find(document.getElementById('scan-manual').value); });
  document.getElementById('scan-manual').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); find(this.value); } });
  document.getElementById('qr-upload').addEventListener('change', function () { readPhoto(this.files[0]); });
  document.getElementById('scan-again').addEventListener('click', function () { chooseMethod(method); if (method === 'camera') beginCamera(); });
  document.getElementById('scan-add').addEventListener('click', function () {
    if (!selected || this.disabled) return; this.disabled = true;
    if (typeof window.addProductToForm === 'function') {
      window.addProductToForm(selected); closeScanner(); showToast(selected.name + ' added to the bill.');
    } else location.href = dialog.dataset.newBill + '?product_code=' + encodeURIComponent(selected.barcode);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && dialog.open) { stopCamera(); message('Camera paused while this page was hidden. Start it again when you are ready.'); } });
  window.addEventListener('pagehide', stopCamera);
  window.openScanner = function () { open(document.activeElement); };
})();
