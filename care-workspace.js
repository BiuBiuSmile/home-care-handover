/* 大安心交班 · 值班提醒、主管審核、手機快捷與私有雲端交班草稿 */
'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const fmt=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
  const reviewer=()=>['admin','supervisor'].includes(s.profile?.role);
  const s={db:null,user:null,profile:null,cases:[],records:[],reads:[],caseNames:new Map(),callbacks:{},seq:0,reviewBusy:false,alerts:[],pending:[],guides:[],rooms:[],quickOpen:false,formCase:null,formSeq:0,formTouched:false,formPending:false,formRevision:0,draftTimer:null,draftBusy:null,draftMessage:'',template:''};
  const active=()=>!!s.db&&!!s.user?.id&&!!s.profile?.active;
  function note(message,error=false){const node=$('careEnhNotice');if(!node)return;node.hidden=false;node.textContent=message;node.classList.toggle('error',error)}
  function draftNote(message,error=false){const el=$('recordDraftState');if(el){el.textContent=message;el.classList.toggle('error',error)}}
  function init(){
    $('careAlertsHub')?.addEventListener('click',onAction);
    $('careReviewHub')?.addEventListener('click',onAction);
    $('careMobileNav')?.addEventListener('click',e=>{
      const b=e.target.closest('[data-mobile-action]');if(!b)return;
      const a=b.dataset.mobileAction;
      if(a==='cases')s.callbacks.showBrowser?.();
      if(a==='alerts'){s.callbacks.showBrowser?.();$('careAlertsHub')?.scrollIntoView({behavior:'smooth',block:'start'});}
      if(a==='compose')showQuick();
      if(a==='achievements')s.callbacks.chooseTab?.('achievements');
    });
    $('careQuickDismiss')?.addEventListener('click',hideQuick);
    $('careQuickLayer')?.addEventListener('click',e=>{if(e.target===$('careQuickLayer'))hideQuick()});
    $('careQuickStart')?.addEventListener('click',()=>{
      const id=$('careQuickCase')?.value;if(!id||!s.cases.some(c=>c.id===id))return;
      hideQuick();s.callbacks.openCase?.(id,'history');s.callbacks.openNewHandover?.();
    });
    $('handoverForm')?.addEventListener('input',event=>{
      if(!s.formCase||!event.target.closest('#handoverForm'))return;
      if(event.target.type==='file'||event.target.id==='urgentAck')return;
      s.formTouched=true;s.formRevision++;draftNote('草稿尚未儲存');scheduleDraft();
    });
    $('handoverForm')?.addEventListener('change',event=>{
      if(s.formCase&&event.target.matches('select,input[type=date]')){s.formTouched=true;s.formRevision++;scheduleDraft()}
    });
    $('recordUseTemplate')?.addEventListener('click',applyTemplate);
    $('recordSaveDraft')?.addEventListener('click',()=>saveDraft(true));
    $('recordDeleteDraft')?.addEventListener('click',discardDraft);
  }
  function syncTab(tab){
    $('careMobileNav')?.querySelectorAll('[data-mobile-action]').forEach(b=>{
      const x=b.dataset.mobileAction; b.classList.toggle('active',x===tab||(x==='alerts'&&tab==='alerts'));
    });
  }
  async function mount(ctx){
    if(!ctx?.db||!ctx?.user?.id||!ctx?.profile?.active){destroy();return}
    const switched=s.user?.id&&s.user.id!==ctx.user.id;
    if(switched)destroy();
    Object.assign(s,{db:ctx.db,user:ctx.user,profile:ctx.profile,cases:ctx.cases||[],records:ctx.records||[],reads:ctx.reads||[],callbacks:ctx.callbacks||{}});
    s.caseNames=new Map(s.cases.map(c=>[c.id,c.name]));
    $('careMobileNav').hidden=!['staff','supervisor'].includes(ctx.profile.role);
    const selector=$('careQuickCase');if(selector){const value=selector.value;selector.innerHTML='<option value="">請選擇已指派個案</option>'+s.cases.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'（'+esc(c.id)+'）</option>').join('');if(s.cases.some(c=>c.id===value))selector.value=value;}
    await refresh();
  }
  async function refresh(){
    if(!active())return;
    const seq=++s.seq,db=s.db,me=s.user.id;
    const alerts=[];
    for(const c of s.cases){
      const latest=s.records.find(r=>r.case_id===c.id);
      if(!latest)continue;
      const seen=s.reads.find(r=>r.case_id===c.id);
      if(!seen||new Date(seen.read_at)<new Date(latest.created_at)) alerts.push({kind:'handover',id:c.id,label:c.name,subject:latest.summary,created_at:latest.created_at,risk:latest.risk});
    }
    const promises=[db.from('handover_rooms').select('id,case_id,case_name_snapshot,title,participant_b_id,created_at,expires_at,closed_at').eq('participant_b_id',me).order('created_at',{ascending:false}).limit(75)];
    if(reviewer()){
      promises.push(db.from('review_pending_handovers').select('id,case_id,summary,description,author_name,created_at').order('created_at',{ascending:false}).limit(100));
      promises.push(db.from('case_care_guide_items').select('id,case_id,title,detail,author_id,author_name,created_at').eq('status','pending').order('created_at',{ascending:false}).limit(100));
      promises.push(db.from('handover_rooms').select('id,case_id,case_name_snapshot,title,expires_at,closed_at,created_at').order('created_at',{ascending:false}).limit(100));
      promises.push(db.from('handovers').select('source_room_id').not('source_room_id','is',null).order('created_at',{ascending:false}).limit(500));
    }
    const results=await Promise.all(promises);
    if(seq!==s.seq||!active())return;
    const [invites,handovers,guides,rooms,published]=results;
    if(invites.error){note('受邀交班提醒暫時無法讀取，請使用原本的受邀清單。',true)}
    else for(const r of invites.data||[]){if(!r.closed_at&&new Date(r.expires_at).getTime()>Date.now())alerts.push({kind:'room',id:r.id,label:r.case_name_snapshot||'受邀交班',subject:r.title,created_at:r.created_at});}
    s.alerts=alerts.sort((a,b)=>Number(b.risk==='緊急')-Number(a.risk==='緊急')||String(b.created_at).localeCompare(String(a.created_at))).slice(0,24);
    renderAlerts();
    if(reviewer()){
      if(handovers.error||guides.error||rooms.error||published.error){note('部分待審資料讀取失敗，請在原有個案頁或點數獎勵頁處理。',true)}
      s.pending=handovers.error?[]:handovers.data||[];
      s.guides=guides.error?[]:(guides.data||[]).filter(x=>x.author_id!==me);
      const completed=new Set((published.error?[]:published.data||[]).map(x=>x.source_room_id));
      s.rooms=(rooms.error?[]:rooms.data||[]).filter(x=>(x.closed_at||new Date(x.expires_at).getTime()<=Date.now())&&!completed.has(x.id));
      renderReviews();
    }else{$('careReviewHub').hidden=true}
  }
  function renderAlerts(){
    const root=$('careAlertsHub');if(!root)return;root.hidden=false;
    const urgent=s.alerts.filter(x=>x.risk==='緊急').length;
    root.innerHTML='<div class="enh-head"><div><h2>🔔 我的交班提醒 <span class="enh-count">'+s.alerts.length+'</span></h2><p>顯示未閱讀的最新正式交班與正在進行的受邀聊天室；請依實際內容確認。</p></div><button type="button" class="btn alt enh-mini" data-enh-refresh>↻ 更新</button></div>'+
      (urgent?'<p class="enh-caution">有 '+urgent+' 筆標示「緊急」的未讀交班；緊急事件仍需立即聯絡督導，不以此提醒取代通報。</p>':'')+
      (s.alerts.length?'<div class="enh-tiles">'+s.alerts.slice(0,12).map(a=>'<button type="button" class="enh-alert '+(a.risk==='緊急'?'critical':'')+'" '+(a.kind==='room'?'data-enh-invite="'+esc(a.id)+'"':'data-enh-case="'+esc(a.id)+'"')+'><span class="enh-alert-name">'+esc(a.kind==='room'?'💬 受邀交班':'📋 待閱交班')+' · '+esc(a.label)+'</span><strong>'+esc(a.subject||'尚未填寫主旨')+'</strong><small>'+fmt(a.created_at)+(a.risk==='緊急'?' · 緊急':'')+'</small></button>').join('')+'</div>': '<p class="enh-empty">目前沒有未閱讀的最新正式交班或進行中的受邀聊天室。</p>');
  }
  function renderReviews(){
    const root=$('careReviewHub');if(!root)return;root.hidden=false;
    const counts=s.pending.length+s.guides.length+s.rooms.length;
    const section=(title,items,fn)=>'<div class="enh-review-section"><h3>'+title+' <span class="enh-count">'+items.length+'</span></h3>'+(items.length?items.slice(0,12).map(fn).join(''):'<p class="enh-empty">目前沒有待處理項目。</p>')+'</div>';
    root.innerHTML='<div class="enh-head"><div><h2>📋 居督集中審核 <span class="enh-count">'+counts+'</span></h2><p>集中檢視正式交班、照顧重點與到期聊天室；核點仍由原有資料庫規則處理。</p></div><button type="button" class="btn alt enh-mini" data-enh-refresh>↻ 更新</button></div><div id="careEnhNotice" class="enh-notice" hidden></div><div class="enh-review-columns">'+
     section('正式交班待審',s.pending,r=>'<article class="enh-review-item"><strong>'+esc(r.summary)+'</strong><small>'+esc(s.caseNames.get(r.case_id)||r.case_id)+' · '+esc(r.author_name)+' · '+fmt(r.created_at)+'</small><p>'+esc(r.description).slice(0,170)+'</p><div class="enh-actions"><button type="button" class="btn enh-mini" data-enh-handover="'+esc(r.id)+'" data-approve="yes">確認並核點</button><button type="button" class="btn alt enh-mini" data-enh-handover="'+esc(r.id)+'" data-approve="no">退回不核點</button></div></article>')+
     section('照顧重點待確認',s.guides,r=>'<article class="enh-review-item"><strong>'+esc(r.title)+'</strong><small>'+esc(s.caseNames.get(r.case_id)||r.case_id)+' · '+esc(r.author_name)+'</small><p>'+esc(r.detail).slice(0,170)+'</p><div class="enh-actions"><button type="button" class="btn enh-mini" data-enh-guide="'+esc(r.id)+'" data-case-id="'+esc(r.case_id)+'" data-status="approved">確認</button><button type="button" class="btn alt enh-mini" data-enh-guide="'+esc(r.id)+'" data-case-id="'+esc(r.case_id)+'" data-status="rejected">退回</button></div></article>')+
     section('到期聊天室待整理',s.rooms,r=>'<article class="enh-review-item"><strong>'+esc(r.title)+'</strong><small>'+esc(s.caseNames.get(r.case_id)||r.case_name_snapshot||r.case_id)+' · 到期 '+fmt(r.expires_at)+'</small><p>須由有權限的督導檢視實際雙方留言後，再決定是否整理成正式交班。</p><div class="enh-actions"><button type="button" class="btn alt enh-mini" data-enh-room-case="'+esc(r.case_id)+'">開啟交班室整理</button></div></article>')+'</div>';
  }
  async function onAction(e){
    const b=e.target.closest('button');if(!b||!active())return;
    if(b.hasAttribute('data-enh-refresh')){await refresh();return}
    if(b.dataset.enhCase){s.callbacks.openCase?.(b.dataset.enhCase,'history');return}
    if(b.dataset.enhInvite){s.callbacks.openInvitedRoom?.(b.dataset.enhInvite);return}
    if(b.dataset.enhRoomCase){s.callbacks.openCase?.(b.dataset.enhRoomCase,'rooms');return}
    if(s.reviewBusy)return;
    if(b.dataset.enhHandover){
      const id=b.dataset.enhHandover,approve=b.dataset.approve==='yes';
      if(!s.pending.some(r=>r.id===id)||!confirm(approve?'確定此筆正式交班審核通過並依規則核點？':'確定此筆正式交班不通過且不核點？'))return;
      s.reviewBusy=true;b.disabled=true;
      try{const r=await s.db.rpc('review_handover_reward',{p_handover_id:id,p_approve:approve});if(r.error)throw r.error;await refresh();note(approve?'正式交班已完成審核。':'已記錄此筆不計點。');}
      catch(err){note('審核失敗：'+String(err.message||err),true)}finally{s.reviewBusy=false;b.disabled=false}
    }
    if(b.dataset.enhGuide){
      const id=Number(b.dataset.enhGuide),caseId=b.dataset.caseId,status=b.dataset.status;
      if(!s.guides.some(r=>r.id===id&&r.case_id===caseId)||!['approved','rejected'].includes(status)||!confirm(status==='approved'?'確定審核通過此項照顧重點？':'確定退回此項照顧重點？'))return;
      s.reviewBusy=true;b.disabled=true;
      try{const r=await s.db.from('case_care_guide_items').update({status}).eq('id',id).eq('case_id',caseId).eq('status','pending').select('id');if(r.error)throw r.error;if(!r.data?.length)throw Error('已審核或無權限');await refresh();note(status==='approved'?'已確認照顧重點，符合規則者自動核點。':'已退回照顧重點。');}
      catch(err){note('審核失敗：'+String(err.message||err),true)}finally{s.reviewBusy=false;b.disabled=false}
    }
  }
  function showQuick(){
    if(!active()||!s.cases.length)return note('目前沒有可交班的已指派個案。',true);
    $('careQuickLayer').hidden=false;
    $('careQuickCase').focus();
  }
  function hideQuick(){$('careQuickLayer').hidden=true}
  const fields=['recordKind','recordRisk','recordSummary','recordDescription','recordExpires','structuredMental','structuredFood','structuredMove','structuredMood','structuredSafety','structuredNext'];
  function dataFromForm(){const data={};for(const id of fields)data[id]=$(id)?.value||'';return data}
  function applyData(data){if(!data||typeof data!=='object')return;for(const id of fields){if($(id)&&typeof data[id]==='string')$(id).value=data[id].slice(0,id==='recordDescription'?2000:1000)}}
  function hasContent(data){return !!(data.recordSummary?.trim()||data.recordDescription?.trim()||data.structuredMental||data.structuredFood||data.structuredMove||data.structuredMood||data.structuredSafety||data.structuredNext?.trim())}
  function scheduleDraft(){clearTimeout(s.draftTimer);if(!s.formPending)s.draftTimer=setTimeout(()=>saveDraft(false),2400)}
  async function openForm(c){
    clearTimeout(s.draftTimer);s.formCase=c.id;s.formSeq++;s.formTouched=false;s.formPending=false;s.formRevision=0;s.draftBusy=null;s.template='';
    const id=c.id,seq=s.formSeq;draftNote('正在檢查雲端草稿…');
    const r=await s.db.from('handover_drafts').select('form_data,updated_at').eq('case_id',id).eq('owner_id',s.user.id).maybeSingle();
    if(seq!==s.formSeq||s.formCase!==id)return;
    if(r.error){draftNote('草稿功能暫時無法使用，請勿關閉尚未送出的內容。',true);return}
    if(r.data&&!s.formTouched){applyData(r.data.form_data);draftNote('已恢復你的雲端草稿（照片需重新選取）· '+fmt(r.data.updated_at));}
    else draftNote('編輯後將自動儲存私人雲端草稿（照片不包含）');
  }
  async function saveDraft(manual){
    clearTimeout(s.draftTimer);
    if(!s.formCase||!active()||s.formPending)return true;
    const data=dataFromForm();if(!hasContent(data)){if(manual)draftNote('請先輸入交班主旨、內容或結構化資訊。',true);return true}
    if(s.draftBusy){await s.draftBusy;if(manual)return saveDraft(true);return true}
    const caseId=s.formCase,seq=s.formSeq,revision=s.formRevision;
    draftNote('正在儲存雲端草稿…');
    const task=s.db.from('handover_drafts').upsert({owner_id:s.user.id,case_id:caseId,form_data:data,updated_at:new Date().toISOString()},{onConflict:'owner_id,case_id'});
    s.draftBusy=task;
    try{const r=await task;if(r.error)throw r.error;if(seq===s.formSeq&&caseId===s.formCase)draftNote('草稿已安全儲存於雲端 · '+fmt(new Date().toISOString()));return true;}
    catch(err){if(seq===s.formSeq)draftNote('雲端草稿儲存失敗：'+String(err.message||err).slice(0,120),true);return false}
    finally{s.draftBusy=null;if(!s.formPending&&seq===s.formSeq&&s.formRevision!==revision)scheduleDraft()}
  }
  async function closeForm(){
    clearTimeout(s.draftTimer);
    if(!s.formCase)return true;
    const ok=await saveDraft(true);
    if(!ok)return false;
    s.formCase=null;s.formSeq++;return true;
  }
  async function beforeSubmit(){
    clearTimeout(s.draftTimer);s.formPending=true;
    if(s.draftBusy)try{await s.draftBusy}catch(_){}
  }
  function resumeDraft(){s.formPending=false;s.formRevision++;scheduleDraft()}
  async function afterSubmit(caseId){
    const db=s.db,owner=s.user?.id;
    clearTimeout(s.draftTimer);s.formCase=null;s.formSeq++;s.formPending=false;
    if(!db||!owner)return;
    const r=await db.from('handover_drafts').delete().eq('case_id',caseId).eq('owner_id',owner);
    if(r.error)draftNote('正式交班已儲存，但清除舊草稿未完成；下次可手動清除。',true);
  }
  async function discardDraft(){
    if(!s.formCase||!confirm('確定刪除此個案的私人雲端草稿並清空表單嗎？'))return;
    clearTimeout(s.draftTimer);s.formPending=true;if(s.draftBusy)await s.draftBusy;
    const r=await s.db.from('handover_drafts').delete().eq('owner_id',s.user.id).eq('case_id',s.formCase);
    s.formPending=false;
    if(r.error){draftNote('刪除草稿失敗：'+r.error.message,true);return}
    $('handoverForm').reset();$('recordPhotosPreview').replaceChildren();s.formRevision=0;s.formTouched=false;s.template='';draftNote('已刪除雲端草稿。');
  }
  function applyTemplate(){
    const labels={structuredMental:'精神',structuredFood:'飲食',structuredMove:'行動',structuredMood:'情緒',structuredSafety:'安全風險'};
    const lines=Object.entries(labels).filter(([id])=>$(id)?.value).map(([id,label])=>label+'：'+$(id).value);
    if($('structuredNext')?.value.trim())lines.push('接班注意：'+$('structuredNext').value.trim());
    if(!lines.length){draftNote('請先選擇至少一項照顧狀況或填寫接班注意事項。',true);return}
    const template='【結構化交班】\n'+lines.join('\n');
    let previous=$('recordDescription').value;
    if(s.template&&previous.includes(s.template))previous=previous.replace(s.template,'').trim();
    const combined=[previous,template].filter(Boolean).join('\n\n');
    if(combined.length>2000){draftNote('交班內容超過 2000 字，請先精簡文字。',true);return}
    $('recordDescription').value=combined;s.template=template;s.formTouched=true;s.formRevision++;scheduleDraft();draftNote('已將選取的實際狀況放入交班內容，可繼續編輯。');
  }
  function destroy(){
    ++s.seq;clearTimeout(s.draftTimer);++s.formSeq;s.formCase=null;s.formPending=false;s.draftBusy=null;s.db=null;s.user=null;s.profile=null;s.cases=[];s.records=[];s.alerts=[];s.pending=[];s.guides=[];s.rooms=[];
    for(const id of ['careAlertsHub','careReviewHub','careMobileNav'])if($(id))$(id).hidden=true;
    hideQuick();
  }
  window.CareWorkspace={init,mount,refresh,syncTab,openForm,closeForm,beforeSubmit,resumeDraft,afterSubmit,destroy};
})();