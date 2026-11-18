/* Keyboard, safe-area, Back and list-position behavior shared by mobile browsers. */
(function () {
  'use strict';
  var root=document.documentElement, baseline=innerHeight, width=innerWidth, queued=false;
  function editing(){var node=document.activeElement;return node&&node.matches('textarea,select,input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=button]):not([type=submit])');}
  function updateViewport(){
    queued=false;
    var view=window.visualViewport, height=view?view.height:innerHeight, top=view?view.offsetTop:0;
    if(Math.abs(innerWidth-width)>80){width=innerWidth;baseline=innerHeight;}
    if(!editing())baseline=Math.max(baseline,innerHeight);
    var touch=matchMedia('(pointer:coarse)').matches||(navigator.maxTouchPoints>0&&innerWidth<1100);
    var keyboard=Boolean(touch&&editing()&&Math.max(baseline,innerHeight)-height>130&&(!view||view.scale<1.15));
    document.body.classList.toggle('keyboard-open',keyboard);
    root.style.setProperty('--usable-height',height+'px');root.style.setProperty('--viewport-top',top+'px');
    if(keyboard){
      var active=document.activeElement, box=active.getBoundingClientRect();
      if(box.bottom>top+height-30||box.top<top+80)active.scrollIntoView({block:'center',behavior:'auto'});
    }
  }
  function schedule(){if(!queued){queued=true;requestAnimationFrame(updateViewport);}}
  window.MobileUI={updateViewport:updateViewport};
  window.addEventListener('resize',schedule,{passive:true});
  if(window.visualViewport){visualViewport.addEventListener('resize',schedule,{passive:true});visualViewport.addEventListener('scroll',schedule,{passive:true});}
  document.addEventListener('focusin',schedule);document.addEventListener('focusout',function(){setTimeout(schedule,100);});
  document.addEventListener('invalid',function(event){var parent=event.target.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}},true);
  function ready(){
    updateViewport();
    var done=document.getElementById('keyboard-done');if(done)done.addEventListener('click',function(){if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();schedule();});
    document.querySelectorAll('input[type=tel]').forEach(function(input){input.inputMode='tel';input.enterKeyHint='next';});
    document.querySelectorAll('input[type=number]').forEach(function(input){input.inputMode=input.step==='1'?'numeric':'decimal';input.enterKeyHint='next';});
    document.querySelectorAll('input[type=search],input[name=q],#client-search').forEach(function(input){input.enterKeyHint='search';});
    var menu=document.getElementById('main-nav');
    if(menu){new MutationObserver(function(){
      if(menu.classList.contains('open')&&!(history.state&&history.state._shopMenu)){
        try{history.pushState(Object.assign({},history.state||{},{_shopMenu:true}),'',location.href);}catch(error){/* Native links remain available. */}
      }else if(!menu.classList.contains('open')&&history.state&&history.state._shopMenu){history.back();}
    }).observe(menu,{attributes:true,attributeFilter:['class']});}
    var dialogState='_shopDialog';
    document.querySelectorAll('dialog[id]').forEach(function(dialog){
      function watch(){if(dialog.open&&!(history.state&&history.state[dialogState]===dialog.id)){try{var state=Object.assign({},history.state||{});state[dialogState]=dialog.id;history.pushState(state,'',location.href);}catch(error){/* Native dialog cancellation remains available. */}}}
      new MutationObserver(watch).observe(dialog,{attributes:true,attributeFilter:['open']});
      dialog.addEventListener('close',function(){if(history.state&&history.state[dialogState]===dialog.id)history.back();});
      watch();
    });
    window.addEventListener('popstate',function(){if(menu&&menu.classList.contains('open')&&!(history.state&&history.state._shopMenu)){var close=menu.querySelector('[data-close-menu]');if(close)close.click();}document.querySelectorAll('dialog[open]').forEach(function(dialog){if(!history.state||history.state[dialogState]!==dialog.id)dialog.close();});});
    var user=document.body.dataset.user||'guest', positionsKey='shop-list-positions-'+user;
    var listNames=['/products','/clients','/invoices'];
    function values(){try{return JSON.parse(sessionStorage.getItem(positionsKey)||'{}');}catch(error){return {};}}
    function remember(){
      if(!listNames.includes(location.pathname))return;
      try{var data=values();data[location.pathname]={url:location.href,y:scrollY,at:Date.now()};sessionStorage.setItem(positionsKey,JSON.stringify(data));}catch(error){/* Native Back still restores position. */}
    }
    document.addEventListener('click',function(event){var anchor=event.target.closest('a');if(anchor)remember();});
    window.addEventListener('pagehide',remember);
    document.querySelectorAll('[data-record-back]').forEach(function(anchor){
      var saved=values()[anchor.dataset.recordBack];
      if(!saved||Date.now()-saved.at>3600000)return;
      try{var url=new URL(saved.url);if(url.origin===location.origin&&listNames.includes(url.pathname))anchor.href=url.href;}catch(error){/* Use the original safe link. */}
    });
    function restorePosition(event){
      schedule();if(event.persisted)return;
      var entry=performance.getEntriesByType('navigation')[0], saved=values()[location.pathname];
      var returning=false;try{returning=sessionStorage.getItem('shop-return-list')===location.href;}catch(error){/* Optional storage. */}
      if(saved&&saved.url===location.href&&Date.now()-saved.at<3600000&&(entry&&entry.type==='back_forward'||returning)){
        try{sessionStorage.removeItem('shop-return-list');}catch(error){/* Optional storage. */}requestAnimationFrame(function(){scrollTo(0,saved.y);});
      }
    }
    document.querySelectorAll('[data-record-back]').forEach(function(anchor){anchor.addEventListener('click',function(){try{sessionStorage.setItem('shop-return-list',anchor.href);}catch(error){/* Optional convenience. */}});});
    window.addEventListener('pageshow',restorePosition);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
