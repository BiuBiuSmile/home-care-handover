/* Temporary handover rooms: DB controls expiry and permissions; browser countdown is informational. */
'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=x=>x?new Date(x).toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
 const s={db:null,caseId:null,profile:null,userId:null,people:[],rooms:[],messages:[],roomId:null,token:0,poll:null,tick:null,busy:false};
 const current=()=>s.rooms.find(x=>x.id===s.roomId);
 const open=r=>!!r&&!r.closed_at&&Date.now()<new Date(r.expires_at).getTime();
 const member=r=>!!r&&(s.userId===r.participant_a_id||s.userId===r.participant_b_id);
 const label=r=>r.closed_at?'雙方已完成':open(r)?'進行中':'24 小時到期';
 function remaining(r){
   if(!open(r))return '00:00:00';
   const t=Math.ceil((new Date(r.expires_at).getTime()-Date.now())/1000);
   return [Math.floor(t/3600),Math.floor(t%3600/60),t%60].map(n=>String(n).padStart(2,'0')).join(':');
 }
 function notice(message,failed=false){
   const el=$('tempNotice');if(!el)return;el.hidden=!message;el.className='temp-notice'+(failed?' error':'');el.textContent=message||'';
 }
 const err=e=>String(e?.message||'操作未完成').slice(0,180);
 function destroy(){
   s.token++;
   if(s.poll!==null)clearInterval(s.poll);
   if(s.tick!==null)clearInterval(s.tick);
   s.poll=s.tick=null;
   if($('tempRoomRoot'))$('tempRoomRoot').innerHTML='';
   s.db=null;s.caseId=null;s.userId=null;s.profile=null;s.people=[];s.rooms=[];s.messages=[];s.roomId=null;s.busy=false;
 }
 function shell(){
   $('tempRoomRoot').innerHTML=[
    '<div class="temp-heading"><div><h3>24 小時臨時交班室</h3><p>臨時代班可選擇 A、B 兩位居服員進行交接；結束後保留唯讀紀錄。</p></div><button class="btn alt" type="button" id="tempRefresh">↻ 更新</button></div>',
    '<div class="temp-warning">重要：遇到跌倒、傷害或緊急異常，仍須立即聯絡督導，不能只在聊天室留言。</div>',
    '<div id="tempNotice" class="temp-notice" role="status" hidden></div>',
    '<section id="tempOverview">',
      '<form id="tempCreateForm" class="temp-create">',
        '<h4>＋ 建立新的臨時交班室</h4>',
        '<div class="temp-create-grid">',
          '<label>交班主題<input id="tempTitle" value="臨時代班交接" maxlength="100" minlength="2" required></label>',
          '<label>主責居服員 A<select id="tempPersonA" required><option value="">選擇 A</option></select></label>',
          '<label>代班居服員 B<select id="tempPersonB" required><option value="">選擇 B</option></select></label>',
        '</div>',
        '<div class="temp-create-actions"><span>僅限已指派此個案的兩位居服員；時間由伺服器計算。</span><button type="submit" class="btn" id="tempCreateBtn">建立 24 小時交班室</button></div>',
      '</form>',
      '<div class="temp-list-head"><h4>臨時交班室紀錄</h4><small>進行中優先顯示，結束後可查閱歷史</small></div>',
      '<div id="tempRoomList" class="temp-list"><p class="temp-empty">讀取中…</p></div>',
    '</section>',
    '<section id="tempDetail" hidden>',
      '<div class="temp-detail-nav"><button class="btn alt" type="button" id="tempBack">← 返回交班室清單</button><span id="tempStatus"></span></div>',
      '<div class="temp-room-heading"><div><h3 id="tempRoomTitle"></h3><p id="tempMembers"></p></div><div class="temp-countdown"><small>距離關閉</small><strong id="tempTime">--:--:--</strong></div></div>',
      '<div class="temp-confirmed" id="tempConfirmInfo"></div>',
      '<div class="temp-closed" id="tempClosed" hidden>交班室已關閉，目前僅供查閱。歷史對話會保留，供日後獲授權的代班人員參考。</div>',
      '<div class="temp-messages" id="tempMessages"><p class="temp-empty">載入訊息中…</p></div>',
      '<form id="tempChatForm" class="temp-chat"><label for="tempBody">輸入交班內容</label><textarea id="tempBody" maxlength="3000" minlength="2" required rows="3" placeholder="詢問代班注意事項、服務習慣與照顧需求…"></textarea><div class="temp-chat-bottom"><small>訊息會留存紀錄，不能隨意刪改。</small><button class="btn" type="submit" id="tempSend">傳送訊息</button></div></form>',
      '<div id="tempComplete" class="temp-complete"><div><strong>雙方完成交班了嗎？</strong><p>A、B 各自確認後提前關閉，未確認則 24 小時自動到期。</p></div><button id="tempConfirmBtn" type="button" class="btn alt">✓ 我已完成交班</button></div>',
    '</section>'
   ].join('');
   $('tempRefresh').addEventListener('click',()=>refresh(true));
   $('tempCreateForm').addEventListener('submit',createRoom);
   $('tempRoomList').addEventListener('click',e=>{const b=e.target.closest('[data-open-room]');if(b)openRoom(b.dataset.openRoom)});
   $('tempBack').addEventListener('click',()=>{s.roomId=null;s.messages=[];drawList()});
   $('tempChatForm').addEventListener('submit',send);
   $('tempConfirmBtn').addEventListener('click',confirm);
   $('tempMessages').addEventListener('click',e=>{const b=e.target.closest('[data-suggest-message]');if(b)suggest(b.dataset.suggestMessage)});
 }
 async function people(){
   const token=s.token;
   const {data,error}=await s.db.rpc('list_case_handover_staff',{p_case_id:s.caseId});
   if(token!==s.token)return;
   if(error)throw error;
   s.people=data||[];
   const opt=s.people.map(p=>'<option value="'+esc(p.user_id)+'">'+esc(p.display_name)+'</option>').join('');
   $('tempPersonA').innerHTML='<option value="">選擇 A</option>'+opt;
   $('tempPersonB').innerHTML='<option value="">選擇 B</option>'+opt;
   if(s.people.some(p=>p.user_id===s.userId))$('tempPersonA').value=s.userId;
   $('tempCreateBtn').disabled=s.people.length<2;
   if(s.people.length<2)notice('請先由管理員指派至少兩位已啟用的居服員給此個案。');
 }
 async function rooms(){
   const token=s.token,caseId=s.caseId;
   const {data,error}=await s.db.from('handover_rooms')
     .select('id,title,participant_a_id,participant_b_id,participant_a_name,participant_b_name,created_at,expires_at,a_confirmed_at,b_confirmed_at,closed_at')
     .eq('case_id',caseId).order('created_at',{ascending:false}).limit(150);
   if(token!==s.token||caseId!==s.caseId)return;
   if(error)throw error;
   s.rooms=data||[];
   if(s.roomId&&!current())s.roomId=null;
   drawList();if(s.roomId)drawHeader();
 }
 function drawList(){
   const wrap=$('tempOverview');if(!wrap)return;
   wrap.hidden=!!s.roomId;$('tempDetail').hidden=!s.roomId;
   const rows=[...s.rooms].sort((a,b)=>Number(open(b))-Number(open(a))||new Date(b.created_at)-new Date(a.created_at));
   $('tempRoomList').innerHTML=rows.map(r=>
     '<button type="button" class="temp-card" data-open-room="'+esc(r.id)+'">'+
     '<div class="temp-card-top"><strong>'+esc(r.title)+'</strong><span class="temp-pill '+(open(r)?'live':'ended')+'">'+label(r)+'</span></div>'+
     '<div class="temp-card-names">A '+esc(r.participant_a_name)+' <span>⇄</span> B '+esc(r.participant_b_name)+'</div>'+
     '<div class="temp-card-foot"><small>建立於 '+fmt(r.created_at)+'</small><b>'+(open(r)?'剩餘 '+remaining(r):'查閱歷史')+' ›</b></div>'+
     '</button>'
   ).join('')||'<p class="temp-empty">目前尚無臨時交班室，可在上方建立第一個。</p>';
 }
 function drawHeader(){
   const r=current();if(!r||!$('tempDetail'))return;
   const active=open(r),canSend=active&&member(r);
   $('tempOverview').hidden=true;$('tempDetail').hidden=false;
   $('tempRoomTitle').textContent=r.title;
   $('tempMembers').textContent='主責 A：'+r.participant_a_name+' ｜ 代班 B：'+r.participant_b_name+' ｜ '+fmt(r.created_at)+' 開始';
   $('tempStatus').className='temp-pill '+(active?'live':'ended');
   $('tempStatus').textContent=label(r);
   $('tempTime').textContent=remaining(r);
   $('tempConfirmInfo').innerHTML='<span class="'+(r.a_confirmed_at?'yes':'')+'">A '+(r.a_confirmed_at?'已確認':'尚未確認')+'</span><span class="'+(r.b_confirmed_at?'yes':'')+'">B '+(r.b_confirmed_at?'已確認':'尚未確認')+'</span>';
   $('tempClosed').hidden=active;
   $('tempChatForm').hidden=!canSend;
   $('tempComplete').hidden=!canSend;
   if(canSend){
     const confirmed=s.userId===r.participant_a_id?r.a_confirmed_at:r.b_confirmed_at;
     $('tempConfirmBtn').disabled=!!confirmed;
     $('tempConfirmBtn').textContent=confirmed?'✓ 已確認，等待另一位':'✓ 我已完成交班';
   }
 }
 async function openRoom(id){
   if(!s.rooms.some(r=>r.id===id))return;
   s.roomId=id;
   $('tempOverview').hidden=true;$('tempDetail').hidden=false;
   $('tempMessages').innerHTML='<p class="temp-empty">載入訊息中…</p>';
   drawHeader();await messages();
 }
 async function messages(){
   const id=s.roomId,token=s.token;
   if(!id)return;
   const {data,error}=await s.db.from('handover_room_messages')
     .select('id,author_id,author_name,body,created_at')
     .eq('room_id',id).order('created_at',{ascending:false}).limit(500);
   if(token!==s.token||id!==s.roomId)return;
   if(error){notice('讀取對話失敗：'+err(error),true);return}
   s.messages=(data||[]).reverse();drawMessages();
 }
 function drawMessages(){
   const el=$('tempMessages');if(!el)return;
   const nearBottom=el.scrollHeight-el.scrollTop-el.clientHeight<100;
   el.innerHTML=s.messages.map(m=>
     '<article class="temp-message '+(m.author_id===s.userId?'own':'')+'">'+
     '<div class="temp-message-heading"><b>'+esc(m.author_name)+'</b><time>'+fmt(m.created_at)+'</time></div>'+
     '<p>'+esc(m.body)+'</p><button type="button" class="temp-to-guide" data-suggest-message="'+esc(m.id)+'">＋ 整理成照顧重點</button></article>'
   ).join('')||'<p class="temp-empty">尚無對話。A、B 可以從下方開始討論。</p>';
   if(nearBottom)el.scrollTop=el.scrollHeight;
 }
 async function createRoom(e){
   e.preventDefault();if(s.busy)return;
   const a=$('tempPersonA').value,b=$('tempPersonB').value,title=$('tempTitle').value.trim();
   if(!a||!b||a===b)return notice('請選擇兩位不同的居服員。',true);
   if(title.length<2||title.length>100)return notice('交班主題須為 2～100 字。',true);
   if(s.rooms.some(r=>open(r)&&((r.participant_a_id===a&&r.participant_b_id===b)||(r.participant_a_id===b&&r.participant_b_id===a)))){
     return notice('這兩位居服員已有進行中的交班室，請開啟現有交班室。',true);
   }
   s.busy=true;$('tempCreateBtn').disabled=true;
   try{
     const {data,error}=await s.db.from('handover_rooms').insert({case_id:s.caseId,title,participant_a_id:a,participant_b_id:b}).select('id').single();
     if(error)throw error;
     notice('已建立 24 小時交班室，期限由資料庫設定。');
     await rooms();
     await openRoom(data.id);
   }catch(e){notice('建立失敗：'+err(e),true)}
   finally{s.busy=false;$('tempCreateBtn').disabled=s.people.length<2}
 }
 async function send(e){
   e.preventDefault();if(s.busy)return;
   const r=current(),body=$('tempBody').value.trim();
   if(!open(r)||!member(r))return notice('交班室已關閉或你不是 A／B 參與者。',true);
   if(body.length<2||body.length>3000)return notice('請輸入 2～3000 字的交班內容。',true);
   s.busy=true;$('tempSend').disabled=true;
   try{
     const {error}=await s.db.from('handover_room_messages').insert({room_id:r.id,body});
     if(error)throw error;
     $('tempBody').value='';await messages();notice('');
   }catch(e){notice('無法送出：'+err(e)+'。請確認房間是否已到期。',true);await refresh()}
   finally{s.busy=false;$('tempSend').disabled=false;drawHeader()}
 }
 async function confirm(){
   if(s.busy)return;
   const r=current();
   if(!open(r)||!member(r))return notice('僅進行中的 A／B 可以確認交班。',true);
   const isA=r.participant_a_id===s.userId;
   if(isA?r.a_confirmed_at:r.b_confirmed_at)return;
   s.busy=true;$('tempConfirmBtn').disabled=true;
   try{
     const patch=isA?{a_confirmed_at:new Date().toISOString()}:{b_confirmed_at:new Date().toISOString()};
     const {data,error}=await s.db.from('handover_rooms').update(patch).eq('id',r.id).select('id');
     if(error)throw error;
     if(!data?.length)throw Error('交班室可能已到期，請重新整理。');
     await rooms();
     notice(open(current())?'已確認完成，等待另一位居服員。':'雙方已確認，交班室關閉並轉為唯讀。');
   }catch(e){notice('確認失敗：'+err(e),true);await refresh()}
   finally{s.busy=false;drawHeader()}
 }
 function suggest(id){
   const m=s.messages.find(x=>String(x.id)===String(id));
   if(!m)return;
   if(!window.CareCollab?.selectTab)return notice('照顧檔案未載入，請重新整理。',true);
   window.CareCollab.selectTab('guide');
   if($('guideCategory'))$('guideCategory').value='其他';
   if($('guideTitle'))$('guideTitle').value=('臨時交班整理：'+m.body.split(/[。？！\n]/)[0]).slice(0,100);
   if($('guideDetail'))$('guideDetail').value=m.body.slice(0,2000);
   if($('guideNotice')){
     $('guideNotice').hidden=false;$('guideNotice').className='care-notice';
     $('guideNotice').textContent='交班訊息已填入草稿。請確認內容後送交居督審核。';
   }
   $('guideTitle')?.scrollIntoView({behavior:'smooth',block:'center'});
 }
 async function refresh(showNotice=false){
   if(!s.db||!s.caseId||!$('tempOverview'))return;
   try{await rooms();if(s.roomId)await messages();if(showNotice)notice('交班室已更新')}
   catch(e){notice('更新失敗：'+err(e),true)}
 }
 async function mount({db,caseId,profile,user}){
   if(!db||!caseId||!$('tempRoomRoot'))return;
   const previous=s.caseId===caseId?s.roomId:null;
   destroy();const token=s.token;
   s.db=db;s.caseId=caseId;s.profile=profile;s.userId=user?.id;s.roomId=previous;
   shell();
   try{
     await Promise.all([people(),rooms()]);
     if(token!==s.token)return;
     if(previous&&current())await openRoom(previous);
     else s.roomId=null;
     drawList();
   }catch(e){notice('讀取臨時交班室失敗：'+err(e),true)}
   if(token!==s.token)return;
   s.tick=setInterval(()=>{
     const r=current();if(r){
       const hadClosed=$('tempClosed').hidden;
       $('tempTime').textContent=remaining(r);
       if(hadClosed!==!open(r))drawHeader();
     }else if($('tempRoomList'))drawList();
   },1000);
   s.poll=setInterval(()=>{
     const panel=$('tempRoomRoot')?.closest('[data-care-panel]');
     if(document.visibilityState==='visible'&&!$('caseFocus')?.hidden&&panel&&!panel.hidden)refresh();
   },15000);
 }
 window.HandoverRooms={mount,destroy,refresh};
})();
