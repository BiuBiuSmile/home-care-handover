/* 安護交班 secure portal — browser uses only Supabase publishable/anon key.
 * Patient/case access is enforced by PostgreSQL RLS, NOT by front-end controls.
 * No service_role secret, admin impersonation, or production data in this file.
 */
'use strict';
(function(){
 const $ = id => document.getElementById(id);
 const config = window.CARE_CONFIG || {};
 const state = {db:null,user:null,profile:null,cases:[],records:[],reads:[],profiles:[],assignments:[],current:null,editing:null,tab:'cases',verifyPhone:null};
 const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 const roles = {admin:'管理員',supervisor:'居督',staff:'居服員'};
 const when = v => v ? new Date(v).toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '';
 let toastTimer;
 function notify(text,failed){
   const t=$('toast');t.textContent=text;t.style.display='block';t.style.background=failed?'#9f3530':'#102f3c';
   clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.style.display='none'},4800);
 }
 function authMessage(message,failed){
   const el=$('authMessage');el.textContent=message;el.className='msg'+(failed?' error':'');
 }
 function show(screen){
   ['authScreen','pendingScreen','appScreen'].forEach(x=>$(x).hidden=x!==screen);
 }
 function setBusy(form,busy){
   Array.from(form.querySelectorAll('button,input,select,textarea')).forEach(el=>el.disabled=busy);
 }
 function errText(error){return (error && error.message) ? error.message : String(error || '操作失敗');}
 function canAdmin(){return state.profile && state.profile.role==='admin' && state.profile.active;}
 function selectedCase(){return state.cases.find(x=>x.id===state.current);}
 async function checkQuery(result,action){
   if(result.error)throw new Error(action+'：'+errText(result.error));
   return result.data;
 }
 async function init(){
   $('authForm').addEventListener('submit',handleAuth);
   $('verifyForm').addEventListener('submit',handleVerifySms);
   $('verifyBack').addEventListener('click',hideVerifySms);
   $('resendSms').addEventListener('click',resendVerifySms);
   $('pendingReload').addEventListener('click',refreshIdentity);
   $('pendingLogout').addEventListener('click',logout);
   $('logoutBtn').addEventListener('click',logout);
   $('casesTab').addEventListener('click',()=>chooseTab('cases'));
   $('adminTab').addEventListener('click',async()=>{chooseTab('admin');try{await loadAdmin()}catch(e){notify(errText(e),true)}});
   $('reloadAdmin').addEventListener('click',async()=>{try{await loadAdmin();notify('已更新管理資料')}catch(e){notify(errText(e),true)}});
   $('refreshBtn').addEventListener('click',()=>refreshDashboard());
   $('caseSearch').addEventListener('input',renderCaseList);
   $('caseList').addEventListener('click', e=>{
     const b=e.target.closest('[data-case]');if(!b)return;
     state.current=b.dataset.case;renderCaseList();renderDetail();
     if(matchMedia('(max-width:780px)').matches)$('caseDetail').scrollIntoView({behavior:'smooth',block:'start'});
   });
   $('caseForm').addEventListener('submit',saveCase);
   $('clearCaseBtn').addEventListener('click',clearCaseForm);
   $('assignForm').addEventListener('submit',saveAssignment);
   $('assignCase').addEventListener('change',renderAssignedList);
   $('usersBody').addEventListener('click',saveProfileFromRow);
   $('assignedList').addEventListener('click',removeAssignment);
   $('handoverForm').addEventListener('submit',saveHandover);
   $('cancelRecord').addEventListener('click',closeHandover);
   $('handoverLayer').addEventListener('click',e=>{if(e.target===$('handoverLayer'))closeHandover()});
   document.addEventListener('keydown',e=>{if(e.key==='Escape')closeHandover()});
   if(!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || config.SUPABASE_URL.includes('YOUR_') || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.SUPABASE_URL) || !window.supabase?.createClient){
     $('configMessage').hidden=false;
     $('authSubmit').disabled=true;
     authMessage('登入尚未啟用：需要設定 Supabase 專案網址、公開金鑰與資料庫。',true);
     return;
   }
   state.db=window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
   state.db.auth.onAuthStateChange((event,session)=>{
     if(event==='SIGNED_IN'||event==='SIGNED_OUT'||event==='TOKEN_REFRESHED'||event==='USER_UPDATED'||event==='INITIAL_SESSION'){
       setTimeout(()=>setSession(session).catch(e=>notify(errText(e),true)),0);
     }
   });
   const result=await state.db.auth.getSession();
   await checkQuery(result,'確認登入狀態');
   await setSession(result.data.session);
 }
 function phoneE164(input){
   const raw=String(input||'').trim().replace(/[\s()-]/g,'');
   if(/^09\d{8}$/.test(raw))return '+886'+raw.slice(1);
   if(/^8869\d{8}$/.test(raw))return '+'+raw;
   if(/^\+8869\d{8}$/.test(raw))return raw;
   throw Error('請輸入有效的台灣手機門號，例如 0912345678 或 +886912345678');
 }
 function showVerifySms(phone){
   state.verifyPhone=phone;
   $('verifyHint').textContent='已向 '+phone+' 發送一次性登入驗證碼。請輸入收到的簡訊；首次使用仍需管理員審核。';
   $('authForm').hidden=true;
   $('verifyForm').hidden=false;
   $('smsCode').value='';
   $('authMessage').textContent='';
   $('smsCode').focus();
 }
 function hideVerifySms(){
   state.verifyPhone=null;
   $('verifyForm').hidden=true;
   $('authForm').hidden=false;
   $('smsCode').value='';
   $('authMessage').textContent='';
 }
 async function handleAuth(e){
   e.preventDefault();
   if(!state.db)return;
   const form=$('authForm');
   setBusy(form,true);
   try{
     const phone=phoneE164($('phone').value);
     await checkQuery(
       await state.db.auth.signInWithOtp({phone, options:{shouldCreateUser:true}}),
       '傳送簡訊驗證碼'
     );
     showVerifySms(phone);
   }catch(error){
     const msg=errText(error);
     authMessage(/phone signups? (?:are |is )?disabled/i.test(msg)
       ?'Supabase 尚未啟用手機登入。請到 Authentication → Sign In / Providers → Phone 開啟，並設定 SMS 服務。'
       :msg,true);
   }finally{setBusy(form,false)}
 }
 async function handleVerifySms(e){
   e.preventDefault();
   if(!state.db || !state.verifyPhone)return;
   const form=$('verifyForm'), token=$('smsCode').value.trim();
   if(!/^\d{4,8}$/.test(token)){
     authMessage('請輸入簡訊中的數字驗證碼',true);return;
   }
   setBusy(form,true);
   try{
     await checkQuery(await state.db.auth.verifyOtp({
       phone:state.verifyPhone,token,type:'sms'
     }),'驗證手機門號');
     hideVerifySms();
     await refreshIdentity();
     notify('手機驗證成功！若為新帳號，須由管理員核准後才能查閱個案');
   }catch(error){authMessage(errText(error),true)}
   finally{setBusy(form,false)}
 }
 async function resendVerifySms(){
   if(!state.db || !state.verifyPhone)return;
   const b=$('resendSms');b.disabled=true;
   try{
     await checkQuery(
       await state.db.auth.signInWithOtp({
         phone:state.verifyPhone,
         options:{shouldCreateUser:true}
       }),
       '重新發送簡訊'
     );
     authMessage('已再次申請發送驗證碼。請注意簡訊發送間隔與供應商費用。',false);
   }catch(error){authMessage(errText(error),true)}
   finally{b.disabled=false}
 }
 async function setSession(session){
   if(!session?.user){state.user=null;state.profile=null;state.cases=[];state.records=[];state.reads=[];show('authScreen');return;}
   state.user=session.user;
   await refreshIdentity();
 }
 async function refreshIdentity(){
   if(!state.db)return;
   try{
     const userResult=await state.db.auth.getUser();
     const user=(await checkQuery(userResult,'取得身分'))?.user;
     if(!user){show('authScreen');return;}
     state.user=user;
     if(user.phone && !user.phone_confirmed_at){
       $('pendingTitle').textContent='手機門號尚未驗證';
       $('pendingMessage').textContent='目前門號尚未完成簡訊驗證，暫時不能查閱任何個案資訊。請先完成驗證，必要時聯絡管理員確認 Phone 簡訊服務設定。';
       show('pendingScreen');return;
     }
     const r=await state.db.from('profiles').select('id,display_name,role,active').eq('id',user.id).single();
     state.profile=await checkQuery(r,'取得帳號權限');
     if(!state.profile.active){
       $('pendingTitle').textContent='帳號尚未啟用';
       $('pendingMessage').textContent='已登入 '+(state.profile.display_name||user.phone||user.email)+'，但管理員尚未啟用您的帳號。請先完成審核，開通後再指派個案。';
       show('pendingScreen');return;
     }
     $('identity').textContent=state.profile.display_name+'｜'+(roles[state.profile.role]||state.profile.role);
     $('adminTab').hidden=!canAdmin();
     show('appScreen');await refreshDashboard(false);
   }catch(e){notify(errText(e),true);show('authScreen')}
 }
 async function logout(){
   if(!state.db)return;
   const r=await state.db.auth.signOut();
   if(r.error)notify(errText(r.error),true);
   else {state.user=null;state.profile=null;show('authScreen');notify('已登出')}
 }
 function chooseTab(tab){
   if(tab==='admin'&&!canAdmin())return;
   state.tab=tab;
   $('casesPage').hidden=tab!=='cases';$('adminPage').hidden=tab!=='admin';
   $('casesTab').classList.toggle('active',tab==='cases');
   $('adminTab').classList.toggle('active',tab==='admin');
 }
 async function refreshDashboard(message=true){
   if(!state.profile?.active)return;
   try{
     const db=state.db;
     const [c,r,reads]=await Promise.all([
       db.from('cases').select('id,name,area,service,focus,note,created_at').order('created_at',{ascending:false}),
       db.from('handovers').select('id,case_id,author_name,kind,risk,summary,description,expires_on,created_at').order('created_at',{ascending:false}).limit(1000),
       db.from('case_reads').select('case_id,read_at').eq('user_id',state.user.id)
     ]);
     state.cases=await checkQuery(c,'讀取個案');
     state.records=await checkQuery(r,'讀取交班');
     state.reads=await checkQuery(reads,'取得已讀狀態');
     if(!state.cases.some(x=>x.id===state.current))state.current=state.cases[0]?.id||null;
     renderCaseList();renderDetail();
     if(message)notify('資料已更新');
   }catch(e){notify(errText(e),true)}
 }
 function recordsFor(id){return state.records.filter(r=>r.case_id===id)}
 function isUnread(c){
   const r=recordsFor(c.id)[0];if(!r)return false;
   const seen=state.reads.find(x=>x.case_id===c.id);
   return !seen||new Date(seen.read_at)<new Date(r.created_at);
 }
 function renderCaseList(){
   const term=$('caseSearch').value.trim().toLowerCase();
   const cases=state.cases.filter(x=>(x.id+x.name+x.area).toLowerCase().includes(term));
   $('caseList').innerHTML=cases.map(c=>'<button type="button" class="case-button '+(state.current===c.id?'active':'')+'" data-case="'+esc(c.id)+'"><strong>'+esc(c.name)+(isUnread(c)?'<span class="pill">待閱</span>':'')+'</strong><small>'+esc(c.id)+'｜'+esc(c.area)+' · '+esc(c.service)+'</small></button>').join('')||'<p class="muted">沒有符合條件的個案。管理員可先建立個案，並指派服務人員。</p>';
 }
 function renderDetail(){
   const c=selectedCase(),root=$('caseDetail');
   if(!c){root.innerHTML='<h2>尚無個案</h2><p class="muted">請由管理員建立個案並完成指派，才會顯示交班內容。</p>';return;}
   const rec=recordsFor(c.id);
   const focus=Array.isArray(c.focus)?c.focus:[];
   const rlist=rec.map(r=>{
     const badge=r.risk==='一般'?'':('<span class="pill '+(r.risk==='緊急'?'critical':'')+'">'+esc(r.risk)+'</span>');
     return '<article class="record"><div class="record-head"><strong>'+esc(r.summary)+' '+badge+'</strong><small>'+when(r.created_at)+'</small></div><small>'+esc(r.kind)+'｜記錄人：'+esc(r.author_name)+'</small><p>'+esc(r.description)+'</p>'+(r.expires_on?'<small>提醒期限：'+esc(r.expires_on)+'</small>':'')+'</article>';
   }).join('');
   const focusHtml=focus.map(item=>'<div class="focus-item"><strong>'+esc(Array.isArray(item)?item[0]:item?.title)+'</strong>'+esc(Array.isArray(item)?item[1]:item?.body)+'</div>').join('');
   root.innerHTML='<div class="toolbar"><div><h2>'+esc(c.name)+'</h2><div class="help">'+esc(c.id)+' · '+esc(c.area)+'｜'+esc(c.service)+'</div></div><button class="btn" type="button" id="newHandoverBtn">＋ 新增交班</button></div>'
      +'<h3>固定照顧重點</h3>'+(focusHtml||'<p class="muted">尚未設定固定重點</p>')+(c.note?'<div class="msg error">'+esc(c.note)+'</div>':'')
      +'<div class="toolbar" style="margin-top:21px"><h3>歷史交班（'+rec.length+' 筆）</h3><div class="action-inline">'+(isUnread(c)?'<span class="pill">有未讀紀錄</span><button class="btn alt" id="readCaseBtn" type="button">✓ 我已閱讀</button>':'<span class="pill ok">最新交班已讀</span>')+'</div></div>'
      +'<div class="help">交班依建立時間排序；原始紀錄不允許從使用者端修改或刪除。</div>'+(rlist||'<p class="muted">目前尚無交班紀錄。</p>');
   $('newHandoverBtn').addEventListener('click',openHandover);
   if($('readCaseBtn'))$('readCaseBtn').addEventListener('click',markRead);
 }
 function openHandover(){if(!selectedCase())return;$('handoverForm').reset();$('handoverTitle').textContent='新增交班｜'+selectedCase().name;$('handoverLayer').hidden=false;document.body.style.overflow='hidden';$('recordSummary').focus()}
 function closeHandover(){$('handoverLayer').hidden=true;document.body.style.overflow=''}
 async function saveHandover(e){
   e.preventDefault();const c=selectedCase();if(!c)return;
   const risk=$('recordRisk').value;
   if(risk==='緊急'&&!$('urgentAck').checked){notify('重大異常須先通知督導，再勾選確認',true);return}
   const payload={case_id:c.id,kind:$('recordKind').value,risk,summary:$('recordSummary').value.trim(),description:$('recordDescription').value.trim(),expires_on:$('recordExpires').value||null};
   if(!payload.summary||payload.description.length<8){notify('請填寫完整交班主旨與至少 8 字的內容',true);return}
   const b=$('submitRecord');b.disabled=true;
   try{
     await checkQuery(await state.db.from('handovers').insert(payload),'儲存交班');
     closeHandover();await refreshDashboard(false);notify('交班已寫入資料庫，其他已指派人員可讀取');
   }catch(error){notify(errText(error),true)}finally{b.disabled=false}
 }
 async function markRead(){
   const c=selectedCase();if(!c)return;
   try{await checkQuery(await state.db.rpc('mark_case_read',{p_case_id:c.id}),'標記已讀');await refreshDashboard(false);notify('已讀時間已儲存在資料庫')}
   catch(e){notify(errText(e),true)}
 }
 async function loadAdmin(){
   if(!canAdmin())return;
   const [p,a]=await Promise.all([
     state.db.from('profiles').select('id,display_name,role,active,created_at').order('created_at',{ascending:false}),
     state.db.from('case_assignments').select('case_id,user_id,created_at').order('created_at',{ascending:false})
   ]);
   state.profiles=await checkQuery(p,'取得帳號清單');
   state.assignments=await checkQuery(a,'取得指派清單');
   await refreshDashboard(false);
   renderUsers();renderAssignControls();
 }
 function renderUsers(){
   $('usersBody').innerHTML=state.profiles.map(p=>{
     const self=p.id===state.user.id;
     const options=Object.keys(roles).map(role=>'<option value="'+role+'" '+(p.role===role?'selected':'')+'>'+roles[role]+'</option>').join('');
     return '<tr><td><input type="text" data-display-name="'+esc(p.id)+'" aria-label="員工姓名" maxlength="80" value="'+esc(p.display_name)+'" '+(self?'disabled':'')+'><small class="muted">'+esc(p.id.slice(0,8))+'…</small>'+(self?' <span class="pill ok">自己</span>':'')+'</td><td><select data-role="'+esc(p.id)+'" '+(self?'disabled':'')+'>'+options+'</select></td><td><input type="checkbox" aria-label="啟用 '+esc(p.display_name)+'" data-active="'+esc(p.id)+'" '+(p.active?'checked':'')+' '+(self?'disabled':'')+'></td><td><button type="button" class="btn alt" data-save-profile="'+esc(p.id)+'" '+(self?'disabled':'')+'>儲存</button></td></tr>';
   }).join('')||'<tr><td colspan="4">尚無帳號</td></tr>';
 }
 async function saveProfileFromRow(e){
   const b=e.target.closest('[data-save-profile]');if(!b)return;
   const id=b.dataset.saveProfile;
   if(id===state.user.id){notify('不能停用或變更自己的管理員權限',true);return}
   const role=$('usersBody').querySelector('select[data-role="'+id+'"]')?.value;
   const active=$('usersBody').querySelector('input[data-active="'+id+'"]')?.checked;
   const display_name=$('usersBody').querySelector('input[data-display-name="'+id+'"]')?.value?.trim();
   if(!display_name){notify('請先填寫員工姓名再儲存',true);return}
   b.disabled=true;
   try{
     await checkQuery(await state.db.from('profiles').update({role,active,display_name}).eq('id',id),'儲存帳號權限');
     await loadAdmin();notify('已更新帳號角色及啟用狀態');
   }catch(err){notify(errText(err),true)}finally{b.disabled=false}
 }
 function focusFromText(text){
   return text.split(/\r?\n/).filter(v=>v.trim()).map(line=>{
     const parts=line.split('|');return [parts.shift().trim(),parts.join('|').trim()];
   }).filter(x=>x[0]||x[1]).slice(0,30);
 }
 function focusToText(arr){return (Array.isArray(arr)?arr:[]).map(x=>Array.isArray(x)?x.join(' | '):[x.title,x.body].join(' | ')).join('\n')}
 async function saveCase(e){
   e.preventDefault();if(!canAdmin())return;
   const payload={id:$('manageCaseId').value.trim(),name:$('manageCaseName').value.trim(),area:$('manageArea').value.trim(),service:$('manageService').value.trim(),focus:focusFromText($('manageFocus').value),note:$('manageNote').value.trim()};
   const btn=$('saveCaseBtn');btn.disabled=true;
   try{
     if(state.editing){
       const {id,...changes}=payload;
       await checkQuery(await state.db.from('cases').update(changes).eq('id',state.editing),'修改個案');
     }else{
       await checkQuery(await state.db.from('cases').insert(payload),'新增個案');
     }
     clearCaseForm();await loadAdmin();notify('個案已儲存');
   }catch(error){notify(errText(error),true)}finally{btn.disabled=false}
 }
 function clearCaseForm(){state.editing=null;$('caseForm').reset();$('manageCaseId').readOnly=false;$('saveCaseBtn').textContent='新增個案'}
 function editCase(id){
   const c=state.cases.find(x=>x.id===id);if(!c)return;
   state.editing=id;
   $('manageCaseId').value=c.id;$('manageCaseId').readOnly=true;
   $('manageCaseName').value=c.name;$('manageArea').value=c.area;
   $('manageService').value=c.service;$('manageFocus').value=focusToText(c.focus);
   $('manageNote').value=c.note;$('saveCaseBtn').textContent='儲存修改';
   $('caseForm').scrollIntoView({behavior:'smooth',block:'center'});
 }
 function renderAssignControls(){
   const current=$('assignCase').value;
   $('assignCase').innerHTML=state.cases.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.id)+'｜'+esc(c.name)+'</option>').join('');
   if(state.cases.some(x=>x.id===current))$('assignCase').value=current;
   $('assignUser').innerHTML=state.profiles.filter(p=>p.active).map(p=>'<option value="'+esc(p.id)+'">'+esc(p.display_name)+'｜'+(roles[p.role]||p.role)+'</option>').join('');
   renderAssignedList();
   let editBtn=$('editCaseChoice');
   if(!editBtn){
     editBtn=document.createElement('button');editBtn.type='button';editBtn.className='btn alt';editBtn.id='editCaseChoice';editBtn.style.marginLeft='8px';editBtn.textContent='編輯所選個案';
     $('assignForm').querySelector('button[type="submit"]').after(editBtn);
     editBtn.addEventListener('click',()=>editCase($('assignCase').value));
   }
 }
 function renderAssignedList(){
   const id=$('assignCase').value;
   const links=state.assignments.filter(a=>a.case_id===id);
   $('assignedList').innerHTML='<h3>目前已指派 '+links.length+' 位人員</h3>'+(links.length?'<table><thead><tr><th>人員</th><th>狀態</th><th>操作</th></tr></thead><tbody>'+links.map(a=>{
      const p=state.profiles.find(x=>x.id===a.user_id);
      return '<tr><td>'+esc(p?.display_name||a.user_id.slice(0,8))+'</td><td>'+(p?.active?'已啟用':'未啟用')+'</td><td><button class="btn warn" type="button" data-remove-user="'+esc(a.user_id)+'" data-remove-case="'+esc(a.case_id)+'">取消指派</button></td></tr>';
   }).join('')+'</tbody></table>':'<p class="muted">尚未指派任何人員。</p>');
 }
 async function saveAssignment(e){
   e.preventDefault();
   const case_id=$('assignCase').value,user_id=$('assignUser').value;
   if(!case_id||!user_id)return notify('請先選擇個案及人員',true);
   try{
     await checkQuery(await state.db.from('case_assignments').insert({case_id,user_id}),'指派服務人員');
     await loadAdmin();notify('已完成指派');
   }catch(err){notify(errText(err),true)}
 }
 async function removeAssignment(e){
   const btn=e.target.closest('[data-remove-user]');if(!btn)return;
   if(!window.confirm('確定取消此人員的個案閱覽權限？'))return;
   btn.disabled=true;
   try{
     await checkQuery(await state.db.from('case_assignments').delete().eq('case_id',btn.dataset.removeCase).eq('user_id',btn.dataset.removeUser),'取消指派');
     await loadAdmin();notify('已取消指派');
   }catch(err){notify(errText(err),true)}finally{btn.disabled=false}
 }
 init().catch(e=>{show('authScreen');authMessage('系統初始化失敗：'+errText(e),true)});
})();
