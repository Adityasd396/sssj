/* Guiding a continuous form: navigation never drops fields or recalculates money. */
function initMobileBilling() {
  'use strict';
  var form=document.getElementById('invoice-form'), sections=Array.from(form.querySelectorAll('[data-bill-section]'));
  var buttons=Array.from(document.querySelectorAll('[data-bill-go]'));
  function mark(name){form.dataset.activeSection=name;buttons.forEach(function(button){if(button.dataset.billGo===name)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});}
  function go(name){var section=sections.find(function(node){return node.dataset.billSection===name;});if(!section)return;mark(name);var legend=section.querySelector('legend');if(legend)legend.focus({preventScroll:true});if(window.MobileUI)MobileUI.updateViewport();var header=document.querySelector('.workspace-header'),nav=document.querySelector('.workflow-steps');var offset=(header?header.getBoundingClientRect().height:76)+(nav&&getComputedStyle(nav).position==='sticky'?nav.getBoundingClientRect().height:0)+12;scrollTo({top:Math.max(0,scrollY+section.getBoundingClientRect().top-offset),behavior:'auto'});form.dispatchEvent(new Event('bill:section'));}
  buttons.forEach(function(button){button.addEventListener('click',function(){go(button.dataset.billGo);});});
  document.querySelectorAll('[data-bill-continue]').forEach(function(button){button.addEventListener('click',function(){
    var section=button.closest('[data-bill-section]');var invalid=Array.from(section.querySelectorAll('input,select,textarea')).find(function(input){return !input.checkValidity();});
    if(invalid){invalid.reportValidity();return;}go(button.dataset.billContinue);
  });});
  form.addEventListener('invalid',function(event){var section=event.target.closest('[data-bill-section]');if(section)mark(section.dataset.billSection);},true);
  if(window.IntersectionObserver){
    var observer=new IntersectionObserver(function(){
      var candidate=sections.filter(function(section){var box=section.getBoundingClientRect();return box.top<=200&&box.bottom>155;}).pop();
      if(candidate)mark(candidate.dataset.billSection);
    },{rootMargin:'-155px 0px -45% 0px',threshold:[0,0.25,0.5,0.75,1]});sections.forEach(function(section){observer.observe(section);});
  }
  mark(form.dataset.activeSection||'customer');
  window.MobileBill={go:go};
  var options=document.getElementById('billing-options');
  function revealOptions(){if(form.elements.discount_type.value!=='none'||form.elements.exchange_metal.value!=='none')options.open=true;}
  revealOptions();form.addEventListener('change',revealOptions);

  var recent=document.getElementById('recent-customers'), select=form.elements.client_id, user=form.dataset.user;
  var recentKey='billing-recent-clients-'+user;
  function ids(){try{var value=JSON.parse(sessionStorage.getItem(recentKey)||'[]');return Array.isArray(value)?value.slice(0,3):[];}catch(error){return [];}}
  function renderRecent(){
    var list=recent.querySelector('.recent-customer-buttons');list.replaceChildren();
    ids().forEach(function(id){var option=Array.from(select.options).find(function(row){return row.value===String(id);});if(!option)return;var button=document.createElement('button');button.type='button';button.className='btn btn-ghost btn-sm';button.textContent=option.text.split('—')[0].trim();button.title=button.textContent;button.addEventListener('click',function(){select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));});list.appendChild(button);});
    recent.hidden=!list.children.length;
  }
  select.addEventListener('change',function(){if(select.value){try{sessionStorage.setItem(recentKey,JSON.stringify([select.value].concat(ids().filter(function(id){return id!==select.value;})).slice(0,3)));}catch(error){/* Search still works. */}}renderRecent();});
  renderRecent();
  if(window.ClientLookup)Promise.all(ids().map(function(id){return ClientLookup.ensure(id).catch(function(){/* Search remains available. */});})).then(renderRecent);
}
