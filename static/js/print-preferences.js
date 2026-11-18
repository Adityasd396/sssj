(function(){
 'use strict';
 var select=document.querySelector('[data-receipt-preference]');if(!select)return;
 var key='shop-receipt-width', params=new URLSearchParams(location.search), explicit=params.get('width'), saved;
 try{saved=localStorage.getItem(key);}catch(error){/* Per-page selection still works. */}
 var value=['58','80'].includes(explicit)?explicit:['58','80'].includes(saved)?saved:select.value;
 if(select.dataset.mode==='receipt'&&!explicit&&value!==select.value){var url=new URL(location.href);url.searchParams.set('width',value);location.replace(url.href);return;}
 select.value=value;document.documentElement.style.setProperty('--receipt-paper',value+'mm');
 function save(){document.documentElement.style.setProperty('--receipt-paper',select.value+'mm');try{localStorage.setItem(key,select.value);var status=document.getElementById('printer-preference-status');if(status)status.textContent='Paper width saved on this device.';}catch(error){var hint=document.getElementById('printer-preference-status');if(hint)hint.textContent='Paper width applies here; device storage is unavailable.';}}
 select.addEventListener('change',save);if(explicit)save();
})();
