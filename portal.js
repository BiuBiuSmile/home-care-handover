/* 安護交班 secure portal — browser uses only Supabase publishable/anon key.
 * Patient/case access is enforced by PostgreSQL RLS, NOT by front-end controls.
 * No service_role secret, admin impersonation, or production data in this file.
 */
'use strict';
(function(){
 const $ = id => document.getElementById(id);
 const config = window.CARE_CONFIG || {};
 const state = {db:null,user:null,profile:null,cases:[],records:[],reads:[],profiles:[],assignments:[],current:null,editing:null,tab:'cases',resetTarget:null,deleteTarget:null,caseOpen:false,casePage:1,caseFilter:'all',caseSort:'attention',caseView:'cards',browserScroll:0};
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
   ['authScreen','changeScreen','pendingScreen','appScreen'].forEach(x=>$(x).hidden=x!==screen);
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
   $('changePasswordForm').addEventListener('submit',changeFirstPassword);
   $('changeLogout').addEventListener('click',logout);
   $('provisionForm').addEventListener('submit',createStaffAccount);
   $('showStaffPassword').addEventListener('change',v=>{
     const type=$('showStaffPassword').checked?'text':'password';
     $('staffPassword').type=type;$('staffPasswordConfirm').type=type;
   });
   $('resetPasswordForm').addEventListener('submit',submitResetPassword);
   $('deleteUserForm').addEventListener('submit',submitDeleteUser);
   $('cancelDeleteUser').addEventListener('click',closeDeleteUser);
   $('deleteUserConfirm').addEventListener('input',()=>{
     $('confirmDeleteUser').disabled=$('deleteUserConfirm').value.trim()!=='刪除';
   });
   $('deleteUserLayer').addEventListener('click',e=>{if(e.target===$('deleteUserLayer'))closeDeleteUser()});
   $('cancelResetPassword').addEventListener('click',closeResetPassword);
   $('showResetPassword').addEventListener('change',()=>{
     const type=$('showResetPassword').checked?'text':'password';
     $('resetPassword').type=type;$('resetPasswordConfirm').type=type;
   });
   $('resetPasswordLayer').addEventListener('click',e=>{if(e.target===$('resetPasswordLayer'))closeResetPassword();});
   $('pendingReload').addEventListener('click',refreshIdentity);
   $('pendingLogout').addEventListener('click',logout);
   $('logoutBtn').addEventListener('click',logout);
   $('casesTab').addEventListener('click',()=>chooseTab('cases'));
   $('adminTab').addEventListener('click',async()=>{chooseTab('admin');try{await loadAdmin()}catch(e){notify(errText(e),true)}});
   $('reloadAdmin').addEventListener('click',async()=>{try{await loadAdmin();notify('已更新管理資料')}catch(e){notify(errText(e),true)}});
   $('adminUserSearch').addEventListener('input',renderUsers);
   $('adminUserRoleFilter').addEventListener('change',renderUsers);
   $('refreshBtn').addEventListener('click',()=>refreshDashboard());
   $('caseSearch').addEventListener('input',()=>{state.casePage=1;renderCaseList()});
   $('caseFilter').addEventListener('change',value=>{state.caseFilter=$('caseFilter').value;state.casePage=1;renderCaseList()});
   $('caseSort').addEventListener('change',()=>{state.caseSort=$('caseSort').value;state.casePage=1;renderCaseList()});
   $('caseCardView').addEventListener('click',()=>setCaseView('cards'));
   $('caseRowView').addEventListener('click',()=>setCaseView('rows'));
   $('casePrev').addEventListener('click',()=>{if(state.casePage>1){state.casePage--;renderCaseList();scrollBrowserTop()}});
   $('caseNext').addEventListener('click',()=>{state.casePage++;renderCaseList();scrollBrowserTop()});
   $('backToCases').addEventListener('click',showCaseBrowser);
   $('caseList').addEventListener('click', e=>{
     const b=e.target.closest('[data-case]');if(!b)return;
     showCaseDetail(b.dataset.case);
   });
   $('caseForm').addEventListener('submit',saveCase);
   $('clearCaseBtn').addEventListener('click',clearCaseForm);
   $('assignForm').addEventListener('submit',saveAssignment);
   $('assignCase').addEventListener('change',renderAssignedList);
   $('usersBody').addEventListener('change',e=>{
     const checkbox=e.target.closest('input[data-active]');
     if(checkbox){const label=checkbox.closest('.staff-state')?.querySelector('span');if(label)label.textContent=checkbox.checked?'已啟用':'已停用'}
   });
   $('usersBody').addEventListener('click',e=>{
     const b=e.target.closest('[data-reset-profile]');
     if(b){openResetPassword(b.dataset.resetProfile);return}
     const del=e.target.closest('[data-delete-profile]');
     if(del){openDeleteUser(del.dataset.deleteProfile);return}
     saveProfileFromRow(e);
   });
   $('assignedList').addEventListener('click',removeAssignment);
   $('handoverForm').addEventListener('submit',saveHandover);
   $('cancelRecord').addEventListener('click',closeHandover);
   $('handoverLayer').addEventListener('click',e=>{if(e.target===$('handoverLayer'))closeHandover()});
   document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeHandover();closeResetPassword();closeDeleteUser()}});
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
 async function handleAuth(e){
   e.preventDefault();if(!state.db)return;
   const form=$('authForm'),password=$('password').value;
   setBusy(form,true);
   try{
     const phone=phoneE164($('phone').value);
     await checkQuery(await state.db.auth.signInWithPassword({phone,password}),'登入驗證');
     $('password').value='';
     await refreshIdentity();
   }catch(error){
     authMessage('登入失敗，請確認管理員已建立此帳號，以及手機號碼和密碼是否正確。',true);
   }finally{setBusy(form,false)}
 }
 async function changeFirstPassword(e){
   e.preventDefault();if(!state.db || !state.user)return;
   const password=$('newPassword').value;
   const confirm=$('confirmPassword').value;
   const box=$('changeMessage');
   const fail=m=>{box.textContent=m;box.className='msg error'};
   if(password.length<10 || password.length>72)return fail('新密碼請設定 10～72 個字元');
   if(password!==confirm)return fail('兩次輸入的新密碼不一致');
   if(/^[a-z][12]\d{8}$/i.test(password))return fail('新密碼不能使用身分證字號');
   const form=$('changePasswordForm');setBusy(form,true);
   try{
     await checkQuery(await state.db.auth.updateUser({password}),'設定新密碼');
     form.reset();
     await refreshIdentity();
     notify('已設定個人密碼，可以開始使用系統');
   }catch(error){fail(errText(error))}
   finally{setBusy(form,false)}
 }
 function validateManagerPassword(password,phone){
   if(password.length<10||password.length>72)return '密碼須為 10～72 字元';
   if(!/[A-Za-z]/.test(password)||!/[0-9]/.test(password))return '密碼須包含英文字母與數字';
   if(phone && (password.includes(phone.slice(-9))||password.includes('0'+phone.slice(-9))))return '密碼不能包含員工手機號碼';
   return '';
 }
 async function invokeAdminUser(body){
   const {data,error}=await state.db.functions.invoke('admin-create-staff',{body});
   if(error){
     let message='伺服器操作失敗，請確認管理員權限與密碼規則';
     try{
       const detail=await error.context?.json();
       if(typeof detail?.message==='string')message=detail.message;
     }catch{}
     throw Error(message);
   }
   if(!data || typeof data.message!=='string')throw Error('後端未回傳完整結果');
   return data;
 }
 async function createStaffAccount(e){
   e.preventDefault();if(!canAdmin())return;
   const form=$('provisionForm'),display_name=$('staffName').value.trim();
   let phone;
   try{phone=phoneE164($('staffPhone').value)}catch(error){notify(errText(error),true);return}
   const role=$('staffRole').value;
   const password=$('staffPassword').value;
   const confirm=$('staffPasswordConfirm').value;
   if(!display_name||!['staff','supervisor'].includes(role))return notify('請完整填寫姓名、手機與角色',true);
   const issue=validateManagerPassword(password,phone);
   if(issue)return notify(issue,true);
   if(password!==confirm)return notify('兩次輸入的密碼不一致',true);
   $('createdStaffSuccess').hidden=true;
   setBusy(form,true);
   try{
     const result=await invokeAdminUser({action:'create',display_name,phone,role,password});
     if(!result.user_id)throw Error('伺服器未確認帳號已建立');
     form.reset();$('staffPassword').type='password';$('staffPasswordConfirm').type='password';
     $('createdStaffSuccess').hidden=false;
     await loadAdmin();
     notify('帳號建立成功，員工可直接使用管理員設定的密碼登入');
   }catch(error){notify(errText(error),true)}
   finally{
     $('staffPassword').value='';$('staffPasswordConfirm').value='';
     setBusy(form,false);
   }
 }
 function openDeleteUser(id){
   if(!canAdmin() || id===state.user?.id)return notify('不能刪除自己的管理員帳號',true);
   const p=state.profiles.find(x=>x.id===id);
   if(!p || !['staff','supervisor'].includes(p.role))return notify('僅能刪除居服員或居督帳號；管理員帳號受到保護',true);
   state.deleteTarget=id;
   $('deleteUserName').textContent=p.display_name;
   $('deleteUserForm').reset();
   $('confirmDeleteUser').disabled=true;
   $('deleteUserLayer').hidden=false;
   $('deleteUserConfirm').focus();
 }
 function closeDeleteUser(){
   state.deleteTarget=null;
   $('deleteUserForm').reset();
   $('deleteUserLayer').hidden=true;
   $('confirmDeleteUser').disabled=true;
 }
 async function submitDeleteUser(e){
   e.preventDefault();
   if(!canAdmin()||!state.deleteTarget)return;
   const id=state.deleteTarget;
   const target=state.profiles.find(x=>x.id===id);
   if(id===state.user.id || !target || !['staff','supervisor'].includes(target.role)){
     return notify('此帳號不可刪除',true);
   }
   if($('deleteUserConfirm').value.trim()!=='刪除'){
     return notify('請輸入「刪除」後再確認',true);
   }
   const form=$('deleteUserForm');
   setBusy(form,true);
   try{
     const data=await invokeAdminUser({action:'delete_user',user_id:id,confirm:'刪除'});
     closeDeleteUser();
     notify(data.message||'員工帳號已刪除，交班歷史資料仍保留');
     await loadAdmin();
   }catch(error){notify(errText(error),true)}
   finally{
     setBusy(form,false);
     $('confirmDeleteUser').disabled=$('deleteUserConfirm').value.trim()!=='刪除';
   }
 }
 function openResetPassword(id){
   if(!canAdmin())return;
   const p=state.profiles.find(x=>x.id===id);
   if(!p || !['staff','supervisor'].includes(p.role))return notify('只有居服員或居督的密碼可以在此重設',true);
   state.resetTarget=id;
   $('resetStaffName').textContent=p.display_name;
   $('resetPasswordForm').reset();
   $('resetPassword').type='password';$('resetPasswordConfirm').type='password';
   $('resetPasswordLayer').hidden=false;
   $('resetPassword').focus();
 }
 function closeResetPassword(){
   state.resetTarget=null;
   $('resetPasswordForm').reset();
   $('resetPassword').type='password';$('resetPasswordConfirm').type='password';
   $('resetPasswordLayer').hidden=true;
 }
 async function submitResetPassword(e){
   e.preventDefault();if(!canAdmin()||!state.resetTarget)return;
   const target=state.profiles.find(x=>x.id===state.resetTarget);
   if(!target||!['staff','supervisor'].includes(target.role))return notify('無法重設這個帳號',true);
   const password=$('resetPassword').value,confirm=$('resetPasswordConfirm').value;
   const issue=validateManagerPassword(password,null);
   if(issue)return notify(issue,true);
   if(password!==confirm)return notify('兩次輸入的密碼不一致',true);
   const form=$('resetPasswordForm'),user_id=state.resetTarget;
   setBusy(form,true);
   try{
     await invokeAdminUser({action:'reset_password',user_id,password});
     closeResetPassword();
     notify('密碼已更新，請私下告知員工。舊密碼無法再用於重新登入');
   }catch(error){notify(errText(error),true)}
   finally{
     $('resetPassword').value='';$('resetPasswordConfirm').value='';
     setBusy(form,false);
   }
 }
 async function setSession(session){
   if(!session?.user){
     window.CareCollab?.destroy();
     state.user=null;state.profile=null;state.cases=[];state.records=[];state.reads=[];
     state.current=null;state.caseOpen=false;state.casePage=1;
     $('caseBrowser').hidden=false;$('caseFocus').hidden=true;
     show('authScreen');return;
   }
   if(state.user?.id!==session.user.id){
     window.CareCollab?.destroy();
     state.cases=[];state.records=[];state.reads=[];state.current=null;
     state.caseOpen=false;state.casePage=1;state.browserScroll=0;
     $('caseBrowser').hidden=false;$('caseFocus').hidden=true;
   }
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
     const r=await state.db.from('profiles').select('id,display_name,role,active,must_change_password').eq('id',user.id).single();
     state.profile=await checkQuery(r,'取得帳號權限');
     if(state.profile.must_change_password){show('changeScreen');return;}
     if(!state.profile.active){
       $('pendingTitle').textContent='帳號尚未啟用';
       $('pendingMessage').textContent='已登入 '+(state.profile.display_name||user.phone||user.email)+'，但管理員尚未啟用您的帳號。請先完成審核，開通後再指派個案。';
       show('pendingScreen');return;
     }
     $('identity').textContent=state.profile.display_name+'｜'+(roles[state.profile.role]||state.profile.role);
     $('adminTab').hidden=!canAdmin();
     await refreshDashboard(false);show('appScreen');
   }catch(e){notify(errText(e),true);show('authScreen')}
 }
 async function logout(){
   if(!state.db)return;
   const r=await state.db.auth.signOut();
   if(r.error)notify(errText(r.error),true);
   else {state.user=null;state.profile=null;closeDeleteUser();closeResetPassword();$('provisionForm').reset();show('authScreen');notify('已登出')}
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
       db.from('cases').select('id,name,area,service,status,supervisor_name,caregiver_name,focus,note,created_at').order('created_at',{ascending:false}),
       db.from('handovers').select('id,case_id,author_name,kind,risk,summary,description,expires_on,created_at').order('created_at',{ascending:false}).limit(1000),
       db.from('case_reads').select('case_id,read_at').eq('user_id',state.user.id)
     ]);
     state.cases=await checkQuery(c,'讀取個案');
     state.records=await checkQuery(r,'讀取交班');
     state.reads=await checkQuery(reads,'取得已讀狀態');
     if(!state.cases.some(x=>x.id===state.current))state.current=state.cases[0]?.id||null;
     renderCaseList();if(state.caseOpen)renderDetail();
     if(message)notify('資料已更新');
   }catch(e){notify(errText(e),true)}
 }
 function recordsFor(id){return state.records.filter(r=>r.case_id===id)}
 function isUnread(c){
   const r=recordsFor(c.id)[0];if(!r)return false;
   const seen=state.reads.find(x=>x.case_id===c.id);
   return !seen||new Date(seen.read_at)<new Date(r.created_at);
 }
 function setCaseView(view){
   state.caseView=view;
   state.casePage=1;
   $('caseCardView').classList.toggle('active',view==='cards');
   $('caseRowView').classList.toggle('active',view==='rows');
   $('caseCardView').setAttribute('aria-pressed',String(view==='cards'));
   $('caseRowView').setAttribute('aria-pressed',String(view==='rows'));
   renderCaseList();
 }
 function scrollBrowserTop(){
   const top=$('caseBrowser').getBoundingClientRect().top+window.scrollY-12;
   window.scrollTo({top:Math.max(0,top),behavior:'smooth'});
 }
 function showCaseBrowser(){
   state.caseOpen=false;
   $('caseBrowser').hidden=false;
   $('caseFocus').hidden=true;
   window.CareCollab?.destroy();
   renderCaseList();
   window.requestAnimationFrame(()=>window.scrollTo(0,state.browserScroll||0));
 }
 function showCaseDetail(id){
   const found=state.cases.find(c=>c.id===id);
   if(!found)return notify('找不到此個案，請重新整理資料',true);
   state.browserScroll=window.scrollY;
   state.current=id;
   state.caseOpen=true;
   $('caseFocusPath').textContent='個案總覽 / '+found.name;
   $('caseBrowser').hidden=true;
   $('caseFocus').hidden=false;
   renderDetail();
   window.scrollTo({top:0,behavior:'smooth'});
 }
 function renderCaseList(){
   const text=$('caseSearch').value.trim().toLocaleLowerCase('zh-TW');
   const tokens=text.split(/\s+/).filter(Boolean);
   const filtered=state.cases.filter(c=>{
     const haystack=[c.id,c.name,c.area,c.service,c.status,c.supervisor_name,c.caregiver_name].filter(Boolean).join(' ').toLocaleLowerCase('zh-TW');
     if(!tokens.every(token=>haystack.includes(token)))return false;
     if(state.caseFilter==='unread')return isUnread(c);
     if(state.caseFilter==='recorded')return recordsFor(c.id).length>0;
     if(state.caseFilter==='paused')return c.status==='暫停';
     return true;
   });
   const lastTime=c=>recordsFor(c.id)[0]?.created_at || '';
   const order=state.caseSort;
   filtered.sort((a,b)=>{
     if(order==='attention'){
       const diff=Number(isUnread(b))-Number(isUnread(a));
       if(diff!==0)return diff;
       const recent=lastTime(b).localeCompare(lastTime(a));
       if(recent!==0)return recent;
     }else if(order==='recent'){
       const recent=lastTime(b).localeCompare(lastTime(a));
       if(recent!==0)return recent;
     }else if(order==='number'){
       return String(a.id).localeCompare(String(b.id),'zh-Hant',{numeric:true});
     }else if(order==='area'){
       const compare=String(a.area||'').localeCompare(String(b.area||''),'zh-Hant');
       if(compare!==0)return compare;
     }
     return String(a.name||'').localeCompare(String(b.name||''),'zh-Hant');
   });
   const total=filtered.length;
   const size=state.caseView==='rows'?20:12;
   const pages=Math.max(1,Math.ceil(total/size));
   state.casePage=Math.max(1,Math.min(state.casePage,pages));
   const start=(state.casePage-1)*size;
   const shown=filtered.slice(start,start+size);
   $('statCaseCount').textContent=String(state.cases.length);
   $('statUnreadCount').textContent=String(state.cases.filter(isUnread).length);
   $('statRecordedCount').textContent=String(state.cases.filter(c=>recordsFor(c.id).length>0).length);
   $('caseListSummary').textContent=total===0?'目前沒有符合條件的個案':'符合 '+total+' 位個案 · 顯示 '+(start+1)+'–'+(start+shown.length)+' 位';
   $('caseList').classList.toggle('row-mode',state.caseView==='rows');
   $('caseList').innerHTML=shown.map(c=>{
     const count=recordsFor(c.id).length;
     const latest=lastTime(c);
     const status=c.status&&c.status!=='服務中'?'<span class="tile-tag paused">'+esc(c.status)+'</span>':'';
     const unread=isUnread(c)?'<span class="tile-tag unread">● 待閱</span>':'';
     return '<button type="button" class="case-tile" data-case="'+esc(c.id)+'" aria-label="查看 '+esc(c.name)+' 的交班紀錄">'+
        '<div class="tile-top"><div><div class="tile-name">'+esc(c.name)+'</div><div class="tile-code">'+esc(c.id)+' · '+esc(c.area||'未設定區域')+'</div></div><div class="tile-tags">'+unread+status+'</div></div>'+
        '<div class="tile-subtitle">'+esc(c.service||'尚未設定服務項目')+'</div>'+
        '<div class="tile-meta">交班紀錄 '+count+' 筆'+(latest?' · 最近：'+esc(when(latest).slice(0,10)):' · 尚無交班')+'</div>'+
        '<div class="tile-bottom"><span>主責居服員：'+esc(c.caregiver_name||'未設定')+'</span><span class="tile-open">查看交班 ›</span></div>'+
      '</button>';
   }).join('')||'<div class="empty-cases">'+(state.cases.length?'沒有符合條件的個案，請調整搜尋或篩選。':'尚無可查看的個案，請由管理員建立並指派個案。')+'</div>';
   $('casePagination').hidden=pages<=1;
   $('casePrev').disabled=state.casePage<=1;
   $('caseNext').disabled=state.casePage>=pages;
   $('casePageLabel').textContent='第 '+state.casePage+' / '+pages+' 頁';
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
   root.innerHTML=
     '<div class="toolbar care-case-header"><div><h2>'+esc(c.name)+'</h2>'+
     '<div class="help">'+esc(c.id)+' · '+esc(c.area)+'｜'+esc(c.service)+'</div>'+
     '<div class="help">服務狀態：'+esc(c.status||'未設定')+'｜主責督導：'+esc(c.supervisor_name||'未設定')+'｜主責居服員：'+esc(c.caregiver_name||'未設定')+'</div></div>'+
     '<span class="care-case-hint">已指派的人員可共同交班</span></div>'+
     '<div class="care-tabs" role="tablist" aria-label="個案交班功能">'+
       '<button class="care-tab active" data-care-tab="guide" role="tab" aria-selected="true" type="button">照顧檔案</button>'+
       '<button class="care-tab" data-care-tab="discussion" role="tab" aria-selected="false" type="button">交班討論</button>'+
       '<button class="care-tab" data-care-tab="history" role="tab" aria-selected="false" type="button">正式交班 <span class="care-tab-count">'+rec.length+'</span></button>'+
     '</div>'+
     '<section data-care-panel="guide" class="care-tab-panel">'+
       '<div class="care-section-head"><div><h3>原有固定照顧重點</h3><p>由管理員在個案資料中維護，供新接班者快速閱讀。</p></div></div>'+
       '<div class="care-entry-grid">'+(focusHtml||'<p class="care-empty">尚未設定原有固定重點。</p>')+'</div>'+
       (c.note?'<div class="msg error">'+esc(c.note)+'</div>':'')+
       '<div id="careGuideResults"><p class="care-empty">正在載入照顧重點…</p></div>'+
       '<section class="care-input-panel"><h3>＋ 提交新的照顧重點</h3><p class="help">已指派的居服員可提出日常照顧建議。經居督或管理員審核後才列入正式照顧重點。</p>'+
         '<form id="careGuideForm">'+
           '<div class="split"><div class="field"><label for="guideCategory">重點類別</label><select id="guideCategory" required><option>生活習慣</option><option>備餐與飲食</option><option>移位與安全</option><option>沐浴清潔</option><option>溝通與家屬</option><option>其他</option></select></div>'+
           '<div class="field"><label for="guideTitle">重點標題</label><input id="guideTitle" required minlength="2" maxlength="100" placeholder="例如：洗澡前先確認防滑椅"></div></div>'+
           '<div class="field"><label for="guideDetail">具體照顧方式與注意事項</label><textarea id="guideDetail" required minlength="5" maxlength="2000" rows="4" placeholder="描述已確認的照顧習慣與注意事項。請只填必要資訊，不輸入身分證、電話等非必要個資。"></textarea></div>'+
           '<div id="guideNotice" class="care-notice" role="status" hidden></div>'+
           '<div class="care-form-actions"><button class="btn" id="guideSaveBtn" type="submit">提交重點給居督確認</button></div>'+
         '</form></section>'+
     '</section>'+
     '<section data-care-panel="discussion" id="careDiscussionPanel" class="care-tab-panel" hidden>'+
       '<div class="care-section-head"><div><h3>個案交班討論 <span class="care-count" id="discussionCount">0 則討論</span></h3><p>向同一個案的已指派同仁發問或回覆；原始對話會保留，後續代班者可查閱。</p></div><button class="btn alt care-mini" id="refreshDiscussionBtn" type="button">↻ 更新對話</button></div>'+
       '<div class="care-urgent-note">注意：急迫異常、跌倒受傷或服務安全事件，仍須依機構規定立即聯絡督導，不得僅在討論區留言。</div>'+
       '<div id="careDiscussionList" class="care-discussion-list"><p class="care-empty">正在載入討論…</p></div>'+
       '<form id="careDiscussionForm" class="care-chat-form">'+
         '<h4>新增交班討論</h4><div id="discussionReply" class="care-reply-quote" hidden></div>'+
         '<div class="split"><div class="field"><label for="discussionType">訊息類型</label><select id="discussionType"><option>問題</option><option>回覆</option><option>補充</option></select></div>'+
         '<div class="field care-reply-cancel"><label>回覆設定</label><button class="btn alt" id="discussionCancelReply" type="button">取消指定回覆</button></div></div>'+
         '<div class="field"><label for="discussionBody">交班內容</label><textarea id="discussionBody" minlength="2" maxlength="3000" rows="4" required placeholder="例如：明天代班想確認個案沐浴時是否需要使用防滑椅？"></textarea></div>'+
         '<div id="discussionNotice" class="care-notice" role="status" hidden></div>'+
         '<div class="care-form-actions"><span class="help">討論內容不會自動變成正式照顧指示。</span><button class="btn" id="discussionSendBtn" type="submit">送出討論</button></div>'+
       '</form>'+
     '</section>'+
     '<section data-care-panel="history" class="care-tab-panel" hidden>'+
       '<div class="toolbar care-history-header"><div><h3>正式交班歷史（'+rec.length+' 筆）</h3><p class="help">按建立時間排序；原始紀錄保留，不允許一般使用者任意編輯或刪除。</p></div>'+
         '<div class="action-inline"><button type="button" id="newHandoverBtn" class="btn">＋ 新增正式交班</button></div></div>'+
       '<div class="toolbar care-read-toolbar"><span class="help">代班者完成查閱後，請手動確認已讀。</span>'+
         (isUnread(c)?'<button class="btn alt" id="readCaseBtn" type="button">✓ 我已閱讀正式交班</button>':'<span class="pill ok">最新正式交班已讀</span>')+'</div>'+
       (rlist||'<p class="care-empty">目前尚無正式交班紀錄。</p>')+
     '</section>';
   $('newHandoverBtn').addEventListener('click',openHandover);
   if($('readCaseBtn'))$('readCaseBtn').addEventListener('click',markRead);
   if(window.CareCollab){
      window.CareCollab.mount({db:state.db,caseId:c.id,profile:state.profile}).catch(e=>notify('載入交班討論失敗：'+errText(e),true));
   }
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
     state.db.from('profiles').select('id,display_name,role,active,must_change_password,created_at').order('created_at',{ascending:false}),
     state.db.from('case_assignments').select('case_id,user_id,created_at').order('created_at',{ascending:false})
   ]);
   state.profiles=await checkQuery(p,'取得帳號清單');
   state.assignments=await checkQuery(a,'取得指派清單');
   await refreshDashboard(false);
   $('adminTotalUsers').textContent=String(state.profiles.length);
   $('adminActiveUsers').textContent=String(state.profiles.filter(p=>p.active).length);
   $('adminTotalCases').textContent=String(state.cases.length);
   renderUsers();renderAssignControls();
 }
 function renderUsers(){
   const query=$('adminUserSearch').value.trim().toLocaleLowerCase('zh-TW');
   const roleFilter=$('adminUserRoleFilter').value;
   const shown=state.profiles.filter(p=>{
     const matchName=String(p.display_name||'').toLocaleLowerCase('zh-TW').includes(query);
     const matchRole=roleFilter==='all'||p.role===roleFilter;
     return matchName&&matchRole;
   });
   $('adminUserSummary').textContent='顯示 '+shown.length+' / '+state.profiles.length+' 位';
   $('usersBody').innerHTML=shown.map(p=>{
     const self=p.id===state.user.id;
     const manageable=!self && (p.role==='staff'||p.role==='supervisor');
     const options=Object.keys(roles).map(role=>'<option value="'+role+'" '+(p.role===role?'selected':'')+'>'+roles[role]+'</option>').join('');
     const reset=manageable
       ? '<button type="button" class="btn alt" data-reset-profile="'+esc(p.id)+'">重設密碼</button>' : '';
     const remove=manageable
       ? '<button type="button" class="btn warn" data-delete-profile="'+esc(p.id)+'">刪除使用者</button>' : '';
     const avatar=String(p.display_name||'?').trim().slice(0,1)||'?';
     const meta=self?'<span class="pill ok staff-self">自己</span>':'<span class="staff-role-small">'+esc(roles[p.role]||p.role)+'</span>';
     return '<tr class="staff-row">'+
       '<td data-label="使用者"><div class="staff-person"><span class="staff-avatar" aria-hidden="true">'+esc(avatar)+'</span><div class="staff-person-copy"><input type="text" data-display-name="'+esc(p.id)+'" aria-label="員工姓名" maxlength="80" value="'+esc(p.display_name)+'" '+(self?'disabled':'')+'><div class="staff-subline">'+meta+'<span>'+esc(p.id.slice(0,8))+'…</span></div></div></div></td>'+
       '<td data-label="帳號角色" class="staff-role-col"><select aria-label="'+esc(p.display_name)+'的角色" data-role="'+esc(p.id)+'" '+(self?'disabled':'')+'>'+options+'</select></td>'+
       '<td data-label="使用狀態"><label class="staff-state"><input type="checkbox" aria-label="啟用 '+esc(p.display_name)+'" data-active="'+esc(p.id)+'" '+(p.active?'checked':'')+' '+(self?'disabled':'')+'><span>'+(p.active?'已啟用':'已停用')+'</span></label></td>'+
       '<td data-label="管理操作"><div class="staff-actions"><button type="button" class="btn alt" data-save-profile="'+esc(p.id)+'" '+(self?'disabled':'')+'>儲存</button>'+reset+remove+'</div></td>'+
       '</tr>';
   }).join('')||'<tr><td colspan="4" class="staff-empty">目前沒有符合條件的使用者，請調整搜尋或角色篩選。</td></tr>';
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
   const payload={id:$('manageCaseId').value.trim(),name:$('manageCaseName').value.trim(),area:$('manageArea').value.trim(),service:$('manageService').value.trim(),status:$('manageStatus').value,supervisor_name:$('manageSupervisorName').value.trim(),caregiver_name:$('manageCaregiverName').value.trim(),focus:focusFromText($('manageFocus').value),note:$('manageNote').value.trim()};
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
 function clearCaseForm(){
   state.editing=null;$('caseForm').reset();$('manageCaseId').readOnly=false;
   $('saveCaseBtn').textContent='＋ 新增個案';
   $('caseEditMode').textContent='新增模式';$('caseEditMode').classList.remove('editing');
   $('caseFormHelp').textContent='填寫完畢後儲存個案資料';
 }
 function editCase(id){
   const c=state.cases.find(x=>x.id===id);if(!c)return;
   state.editing=id;
   $('manageCaseId').value=c.id;$('manageCaseId').readOnly=true;
   $('manageCaseName').value=c.name;$('manageArea').value=c.area;
   $('manageService').value=c.service;$('manageStatus').value=c.status||'服務中';$('manageSupervisorName').value=c.supervisor_name||'';$('manageCaregiverName').value=c.caregiver_name||'';$('manageFocus').value=focusToText(c.focus);
   $('manageNote').value=c.note;$('saveCaseBtn').textContent='儲存修改';
   $('caseEditMode').textContent='編輯模式 · '+c.name;$('caseEditMode').classList.add('editing');
   $('caseFormHelp').textContent='正在編輯 '+c.name+'，儲存後將更新原有個案資料';
   $('adminCasesSection').scrollIntoView({behavior:'smooth',block:'start'});
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
