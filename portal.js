/* 安護交班 secure portal — browser uses only Supabase publishable/anon key.
 * Patient/case access is enforced by PostgreSQL RLS, NOT by front-end controls.
 * No service_role secret, admin impersonation, or production data in this file.
 */
'use strict';
(function(){
 const $ = id => document.getElementById(id);
 const config = window.CARE_CONFIG || {};
 const state = {db:null,user:null,profile:null,cases:[],records:[],reads:[],profiles:[],assignments:[],current:null,editing:null,tab:'cases',resetTarget:null,deleteTarget:null,caseOpen:false,casePage:1,caseFilter:'all',caseSort:'attention',caseView:'cards',browserScroll:0,authMode:'staff',recoveryActive:false};
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
   ['authScreen','adminRecoveryScreen','changeScreen','pendingScreen','appScreen'].forEach(x=>$(x).hidden=x!==screen);
 }
 function setBusy(form,busy){
   Array.from(form.querySelectorAll('button,input,select,textarea')).forEach(el=>el.disabled=busy);
 }
 function errText(error){return (error && error.message) ? error.message : String(error || '操作失敗');}
 function canAdmin(){return state.profile && state.profile.role==='admin' && state.profile.active;}
 function selectedCase(){return state.cases.find(x=>x.id===state.current);}
 function caseMapUrl(address){
   const value=String(address||'').trim();
   return value?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(value):'';
 }
 function renderCaseAddress(c){
   const address=String(c.address||'').trim();
   if(!address)return '<div class="case-address-row empty"><span class="case-address-label">📍 個案地址：</span><span>尚未設定</span></div>';
   const link=esc(caseMapUrl(address));
   return '<div class="case-address-row"><span class="case-address-label">📍 個案地址：</span>'+
     '<a class="case-address-link" href="'+link+'" target="_blank" rel="noopener noreferrer" title="在 Google 地圖搜尋此地址" aria-label="在 Google 地圖開啟個案地址：'+esc(address)+'">'+
     esc(address)+' <span aria-hidden="true">↗</span></a></div>';
 }
 async function checkQuery(result,action){
   if(result.error)throw new Error(action+'：'+errText(result.error));
   return result.data;
 }
 async function init(){
   window.HandoverRooms?.bindInbox();
   window.TeamPoints?.bind();
   window.CareWorkspace?.init();
   $('toggleAdminLogin').addEventListener('click',()=>setAuthMode(state.authMode==='staff'?'admin':'staff'));
   $('adminResetBtn').addEventListener('click',requestAdminPasswordRecovery);
   $('adminRecoveryForm').addEventListener('submit',submitAdminPasswordRecovery);
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
   $('rewardsTab').addEventListener('click',()=>chooseTab('rewards'));
   $('achievementsTab').addEventListener('click',()=>chooseTab('achievements'));
   $('teamPointsTab').addEventListener('click',()=>chooseTab('teamPoints'));
   $('adminTab').addEventListener('click',async()=>{chooseTab('admin');try{await loadAdmin()}catch(e){notify(errText(e),true)}});
   $('reloadAdmin').addEventListener('click',async()=>{try{await loadAdmin();notify('已更新管理資料')}catch(e){notify(errText(e),true)}});
   $('adminUserSearch').addEventListener('input',renderUsers);
   $('adminUserRoleFilter').addEventListener('change',renderUsers);
   $('adminUserSort').addEventListener('change',renderUsers);
   $('checkLoginMigration').addEventListener('click',checkStaffLoginMigration);
   $('pilotLoginMigration').addEventListener('click',()=>migrateStaffLogins(true));
   $('migrateRemainingLogins').addEventListener('click',()=>migrateStaffLogins(false));
   $('confirmPilotLogin').addEventListener('change',()=>{
     const d=state.loginMigration;
     $('migrateRemainingLogins').disabled=!$('confirmPilotLogin').checked||!d?.pending||!!d?.errors||d.converted<1;
   });
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
   $('previewPrimarySync').addEventListener('click',previewPrimaryAssignments);
   $('applyPrimarySync').addEventListener('click',applyPrimaryAssignments);
   $('assignCase').addEventListener('change',renderAssignedList);
   $('usersBody').addEventListener('change',e=>{
     const checkbox=e.target.closest('input[data-active]');
     if(checkbox){const label=checkbox.closest('.staff-state')?.querySelector('span');if(label)label.textContent=checkbox.checked?'已啟用':'已停用'}
   });
   $('usersBody').addEventListener('click',e=>{
     const points=e.target.closest('[data-view-points]');
     if(points){
       window.TeamPoints?.openUser({db:state.db,user:state.user,profile:state.profile},points.dataset.viewPoints);
       return;
     }
     const b=e.target.closest('[data-reset-profile]');
     if(b){openResetPassword(b.dataset.resetProfile);return}
     const del=e.target.closest('[data-delete-profile]');
     if(del){openDeleteUser(del.dataset.deleteProfile);return}
     saveProfileFromRow(e);
   });
   $('assignedList').addEventListener('click',removeAssignment);
   $('handoverForm').addEventListener('submit',saveHandover);
   $('recordPhotos').addEventListener('change',()=>{
     try{window.HandoverPhotos?.preview($('recordPhotos'),$('recordPhotosPreview'))}
     catch(e){notify('照片選取失敗：'+errText(e),true)}
   });
   $('cancelRecord').addEventListener('click',()=>closeHandover());
   $('handoverLayer').addEventListener('click',e=>{if(e.target===$('handoverLayer'))closeHandover()});
   document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeHandover();closeResetPassword();closeDeleteUser()}});
   if(!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || config.SUPABASE_URL.includes('YOUR_') || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.SUPABASE_URL) || !window.supabase?.createClient){
     $('configMessage').hidden=false;
     $('authSubmit').disabled=true;
     authMessage('登入尚未啟用：需要設定 Supabase 專案網址、公開金鑰與資料庫。',true);
     return;
   }
   state.db=window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
   state.recoveryActive=/[?&]type=recovery(?:&|$)/.test(window.location.hash)||/[?&]type=recovery(?:&|$)/.test(window.location.search);
   state.db.auth.onAuthStateChange((event,session)=>{
     if(event==='PASSWORD_RECOVERY'){
       state.recoveryActive=true;
       setTimeout(()=>verifyAdminRecovery().catch(e=>showRecoveryError(e)),0);
       return;
     }
     if(event==='SIGNED_IN'||event==='SIGNED_OUT'||event==='TOKEN_REFRESHED'||event==='USER_UPDATED'||event==='INITIAL_SESSION'){
       if(!state.recoveryActive)setTimeout(()=>setSession(session).catch(e=>notify(errText(e),true)),0);
     }
   });
   const result=await state.db.auth.getSession();
   await checkQuery(result,'確認登入狀態');
   if(state.recoveryActive)await verifyAdminRecovery().catch(e=>showRecoveryError(e));
   else await setSession(result.data.session);
 }
 function phoneE164(input){
   const raw=String(input||'').trim().replace(/[\s()-]/g,'');
   if(/^09\d{8}$/.test(raw))return '+886'+raw.slice(1);
   if(/^8869\d{8}$/.test(raw))return '+'+raw;
   if(/^\+8869\d{8}$/.test(raw))return raw;
   throw Error('請輸入有效的台灣手機門號，例如 0912345678 或 +886912345678');
 }
 // Synthetic login identifier is never displayed to employees and no Email is sent.
 // Keep this exact mapping in sync with the server-side admin-create-staff function.
 function internalStaffEmail(phone){
   return 'u'+phoneE164(phone).slice(1)+'@staff-login.chkia.dev';
 }
 function setAuthMode(mode){
   state.authMode=mode==='admin'?'admin':'staff';
   const isAdmin=state.authMode==='admin';
   $('staffPhoneField').hidden=isAdmin;
   $('adminEmailField').hidden=!isAdmin;
   $('phone').required=!isAdmin;
   $('adminEmail').required=isAdmin;
   $('adminResetActions').hidden=!isAdmin;
   $('staffLoginFooter').hidden=isAdmin;
   $('toggleAdminLogin').textContent=isAdmin?'返回員工登入':'管理員登入';
   $('toggleAdminLogin').setAttribute('aria-pressed',String(isAdmin));
   $('authHeading').textContent=isAdmin?'管理員登入':'員工帳號登入';
   $('authHint').textContent=isAdmin?'使用原本管理員 Email 與個人密碼登入。若尚未設定新密碼，請使用下方的密碼設定連結。':'員工使用手機號碼和個人密碼登入；帳號由管理員建立。';
   $('authSubmit').textContent=isAdmin?'管理員登入':'登入';
   $('password').value='';
   authMessage('',false);
 }
 async function handleAuth(e){
   e.preventDefault();if(!state.db || state.recoveryActive)return;
   const form=$('authForm'),password=$('password').value,isAdmin=state.authMode==='admin';
   setBusy(form,true);
   try{
     const credentials=isAdmin
       ? {email:$('adminEmail').value.trim().toLowerCase(),password}
       : {email:internalStaffEmail($('phone').value),password};
     if(isAdmin && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credentials.email)){
       throw Error('請輸入有效的管理員 Email');
     }
     // Supabase Email/Password checks the internal alias, not the disabled Phone provider.
     const result=await state.db.auth.signInWithPassword(credentials);
     if(result.error)throw result.error;
     $('password').value='';
     await refreshIdentity();
   }catch(error){
     const code=String(error?.code||'').toLowerCase();
     const message=String(error?.message||'').toLowerCase();
     if(!isAdmin && (code==='phone_provider_disabled'||message.includes('phone logins are disabled'))){
       authMessage('手機登入已停用。請管理員確認員工帳號已轉換為內部 Email 登入，不需要設定 Twilio。',true);
     }else if(code==='over_request_rate_limit'||error?.status===429){
       authMessage('登入嘗試過於頻繁，請稍後再試，不要連續重複輸入。',true);
     }else{
       authMessage('登入失敗，請確認'+(isAdmin?'管理員 Email':'手機號碼')+'與密碼是否正確。'+
         (isAdmin?'':'若剛完成改版，請先請管理員確認已完成原員工帳號轉換。'),true);
     }
   }finally{setBusy(form,false)}
 }
 async function requestAdminPasswordRecovery(){
   if(!state.db || state.authMode!=='admin')return;
   const email=$('adminEmail').value.trim().toLowerCase();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
     authMessage('請先輸入管理員原本使用的 Email。',true);
     $('adminEmail').focus();return;
   }
   const button=$('adminResetBtn');button.disabled=true;
   let rateLimited=false;
   try{
     const redirectTo=window.location.origin+window.location.pathname;
     // Keep the structured Auth error; checkQuery() wraps it and loses its 429/code.
     const result=await state.db.auth.resetPasswordForEmail(email,{redirectTo});
     if(result.error)throw result.error;
     authMessage('如果此 Email 存在有效帳號，密碼設定連結將寄至該信箱。請點擊郵件連結再設定新密碼。',false);
   }catch(error){
     const code=String(error?.code||'').toLowerCase();
     const status=Number(error?.status||0);
     if(status===429||code==='over_email_send_rate_limit'||code==='over_request_rate_limit'){
       rateLimited=true;
       authMessage('Supabase 目前已達驗證信寄送額度（429）。請先查看之前收到的管理員密碼設定信；若沒有可用的信件，建議約一小時後再試。這不是密碼格式或跳轉網址錯誤。',true);
     }else if(code.includes('redirect')||code.includes('url_not_allowed')){
       authMessage('密碼重設信的返回網址尚未獲 Supabase 允許，請管理員到 Authentication → URL Configuration 檢查 Redirect URLs。',true);
     }else{
       authMessage('目前無法寄送密碼設定信。請確認 Supabase Email 寄送設定；若持續發生，請提供詳細錯誤資訊以便查核。',true);
     }
   }finally{
     if(rateLimited){
       const originalLabel=button.textContent;
       button.textContent='寄信額度限制中，請稍後重試';
       window.setTimeout(()=>{button.disabled=false;button.textContent=originalLabel},90000);
     }else button.disabled=false;
   }
 }
 function showRecoveryError(error){
   state.recoveryActive=false;
   setAuthMode('admin');
   show('authScreen');
   authMessage('管理員密碼設定連結無效或已過期，請重新申請。',true);
 }
 async function verifyAdminRecovery(){
   if(!state.db||!state.recoveryActive)return;
   const {data,error}=await state.db.auth.getUser();
   if(error||!data?.user)throw Error('連結未成功驗證');
   const profile=await state.db.from('profiles').select('role,active').eq('id',data.user.id).single();
   if(profile.error||profile.data?.role!=='admin'||!profile.data?.active){
     await state.db.auth.signOut();
     throw Error('非有效管理員');
   }
   $('adminRecoveryNotice').textContent='';
   show('adminRecoveryScreen');
 }
 async function submitAdminPasswordRecovery(e){
   e.preventDefault();if(!state.db||!state.recoveryActive)return;
   const password=$('adminNewPassword').value,confirm=$('adminNewPasswordConfirm').value;
   const box=$('adminRecoveryNotice');
   if(password!==confirm){box.textContent='兩次輸入的密碼不一致。';box.className='msg error';return}
   if(password.length<10||password.length>72||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password)){
     box.textContent='新密碼須為 10～72 字元，且至少包含英文字母與數字（可使用身分證字號格式）。';box.className='msg error';return;
   }
   const form=$('adminRecoveryForm');setBusy(form,true);
   try{
     await verifyAdminRecovery();
     await checkQuery(await state.db.auth.updateUser({password}),'設定管理員密碼');
     $('adminRecoveryForm').reset();
     await checkQuery(await state.db.auth.signOut(),'完成重設後登出');
     state.recoveryActive=false;
     setAuthMode('admin');show('authScreen');
     authMessage('管理員新密碼已設定完成。請使用原本 Email 與新密碼登入。',false);
   }catch(error){
     box.textContent='設定失敗：'+errText(error);box.className='msg error';
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
   if(state.recoveryActive)return;
   if(!session?.user){
     state.tab='cases';
     window.CareCollab?.destroy();
     window.HandoverRooms?.destroy();
     window.HandoverRooms?.clearInbox();
     window.HandoverPhotos?.destroy();
     window.Rewards?.destroy();
     window.BadgeAchievements?.destroy();
     window.TeamPoints?.destroy();
     window.CareWorkspace?.destroy();
     state.user=null;state.profile=null;state.cases=[];state.records=[];state.reads=[];
     state.current=null;state.caseOpen=false;state.casePage=1;
     $('caseBrowser').hidden=false;$('caseFocus').hidden=true;
     show('authScreen');return;
   }
   if(state.user?.id!==session.user.id){
     state.tab='cases';
     window.CareCollab?.destroy();
     window.HandoverRooms?.destroy();
     window.HandoverRooms?.clearInbox();
     window.Rewards?.destroy();
     window.BadgeAchievements?.destroy();
     window.TeamPoints?.destroy();
     window.CareWorkspace?.destroy();
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
     if(state.authMode==='admin'&&state.profile.role!=='admin'){
       await state.db.auth.signOut();
       show('authScreen');
       authMessage('這個 Email 並非管理員帳號，請使用員工登入或正確的管理員帳號。',true);
       return;
     }
     if(state.profile.must_change_password){show('changeScreen');return;}
     if(!state.profile.active){
       $('pendingTitle').textContent='帳號尚未啟用';
       $('pendingMessage').textContent='已登入 '+(state.profile.display_name||user.phone||user.email)+'，但管理員尚未啟用您的帳號。請先完成審核，開通後再指派個案。';
       show('pendingScreen');return;
     }
     $('identity').textContent=state.profile.display_name+'｜'+(roles[state.profile.role]||state.profile.role);
     $('adminTab').hidden=!canAdmin();
     $('teamPointsTab').hidden=!['admin','supervisor'].includes(state.profile.role);
     if($('teamPointsTab').hidden)window.TeamPoints?.destroy();
     await refreshDashboard(false);show('appScreen');
     // 身分、Token 與資料重新載入時保留使用者目前分頁；只在登出／換帳號才回到工作台。
     chooseTab(state.tab);
   }catch(e){notify(errText(e),true);show('authScreen')}
 }
 async function logout(){
   if(!state.db)return;
   const r=await state.db.auth.signOut();
   if(r.error)notify(errText(r.error),true);
   else {state.tab='cases';window.CareCollab?.destroy();window.HandoverRooms?.destroy();window.HandoverRooms?.clearInbox();window.HandoverPhotos?.destroy();window.Rewards?.destroy();window.BadgeAchievements?.destroy();window.TeamPoints?.destroy();window.CareWorkspace?.destroy();state.user=null;state.profile=null;state.cases=[];state.records=[];state.reads=[];state.current=null;state.caseOpen=false;closeDeleteUser();closeResetPassword();$('provisionForm').reset();show('authScreen');notify('已登出')}
 }
 function chooseTab(tab){
   if(!['cases','admin','rewards','achievements','teamPoints'].includes(tab))return;
   if(tab==='admin'&&!canAdmin())return;
   if((tab==='rewards'||tab==='achievements')&&!state.profile?.active)return;
   if(tab==='teamPoints'&&!['admin','supervisor'].includes(state.profile?.role))return;
   state.tab=tab;
   $('casesPage').hidden=tab!=='cases';
   $('adminPage').hidden=tab!=='admin';
   $('rewardsPage').hidden=tab!=='rewards';
   $('achievementsPage').hidden=tab!=='achievements';
   $('teamPointsPage').hidden=tab!=='teamPoints';
   $('casesTab').classList.toggle('active',tab==='cases');
   $('adminTab').classList.toggle('active',tab==='admin');
   $('rewardsTab').classList.toggle('active',tab==='rewards');
   $('achievementsTab').classList.toggle('active',tab==='achievements');
   $('teamPointsTab').classList.toggle('active',tab==='teamPoints');
   if(tab==='rewards')window.Rewards?.show({db:state.db,user:state.user,profile:state.profile});
   if(tab==='achievements')window.BadgeAchievements?.mount({db:state.db,user:state.user,profile:state.profile});
   if(tab==='teamPoints')window.TeamPoints?.show({db:state.db,user:state.user,profile:state.profile});
   window.CareWorkspace?.syncTab(tab);
 }
 async function refreshDashboard(message=true){
   if(!state.profile?.active)return;
   try{
     const db=state.db;
     const [c,r,reads]=await Promise.all([
       db.from('cases').select('id,name,area,service,status,supervisor_name,caregiver_name,address,focus,note,created_at').order('created_at',{ascending:false}),
       db.from('handovers').select('id,case_id,author_name,kind,risk,summary,description,expires_on,created_at,source_room_id,photo_paths').order('created_at',{ascending:false}).limit(1000),
       db.from('case_reads').select('case_id,read_at').eq('user_id',state.user.id)
     ]);
     state.cases=await checkQuery(c,'讀取個案');
     state.records=await checkQuery(r,'讀取交班');
     state.reads=await checkQuery(reads,'取得已讀狀態');
     if(!state.cases.some(x=>x.id===state.current))state.current=state.cases[0]?.id||null;
     renderCaseList();if(state.caseOpen)renderDetail();
     window.CareWorkspace?.mount({
       db:state.db,user:state.user,profile:state.profile,cases:state.cases,records:state.records,reads:state.reads,
       callbacks:{
         chooseTab,
         showBrowser:()=>{chooseTab('cases');showCaseBrowser()},
         openCase:(id,section='history')=>{
           if(!state.cases.some(c=>c.id===id))return;
           chooseTab('cases');showCaseDetail(id);
           window.CareCollab?.selectTab(section);
         },
         openInvitedRoom:id=>{chooseTab('cases');window.HandoverRooms?.openInvitedRoom(id)},
         openNewHandover:()=>openHandover()
       }
     }).catch(e=>notify('交班提醒讀取失敗：'+errText(e),true));
     if(window.HandoverRooms)window.HandoverRooms.loadInvites({db:state.db,user:state.user,profile:state.profile})
       .catch(e=>notify('交班邀請更新失敗：'+errText(e),true));
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
   $('tempInboxWorkspace').hidden=true;
   window.CareCollab?.destroy();
   window.HandoverRooms?.destroy();
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
   const rlist=rec.map(r=>{
     const badge=r.risk==='一般'?'':('<span class="pill '+(r.risk==='緊急'?'critical':'')+'">'+esc(r.risk)+'</span>');
     return '<article class="record"><div class="record-head"><strong>'+esc(r.summary)+' '+badge+'</strong><small>'+when(r.created_at)+'</small></div><small>'+esc(r.kind)+(r.source_room_id?'｜48 小時聊天室整理':'')+'｜記錄人：'+esc(r.author_name)+'</small><p>'+esc(r.description)+'</p>'+(window.HandoverPhotos?.markup(r.photo_paths)||'')+(r.expires_on?'<small>提醒期限：'+esc(r.expires_on)+'</small>':'')+'</article>';
   }).join('');
   root.innerHTML=
     '<div class="toolbar care-case-header"><div><h2>'+esc(c.name)+'</h2>'+
     '<div class="help">'+esc(c.id)+' · '+esc(c.area)+'｜'+esc(c.service)+'</div>'+
     '<div class="help">服務狀態：'+esc(c.status||'未設定')+'｜主責督導：'+esc(c.supervisor_name||'未設定')+'｜主責居服員：'+esc(c.caregiver_name||'未設定')+'</div>'+renderCaseAddress(c)+'</div>'+
     '<span class="care-case-hint">已指派的人員可共同交班</span></div>'+
     '<div class="care-tabs" role="tablist" aria-label="個案交班功能">'+
       '<button class="care-tab active" data-care-tab="guide" role="tab" aria-selected="true" type="button">照顧檔案</button>'+
       '<button class="care-tab" data-care-tab="discussion" role="tab" aria-selected="false" type="button">交班討論</button>'+
       '<button class="care-tab" data-care-tab="rooms" role="tab" aria-selected="false" type="button">48 小時臨時交班室</button>'+
       '<button class="care-tab" data-care-tab="history" role="tab" aria-selected="false" type="button">正式交班 <span class="care-tab-count">'+rec.length+'</span></button>'+
     '</div>'+
     '<section data-care-panel="guide" class="care-tab-panel">'+
       '<div class="care-unified-head"><div><h3>照顧重點</h3><p>所有照顧重點集中顯示；標示「待確認」的內容，須經居督或管理員審核才能正式採用。</p></div>'+
       '<div class="care-unified-actions"><button type="button" class="btn" id="guideAddBtn" aria-expanded="false" aria-controls="careGuideEditor">＋ 新增重點</button>'+
       '<button type="button" class="btn alt" id="refreshGuideBtn">↻ 更新</button></div></div>'+
       '<div id="guideNotice" class="care-notice" role="status" hidden></div>'+
       '<div id="careGuideResults"><p class="care-empty">正在載入照顧重點…</p></div>'+
       '<section class="care-input-panel" id="careGuideEditor" hidden><h3>新增照顧重點</h3><p class="help">已指派的居服員可提出照顧建議，經居督或管理員審核後才列入正式參考。</p>'+
         '<form id="careGuideForm">'+
           '<div class="split"><div class="field"><label for="guideCategory">重點類別</label><select id="guideCategory" required><option>生活習慣</option><option>備餐與飲食</option><option>移位與安全</option><option>沐浴清潔</option><option>溝通與家屬</option><option>其他</option></select></div>'+
           '<div class="field"><label for="guideTitle">重點標題</label><input id="guideTitle" required minlength="2" maxlength="100" placeholder="例如：洗澡前先確認防滑椅"></div></div>'+
           '<div class="field"><label for="guideDetail">具體照顧方式與注意事項</label><textarea id="guideDetail" required minlength="5" maxlength="2000" rows="4" placeholder="描述已確認的照顧習慣與注意事項。請只填必要資訊，不輸入身分證、電話等非必要個資。"></textarea></div>'+
           '<div class="care-form-actions"><button class="btn alt" id="guideCancelBtn" type="button">取消</button><button class="btn" id="guideSaveBtn" type="submit">提交重點給居督確認</button></div>'+
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
     '<section data-care-panel="rooms" class="care-tab-panel" id="tempRoomsPanel" hidden><div id="tempRoomRoot"></div></section>'+
     '<section data-care-panel="history" class="care-tab-panel" hidden>'+
       '<div class="toolbar care-history-header"><div><h3>正式交班歷史（'+rec.length+' 筆）</h3><p class="help">按建立時間排序；原始紀錄保留，不允許一般使用者任意編輯或刪除。</p></div>'+
         '<div class="action-inline"><button type="button" id="newHandoverBtn" class="btn">＋ 新增正式交班</button></div></div>'+
       '<div class="toolbar care-read-toolbar"><span class="help">代班者完成查閱後，請手動確認已讀。</span>'+
         (isUnread(c)?'<button class="btn alt" id="readCaseBtn" type="button">✓ 我已閱讀正式交班</button>':'<span class="pill ok">最新正式交班已讀</span>')+'</div>'+
       (rlist||'<p class="care-empty">目前尚無正式交班紀錄。</p>')+
     '</section>';
   window.HandoverPhotos?.hydrate(root,state.db);
   $('newHandoverBtn').addEventListener('click',openHandover);
   if($('readCaseBtn'))$('readCaseBtn').addEventListener('click',markRead);
   if(window.CareCollab){
      window.CareCollab.mount({db:state.db,caseId:c.id,profile:state.profile,focus:c.focus,note:c.note}).catch(e=>notify('載入交班討論失敗：'+errText(e),true));
   }
   if(window.HandoverRooms){
      window.HandoverRooms.mount({db:state.db,caseId:c.id,profile:state.profile,user:state.user,onPublished:()=>refreshDashboard(false)})
        .catch(e=>notify('載入臨時交班室失敗：'+errText(e),true));
   }
 }
 function openHandover(){
   const c=selectedCase();if(!c)return;
   $('handoverForm').reset();
   window.HandoverPhotos?.clearPreview($('recordPhotosPreview'));
   $('handoverTitle').textContent='新增交班｜'+c.name;
   $('handoverLayer').hidden=false;document.body.style.overflow='hidden';$('recordSummary').focus();
   window.CareWorkspace?.openForm(c).catch(e=>notify('雲端草稿讀取失敗：'+errText(e),true));
 }
 async function closeHandover(force=false){
   if($('submitRecord').disabled)return;
   if(!force&&window.CareWorkspace&&!(await window.CareWorkspace.closeForm()))return;
   $('handoverLayer').hidden=true;document.body.style.overflow='';
   window.HandoverPhotos?.clearPreview($('recordPhotosPreview'));
 }
 async function saveHandover(e){
   e.preventDefault();const c=selectedCase();if(!c)return;
   const risk=$('recordRisk').value;
   if(risk==='緊急'&&!$('urgentAck').checked){notify('重大異常須先通知督導，再勾選確認',true);return}
   const payload={case_id:c.id,kind:$('recordKind').value,risk,summary:$('recordSummary').value.trim(),description:$('recordDescription').value.trim(),expires_on:$('recordExpires').value||null};
   if(!payload.summary||payload.description.length<8){notify('請填寫完整交班主旨與至少 8 字的內容',true);return}
   const button=$('submitRecord');button.disabled=true;
   let photos=[];
   try{
     await window.CareWorkspace?.beforeSubmit();
     photos=await window.HandoverPhotos.uploadSelected({
       input:$('recordPhotos'),db:state.db,userId:state.user.id,caseId:c.id
     });
     payload.photo_paths=photos;
     await checkQuery(await state.db.from('handovers').insert(payload),'儲存交班');
     button.disabled=false;
     await window.CareWorkspace?.afterSubmit(c.id);
     await closeHandover(true);
     await refreshDashboard(false);
     notify('交班已儲存'+(photos.length?'（含 '+photos.length+' 張照片）':'')+'，待居督或管理員確認。');
   }catch(error){
     window.CareWorkspace?.resumeDraft();
     await window.HandoverPhotos?.removeUnlinked(state.db,photos);
     notify('交班儲存失敗：'+errText(error),true);
   }finally{button.disabled=false}
 }
 async function markRead(){
   const c=selectedCase();if(!c)return;
   try{await checkQuery(await state.db.rpc('mark_case_read',{p_case_id:c.id}),'標記已讀');await refreshDashboard(false);notify('已讀時間已儲存在資料庫')}
   catch(e){notify(errText(e),true)}
 }
 async function loadAdmin(){
   if(!canAdmin())return;
   const [p,a,points]=await Promise.all([
     state.db.from('profiles').select('id,display_name,role,active,must_change_password,login_phone,created_at').order('created_at',{ascending:false}),
     state.db.from('case_assignments').select('case_id,user_id,created_at').order('created_at',{ascending:false}),
     state.db.rpc('list_user_point_balances')
   ]);
   const baseProfiles=await checkQuery(p,'取得帳號清單');
   const pointRows=await checkQuery(points,'取得全員點數');
   const pointMap=new Map(pointRows.map(row=>[row.user_id,row]));
   state.profiles=baseProfiles.map(profile=>({
     ...profile,
     total_points:Number(pointMap.get(profile.id)?.total_points||0),
     earned_points:Number(pointMap.get(profile.id)?.earned_points||0)
   }));
   state.assignments=await checkQuery(a,'取得指派清單');
   await refreshDashboard(false);
   const count=state.profiles.length;
   const active=state.profiles.filter(p=>p.active).length;
   const staff=state.profiles.filter(p=>p.role==='staff').length;
   const leaders=state.profiles.filter(p=>['supervisor','admin'].includes(p.role)).length;
   const allPoints=state.profiles.reduce((sum,p)=>sum+p.total_points,0);
   $('adminTotalUsers').textContent=String(count);
   $('adminActiveUsers').textContent=String(active);
   $('adminTotalCases').textContent=String(state.cases.length);
   $('adminUsersCount').textContent=String(count);
   $('adminUsersActive').textContent=String(active);
   $('adminUsersStaff').textContent=String(staff);
   $('adminUsersLeaders').textContent=String(leaders);
   $('adminUsersPoints').textContent=allPoints.toLocaleString('zh-TW')+' 點';
   renderUsers();renderAssignControls();
   state.primarySyncPreview=null;
   $('applyPrimarySync').disabled=true;
   checkStaffLoginMigration().catch(e=>notify('登入轉換狀態檢查失敗：'+errText(e),true));
 }
 async function checkStaffLoginMigration(){
   if(!canAdmin() || !state.db)return;
   const label=$('loginMigrationStatus'),refresh=$('checkLoginMigration');
   refresh.disabled=true;label.classList.remove('error');
   try{
     const d=await invokeAdminUser({action:'migration_status'});
     state.loginMigration=d;
     label.textContent='員工帳號共 '+d.total+' 位；已轉換 '+d.converted+' 位，待轉換 '+d.pending+' 位'+
       (d.errors?'，需人工查核 '+d.errors+' 位':'')+
       (d.pilot?'。下一位待轉換：'+d.pilot.name+'（手機末四碼 '+d.pilot.last4+'）。':'。');
     $('pilotLoginMigration').disabled=!d.pending||!!d.errors;
     $('migrateRemainingLogins').disabled=!d.pending||!!d.errors||d.converted<1||!$('confirmPilotLogin').checked;
   }catch(e){
     label.textContent='查詢失敗：'+errText(e);label.classList.add('error');
     $('pilotLoginMigration').disabled=true;$('migrateRemainingLogins').disabled=true;
     throw e;
   }finally{refresh.disabled=false}
 }
 async function migrateStaffLogins(pilot){
   if(!canAdmin() || !state.db)return;
   const btn=$(pilot?'pilotLoginMigration':'migrateRemainingLogins');
   if(!pilot && (!state.loginMigration?.converted || !$('confirmPilotLogin').checked)){
     notify('請先完成一位試點轉換，並勾選「已確認試點員工可以使用原密碼登入」。',true);return;
   }
   const question=pilot
     ? '將先轉換 1 位員工的登入方式（不更改 ID、密碼或指派）。轉換後，需請該員工實測登入。確定執行？'
     : '請確認已用測試員工的原手機與原密碼成功登入！要將剩餘員工帳號轉換為免簡訊登入嗎？';
   if(!window.confirm(question))return;
   btn.disabled=true;
   try{
     const d=await invokeAdminUser({action:'migrate_logins',pilot,confirm:'轉換員工登入'});
     if(pilot)$('confirmPilotLogin').checked=false;
     notify(d.message+'；本次完成 '+d.changed+' 位。'+
       (pilot&&d.test_user?'請讓「'+d.test_user.name+'」（手機末四碼 '+d.test_user.last4+'）使用原密碼登入。':''));
   }catch(e){notify('登入方式轉換未完成：'+errText(e),true)}
   finally{await checkStaffLoginMigration().catch(()=>{});}
 }
 function renderUsers(){
   const query=$('adminUserSearch').value.trim().toLocaleLowerCase('zh-TW');
   const roleFilter=$('adminUserRoleFilter').value;
   const sortBy=$('adminUserSort').value;
   const collator=new Intl.Collator('zh-TW',{numeric:true,sensitivity:'base'});
   const shown=state.profiles.filter(p=>{
     const phone=p.login_phone && /^8869\d{8}$/.test(p.login_phone)?'0'+p.login_phone.slice(3):'';
     const matchName=String(p.display_name||'').toLocaleLowerCase('zh-TW').includes(query)||phone.includes(query);
     return matchName&&(roleFilter==='all'||p.role===roleFilter);
   }).sort((a,b)=>{
     if(sortBy==='points_desc')return b.total_points-a.total_points||collator.compare(a.display_name,b.display_name);
     if(sortBy==='points_asc')return a.total_points-b.total_points||collator.compare(a.display_name,b.display_name);
     if(sortBy==='role')return collator.compare(roles[a.role]||a.role,roles[b.role]||b.role)||collator.compare(a.display_name,b.display_name);
     return collator.compare(a.display_name,b.display_name);
   });
   $('adminUserSummary').textContent='顯示 '+shown.length+' / '+state.profiles.length+' 位';
   $('usersBody').innerHTML=shown.map(p=>{
     const self=p.id===state.user.id;
     const manageable=!self&&(p.role==='staff'||p.role==='supervisor');
     const options=Object.keys(roles).map(role=>'<option value="'+role+'" '+(p.role===role?'selected':'')+'>'+roles[role]+'</option>').join('');
     const reset=manageable?'<button type="button" class="btn alt" data-reset-profile="'+esc(p.id)+'">重設密碼</button>':'';
     const remove=manageable?'<button type="button" class="btn warn" data-delete-profile="'+esc(p.id)+'">刪除使用者</button>':'';
     const avatar=String(p.display_name||'?').trim().slice(0,1)||'?';
     const meta=self?'<span class="pill ok staff-self">自己</span>':'<span class="staff-role-small">'+esc(roles[p.role]||p.role)+'</span>';
     const phone=p.login_phone && /^8869\d{8}$/.test(p.login_phone)?'0'+p.login_phone.slice(3):'';
     return '<tr class="staff-row">'+
       '<td data-label="員工資料"><div class="staff-person"><span class="staff-avatar" aria-hidden="true">'+esc(avatar)+'</span><div class="staff-person-copy">'+
       '<input type="text" data-display-name="'+esc(p.id)+'" aria-label="員工姓名" maxlength="80" value="'+esc(p.display_name)+'" '+(self?'disabled':'')+'>'+
       '<div class="staff-subline">'+meta+(phone?'<span>登入：'+esc(phone)+'</span>':'')+
       '<span>'+esc(p.id.slice(0,8))+'…</span></div></div></div></td>'+
       '<td data-label="帳號角色" class="staff-role-col"><select aria-label="'+esc(p.display_name)+'的角色" data-role="'+esc(p.id)+'" '+(self?'disabled':'')+'>'+options+'</select></td>'+
       '<td data-label="使用狀態"><label class="staff-state"><input type="checkbox" aria-label="啟用 '+esc(p.display_name)+'" data-active="'+esc(p.id)+'" '+(p.active?'checked':'')+' '+(self?'disabled':'')+'>'+
       '<span>'+(p.active?'已啟用':'已停用')+'</span></label></td>'+
       '<td data-label="可用點數"><div class="admin-user-point-cell"><strong class="points-value">'+Number(p.total_points||0).toLocaleString('zh-TW')+
       ' <span>點</span></strong><button class="points-view-btn" type="button" data-view-points="'+esc(p.id)+'">查看明細</button></div></td>'+
       '<td data-label="管理操作"><div class="staff-actions"><button type="button" class="btn alt" data-save-profile="'+esc(p.id)+'" '+(self?'disabled':'')+'>儲存</button>'+
       reset+remove+'</div></td>'+
       '</tr>';
   }).join('')||'<tr><td colspan="5" class="staff-empty">目前沒有符合條件的使用者，請調整搜尋或角色篩選。</td></tr>';
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
   const payload={id:$('manageCaseId').value.trim(),name:$('manageCaseName').value.trim(),area:$('manageArea').value.trim(),service:$('manageService').value.trim(),address:$('manageCaseAddress').value.trim(),status:$('manageStatus').value,supervisor_name:$('manageSupervisorName').value.trim(),caregiver_name:$('manageCaregiverName').value.trim(),focus:focusFromText($('manageFocus').value),note:$('manageNote').value.trim()};
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
   $('manageCaseName').value=c.name;$('manageArea').value=c.area;$('manageCaseAddress').value=c.address||'';
   $('manageService').value=c.service;$('manageStatus').value=c.status||'服務中';$('manageSupervisorName').value=c.supervisor_name||'';$('manageCaregiverName').value=c.caregiver_name||'';$('manageFocus').value=focusToText(c.focus);
   $('manageNote').value=c.note;$('saveCaseBtn').textContent='儲存修改';
   $('caseEditMode').textContent='編輯模式 · '+c.name;$('caseEditMode').classList.add('editing');
   $('caseFormHelp').textContent='正在編輯 '+c.name+'，儲存後將更新原有個案資料';
   $('adminCasesSection').scrollIntoView({behavior:'smooth',block:'start'});
 }
 function renderAssignControls(){
   const current=$('assignCase').value;
   // 顯示真正由個案服務人員指派建立的居服員，不以個案基本資料上的主責姓名當作權限。
   const profileById=new Map(state.profiles.map(p=>[p.id,p]));
   const caregiverByCase=new Map();
   for(const assignment of state.assignments){
     const profile=profileById.get(assignment.user_id);
     if(!profile||profile.role!=='staff')continue;
     if(!caregiverByCase.has(assignment.case_id))caregiverByCase.set(assignment.case_id,new Map());
     const display=(profile.display_name||'未設定姓名')+(profile.active?'':'（已停用）');
     caregiverByCase.get(assignment.case_id).set(profile.id,display);
   }
   $('assignCase').innerHTML=state.cases.map(c=>{
     const names=[...(caregiverByCase.get(c.id)?.values()||[])];
     const assigned=names.length===0?'尚未指派':names.length<=2?names.join('、'):
       names.slice(0,2).join('、')+' 等 '+names.length+' 位';
     return '<option value="'+esc(c.id)+'">'+esc(c.id)+'｜'+esc(c.name)+'｜居服員：'+esc(assigned)+'</option>';
   }).join('');
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
 async function previewPrimaryAssignments(){
   if(!canAdmin()||!state.db)return;
   const button=$('previewPrimarySync'),apply=$('applyPrimarySync'),label=$('primarySyncStatus');
   button.disabled=true;apply.disabled=true;state.primarySyncPreview=null;
   label.classList.remove('error');label.textContent='正在核對主責姓名與既有指派…';
   try{
     const data=await invokeAdminUser({action:'primary_assignment_preview'});
     state.primarySyncPreview=data;
     label.textContent='共有 '+data.cases+' 位個案；已正確指派 '+data.already_assigned+
       ' 位，可安全新增 '+data.pending+' 筆，須人工核對 '+data.conflicts+' 筆衝突、'+
       data.no_matching_worker+' 筆姓名未對應、'+data.ambiguous_worker+' 筆同名、'+
       data.blank_names+' 筆未填主責。';
     apply.disabled=!data.pending||!data.preview_token;
   }catch(e){
     label.textContent='核對失敗：'+errText(e);label.classList.add('error');
     notify('無法預覽主責指派：'+errText(e),true);
   }finally{button.disabled=false}
 }
 async function applyPrimaryAssignments(){
   if(!canAdmin()||!state.db||!state.primarySyncPreview?.pending)return;
   const preview=state.primarySyncPreview;
   if(!window.confirm('確定依照主責姓名完全相同、無其他居服員指派衝突的規則，新增 '+preview.pending+
     ' 筆正式個案查閱權限嗎？已指派的權限不會移除；姓名不符的個案不會處理。'))return;
   const button=$('applyPrimarySync');button.disabled=true;
   try{
     const result=await invokeAdminUser({
       action:'primary_assignment_sync',
       confirm:'同步主責指派',
       preview_token:preview.preview_token
     });
     notify('已建立 '+result.created+' 筆主責個案指派。其他不符合條件的個案未變動。');
     await loadAdmin();
     await previewPrimaryAssignments();
   }catch(e){
     notify('主責指派未完成：'+errText(e),true);
     await previewPrimaryAssignments();
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
