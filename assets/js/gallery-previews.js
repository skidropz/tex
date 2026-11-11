/* Tex 2.1.33 — local bounded content previews. No external viewer or executable document DOM. */
window.TexGalleryPreviews = (() => {
  const MiB=1024*1024, AUTO=2*MiB, MAX=16*MiB, BUDGET=24*MiB;
  let E, epoch=0, active=0, queue=[], io, pdfModule;
  const jobs=new Map(), resources=new Map();
  const raster=new Set(['image/png','image/jpeg','image/gif','image/webp','image/avif']);
  const video=new Set(['video/mp4','video/webm','video/ogg']);
  const audio=new Set(['audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/x-wav','audio/webm','audio/flac']);
  const text=new Set(['text/plain','text/csv','text/markdown','text/tab-separated-values','application/json']);
  function kind(m){const mime=String(m.attachment?.mime||'').split(';')[0].toLowerCase();return raster.has(mime)?'image':video.has(mime)?'video':audio.has(mime)?'audio':mime==='application/pdf'?'pdf':text.has(mime)?'text':'';}
  function safeUrl(path){const u=new URL(path,location.href);if(u.origin!==location.origin||!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('Adresa fișierului nu este sigură.');return u.href;}
  function clearResource(id, hint=true){const r=resources.get(id);if(!r)return;for(const m of r.box.querySelectorAll('video,audio')){m.pause();m.removeAttribute('src');m.load();}r.box.replaceChildren();if(hint)r.box.textContent='Previzualizarea a fost eliberată; apasă Previzualizează ca s-o încarci din nou.';if(r.url)URL.revokeObjectURL(r.url);r.destroy?.();resources.delete(id);}
  function reset(){epoch++;io?.disconnect();for(const j of jobs.values())j.abort();jobs.clear();queue=[];for(const id of [...resources.keys()])clearResource(id,false);}
  async function bounded(url,signal,cap,partial=false){return TexPreviewBytes.read(safeUrl(url),{signal,maxBytes:cap,partial});}
  function rasterMagic(bytes,mime){return mime==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:mime==='image/gif'?new TextDecoder().decode(bytes.slice(0,6)).startsWith('GIF8'):mime==='image/webp'?new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP':mime==='image/avif'?new TextDecoder().decode(bytes.slice(4,12)).includes('ftypavi'):false;}
  async function pdfCanvas(bytes,box,signal){
    pdfModule ||= import('../vendor/pdfjs/pdf.js?v=2.1.33'); const pdf=await pdfModule;
    if(signal.aborted)throw new DOMException('Anulat','AbortError');
    if(!window.Worker)throw Error('Previzualizarea PDF necesită un browser cu worker de module.');
    const workerUrl=new URL('assets/vendor/pdfjs/pdf.worker.js?v=2.1.33',location.href).href;
    const nativeWorker=new Worker(workerUrl,{type:'module'});let task,pdfWorker;
    const failure=new Promise((_,reject)=>nativeWorker.addEventListener('error',()=>reject(Error('Worker PDF indisponibil')),{once:true}));
    let rejectAbort; const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
    const race=p=>Promise.race([p,failure,aborted]);
    const stop=()=>{rejectAbort(new DOMException('Anulat','AbortError'));nativeWorker.terminate();};
    signal.addEventListener('abort',stop,{once:true});
    try{
      pdfWorker=new pdf.PDFWorker({port:nativeWorker});
      task=pdf.getDocument({data:bytes,worker:pdfWorker,isEvalSupported:false,enableXfa:false,useWasm:false,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,maxImageSize:4000000,standardFontDataUrl:new URL('assets/vendor/pdfjs/standard_fonts/',location.href).href});
      const doc=await race(task.promise),page=await race(doc.getPage(1)),v=page.getViewport({scale:1});
      if(!Number.isFinite(v.width)||v.width<=0||v.height<=0)throw Error('PDF invalid');
      const viewport=page.getViewport({scale:Math.min(1,768/Math.max(v.width,v.height))}),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height));canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Previzualizare PDF — prima pagină');
      await race(page.render({canvasContext:canvas.getContext('2d'),viewport}).promise);
      if(signal.aborted)throw new DOMException('Anulat','AbortError');box.append(canvas);const caption=document.createElement('small');caption.textContent='Prima pagină PDF · '+doc.numPages+' pagini';box.append(caption);
    }finally{signal.removeEventListener('abort',stop);let cleanupTimer;try{if(task)await Promise.race([task.destroy().catch(()=>{}),new Promise(resolve=>{cleanupTimer=setTimeout(resolve,500);})]);}finally{clearTimeout(cleanupTimer);pdfWorker?.destroy();nativeWorker.terminate();}}
  }
  async function load(row,m){const id=+m.id,box=row.querySelector('[data-preview]'),k=kind(m);if(!box||!k||jobs.has(id)||resources.has(id))return;if(queue.some(x=>x.id===id))return;queue.push({id,row,m,k,stamp:epoch});pump();}
  function pump(){while(active<2&&queue.length){const q=queue.shift();if(q.stamp!==epoch)continue;active++;run(q).finally(()=>{active--;pump();});}}
  async function run({id,row,m,k,stamp}){const ctrl=new AbortController();jobs.set(id,ctrl);const timer=setTimeout(()=>ctrl.abort(),30000),box=row.querySelector('[data-preview]'),button=row.querySelector('[data-gallery-preview]');button&&(button.disabled=true);box.textContent='Se încarcă previzualizarea…';let url;
    try{const encrypted=!!m.meta?.e2e,cap=k==='text'?(encrypted?512*1024:64*1024):k==='pdf'?8*MiB:MAX;if(k==='image' && (m.attachment.width||0)*(m.attachment.height||0)>12000000)throw Error('Imagine prea mare pentru previzualizare; folosește butonul Descarcă.');if(encrypted&&m.attachment.size>cap)throw Error('Fișier criptat prea mare pentru previzualizare; folosește butonul Descarcă.');let bytes,truncated=false;
      if(encrypted){safeUrl(m.attachment.url);const blob=await E.E2E.decryptFile(E.convOf(m.conversation_id),m.attachment.url,m.meta.e2e,m.attachment.mime,null,{signal:ctrl.signal,maxBytes:cap+65536,sameOrigin:true});if(blob.size>cap)throw Error('Fișier prea mare pentru previzualizare.');bytes=new Uint8Array(await blob.arrayBuffer());}
      else ({bytes,truncated}=await bounded(m.attachment.url,ctrl.signal,cap,k==='text'));
      if(stamp!==epoch||ctrl.signal.aborted)throw new DOMException('Anulat','AbortError');for(const rid of [...resources.keys()]){if(resources.size<6&&[...resources.values()].reduce((a,r)=>a+r.bytes,0)+bytes.length<=BUDGET)break;clearResource(rid);}
      box.replaceChildren();if(k==='text'){const pre=document.createElement('pre');pre.textContent=new TextDecoder('utf-8',{fatal:false}).decode(bytes.slice(0,65536));box.append(pre);const note=document.createElement('small');note.textContent='Fragment text (max. 64 KiB)'+(truncated||bytes.length>65536?' · trunchiat':'');box.append(note);}
      else if(k==='pdf'){if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Conținutul nu este un PDF valid.');await pdfCanvas(bytes,box,ctrl.signal);}
      else {const mime=m.attachment.mime.split(';')[0].toLowerCase();if(k==='image'&&!rasterMagic(bytes,mime))throw Error('Formatul imaginii nu este acceptat.');const blob=new Blob([bytes],{type:mime});url=URL.createObjectURL(blob);const media=document.createElement(k==='image'?'img':k);media.src=url;if(k==='image'){media.alt=m.attachment.name;media.loading='lazy';media.addEventListener('load',()=>{
          if(media.parentElement!==box)return;
          if(media.naturalWidth*media.naturalHeight>12000000){clearResource(id,false);box.textContent='Imagine prea mare pentru afișare sigură.';return;}
          const canvas=document.createElement('canvas'),scale=Math.min(1,480/media.naturalWidth,300/media.naturalHeight);canvas.width=Math.max(1,Math.round(media.naturalWidth*scale));canvas.height=Math.max(1,Math.round(media.naturalHeight*scale));const ctx=canvas.getContext('2d');if(!ctx){clearResource(id,false);box.textContent='Miniatura nu este disponibilă; folosește butonul Descarcă.';return;}ctx.drawImage(media,0,0,canvas.width,canvas.height);canvas.setAttribute('role','img');canvas.setAttribute('aria-label',m.attachment.name);media.replaceWith(canvas);media.removeAttribute('src');const r=resources.get(id);if(r){if(r.url)URL.revokeObjectURL(r.url);r.url=null;r.bytes=canvas.width*canvas.height*4;}
        },{once:true});}else{media.controls=true;media.preload='metadata';media.playsInline=true;}media.addEventListener('error',()=>{if(media.parentElement===box){clearResource(id,false);box.textContent='Decodor indisponibil; fișierul poate fi descărcat.';}},{once:true});box.append(media);}
      if(stamp!==epoch||ctrl.signal.aborted)throw new DOMException('Anulat','AbortError');resources.set(id,{box,url,bytes:bytes.length});url=null;
    }catch(err){if(url)URL.revokeObjectURL(url);if(stamp===epoch)box.textContent=err.name==='AbortError'?'Previzualizare anulată.':k==='pdf'?'PDF-ul nu poate fi previzualizat în acest browser sau pentru acest document. Folosește butonul Descarcă.':err.message;}finally{clearTimeout(timer);if(jobs.get(id)===ctrl)jobs.delete(id);button&&(button.disabled=false);}}
  function watch(row,m){const box=row.querySelector('[data-preview]');if(!box)return;const k=kind(m);if(!k){box.textContent='Previzualizarea acestui format nu este disponibilă · '+(m.attachment.mime||'format necunoscut')+' · '+m.attachment.size+' de octeți';return;}const button=document.createElement('button');button.type='button';button.className='btn ghost small';button.dataset.galleryPreview='';button.textContent='Previzualizează';button.addEventListener('click',()=>load(row,m));row.querySelector('.row-btns').prepend(button);box.textContent='Previzualizare de conținut la cerere';if(m.attachment.size<=AUTO){if(window.IntersectionObserver){io ||= new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){io.unobserve(e.target);const data=e.target._preview;load(data.row,data.m);}},{root:document.querySelector('#attachmentGallery .modal-body'),rootMargin:'80px'});row._preview={row,m};io.observe(row);}}}
  return {init:env=>{E=env;},watch,load,reset,kind,safeUrl,_bounded:bounded,_rasterMagic:rasterMagic};
})();
