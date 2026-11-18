/* Local recovery only. The server remains authoritative for stock, money and saves. */
function initBillDraft() {
  'use strict';
  var form=document.getElementById('invoice-form'), user=form.dataset.user, store=window.BillDraftStorage;
  var notice=document.getElementById('draft-notice'), state=document.getElementById('draft-state');
  var restoring=false, pending=store.read(user), timer;
  var names=['client_id','client_gstin','payment_type','payment_method','partial_amount','discount_type','discount_value','exchange_metal','exchange_amount','submission_key'];
  var rowNames=['description','item_type','quantity','weight','making_charges','making_mode','unit_price','product_code'];
  function setMessage(text){if(state.textContent!==text)state.textContent=text;}
  function buttons(disabled){Array.from(form.elements).forEach(function(input){if(input.tagName==='BUTTON'&&input.type==='submit')input.disabled=disabled;});}
  function completed(){
    var saved=store.completed(user,form.elements.submission_key.value);
    if(!saved)return false;
    store.remove(user,form.elements.submission_key.value);
    form.dataset.completed='true';buttons(true);form.inert=true;notice.hidden=true;
    state.replaceChildren(document.createTextNode('This bill is already saved. '));
    if(/^\/invoices\/\d+$/.test(saved.url||'')){var link=document.createElement('a');link.href=saved.url;link.textContent='Open saved bill';state.appendChild(link);}
    return true;
  }
  function snapshot(){
    var data={savedAt:Date.now(),fields:{},rows:[],section:form.dataset.activeSection||'customer',optionsOpen:document.getElementById('billing-options').open};
    names.forEach(function(name){data.fields[name]=form.elements[name].value;});
    form.querySelectorAll('.item-row').forEach(function(row){var item={weighed:row.dataset.weighed==='1',detailsOpen:row.querySelector('.item-more').open};rowNames.forEach(function(name){item[name]=row.querySelector('[name="'+name+'"]').value;});data.rows.push(item);});
    var quick=document.getElementById('quick-customer-form');data.customerDraft={};['name','phone','gstin'].forEach(function(name){data.customerDraft[name]=quick.elements[name].value;});
    return data;
  }
  function save(){
    clearTimeout(timer);if(restoring||pending||form.dataset.completed==='true')return;
    if(completed())return;
    if(store.isSignedOut(user)){buttons(true);form.inert=true;setMessage('Signed out. Sign in again before continuing.');return;}
    var data=snapshot();
    if(!data.fields.client_id&&!data.rows.some(function(row){return row.description.trim();})&&!Object.values(data.customerDraft).some(Boolean))return;
    var mode=store.write(user,data);
    if(mode==='completed'){completed();return;}
    setMessage(mode==='device'?'Draft saved on this device for 24 hours. Signing out clears it.':mode==='tab'?'Draft saved in this tab. Keep the tab open until the bill is saved.':'Draft storage unavailable. Keep this tab open until the bill is saved.');
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(save,250);}
  async function restore(data){
    restoring=true;form.inert=true;
    try{if(window.ClientLookup)await ClientLookup.ensure(data.fields.client_id);}catch(error){restoring=false;setMessage('Customer could not be loaded. Check your connection, then resume the draft again.');return;}
    form.inert=false;
    names.forEach(function(name){if(data.fields[name]!==undefined)form.elements[name].value=data.fields[name];});
    form.elements.client_id.dispatchEvent(new Event('change',{bubbles:true}));
    if(data.fields.client_gstin!==undefined)form.elements.client_gstin.value=data.fields.client_gstin;
    document.getElementById('items-container').replaceChildren();
    data.rows.forEach(function(item){var row=newRow({desc:item.description,type:item.item_type,weight:item.weight,price:item.unit_price,code:item.product_code,mode:item.making_mode},item.weighed);rowNames.forEach(function(name){if(item[name]!==undefined)row.querySelector('[name="'+name+'"]').value=item[name];});toggleMetalFields(row.querySelector('[name=item_type]'));if(item.detailsOpen!==undefined)row.querySelector('.item-more').open=item.detailsOpen;});
    if(!data.rows.length)newRow({});
    var partial=form.elements.payment_type.value==='partial';document.getElementById('partial_payment_section').style.display=partial?'block':'none';form.elements.partial_amount.required=partial;
    var options=document.getElementById('billing-options');options.open=Boolean(data.optionsOpen||form.elements.discount_type.value!=='none'||form.elements.exchange_metal.value!=='none');
    if(data.customerDraft){var quick=document.getElementById('quick-customer-form');['name','phone','gstin'].forEach(function(name){quick.elements[name].value=data.customerDraft[name]||'';});}
    pending=null;notice.hidden=true;restoring=false;buttons(false);calculateTotals();save();
    form.dataset.activeSection=data.section||'customer';if(window.MobileBill)MobileBill.go(form.dataset.activeSection);
  }
  if(SERVER_FORM){
    var data={fields:{},rows:[],optionsOpen:true};names.forEach(function(name){if(SERVER_FORM[name])data.fields[name]=SERVER_FORM[name][0];});
    for(var i=0;i<(SERVER_FORM.description||[]).length;i++){var item={detailsOpen:true};rowNames.forEach(function(name){item[name]=(SERVER_FORM[name]||[])[i]||'';});item.weighed=(SERVER_FORM.weighed||[])[i]==='1';data.rows.push(item);}
    restore(data);document.getElementById('bill-error').focus();
  }else if(pending){var chosen=Array.from(form.elements.client_id.options).find(function(option){return option.value===pending.fields.client_id;});document.getElementById('draft-summary').textContent='Unfinished bill'+(chosen&&chosen.value?' for '+chosen.text.split('—')[0].trim():'')+' · '+pending.rows.filter(function(row){return row.description;}).length+' items. Resume before starting another.';notice.hidden=false;form.inert=true;buttons(true);setMessage('Resume or discard the unfinished draft before starting another bill.');}
  document.getElementById('restore-draft').addEventListener('click',function(){if(pending)restore(pending);});
  document.getElementById('discard-draft').addEventListener('click',function(){
    if(!window.confirm('Discard this unfinished bill?'))return;
    if(pending)store.remove(user,pending.fields.submission_key);pending=null;form.inert=false;notice.hidden=true;buttons(false);setMessage('New bill ready.');
  });
  form.addEventListener('input',schedule);form.addEventListener('change',schedule);form.addEventListener('bill:section',schedule);
  document.getElementById('quick-customer-form').addEventListener('input',schedule);
  form.addEventListener('submit',function(event){
    if(pending||completed()){event.preventDefault();if(pending)notice.scrollIntoView({block:'center'});return;}
    form.querySelectorAll('[name=weighed]').forEach(function(input){input.remove();});
    form.querySelectorAll('.item-row').forEach(function(row){var input=document.createElement('input');input.type='hidden';input.name='weighed';input.value=row.dataset.weighed==='1'?'1':'0';row.appendChild(input);});
    if(!form.checkValidity()){event.preventDefault();form.reportValidity();return;}save();
  });
  window.addEventListener('pagehide',save);
  document.addEventListener('visibilitychange',function(){if(document.hidden)save();});
  window.addEventListener('pageshow',function(){completed();});
  window.addEventListener('storage',function(event){if(event.key==='billing-completed-v2-'+user){completed();return;}if(event.key==='billing-signout-'+user){try{sessionStorage.removeItem('billing-draft-v1-'+user);}catch(error){/* Storage may be blocked. */}buttons(true);form.inert=true;setMessage('Signed out on another tab. Sign in again before continuing.');}});
}

function initQuickCustomer() {
  var dialog = document.getElementById('customer-dialog'), form = document.getElementById('quick-customer-form');
  var open = document.getElementById('new-customer'), errorBox = document.getElementById('customer-error');
  var duplicate = document.getElementById('use-existing-customer'), pendingRequest;
  function selectCustomer(customer) {
    var select = document.getElementById('client_id');
    var option = Array.from(select.options).find(function (item) { return item.value === String(customer.id); });
    if (!option) { option = new Option(); select.add(option); }
    option.value = String(customer.id); option.text = customer.name + ' (' + customer.phone + ')';
    option.dataset.search = (customer.name + ' ' + customer.phone).toLowerCase();
    option.dataset.balance = ((customer.balance || 0) / 100).toFixed(2); option.dataset.gstin = customer.gstin || '';
    select.value = String(customer.id); document.getElementById('client-search').value = '';
    Array.from(select.options).forEach(function (item) { item.hidden = false; });
    select.dispatchEvent(new Event('change', {bubbles:true}));
    dialog.close(); form.reset(); duplicate.hidden = true;
  }
  open.addEventListener('click', function () { errorBox.textContent = ''; duplicate.hidden = true; dialog.showModal(); document.getElementById('quick-name').focus(); });
  document.getElementById('close-customer').addEventListener('click', function () { if (pendingRequest) pendingRequest.abort(); dialog.close(); });
  dialog.addEventListener('cancel', function () { if (pendingRequest) pendingRequest.abort(); });
  dialog.addEventListener('close', function () { open.focus(); });
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (form.dataset.saving || !form.reportValidity()) return;
    form.dataset.saving = 'true'; errorBox.textContent = ''; duplicate.hidden = true;
    var button = form.querySelector('[type=submit]'); button.disabled = true; button.textContent = 'Adding…';
    var controller = new AbortController(); pendingRequest = controller;
    var timeout = setTimeout(function () { controller.abort(); }, 20000);
    try {
      var response = await ShopRequest.post(QUICK_CLIENT_URL, function () { return new FormData(form); }, {signal:controller.signal});
      if (response.redirected) throw new Error('Sign in again in another tab, then retry. Your bill stays here.');
      var result;
      try { result = await response.json(); } catch (error) { throw new Error('The server could not save this customer. Your details are kept; retry.'); }
      if (!dialog.open) return;
      if (!response.ok || !result.success) {
        if (response.status === 409 && result.client) {
          duplicate.textContent = 'Use ' + result.client.name;
          duplicate.onclick = function () { selectCustomer(result.client); }; duplicate.hidden = false;
        }
        throw new Error(result.message || result.error || 'Could not add the customer.');
      }
      selectCustomer(result.client);
    } catch (error) { errorBox.textContent = error.name === 'AbortError' ? 'The request timed out. Your details are kept; retry safely.' : error.message; }
    finally { clearTimeout(timeout); pendingRequest = null; delete form.dataset.saving; button.disabled = false; button.textContent = 'Add & select customer'; }
  });
}
