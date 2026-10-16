import { headers } from 'next/headers';

/**
 * Browser extensions (Bitdefender `bis_skin_checked` / `bis_register`, Grammarly, ColorZilla, LanguageTool…) stamp their own attributes on
 * the page BEFORE React hydrates. React then reports "A tree hydrated but some attributes … didn't match" — for markup we never wrote.
 * In production React ignores such attribute differences silently; in development the error overlay hides real problems behind this noise.
 *
 * This tiny script runs first in <body> and removes only those known extension attributes until hydration is over, so the server HTML and
 * the client tree agree again. Our own hydration bugs are untouched and still reported. Development only: it is not rendered in production.
 */
const SCRIPT = `(function(){
  var re=/^(bis_|__processed_|data-new-gr-c-s-|data-gr-ext-|data-lt-|cz-shortcut-listen$)/;
  var tries=new WeakMap();
  function strip(el,name){var c=tries.get(el)||0;if(c>=3)return;tries.set(el,c+1);el.removeAttribute(name);}
  function clean(el){var a=el.attributes;if(!a)return;for(var i=a.length-1;i>=0;i--){if(re.test(a[i].name))strip(el,a[i].name);}}
  function sweep(root){clean(root);if(root.querySelectorAll){var all=root.querySelectorAll('*');for(var i=0;i<all.length;i++)clean(all[i]);}}
  var mo=new MutationObserver(function(list){
    for(var i=0;i<list.length;i++){var m=list[i];
      if(m.type==='attributes'){if(m.attributeName&&re.test(m.attributeName)&&m.target.hasAttribute(m.attributeName))strip(m.target,m.attributeName);}
      else{for(var j=0;j<m.addedNodes.length;j++){if(m.addedNodes[j].nodeType===1)sweep(m.addedNodes[j]);}}
    }
  });
  mo.observe(document.documentElement,{attributes:true,childList:true,subtree:true});
  sweep(document.documentElement);
  function stop(){setTimeout(function(){mo.disconnect();},4000);}
  if(document.readyState==='complete')stop();else window.addEventListener('load',stop,{once:true});
})();`;

export async function ExtensionAttributeGuard() {
  if (process.env.NODE_ENV === 'production') return null;
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
