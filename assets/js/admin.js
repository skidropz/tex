(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const owner = +document.body.dataset.adminUser;
  let csrf = document.querySelector('meta[name="csrf-token"]').content, after = 0, query = '', busy = false;
  const users = new Map();
  // Internal codes stay short for existing database columns and audit events.
  const staffLabels = new Map([['ADMIN','ADMIN'],['MOD','MOD'],['TESTER','PRODUCT TESTER']]);
  const badge = () => '<span class="tex-verified" role="img" title="Tex Verified" aria-label="Tex Verified"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="11"/><path d="m7 12 3 3 7-7"/></svg></span>';
  function error(message) { $('adminError').textContent=message || ''; $('adminError').hidden=!message; }
  function setBusy(value) { busy=value; document.querySelectorAll('button,select').forEach(b => { b.disabled=value; }); $('adminUsers').setAttribute('aria-busy',String(value)); }
  async function request(action, body, args={}) {
    const params=new URLSearchParams({ action,...args });
    for (let attempt=0; attempt<2; attempt++) {
      const response=await fetch('api/admin.php?'+params, { method:body===undefined?'GET':'POST', credentials:'same-origin', cache:'no-store', headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf}, ...(body===undefined?{}:{body:JSON.stringify(body)}) });
      const data=await response.json().catch(()=>({error:'Răspuns indisponibil.'}));
      if (response.status===419 && body!==undefined && attempt===0) {
        // Restore only CSRF after a server-restored session; never replay a change into another account.
        const fresh=await fetch('api/admin.php?action=session',{credentials:'same-origin',cache:'no-store'});
        const session=await fresh.json().catch(()=>({}));
        if (!fresh.ok || !session.ok || +session.user_id!==owner || !session.csrf) throw new Error('Sesiunea sau contul s-a schimbat. Reîncarcă pagina și autentifică-te în contul autorizat.');
        csrf=session.csrf; continue;
      }
      if (!response.ok || !data.ok) throw new Error(response.status===401?'Autentificarea este necesară. Folosește pagina de conectare, apoi reîncarcă administrarea.':data.error || 'Operația nu a reușit.');
      return data;
    }
    throw new Error('Token expirat. Reîncarcă pagina.');
  }
  function date(epoch) { return epoch>0?new Intl.DateTimeFormat('ro-RO',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Bucharest'}).format(new Date(epoch*1000))+' (Europe/Bucharest)':'Dată indisponibilă'; }
  function row(u) {
    const li=document.createElement('li'); li.className='admin-user'; li.dataset.user=u.id;
    const info=document.createElement('div'); info.className='admin-user-info';
    const name=document.createElement('div'); name.className='admin-user-name'; name.textContent=u.display_name;
    if (u.verified) name.insertAdjacentHTML('beforeend',badge());
    const staffText=staffLabels.get(u.staff_label);
    if (staffText) {
      const tag=document.createElement('span');tag.className='tex-staff tex-staff-'+u.staff_label.toLowerCase();tag.textContent=staffText;
      tag.title='Etichetă vizuală atribuită de administratorii Tex; nu acordă permisiuni';tag.setAttribute('aria-label',staffText+' — etichetă vizuală Tex');name.append(tag);
    }
    const details=document.createElement('p'); details.textContent='@'+u.username+' · ID '+u.id+' · Creat: '+date(u.created_at);
    info.append(name,details);
    const button=document.createElement('button'); button.type='button'; button.dataset.verify=u.id;
    button.textContent=u.verified?'Retrage bifa':'Acordă bifa'; button.setAttribute('aria-label',button.textContent+' pentru @'+u.username);
    const actions=document.createElement('div');actions.className='admin-user-actions';
    const label=document.createElement('label');label.className='admin-label-control';label.htmlFor='staffLabel-'+u.id;
    const caption=document.createElement('span');caption.textContent='Etichetă vizuală';
    const select=document.createElement('select');select.id=label.htmlFor;select.setAttribute('aria-label','Etichetă vizuală pentru @'+u.username);
    for (const [value,text] of [['','Fără etichetă'],...staffLabels]) {
      const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);
    }
    select.value=staffLabels.has(u.staff_label)?u.staff_label:'';
    label.append(caption,select);
    const save=document.createElement('button');save.type='button';save.dataset.label=u.id;save.textContent='Salvează eticheta';save.setAttribute('aria-label','Salvează eticheta vizuală pentru @'+u.username);
    actions.append(button,label,save);li.append(info,actions); return li;
  }
  async function load(reset) {
    if (busy) return; setBusy(true); error('');
    if (reset) { query=$('adminQuery').value.trim(); after=0; }
    try {
      const data=await request('list',undefined,{q:query,after:String(after)});
      const fragment=document.createDocumentFragment(); users.clear();
      for (const u of data.users) { users.set(+u.id,u); fragment.append(row(u)); }
      $('adminUsers').replaceChildren(fragment); after=data.next_after;
      $('adminNext').hidden=!data.has_more;
      $('adminStatus').textContent=data.users.length?data.users.length+' conturi pe această pagină.':'Niciun cont găsit.';
    } catch(e) { error(e.message); }
    finally { setBusy(false); }
  }
  async function audit() {
    const data=await request('audit'), fragment=document.createDocumentFragment();
    const labels={label_none_to_admin:'a atribuit eticheta vizuală ADMIN',label_none_to_mod:'a atribuit eticheta vizuală MOD',label_admin_to_mod:'a schimbat eticheta vizuală ADMIN în MOD',label_mod_to_admin:'a schimbat eticheta vizuală MOD în ADMIN',label_admin_to_none:'a eliminat eticheta vizuală ADMIN',label_mod_to_none:'a eliminat eticheta vizuală MOD',label_none_to_tester:'a atribuit eticheta vizuală PRODUCT TESTER',label_admin_to_tester:'a schimbat eticheta vizuală ADMIN în PRODUCT TESTER',label_mod_to_tester:'a schimbat eticheta vizuală MOD în PRODUCT TESTER',label_tester_to_none:'a eliminat eticheta vizuală PRODUCT TESTER',label_tester_to_admin:'a schimbat eticheta vizuală PRODUCT TESTER în ADMIN',label_tester_to_mod:'a schimbat eticheta vizuală PRODUCT TESTER în MOD',verified_granted:'a acordat bifa',verified_revoked:'a retras bifa',admin_provisioned:'a acordat rolul de administrator (operație locală)',admin_revoked:'a retras rolul de administrator (operație locală)'};
    for (const event of data.events) { const li=document.createElement('li'); li.textContent=date(event.created_at)+' · '+(event.actor?'@'+event.actor:'Operator local / ID '+event.actor_id)+' '+(labels[event.action] || 'a modificat marcajul')+' pentru '+(event.target?'@'+event.target:'ID '+event.target_id); fragment.append(li); }
    if (!data.events.length) { const li=document.createElement('li'); li.textContent='Nicio modificare înregistrată.'; fragment.append(li); }
    $('adminAudit').replaceChildren(fragment);
  }
  $('adminSearch').addEventListener('submit',e=>{e.preventDefault();load(true);});
  $('adminNext').addEventListener('click',()=>load(false));
  $('adminAuditRefresh').addEventListener('click',async()=>{if(busy)return;setBusy(true);error('');try{await audit();}catch(e){error(e.message);}finally{setBusy(false);}});
  $('adminUsers').addEventListener('click',async e=>{
    const button=e.target.closest('button[data-verify],button[data-label]'); if(!button || busy)return;
    const isLabel=button.hasAttribute('data-label'), id=+(isLabel?button.dataset.label:button.dataset.verify);
    const u=users.get(id); if(!u)return;
    const label=isLabel ? $('staffLabel-'+u.id).value : '';
    setBusy(true); error('');
    try {
      const data=await request(isLabel?'staff_label':'verify',{actor_id:owner,user_id:+u.id,...(isLabel?{staff_label:label}:{verified:!u.verified})});
      if(isLabel)u.staff_label=data.staff_label;else u.verified=data.verified;
      const old=$('adminUsers').querySelector('[data-user="'+u.id+'"]'); if(old)old.replaceWith(row(u));
      setBusy(true); // Include replacement controls while audit refresh is still pending.
      $('adminStatus').textContent=(isLabel?(u.staff_label?'Etichetă vizuală '+(staffLabels.get(u.staff_label) || '')+' salvată':'Etichetă vizuală eliminată'):(u.verified?'Bifă acordată':'Bifă retrasă'))+' pentru @'+u.username+'.';
      await audit();
      const replacement=$('adminUsers').querySelector('button[data-'+(isLabel?'label':'verify')+'="'+u.id+'"]');
      setBusy(false); if(replacement)replacement.focus({preventScroll:true});
    } catch(e) { error(e.message); }
    finally { setBusy(false); }
  });
  load(true); audit().catch(e=>error(e.message));
})();
