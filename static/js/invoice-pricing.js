/* All monetary decisions come from the original server rules, never a device's JS math. */
function initInvoicePricing() {
  var form = document.getElementById('invoice-form');
  var status = document.getElementById('pricing-status');
  var button = form.querySelector('button[type=submit]');
  var timer, controller, revision = 0, valid = false, approved = false, saving = false;
  function setSaveDisabled(disabled) {
    disabled = disabled || form.dataset.completed === 'true';
    Array.from(form.elements).forEach(function(element) { if(element.tagName === 'BUTTON' && element.type === 'submit') element.disabled = disabled; });
  }
  function filled() { return Array.from(form.querySelectorAll('[name=description]')).filter(function (field) { return field.value.trim(); }).length; }
  function money(id, paise) { var node = document.getElementById(id); if (node) node.textContent = fmt(paise / 100); }
  async function request() {
    clearTimeout(timer);
    if (!document.getElementById('draft-notice').hidden || form.dataset.completed === 'true') { setSaveDisabled(true); return false; }
    var version = ++revision;
    if (controller) controller.abort();
    controller = new AbortController(); valid = false;
    status.classList.remove('error'); status.textContent = 'Updating bill total…';
    var timedOut = false;
    var timeout = setTimeout(function () { timedOut = true; controller.abort(); }, 20000);
    try {
      var response = await ShopRequest.post(INVOICE_PREVIEW_URL, function () { return new FormData(form); }, {signal:controller.signal});
      if (response.redirected) throw new Error('Sign in again in another tab, then update this bill.');
      var data;
      try { data = await response.json(); } catch (error) { throw new Error('Could not update the total. Refresh your sign-in and try again.'); }
      if (version !== revision) return false;
      if (!response.ok || !data.success) throw new Error(data.message || data.error || 'Review the item details.');
      if (data.gold_rate !== undefined) { GOLD_RATE = data.gold_rate / 100; SILVER_RATE = data.silver_rate / 100; money('rate-gold', data.gold_rate); money('rate-silver', data.silver_rate); money('current-gold-rate', data.gold_rate); money('current-silver-rate', data.silver_rate); }
      money('subtotal', data.subtotal); money('discount-amount', data.discount);
      money('gst-amount', data.gst); money('exchange-amount', data.exchange);
      money('total', data.total); money('dock-total', data.total);
      money('received-amount', data.paid); money('remaining-amount', data.due);
      money('dock-paid', data.paid); money('dock-due', data.due);
      document.getElementById('gst-rate-display').textContent = data.gst_rate;
      var count = filled(); document.getElementById('bill-lines').textContent = count + (count === 1 ? ' item' : ' items');
      var rows = form.querySelectorAll('.item-row');
      rows.forEach(function (row) { row.querySelector('.line-total').value = '0.00'; });
      data.lines.forEach(function (line) {
        var row = rows[line.index]; if (!row) return;
        row.querySelector('.line-total').value = (line.total / 100).toFixed(2);
        if (['gold','silver'].includes(row.querySelector('[name=item_type]').value)) {
          row.querySelector('[name=unit_price]').value = (line.unit_price / 100).toFixed(2);
          row.querySelector('.line-note').textContent = line.grams.toFixed(3) + ' g · Making ' + (line.mode === 'percent' ? line.making_used + '%' : '₹' + line.making_used + (row.querySelector('[name=item_type]').value === 'silver' ? '/10 g' : '/g')) + ' · Line total ₹' + fmt(line.total / 100);
        } else row.querySelector('.line-note').textContent = '';
      });
      valid = count > 0 && data.total >= 0;
      status.textContent = count ? 'Bill total is up to date.' : 'Add an item to begin.';
      setSaveDisabled(saving || !document.getElementById('draft-notice').hidden);
      return valid;
    } catch (error) {
      if ((error.name === 'AbortError' && !timedOut) || version !== revision) return false;
      status.classList.add('error'); status.textContent = (saving ? 'Bill not saved. ' : 'Total unavailable. ') + (timedOut ? 'The request timed out. Retry when the connection returns.' : error.message || 'Check the connection and retry.');
      return false;
    } finally { clearTimeout(timeout); }
  }
  function schedule() {
    revision++; if (controller) controller.abort();
    valid = false; approved = false;
    status.textContent = 'Updating bill total…';
    clearTimeout(timer); timer = setTimeout(request, 400);
    return Promise.resolve(false);
  }
  window.InvoicePricing = {schedule:schedule, refresh:request};
  form.addEventListener('input', function (event) { if (event.target.name && event.target.name !== 'csrf_token') schedule(); });
  form.addEventListener('change', function (event) { if (event.target.name) schedule(); });
  form.addEventListener('submit', async function (event) {
    if (form.dataset.completed === 'true') { event.preventDefault(); return; }
    if (approved) { approved = false; return; }
    event.preventDefault();
    if (saving || !document.getElementById('draft-notice').hidden || !form.reportValidity()) return;
    saving = true; setSaveDisabled(true);
    var ready = await request();
    saving = false; setSaveDisabled(false);
    if (ready) { approved = true; form.requestSubmit(button); }
    else status.scrollIntoView({block:'center', behavior:'smooth'});
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && form.dataset.completed !== 'true') schedule(); });
  window.addEventListener('pageshow', function (event) { if (event.persisted && form.dataset.completed !== 'true') schedule(); });
  schedule();
}
