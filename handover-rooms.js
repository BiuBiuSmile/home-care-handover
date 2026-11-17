/* 安護交班 48h 自助臨時交班室：A 建立、受邀 B 收件、到期居督整理。
 * Room visibility, expiry, authorship and publishing are enforced server-side.
 */
'use strict';
(function(){
 const globalEl=id=>document.getElementById(id);
 const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const fmt=value=>value?new Date(value).toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
 const err=e=>String(e?.message||'操作未完成').slice(0,200);
 const s={root:null,mode:null,db:null,caseId:null,profile:null,userId:null,people:[],rooms:[],messages:[],published:new Map(),roomId:null,seq:0,timer:null,tick:null,busy:false,onPublished:null};
 const inbox={db:null,userId:null,rooms:[],query:'',seq:0};
 const $=id=>s.root?.querySelector('[id="'+id+'"]')||null;
 const current=()=>s.rooms.find(r=>r.id===s.roomId);
 const open=r=>!!r&&!r.closed_at&&Date.now()<Date.parse(r.expires_at);
 const participant=r=>!!r&&(r.participant_a_id===s.userId||r.participant_b_id===s.userId);
 const reviewer=()=>['admin','supervisor'].includes(s.profile?.role)&&s.mode==='case';
 function remains(r){
   if(!open(r))return '00:00:00';
   const t=Math.max(0,Math.ceil((Date.parse(r.expires_at)-Date.now())/1000));
   return [Math.floor(t/3600),Math.floor(t%3600/60),t%60].map(n=>String(n).padStart(2,'0')).join(':');
 }
 function roomState(r){return open(r)?'48 小時交班中':'已結束 · 唯讀'}
 function notify(msg,failed=false){
   const el=$('tempNotice');if(!el)return;
   el.hidden=!msg;el.textContent=msg||'';el.className='temp-notice'+(failed?' error':'');
 }
 function destroy(){
   if(s.root)window.HandoverPhotos?.clearPreview($('tempPhotosPreview'));
   s.seq++;if(s.timer!==null)clearInterval(s.timer);if(s.tick!==null)clearInterval(s.tick);
   if(s.root)s.root.innerHTML='';
   s.root=null;s.mode=null;s.db=null;s.caseId=null;s.userId=null;s.profile=null;
   s.people=[];s.rooms=[];s.messages=[];s.published=new Map();s.roomId=null;s.timer=null;s.tick=null;s.busy=false;s.onPublished=null;
 }
 function build(){
   if(!s.root)return;
   s.root.innerHTML=[
     '<div class="temp-heading"><div><h3>48 小時臨時交班室</h3><p>主責居服員 A 可直接邀請代班 B，無須等待管理員先指派 B 的永久個案權限。</p></div><button id="tempRefresh" type="button" class="btn alt">↻ 更新</button></div>',
     '<div class="temp-warning">重要：聊天室不取代緊急通報。涉及受傷、跌倒或服務安全事件，請依機構規定立即聯絡居督。</div>',
     '<div id="tempNotice" class="temp-notice" role="status" hidden></div>',
     '<section id="tempOverview">',
       '<form id="tempCreateForm" class="temp-create" hidden>',
         '<h4>＋ 建立 48 小時交班室</h4>',
         '<div class="temp-create-grid"><label>交班主題<input id="tempTitle" minlength="2" maxlength="100" required value="臨時代班交接"></label>',
         '<label>交班居服員 A<input id="tempPersonA" readonly></label>',
         '<label>接班居服員 B<select id="tempPersonB" required><option value="">選擇要邀請的 B</option></select></label></div>',
         '<div class="temp-create-actions"><span>只開放 B 查閱這間交班室，不會授予整份個案的永久權限。</span><button id="tempCreateBtn" class="btn" type="submit">建立 48 小時交班室</button></div>',
       '</form>',
       '<div class="temp-list-head"><h4>這位個案的交班室</h4><small>進行中優先，結束後保留歷史</small></div>',
       '<div id="tempRoomList" class="temp-list"><p class="temp-empty">讀取中…</p></div>',
     '</section>',
     '<section id="tempDetail" hidden>',
       '<div class="temp-detail-nav"><button id="tempBack" type="button" class="btn alt">← '+(s.mode==='inbox'?'返回受邀交班清單':'返回此個案交班室')+'</button><span id="tempStatus"></span></div>',
       '<div class="temp-room-heading"><div><h3 id="tempRoomTitle"></h3><p id="tempMembers"></p></div><div class="temp-countdown"><small>距離 48 小時到期</small><strong id="tempTime">--:--:--</strong></div></div>',
       '<div class="temp-closed" id="tempClosed" hidden>交班室已到期並轉為唯讀。歷史訊息保留，由居督或管理員整理正式交班。</div>',
       '<section id="tempCaseBrief" class="temp-case-brief" hidden><div class="temp-case-brief-head"><h4>📋 個案資料與照顧重點</h4><small>僅限本次有效交班室 A、B 查閱</small></div><div id="tempCaseBriefContent"></div></section>',
       '<div class="temp-messages" id="tempMessages"><p class="temp-empty">載入訊息中…</p></div>',
       '<form id="tempChatForm" class="temp-chat" hidden>',
         '<label for="tempBody">交班文字</label><textarea id="tempBody" rows="4" minlength="2" maxlength="3000" required placeholder="說明代班注意事項、服務方式，或向 A 詢問問題…"></textarea>',
         '<div class="handover-photo-field"><label for="tempPhotos">📷 附加照片（選填，最多 3 張）</label><input id="tempPhotos" type="file" accept="image/jpeg,image/png,image/webp" multiple><div id="tempPhotosPreview" class="handover-photo-preview"></div><small>圖片只提供受邀交班者及授權管理人員查閱，請勿上傳不必要的個人資訊。</small></div>',
         '<div class="temp-chat-bottom"><small>訊息永久保存且不可任意刪改。</small><button id="tempSend" class="btn" type="submit">傳送交班訊息</button></div>',
       '</form>',
       '<section id="tempSummary" class="temp-summary" hidden>',
         '<h4>居督／管理員整理正式交班</h4>',
         '<p class="help">請閱讀上述對話、彙整已確認的照顧重點。發佈後會新增到該個案「正式交班」最新紀錄。</p>',
         '<form id="tempSummaryForm"><label>交班摘要標題<input id="tempSummaryTitle" minlength="1" maxlength="100" required placeholder="例如：臨時代班交接重點"></label>',
         '<label>整理後的正式交班內容<textarea id="tempSummaryBody" minlength="8" maxlength="2000" rows="5" required placeholder="請自行核對聊天內容後整理；不會直接把原始聊天當作正式指示。"></textarea></label>',
         '<button id="tempPublish" class="btn" type="submit">確認並發佈最新正式交班</button></form>',
       '</section>',
       '<div id="tempSummaryPublished" class="temp-published" hidden></div>',
     '</section>'
   ].join('');
   $('tempRefresh').addEventListener('click',()=>refresh(true));
   $('tempCreateForm').addEventListener('submit',createRoom);
   $('tempRoomList').addEventListener('click',e=>{const b=e.target.closest('[data-open-room]');if(b)openRoom(b.dataset.openRoom)});
   $('tempBack').addEventListener('click',()=>{
     if(s.mode==='inbox'){exitInbox();return}
     s.roomId=null;s.messages=[];clearCaseBrief();renderList();
   });
   $('tempChatForm').addEventListener('submit',send);
   $('tempPhotos').addEventListener('change',()=>{
     try{window.HandoverPhotos?.preview($('tempPhotos'),$('tempPhotosPreview'))}
     catch(e){notify('照片選取失敗：'+err(e),true)}
   });
   $('tempSummaryForm').addEventListener('submit',publish);
 }
 async function recipients(){
   if(s.mode!=='case'||s.profile?.role!=='staff')return;
   const seq=s.seq;
   const {data,error}=await s.db.rpc('list_handover_recipients',{p_case_id:s.caseId});
   if(seq!==s.seq)return;
   if(error)throw error;
   s.people=data||[];
   $('tempCreateForm').hidden=false;
   $('tempPersonA').value=s.profile.display_name||'目前登入者';
   $('tempPersonB').innerHTML='<option value="">選擇要邀請的 B</option>'+
      s.people.map(p=>'<option value="'+esc(p.user_id)+'">'+esc(p.display_name)+'</option>').join('');
   $('tempCreateBtn').disabled=s.people.length===0;
   if(!s.people.length)notify('找不到其他已啟用的居服員帳號，請先建立員工帳號。');
 }
 async function loadPublished(){
   if(!reviewer()||!s.caseId)return;
   const seq=s.seq;
   const {data,error}=await s.db.from('handovers').select('id,source_room_id,summary')
     .eq('case_id',s.caseId).not('source_room_id','is',null).limit(300);
   if(seq!==s.seq)return;
   if(error)throw error;
   s.published=new Map((data||[]).filter(x=>x.source_room_id).map(x=>[x.source_room_id,x]));
 }
 async function rooms(){
   const seq=s.seq,mode=s.mode,id=s.caseId;
   let query=s.db.from('handover_rooms')
     .select('id,case_id,case_name_snapshot,title,participant_a_id,participant_b_id,participant_a_name,participant_b_name,created_at,expires_at,closed_at')
     .order('created_at',{ascending:false}).limit(150);
   query=mode==='inbox'?query.eq('id',s.roomId):query.eq('case_id',id);
   const {data,error}=await query;
   if(seq!==s.seq||mode!==s.mode)return;
   if(error)throw error;
   s.rooms=data||[];
   if(s.roomId&&!current()){s.roomId=null;s.messages=[];clearCaseBrief();notify('交班室已到期或不再有查閱權限。',true)}
   renderList();
   if(s.roomId)drawHeader();
 }
 function renderList(){
   if(!$('tempOverview'))return;
   $('tempOverview').hidden=!!s.roomId;$('tempDetail').hidden=!s.roomId;
   const sorted=[...s.rooms].sort((a,b)=>Number(open(b))-Number(open(a))||Date.parse(b.created_at)-Date.parse(a.created_at));
   $('tempRoomList').innerHTML=sorted.map(r=>
     '<button class="temp-card" data-open-room="'+esc(r.id)+'" type="button">'+
     '<div class="temp-card-top"><strong>'+esc(r.title)+'</strong><span class="temp-pill '+(open(r)?'live':'ended')+'">'+roomState(r)+'</span></div>'+
     '<div class="temp-card-names">A '+esc(r.participant_a_name)+' <span>⇄</span> B '+esc(r.participant_b_name)+'</div>'+
     '<div class="temp-card-foot"><small>'+fmt(r.created_at)+'</small><b>'+(open(r)?'剩餘 '+remains(r):'查看歷史')+' ›</b></div></button>'
   ).join('')||'<p class="temp-empty">目前沒有可查看的交班室。</p>';
 }
 function clearCaseBrief(){
   const panel=$('tempCaseBrief'),content=$('tempCaseBriefContent');
   if(panel)panel.hidden=true;
   if(content)content.textContent='';
 }
 function briefField(label,value){
   const v=String(value??'').trim();
   return v?'<div class="temp-brief-field"><span>'+esc(label)+'</span><strong>'+esc(v)+'</strong></div>':'';
 }
 function briefItem(title,detail,byline=''){
   const body=String(detail??'').trim();
   if(!body)return '';
   const heading=String(title??'').trim();
   return '<article class="temp-brief-item">'+(heading?'<strong>'+esc(heading)+'</strong>':'')+
     '<p>'+esc(body)+'</p>'+(byline?'<small>'+esc(byline)+'</small>':'')+'</article>';
 }
 function renderCaseBrief(data){
   const panel=$('tempCaseBrief'),content=$('tempCaseBriefContent');
   if(!panel||!content)return;
   const c=data?.case,guides=Array.isArray(data?.guides)?data.guides:[];
   if(!c){clearCaseBrief();return;}
   const fields=[
     briefField('個案姓名',c.name),briefField('服務狀態',c.status),
     briefField('服務區域',c.area),briefField('服務項目',c.service),
     briefField('服務地址',c.address),briefField('主責督導',c.supervisor_name),
     briefField('主責居服員',c.caregiver_name)
   ].filter(Boolean).join('');
   const fixed=(Array.isArray(c.focus)?c.focus:[]).map(x=>
     briefItem(Array.isArray(x)?x[0]:x?.title,Array.isArray(x)?x[1]:x?.body)
   ).filter(Boolean);
   if(String(c.note||'').trim())fixed.push(briefItem('個案重要提醒',c.note));
   const approved=guides.map(x=>
     briefItem(x.category==='其他'&&x.title==='照顧重點'?'':x.title,x.detail,
       '已確認照顧重點'+(x.author_name?' · 提出者：'+x.author_name:''))
   ).filter(Boolean);
   content.innerHTML='<div class="temp-brief-fields">'+fields+'</div>'+
     '<h5>既有照顧資訊與提醒</h5>'+
     (fixed.length?'<div class="temp-brief-grid">'+fixed.join('')+'</div>':'<p class="temp-brief-empty">目前沒有額外的固定照顧資訊。</p>')+
     '<h5>居督／管理員已確認的照顧重點（'+approved.length+'）</h5>'+
     (approved.length?'<div class="temp-brief-grid">'+approved.join('')+'</div>':'<p class="temp-brief-empty">尚無審核通過的照顧重點；待審核內容不會提供給接班者。</p>')+
     '<p class="temp-brief-warning">資料僅供本次交班查閱；緊急異常請依機構規定直接聯絡居督。本區在聊天室到期、關閉或撤權後停止顯示。</p>';
   panel.hidden=false;
 }
 async function loadCaseBrief(){
   const room=current(),id=s.roomId,seq=s.seq;
   if(!room||!open(room)||!participant(room)){clearCaseBrief();return;}
   const panel=$('tempCaseBrief'),content=$('tempCaseBriefContent');
   if(panel&&content&&panel.hidden){
     panel.hidden=false;
     content.innerHTML='<p class="temp-brief-empty">正在讀取本次交班可查閱的個案資料…</p>';
   }
   try{
     const {data,error}=await s.db.rpc('get_invited_room_case_brief',{p_room_id:id});
     if(seq!==s.seq||id!==s.roomId)return;
     if(!open(current())){clearCaseBrief();return;}
     if(error)throw error;
     if(!data){clearCaseBrief();return;}
     renderCaseBrief(data);
   }catch(e){
     if(seq!==s.seq||id!==s.roomId)return;
     clearCaseBrief();
     if(panel&&content&&open(current())){
       panel.hidden=false;
       content.innerHTML='<p class="temp-brief-empty">無法讀取個案資料：'+esc(err(e))+'。請確認交班室仍有效，或聯絡居督。</p>';
     }
   }
 }
 function drawHeader(){
   const r=current();if(!r||!$('tempDetail'))return;
   const active=open(r),canSend=active&&participant(r);
   $('tempOverview').hidden=true;$('tempDetail').hidden=false;
   $('tempRoomTitle').textContent=(s.mode==='inbox'?r.case_name_snapshot+'｜':'')+r.title;
   $('tempMembers').textContent='交班 A：'+r.participant_a_name+' ｜ 接班 B：'+r.participant_b_name+' ｜ 建立：'+fmt(r.created_at);
   $('tempStatus').className='temp-pill '+(active?'live':'ended');
   $('tempStatus').textContent=roomState(r);
   $('tempTime').textContent=remains(r);
   $('tempClosed').hidden=active;
   if(!active)clearCaseBrief();
   $('tempChatForm').hidden=!canSend;
   const published=s.published.get(r.id);
   $('tempSummary').hidden=active||!reviewer()||!!published;
   $('tempSummaryPublished').hidden=!published;
   if(published)$('tempSummaryPublished').textContent='已整理成正式交班：'+published.summary+'（已收錄在最新交班紀錄）';
 }
 async function openRoom(id){
   if(!s.rooms.some(x=>x.id===id))return;
   s.roomId=id;s.messages=[];clearCaseBrief();
   $('tempOverview').hidden=true;$('tempDetail').hidden=false;
   $('tempMessages').innerHTML='<p class="temp-empty">載入訊息中…</p>';
   drawHeader();await Promise.all([messages(),loadCaseBrief()]);
 }
 async function messages(){
   const id=s.roomId,seq=s.seq;if(!id)return;
   const {data,error}=await s.db.from('handover_room_messages')
     .select('id,author_id,author_name,body,photo_paths,created_at').eq('room_id',id)
     .order('created_at',{ascending:false}).limit(500);
   if(seq!==s.seq||id!==s.roomId)return;
   if(error){notify('載入對話失敗：'+err(error),true);return}
   s.messages=(data||[]).reverse();renderMessages();
 }
 function renderMessages(){
   const el=$('tempMessages');if(!el)return;
   const bottom=el.scrollHeight-el.scrollTop-el.clientHeight<100;
   el.innerHTML=s.messages.map(m=>'<article class="temp-message '+(m.author_id===s.userId?'own':'')+'">'+
     '<div class="temp-message-heading"><b>'+esc(m.author_name)+'</b><time>'+fmt(m.created_at)+'</time></div>'+
     '<p>'+esc(m.body)+'</p>'+(window.HandoverPhotos?.markup(m.photo_paths)||'')+'</article>'
   ).join('')||'<p class="temp-empty">目前沒有交班留言。A 可先寫入注意事項，B 也能在 48 小時內詢問。</p>';
   if(bottom)el.scrollTop=el.scrollHeight;
   window.HandoverPhotos?.hydrate(el,s.db);
 }
 async function createRoom(e){
   e.preventDefault();if(s.busy)return;
   const b=$('tempPersonB').value,title=$('tempTitle').value.trim();
   if(!b||b===s.userId)return notify('請選擇要接班的另一位居服員 B。',true);
   if(title.length<2||title.length>100)return notify('交班主題須為 2～100 字。',true);
   s.busy=true;$('tempCreateBtn').disabled=true;
   try{
     const {data,error}=await s.db.from('handover_rooms').insert({
       case_id:s.caseId,title,participant_a_id:s.userId,participant_b_id:b
     }).select('id').single();
     if(error)throw error;
     await rooms();await openRoom(data.id);
     notify('已建立 48 小時交班室，受邀 B 可在聊天室查看該案資料與已確認照顧重點。');
   }catch(e){notify('建立失敗：'+err(e),true)}
   finally{s.busy=false;$('tempCreateBtn').disabled=!s.people.length}
 }
 async function send(e){
   e.preventDefault();if(s.busy)return;
   const r=current(),body=$('tempBody').value.trim();
   if(!open(r)||!participant(r))return notify('交班室已到期或沒有留言權限。',true);
   if(body.length<2||body.length>3000)return notify('請輸入 2～3000 字。',true);
   s.busy=true;$('tempSend').disabled=true;
   let paths=[];
   try{
     paths=await window.HandoverPhotos.uploadSelected({
       input:$('tempPhotos'),db:s.db,userId:s.userId,roomId:r.id
     });
     const {error}=await s.db.from('handover_room_messages')
       .insert({room_id:r.id,body,photo_paths:paths});
     if(error)throw error;
     $('tempBody').value='';$('tempPhotos').value='';
     window.HandoverPhotos.clearPreview($('tempPhotosPreview'));
     await messages();notify(paths.length?'已傳送交班訊息與 '+paths.length+' 張照片。':'');
   }catch(e){
     await window.HandoverPhotos?.removeUnlinked(s.db,paths);
     notify('無法發送：'+err(e),true);
     await refresh();
   }finally{s.busy=false;if($('tempSend'))$('tempSend').disabled=false;drawHeader()}
 }
 async function publish(e){
   e.preventDefault();if(s.busy)return;
   const r=current(),title=$('tempSummaryTitle').value.trim(),description=$('tempSummaryBody').value.trim();
   if(!r||open(r)||!reviewer())return notify('只有到期後的居督或管理員可以發佈整理。',true);
   if(!title||title.length>100||description.length<8||description.length>2000)return notify('請填寫標題及 8～2000 字的整理內容。',true);
   s.busy=true;$('tempPublish').disabled=true;
   try{
     const {data,error}=await s.db.rpc('publish_room_handover_summary',{p_room_id:r.id,p_title:title,p_description:description});
     if(error)throw error;
     await loadPublished();drawHeader();
     notify('已發佈最新正式交班。若 A、B 雙方皆曾實際留言，系統將各核發 5 點。');
     if(s.onPublished)await s.onPublished(data);
   }catch(e){notify('發佈失敗：'+err(e),true)}
   finally{s.busy=false;if($('tempPublish'))$('tempPublish').disabled=false}
 }
 async function refresh(showNotice=false){
   if(!s.db||!s.root)return;
   try{
     await rooms();if(s.mode==='case')await loadPublished();
     if(s.roomId){await Promise.all([messages(),loadCaseBrief()]);drawHeader();}
     if(showNotice)notify('已更新交班室');
   }catch(e){notify('更新失敗：'+err(e),true)}
 }
 async function mount({db,caseId,profile,user,onPublished}){
   if(!db||!caseId||!globalEl('tempRoomRoot'))return;
   const previous=s.mode==='case'&&s.caseId===caseId?s.roomId:null;
   destroy();const token=s.seq;
   s.root=globalEl('tempRoomRoot');s.mode='case';s.db=db;s.caseId=caseId;
   s.profile=profile;s.userId=user?.id;s.onPublished=onPublished||null;
   build();s.roomId=previous;
   try{
     await Promise.all([recipients(),rooms(),loadPublished()]);
     if(token!==s.seq)return;
     if(previous&&current())await openRoom(previous);
     renderList();
   }catch(e){notify('無法載入：'+err(e),true)}
   if(token!==s.seq)return;
   startTimers();
 }
 function startTimers(){
   s.tick=setInterval(()=>{
     const r=current();
     if(r&&$('tempTime')){
       const hadClosed=$('tempClosed').hidden;
       $('tempTime').textContent=remains(r);
       if(hadClosed===!open(r))drawHeader();
     } else if($('tempRoomList'))renderList();
   },1000);
   s.timer=setInterval(()=>{
     if(!s.root||document.visibilityState!=='visible')return;
     const pane=s.root.closest('[data-care-panel]');
     if(s.mode==='inbox'||(pane&&!pane.hidden))refresh();
   },15000);
 }
 function bindInbox(){
   const search=globalEl('tempInboxSearch'),list=globalEl('tempInboxList');
   if(!search||!list||search.dataset.bound==='yes')return;
   search.dataset.bound='yes';
   search.addEventListener('input',()=>{inbox.query=search.value.trim().toLocaleLowerCase('zh-TW');renderInbox()});
   list.addEventListener('click',e=>{
     const b=e.target.closest('[data-inbox-room]');if(b)openInvitedRoom(b.dataset.inboxRoom);
   });
 }
 function clearInbox(){
   inbox.seq++;inbox.db=null;inbox.userId=null;inbox.rooms=[];inbox.query='';
   if(globalEl('tempInboxSearch'))globalEl('tempInboxSearch').value='';
   if(globalEl('tempInboxPanel'))globalEl('tempInboxPanel').hidden=true;
   if(globalEl('tempInboxWorkspace'))globalEl('tempInboxWorkspace').hidden=true;
 }
 async function loadInvites({db,user,profile}){
   bindInbox();
   const box=globalEl('tempInboxPanel');if(!box)return;
   if(!db||!user?.id||profile?.role!=='staff'||!profile.active){clearInbox();return}
   inbox.db=db;inbox.userId=user.id;const seq=++inbox.seq;
   box.hidden=false;
   const {data,error}=await db.from('handover_rooms')
     .select('id,case_id,case_name_snapshot,title,participant_a_id,participant_b_id,participant_a_name,participant_b_name,created_at,expires_at,closed_at')
     .eq('participant_b_id',user.id).order('created_at',{ascending:false}).limit(100);
   if(seq!==inbox.seq)return;
   if(error){const el=globalEl('tempInboxList');if(el)el.textContent='交班邀請讀取失敗：'+err(error);return}
   inbox.rooms=data||[];
   renderInbox();
 }
 function renderInbox(){
   const list=globalEl('tempInboxList');if(!list)return;
   const rows=inbox.rooms.filter(r=>[r.case_name_snapshot,r.case_id,r.title,r.participant_a_name].join(' ')
     .toLocaleLowerCase('zh-TW').includes(inbox.query));
   globalEl('tempInboxCount').textContent=inbox.rooms.filter(open).length+' 間進行中';
   list.innerHTML=rows.map(r=>'<button type="button" class="temp-inbox-card" data-inbox-room="'+esc(r.id)+'">'+
     '<div><strong>'+esc(r.case_name_snapshot||'個案交班')+'</strong><span>'+esc(r.title)+' · 交班者 '+esc(r.participant_a_name)+'</span></div>'+
     '<span class="temp-pill '+(open(r)?'live':'ended')+'">'+(open(r)?'進入聊天室':'查看歷史')+'</span>'+
     '</button>').join('')||
     '<p class="temp-empty">'+(inbox.query?'沒有符合搜尋的受邀交班室。':'目前沒有收到臨時交班邀請；A 建立後才會顯示。')+'</p>';
 }
 async function openInvitedRoom(id){
   if(!inbox.db||!inbox.userId||!inbox.rooms.some(r=>r.id===id))return;
   const db=inbox.db,userId=inbox.userId,room=inbox.rooms.find(r=>r.id===id),root=globalEl('tempInboxWorkspace');
   if(!root)return;
   destroy();const token=s.seq;
   s.root=root;s.mode='inbox';s.db=db;s.userId=userId;s.caseId=room.case_id;
   s.profile={role:'staff'};s.roomId=room.id;
   globalEl('caseBrowser').hidden=true;
   globalEl('caseFocus').hidden=true;
   globalEl('tempInboxPanel').hidden=true;
   root.hidden=false;build();
   try{
     await rooms();
     if(token!==s.seq)return;
     if(current())await openRoom(id);
     else notify('這間交班室可能已到期，不再提供臨時讀取。',true);
   }catch(e){notify('無法開啟受邀聊天室：'+err(e),true)}
   if(token!==s.seq)return;
   startTimers();window.scrollTo({top:0,behavior:'smooth'});
 }
 function exitInbox(){
   destroy();
   const root=globalEl('tempInboxWorkspace'),box=globalEl('tempInboxPanel');
   if(root)root.hidden=true;
   if(box)box.hidden=false;
   if(globalEl('caseBrowser'))globalEl('caseBrowser').hidden=false;
   if(inbox.db&&inbox.userId)loadInvites({db:inbox.db,user:{id:inbox.userId},profile:{role:'staff',active:true}});
 }
 window.HandoverRooms={mount,destroy,refresh,bindInbox,loadInvites,clearInbox,openInvitedRoom,exitInbox};
})();