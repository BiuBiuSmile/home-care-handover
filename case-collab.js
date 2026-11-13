/* Case Care Collaboration v1
 * Care guide proposals + immutable case discussion.
 * All read/write authorization is enforced by Supabase PostgreSQL RLS.
 * The website only uses the public publishable key.
 */
'use strict';
(function(){
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=value=>value?new Date(value).toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
  const categories=['生活習慣','備餐與飲食','移位與安全','沐浴清潔','溝通與家屬','其他'];
  const state={db:null,caseId:null,profile:null,guide:[],messages:[],replyTo:null,loadId:0,timer:null,panel:'guide',loaded:false};
  function setNotice(text,isError=false,section='guide'){
    const e=$(section==='guide'?'guideNotice':'discussionNotice');
    if(!e)return;
    e.hidden=!text;e.textContent=text||'';e.className=isError?'care-notice error':'care-notice';
  }
  function errorText(err){
    const detail=err?.message||String(err||'操作未完成');
    return detail.length>180?detail.slice(0,180):detail;
  }
  function reviewedByAllowed(){return ['admin','supervisor'].includes(state.profile?.role)}
  function clearTimer(){if(state.timer!==null){clearInterval(state.timer);state.timer=null}}
  function destroy(){
    clearTimer();state.loadId++;state.caseId=null;state.guide=[];state.messages=[];state.replyTo=null;state.loaded=false;
  }
  function guideHtml(){
    const pending=state.guide.filter(x=>x.status==='pending');
    const approved=state.guide.filter(x=>x.status==='approved');
    const rejected=state.guide.filter(x=>x.status==='rejected');
    const row=(x,showControls)=>'<article class="care-entry">'+
      '<div class="care-entry-header"><span class="care-category">'+esc(x.category)+'</span>'+
      '<span class="care-entry-date">'+fmt(x.created_at)+'</span></div>'+
      '<h4>'+esc(x.title)+'</h4><p>'+esc(x.detail)+'</p>'+
      '<div class="care-entry-footer"><span>提交：'+esc(x.author_name)+' </span>'+
      (showControls&&reviewedByAllowed()?'<div class="care-review-actions"><button class="btn care-mini" data-guide-review="'+esc(x.id)+'" data-guide-status="approved" type="button">✓ 審核通過</button><button class="btn alt care-mini" data-guide-review="'+esc(x.id)+'" data-guide-status="rejected" type="button">退回</button></div>':'')+
      '</div></article>';
    const approvedHtml=approved.length?approved.map(x=>row(x,false)).join(''):'<div class="care-empty">目前尚未有經確認的照顧重點。主責或已指派的居服員可先提交內容。</div>';
    return '<div class="care-section-head"><div><h3>已確認的照顧重點 <span class="care-count">'+approved.length+'</span></h3><p>僅此區塊的內容視為本系統已確認的照顧參考；仍以核定服務計畫為準。</p></div><button type="button" class="btn alt care-mini" id="refreshGuideBtn">↻ 更新</button></div>'+
      '<div class="care-entry-grid">'+approvedHtml+'</div>'+
      '<div class="care-section-head care-subhead"><div><h3>待確認項目 <span class="care-count pending">'+pending.length+'</span></h3><p>居服員提交後，須由居督或管理員確認。未審核前請勿視為正式照顧指示。</p></div></div>'+
      '<div class="care-entry-grid">'+(pending.length?pending.map(x=>row(x,true)).join(''):'<p class="care-empty">目前沒有待確認項目。</p>')+'</div>'+
      (rejected.length?'<details class="care-rejected"><summary>查看已退回提案（'+rejected.length+'）</summary>'+rejected.map(x=>row(x,false)).join('')+'</details>':'');
  }
  function renderGuide(){
    const root=$('careGuideResults');if(!root)return;
    root.innerHTML=guideHtml();
  }
  function renderMessages(){
    const list=$('careDiscussionList');if(!list)return;
    const byId=new Map(state.messages.map(x=>[String(x.id),x]));
    list.innerHTML=state.messages.map(m=>{
      const quoted=m.reply_to_id?byId.get(String(m.reply_to_id)):null;
      return '<article class="care-message">'+
        '<div class="care-message-top"><span class="care-chat-avatar" aria-hidden="true">'+esc(String(m.author_name||'?').charAt(0))+'</span>'+
        '<strong>'+esc(m.author_name)+'</strong><span class="care-type">'+esc(m.message_type)+'</span><time>'+fmt(m.created_at)+'</time></div>'+
        (quoted?'<div class="care-message-quote">回覆 '+esc(quoted.author_name)+'：'+esc(quoted.body).slice(0,130)+'</div>':'')+
        '<p>'+esc(m.body)+'</p>'+
        '<div class="care-message-actions"><button type="button" data-discussion-reply="'+esc(m.id)+'">↩ 回覆</button>'+
        '<button type="button" data-discussion-propose="'+esc(m.id)+'">＋ 整理為照顧重點</button></div>'+
      '</article>';
    }).join('')||'<div class="care-empty">尚無交班討論。可先提出問題，之後已指派的同仁便能看到並回覆。</div>';
    $('discussionCount').textContent=state.messages.length+' 則討論';
  }
  function setReply(id){
    const msg=state.messages.find(x=>String(x.id)===String(id));
    if(!msg)return;
    state.replyTo=msg.id;
    $('discussionReply').hidden=false;
    $('discussionReply').textContent='正在回覆 '+msg.author_name+'：'+msg.body.slice(0,70);
    $('discussionType').value='回覆';
    $('discussionBody').focus();
  }
  function changeTab(next){
    if(!['guide','discussion','rooms','history'].includes(next))return;
    state.panel=next;
    document.querySelectorAll('[data-care-tab]').forEach(b=>{
      const active=b.dataset.careTab===next;
      b.classList.toggle('active',active);
      b.setAttribute('aria-selected',String(active));
    });
    document.querySelectorAll('[data-care-panel]').forEach(p=>p.hidden=p.dataset.carePanel!==next);
    if(next==='discussion' && state.loaded)loadMessages(false);
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
  async function loadMessages(showNotice=false){
    const id=state.caseId,seq=state.loadId;
    if(!state.db||!id)return;
    const {data,error}=await state.db.from('case_discussion_messages')
      .select('id,case_id,author_name,message_type,body,reply_to_id,created_at')
      .eq('case_id',id).order('created_at',{ascending:false}).limit(200);
    if(id!==state.caseId || seq!==state.loadId)return;
    if(error){setNotice('載入交班討論失敗：'+errorText(error),true,'discussion');return}
    state.messages=(data||[]).reverse();
    if(showNotice)setNotice('討論已更新',false,'discussion');
    else setNotice('',false,'discussion');
    renderMessages();
  }
  async function submitGuide(e){
    e.preventDefault();
    const caseId=state.caseId;
    const category=$('guideCategory').value;
    const title=$('guideTitle').value.trim();
    const detail=$('guideDetail').value.trim();
    if(!categories.includes(category)||title.length<2||title.length>100||detail.length<5||detail.length>2000){
      return setNotice('請填寫至少 2 字的標題與至少 5 字的照顧重點（不得超過欄位上限）',true);
    }
    const btn=$('guideSaveBtn');btn.disabled=true;
    try{
      const {error}=await state.db.from('case_care_guide_items').insert({case_id:caseId,category,title,detail});
      if(error)throw error;
      if(caseId!==state.caseId)return;
      $('careGuideForm').reset();
      await loadGuide();
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
      setNotice(status==='approved'?'已審核通過，其他獲授權同仁可看到正式照顧重點。':'已將此提案退回，原始提案保留。');
    }catch(err){setNotice('審核失敗：'+errorText(err),true)}
    finally{button.disabled=false}
  }
  async function submitMessage(e){
    e.preventDefault();
    const caseId=state.caseId;
    const body=$('discussionBody').value.trim();
    const message_type=$('discussionType').value;
    if(body.length<2||body.length>3000||!['問題','回覆','補充'].includes(message_type)){
      return setNotice('請輸入 2～3000 字的問題或回覆。',true,'discussion');
    }
    const btn=$('discussionSendBtn');btn.disabled=true;
    try{
      const {error}=await state.db.from('case_discussion_messages').insert({
        case_id:caseId,message_type,body,reply_to_id:state.replyTo
      });
      if(error)throw error;
      if(caseId!==state.caseId)return;
      $('discussionBody').value='';
      $('discussionType').value='問題';
      cancelReply();
      await loadMessages(false);
      setNotice('已送出，交班討論將永久保留，其他獲授權的居服員可閱讀。',false,'discussion');
    }catch(err){setNotice('送出失敗：'+errorText(err),true,'discussion')}
    finally{btn.disabled=false}
  }
  function cancelReply(){state.replyTo=null;$('discussionReply').hidden=true;$('discussionReply').textContent='';}
  function promoteMessage(id){
    const m=state.messages.find(x=>String(x.id)===String(id));
    if(!m)return;
    changeTab('guide');
    $('guideCategory').value='其他';
    $('guideTitle').value=('討論整理：'+m.body.split(/[\n。？！]/)[0]).slice(0,100);
    $('guideDetail').value=m.body.slice(0,2000);
    setNotice('已將討論內容填入照顧重點草稿。請先確認內容，再送出給居督審核。');
    $('guideTitle').scrollIntoView({behavior:'smooth',block:'center'});
    $('guideTitle').focus();
  }
  function bind(){
    $('careGuideForm').addEventListener('submit',submitGuide);
    $('careDiscussionForm').addEventListener('submit',submitMessage);
    $('discussionCancelReply').addEventListener('click',cancelReply);
    $('refreshDiscussionBtn').addEventListener('click',()=>loadMessages(true));
    $('careGuideResults').addEventListener('click',e=>{
      if(e.target.closest('#refreshGuideBtn'))return loadGuide();
      const b=e.target.closest('[data-guide-review]');if(!b)return;
      reviewGuide(Number(b.dataset.guideReview),b.dataset.guideStatus,b);
    });
    $('careDiscussionList').addEventListener('click',e=>{
      const reply=e.target.closest('[data-discussion-reply]');
      if(reply){setReply(reply.dataset.discussionReply);return;}
      const promote=e.target.closest('[data-discussion-propose]');
      if(promote)promoteMessage(promote.dataset.discussionPropose);
    });
    document.querySelectorAll('[data-care-tab]').forEach(b=>b.addEventListener('click',()=>changeTab(b.dataset.careTab)));
  }
  async function mount({db,caseId,profile}){
    if(!db||!caseId||!$('careGuideResults')||!$('careDiscussionList'))return;
    const preferredPanel=state.caseId===caseId?state.panel:'guide';
    destroy();
    const mountToken=state.loadId;
    state.db=db;state.caseId=caseId;state.profile=profile;state.panel=preferredPanel;
    $('careGuideResults').innerHTML='<p class="care-empty">正在載入照顧重點…</p>';
    $('careDiscussionList').innerHTML='<p class="care-empty">正在載入交班討論…</p>';
    cancelReply();bind();changeTab(preferredPanel);
    await Promise.all([loadGuide(),loadMessages(false)]);
    if(state.caseId!==caseId||state.loadId!==mountToken)return;
    state.loaded=true;
    state.timer=setInterval(()=>{
      if(document.visibilityState==='visible' && state.panel==='discussion' && state.caseId===caseId && !$('caseFocus')?.hidden){
        loadMessages(false);
      }
    },25000);
  }
  window.CareCollab={mount,destroy,selectTab:changeTab};
})();
