/* Case Care Collaboration v1
 * Care guide proposals; historical discussion rows remain archived in the database.
 * All read/write authorization is enforced by Supabase PostgreSQL RLS.
 * The website only uses the public publishable key.
 */
'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>value?new Date(value).toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
  const state={db:null,caseId:null,profile:null,guide:[],focus:[],note:'',loadId:0,panel:'guide',loaded:false};
  function setNotice(text,isError=false){
    const e=$('guideNotice');
    if(!e)return;
    e.hidden=!text;e.textContent=text||'';e.className=isError?'care-notice error':'care-notice';
  }
  function errorText(err){
    const detail=err?.message||String(err||'操作未完成');
    return detail.length>180?detail.slice(0,180):detail;
  }
  function reviewedByAllowed(){return ['admin','supervisor'].includes(state.profile?.role)}
  function destroy(){
    state.loadId++;state.caseId=null;state.guide=[];state.focus=[];state.note='';state.loaded=false;
  }
  function guideHtml(){
    const fixed=state.focus.map(item=>{
      const title=Array.isArray(item)?item[0]:item?.title;
      const detail=Array.isArray(item)?item[1]:item?.body;
      return '<article class="care-entry care-entry--fixed"><div class="care-entry-header">'+
        '<span class="care-status-tag fixed">固定</span></div>'+
        '<h4>'+esc(title||'照顧重點')+'</h4><p>'+esc(detail||'')+'</p>'+
        '<div class="care-entry-footer">原有固定重點 · 管理員維護</div></article>';
    });
    if(state.note){
      fixed.push('<article class="care-entry care-entry--note">'+
        '<div class="care-entry-header"><span class="care-status-tag alert">重要提醒</span></div>'+
        '<h4>個案注意事項</h4><p>'+esc(state.note)+'</p>'+
        '<div class="care-entry-footer">原有個案提醒</div></article>');
    }
    const row=(item)=>{
      const status=item.status==='approved'?'已確認':item.status==='pending'?'待確認':'已退回';
      const cls=item.status==='approved'?'approved':item.status==='pending'?'pending':'rejected';
      const controls=item.status==='pending'&&reviewedByAllowed()
        ? '<div class="care-review-actions"><button class="btn care-mini" data-guide-review="'+esc(item.id)+'" data-guide-status="approved" type="button">✓ 確認</button>'+
            '<button class="btn alt care-mini" data-guide-review="'+esc(item.id)+'" data-guide-status="rejected" type="button">退回</button></div>'
        : '';
      const simple=item.category==='其他'&&item.title==='照顧重點';
      return '<article class="care-entry care-entry--'+cls+'">'+
        '<div class="care-entry-header"><div class="care-tags"><span class="care-status-tag '+cls+'">'+status+'</span>'+
        (simple?'':'<span class="care-category">'+esc(item.category)+'</span>')+'</div>'+
        '<time class="care-entry-date">'+fmt(item.created_at)+'</time></div>'+
        (simple?'':'<h4>'+esc(item.title)+'</h4>')+'<p>'+esc(item.detail)+'</p>'+
        '<div class="care-entry-footer"><span>提交：'+esc(item.author_name)+'</span>'+controls+'</div>'+
        '</article>';
    };
    const approved=state.guide.filter(x=>x.status==='approved');
    const pending=state.guide.filter(x=>x.status==='pending');
    const rejected=state.guide.filter(x=>x.status==='rejected');
    const count=fixed.length+approved.length+pending.length+rejected.length;
    if(!count)return '<div class="care-empty">目前尚無照顧重點，可由主責或已指派居服員點選「新增重點」提出內容。</div>';
    return '<div class="care-unified-meta"><span>共 '+count+' 項照顧重點</span>'+
      (pending.length?'<span class="care-pending-summary">待確認 '+pending.length+' 項</span>':'')+'</div>'+
      '<div class="care-entry-grid care-unified-list">'+
      [...fixed,...approved.map(row),...pending.map(row),...rejected.map(row)].join('')+
      '</div>';
  }
  function showGuideEditor(show,focus=false){
    const panel=$('careGuideEditor'),button=$('guideAddBtn');
    if(!panel||!button)return;
    panel.hidden=!show;
    button.setAttribute('aria-expanded',String(show));
    button.classList.toggle('active',show);
    if(show&&focus){panel.scrollIntoView({behavior:'smooth',block:'nearest'});$('guideDetail')?.focus();}
  }
  function renderGuide(){
    const root=$('careGuideResults');if(!root)return;
    root.innerHTML=guideHtml();
  }
  function changeTab(next){
    if(!['guide','rooms','history'].includes(next))return;
    state.panel=next;
    document.querySelectorAll('[data-care-tab]').forEach(b=>{
      const active=b.dataset.careTab===next;
      b.classList.toggle('active',active);
      b.setAttribute('aria-selected',String(active));
    });
    document.querySelectorAll('[data-care-panel]').forEach(p=>p.hidden=p.dataset.carePanel!==next);
    if(next==='rooms' && state.loaded)window.HandoverRooms?.refresh();
  }
  async function loadGuide(){
    const id=state.caseId,seq=state.loadId;
    if(!state.db||!id)return;
    const {data,error}=await state.db.from('case_care_guide_items')
      .select('id,case_id,category,title,detail,status,author_name,created_at,reviewed_at')
      .eq('case_id',id).order('created_at',{ascending:false}).limit(300);
    if(id!==state.caseId || seq!==state.loadId)return;
    if(error){setNotice('載入照顧重點失敗：'+errorText(error),true);return}
    state.guide=data||[];
    setNotice('');
    renderGuide();
  }
  async function submitGuide(e){
    e.preventDefault();
    const caseId=state.caseId;
    // 沿用原資料庫必填欄位，但使用者只需填寫照顧重點內容。
    const category='其他';
    const title='照顧重點';
    const detail=$('guideDetail').value.trim();
    if(detail.length<5||detail.length>2000){
      return setNotice('請填寫 5～2000 字的照顧重點與注意事項。',true);
    }
    const btn=$('guideSaveBtn');btn.disabled=true;
    try{
      const {error}=await state.db.from('case_care_guide_items').insert({case_id:caseId,category,title,detail});
      if(error)throw error;
      if(caseId!==state.caseId)return;
      $('careGuideForm').reset();
      await loadGuide();
      showGuideEditor(false);
      setNotice('已送出照顧重點，待居督或管理員確認。');
    }catch(err){setNotice('送出失敗：'+errorText(err),true)}
    finally{btn.disabled=false}
  }
  async function reviewGuide(id,status,button){
    if(!reviewedByAllowed()||!['approved','rejected'].includes(status))return;
    button.disabled=true;
    try{
      const {data,error}=await state.db.from('case_care_guide_items')
        .update({status}).eq('id',id).eq('case_id',state.caseId).eq('status','pending').select('id');
      if(error)throw error;
      if(!data?.length)throw Error('此項目已處理或您未獲授權，請重新整理。');
      await loadGuide();
      setNotice(status==='approved'?'已審核通過，已符合獎勵規則的提交者獲得 5 點，其他獲授權同仁可看到正式照顧重點。':'已將此提案退回，不計點；原始提案保留。');
    }catch(err){setNotice('審核失敗：'+errorText(err),true)}
    finally{button.disabled=false}
  }
  function bind(){
    $('guideAddBtn').addEventListener('click',()=>showGuideEditor($('careGuideEditor').hidden,true));
    $('guideCancelBtn').addEventListener('click',()=>showGuideEditor(false));
    $('refreshGuideBtn').addEventListener('click',loadGuide);
    $('careGuideForm').addEventListener('submit',submitGuide);
    $('careGuideResults').addEventListener('click',e=>{
      const b=e.target.closest('[data-guide-review]');if(!b)return;
      reviewGuide(Number(b.dataset.guideReview),b.dataset.guideStatus,b);
    });
    document.querySelectorAll('[data-care-tab]').forEach(b=>b.addEventListener('click',()=>changeTab(b.dataset.careTab)));
  }
  async function mount({db,caseId,profile,focus=[],note=''}){
    if(!db||!caseId||!$('careGuideResults'))return;
    const preferredPanel=state.caseId===caseId&&['guide','rooms','history'].includes(state.panel)?state.panel:'guide';
    destroy();
    const mountToken=state.loadId;
    state.db=db;state.caseId=caseId;state.profile=profile;state.panel=preferredPanel;
    state.focus=Array.isArray(focus)?focus:[];state.note=String(note||'');
    $('careGuideResults').innerHTML='<p class="care-empty">正在載入照顧重點…</p>';
    showGuideEditor(false);bind();changeTab(preferredPanel);
    await loadGuide();
    if(state.caseId!==caseId||state.loadId!==mountToken)return;
    state.loaded=true;
  }
  window.CareCollab={mount,destroy,selectTab:next=>{changeTab(next);if(next==='guide')showGuideEditor(true)}};
})();
