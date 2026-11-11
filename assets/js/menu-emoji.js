/* Tex 2.1.20: monochrome glyphs ONLY on the seven settings-root category buttons. */
window.TexMenuEmoji = (() => {
  const selector='.conv-menu button,.attach-menu button,#statusPop button,#zoomPop button,#actionSheet button,#sendChoice button,#settings button,#settings label,#settings option,#galleryFilter option,.msg-actions button,#attachmentGallery button,#messageEditor button,.modal .row-btns button,.tabs button,.login-stage button,#forgotDialog button';
  const strip=s=>s.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0E\uFE0F\u200D\u20E3]/gu,'').replace(/^[ \t]+/,'');
  const rules=[[/închide|anulează|renunță|cancel|close/i,'✖'],[/înapoi|răspunde|return/i,'↩'],[/caut|căut|search/i,'🔍'],[/șterg|elimin|distrug/i,'🗑'],[/fix|pin/i,'📌'],[/edit|redenume/i,'✏'],[/descarc|încarcă mai/i,'⬇'],[/salv|save/i,'💾'],[/galeri|poze|imagin|fotograf/i,'📷'],[/video|camer/i,'🎥'],[/audio|sunet|muzic/i,'🎵'],[/fișier|ataș|document/i,'📄'],[/secur|cript|parol|siguran|recuper/i,'🔒'],[/notific|alert/i,'🔔'],[/tem|aspect|palet|culo|fundal/i,'🎨'],[/profil|contact|grup|membr|cont|prieten/i,'👥'],[/mesaj|text|conversa/i,'💬'],[/ieș|deconect/i,'🚪'],[/disponibil|online|activ/i,'✔'],[/inviz|offline/i,'👁'],[/plecat|revin/i,'🕒'],[/ocupat/i,'⛔'],[/întunec|noapte|lun/i,'🌙'],[/lumino|soare/i,'☀'],[/adaug|mai mult|măre/i,'➕'],[/micș/i,'➖'],[/reac/i,'❤']];
  const glyph=label=>label==='+'?'➕':label==='−'||label==='-'?'➖':label==='×'?'✖':rules.find(([r])=>r.test(label))?.[1]||'⚙';
  function clean(b){if(b.closest('#emoPanel'))return;const root=b.matches('#settings .settings-nav > .settings-link[data-settings-go]');
    for(const icon of b.querySelectorAll('.menu-emoji'))if(!root)icon.remove();
    if(!root)b.classList.remove('has-menu-emoji');
    const walk=document.createTreeWalker(b,NodeFilter.SHOW_TEXT);let n;while(n=walk.nextNode()){if(n.parentElement.closest('svg,.menu-emoji'))continue;const text=strip(n.textContent);if(text!==n.textContent)n.textContent=text;}
    for(const a of ['aria-label','title'])if(b.hasAttribute(a)){const v=b.getAttribute(a),t=strip(v);if(v!==t)b.setAttribute(a,t);}
    if(root&&!b.querySelector(':scope > .menu-emoji')){const label=document.createElement('span');label.className='menu-label';while(b.firstChild)label.append(b.firstChild);const icon=document.createElement('span');icon.className='menu-emoji';icon.setAttribute('aria-hidden','true');icon.textContent=glyph(label.textContent);b.append(icon,label);b.classList.add('has-menu-emoji');}
  }
  function scan(root){if(root.nodeType!==1)return;if(root.matches(selector))clean(root);for(const b of root.querySelectorAll(selector))clean(b);}
  function init(){scan(document.body);const roots=new Set();let pending=false;new MutationObserver(ms=>{for(const m of ms){const p=m.target.nodeType===1?m.target:m.target.parentElement;if(p?.closest(selector))roots.add(p.closest(selector));for(const n of m.addedNodes)if(n.nodeType===1)roots.add(n);}if(!pending){pending=true;requestAnimationFrame(()=>{pending=false;for(const r of roots)if(r.isConnected)scan(r);roots.clear();});}}).observe(document.body,{childList:true,characterData:true,subtree:true});
    document.fonts?.load('400 18px "Tex Noto Emoji"','⚙🔒👥').then(f=>{if(f.length&&f.every(x=>x.status==='loaded'))document.documentElement.classList.add('menu-font-ready');}).catch(()=>{});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  return {scan,glyph,closeSelects:()=>{},back:()=>false};
})();
