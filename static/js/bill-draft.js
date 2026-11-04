/* One recoverable bill per signed-in user and browser tab; never store CSRF tokens. */
function initBillDraft() {
  'use strict';
  var form = document.getElementById('invoice-form');
  var key = 'billing-draft-v1-' + form.dataset.user;
  var notice = document.getElementById('draft-notice');
  var state = document.getElementById('draft-state');
  var storageOK = true;
  var restoring = false;
  var pending = null;
  var names = ['client_id', 'client_gstin', 'payment_type', 'payment_method', 'partial_amount',
    'discount_type', 'discount_value', 'exchange_metal', 'exchange_amount', 'submission_key'];
  var rowNames = ['description', 'item_type', 'quantity', 'weight', 'making_charges',
    'making_mode', 'unit_price', 'product_code'];
  function snapshot() {
    var data = {savedAt:Date.now(), fields:{}, rows:[]};
    names.forEach(function (name) { data.fields[name] = form.elements[name].value; });
    form.querySelectorAll('.item-row').forEach(function (row) {
      var item = {weighed:row.dataset.weighed === '1'};
      rowNames.forEach(function (name) { item[name] = row.querySelector('[name="' + name + '"]').value; });
      data.rows.push(item);
    });
    return data;
  }
  function save() {
    if (restoring || pending) return;
    try {
      var data = snapshot();
      sessionStorage.setItem(key, JSON.stringify(data));
      state.textContent = 'Draft saved in this tab · ' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    } catch (error) {
      storageOK = false;
      state.textContent = 'Draft saving is unavailable. Keep this tab open until you save the bill.';
    }
  }
  function restore(data) {
    restoring = true;
    names.forEach(function (name) {
      if (data.fields[name] !== undefined) form.elements[name].value = data.fields[name];
    });
    // Update customer context first, then restore a manually overridden GSTIN.
    form.elements.client_id.dispatchEvent(new Event('change', {bubbles:true}));
    if (data.fields.client_gstin !== undefined) form.elements.client_gstin.value = data.fields.client_gstin;
    document.getElementById('items-container').replaceChildren();
    data.rows.forEach(function (item) {
      var row = newRow({desc:item.description, type:item.item_type, weight:item.weight,
        price:item.unit_price, code:item.product_code, mode:item.making_mode}, item.weighed);
      rowNames.forEach(function (name) {
        if (item[name] !== undefined) row.querySelector('[name="' + name + '"]').value = item[name];
      });
      toggleMetalFields(row.querySelector('[name="item_type"]'));
    });
    if (!data.rows.length) newRow({});
    var partial = form.elements.payment_type.value === 'partial';
    document.getElementById('partial_payment_section').style.display = partial ? 'block' : 'none';
    form.elements.partial_amount.required = partial;
    calculateTotals();
    pending = null; notice.hidden = true; restoring = false; save();
  }
  try {
    pending = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (pending && (!pending.fields || !Array.isArray(pending.rows) || Date.now() - pending.savedAt > 86400000)) {
      sessionStorage.removeItem(key); pending = null;
    }
  } catch (error) { storageOK = false; pending = null; }
  if (SERVER_FORM) {
    var data = {fields:{}, rows:[]};
    names.forEach(function (name) { if (SERVER_FORM[name]) data.fields[name] = SERVER_FORM[name][0]; });
    var count = (SERVER_FORM.description || []).length;
    for (var i = 0; i < count; i++) {
      var item = {};
      rowNames.forEach(function (name) { item[name] = (SERVER_FORM[name] || [])[i] || ''; });
      item.weighed = (SERVER_FORM.weighed || [])[i] === '1';
      data.rows.push(item);
    }
    restore(data);
    document.getElementById('bill-error').focus();
  } else if (pending) {
    notice.hidden = false;
    state.textContent = 'Resume or discard the previous draft before starting a new bill.';
    // Protect the offered draft from being overwritten by a new bill.
    form.querySelector('[type=submit]').disabled = true;
  }
  if (!storageOK) state.textContent = 'Draft saving is unavailable. Keep this tab open until you save.';
  document.getElementById('restore-draft').addEventListener('click', function () {
    if (pending) restore(pending);
    form.querySelector('[type=submit]').disabled = false;
  });
  document.getElementById('discard-draft').addEventListener('click', function () {
    if (!window.confirm('Discard the unfinished bill saved in this tab?')) return;
    pending = null; notice.hidden = true;
    try { sessionStorage.removeItem(key); } catch (error) { /* Storage can be disabled. */ }
    state.textContent = 'New bill ready. Drafts stay in this browser tab for 24 hours.';
    form.querySelector('[type=submit]').disabled = false;
  });
  form.addEventListener('input', save);
  form.addEventListener('change', save);
  form.addEventListener('submit', function (event) {
    if (pending) { event.preventDefault(); notice.scrollIntoView({block:'center'}); return; }
    // Persist whether quantity means grams so failed submissions restore faithfully.
    form.querySelectorAll('[name=weighed]').forEach(function (input) { input.remove(); });
    form.querySelectorAll('.item-row').forEach(function (row) {
      var input = document.createElement('input'); input.type = 'hidden'; input.name = 'weighed';
      input.value = row.dataset.weighed === '1' ? '1' : '0'; row.appendChild(input);
    });
    if (!form.checkValidity()) { event.preventDefault(); form.reportValidity(); return; }
    save();
  });
  window.addEventListener('pagehide', save);
}

function initQuickCustomer() {
  var dialog = document.getElementById('customer-dialog');
  var form = document.getElementById('quick-customer-form');
  var open = document.getElementById('new-customer');
  var errorBox = document.getElementById('customer-error');
  open.addEventListener('click', function () { dialog.showModal(); document.getElementById('quick-name').focus(); });
  document.getElementById('close-customer').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('close', function () { open.focus(); });
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (form.dataset.saving) return;
    form.dataset.saving = 'true'; errorBox.textContent = '';
    var button = form.querySelector('[type=submit]'); button.disabled = true; button.textContent = 'Adding…';
    var data = new FormData(form);
    data.set('csrf_token', document.querySelector('#invoice-form [name=csrf_token]').value);
    try {
      var response = await fetch(QUICK_CLIENT_URL, {method:'POST', body:data, headers:{Accept:'application/json'}});
      if (response.redirected) throw new Error('Your session expired. Keep this bill open and sign in again in another tab.');
      var result;
      try { result = await response.json(); } catch (error) { throw new Error('Could not add the customer. Refresh your sign-in and try again.'); }
      if (!response.ok) throw new Error(result.message || 'Could not add the customer.');
      var customer = result.client;
      var select = document.getElementById('client_id');
      var option = new Option(customer.name + ' (' + customer.phone + ') — Bal: ₹0.00', customer.id, true, true);
      option.dataset.search = (customer.name + ' ' + customer.phone).toLowerCase();
      option.dataset.balance = '0.00'; option.dataset.gstin = customer.gstin;
      select.add(option); select.value = String(customer.id);
      document.getElementById('client-search').value = '';
      Array.from(select.options).forEach(function (item) { item.hidden = false; });
      select.dispatchEvent(new Event('change', {bubbles:true}));
      dialog.close(); form.reset(); showToast('Customer added and selected.');
    } catch (error) { errorBox.textContent = error.message || 'Check your connection and try again.'; }
    finally { delete form.dataset.saving; button.disabled = false; button.textContent = 'Add & select customer'; }
  });
}
