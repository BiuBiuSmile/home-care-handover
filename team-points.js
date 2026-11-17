/* 安護交班：全員點數總覽，居督／管理員唯讀授權介面。 */
'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>Number(n||0).toLocaleString('zh-TW');
 const when=v=>v?new Date(v).toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
 const roles={staff:'居服員',supervisor:'居督',admin:'管理員'};
 const eventNames={guide_approval:'照顧重點審核通過',handover_review:'正式交班完成',room_completion:'48 小時交班完成',redemption:'申請兌換',redemption_refund:'兌換退回'};
 const state={db:null,user:null,profile:null,people:[],query:'',role:'all',sort:'points_desc',loading:false,loaded:false,seq:0,modalSeq:0};
 const allowed=()=>!!state.db&&!!state.user?.id&&state.profile?.active&&['admin','supervisor'].includes(state.profile?.role);
 function initContext(ctx){
   if(!ctx?.db||!ctx.user?.id||!ctx.profile)return false;
   if(state.user?.id!==ctx.user.id){
     state.people=[];state.loaded=false;state.query='';state.role='all';state.sort='points_desc';state.seq++;
   }
   state.db=ctx.db;state.user=ctx.user;state.profile=ctx.profile;
   return allowed();
 }
 function summary(){
   const people=state.people;
   return {total:people.length,active:people.filter(p=>p.active).length,
     staff:people.filter(p=>p.role==='staff').length,
     leadership:people.filter(p=>p.role==='supervisor'||p.role==='admin').length,
     points:people.reduce((n,p)=>n+Number(p.total_points||0),0)};
 }
 function draw(){
   const root=$('teamPointsRoot');if(!root)return;
   const x=summary();
   root.innerHTML='<div class="tp-wrap">'+
    '<section class="tp-hero"><div><span class="tp-kicker">TEAM REWARDS · 人員獎勵</span>'+
      '<h1>全員點數總覽</h1><p>統一檢視同仁可用點數與核點紀錄。居督和管理員皆可查看，但此頁不提供帳號或點數修改功能。</p></div>'+
      '<button class="btn alt" type="button" id="teamPointsRefresh">↻ 重新整理</button></section>'+
    '<div class="tp-stats" aria-label="全員點數統計">'+
      stat('帳號總數',x.total,'users')+stat('已啟用',x.active,'active')+
      stat('居服員',x.staff,'staff')+stat('居督／管理員',x.leadership,'lead')+
      stat('全體可用點數',fmt(x.points)+' 點','points')+
    '</div>'+
    '<section class="tp-list-panel"><div class="tp-list-head"><div><h2>同仁點數清單</h2><p>點數依已核發及兌換紀錄計算，兌換扣點已反映在餘額中。</p></div>'+
    '<span id="teamPointsCount" class="tp-count"></span></div>'+
    '<div class="tp-filters"><label class="tp-search-label"><span>搜尋姓名</span><input id="teamPointsSearch" type="search" autocomplete="off" placeholder="輸入員工姓名…" value="'+esc(state.query)+'"></label>'+
    '<label><span>角色</span><select id="teamPointsRole"><option value="all">全部角色</option>'+
      '<option value="staff">居服員</option><option value="supervisor">居督</option><option value="admin">管理員</option></select></label>'+
    '<label><span>排序方式</span><select id="teamPointsSort"><option value="points_desc">點數：高到低</option><option value="points_asc">點數：低到高</option>'+
      '<option value="name">依姓名</option><option value="role">依角色</option></select></label></div>'+
    '<div class="tp-rows" id="teamPointsList"></div></section>'+
    '<p class="tp-note">此頁為唯讀總覽。若需發放獎品，管理員仍須進入「點數獎勵」處理兌換申請。</p></div>';
   $('teamPointsRole').value=state.role;
   $('teamPointsSort').value=state.sort;
   $('teamPointsSearch').addEventListener('input',e=>{state.query=e.target.value;drawRows()});
   $('teamPointsRole').addEventListener('change',e=>{state.role=e.target.value;drawRows()});
   $('teamPointsSort').addEventListener('change',e=>{state.sort=e.target.value;drawRows()});
   $('teamPointsRefresh').addEventListener('click',()=>refresh());
   $('teamPointsList').addEventListener('click',e=>{
     const b=e.target.closest('[data-team-point-person]');
     if(b)openUser({db:state.db,user:state.user,profile:state.profile},b.dataset.teamPointPerson);
   });
   drawRows();
 }
 function stat(name,value,kind){
   return '<div class="tp-stat tp-stat-'+kind+'"><span>'+esc(name)+'</span><strong>'+esc(value)+'</strong></div>';
 }
 function drawRows(){
   const box=$('teamPointsList');if(!box)return;
   const key=state.query.trim().toLocaleLowerCase('zh-TW');
   const collator=new Intl.Collator('zh-TW',{numeric:true,sensitivity:'base'});
   const rows=state.people.filter(p=>
     (state.role==='all'||p.role===state.role)&&(!key||String(p.display_name||'').toLocaleLowerCase('zh-TW').includes(key))
   ).sort((a,b)=>{
     if(state.sort==='points_desc')return Number(b.total_points||0)-Number(a.total_points||0)||collator.compare(a.display_name,b.display_name);
     if(state.sort==='points_asc')return Number(a.total_points||0)-Number(b.total_points||0)||collator.compare(a.display_name,b.display_name);
     if(state.sort==='role')return collator.compare(roles[a.role]||a.role,roles[b.role]||b.role)||collator.compare(a.display_name,b.display_name);
     return collator.compare(a.display_name,b.display_name);
   });
   $('teamPointsCount').textContent='顯示 '+rows.length+' / '+state.people.length+' 位';
   box.innerHTML=rows.length?rows.map(p=>{
     const initial=String(p.display_name||'員').trim().slice(0,1);
     return '<article class="tp-person"><div class="tp-person-name"><span class="tp-avatar" aria-hidden="true">'+esc(initial)+'</span>'+
       '<div><strong>'+esc(p.display_name||'未命名員工')+'</strong><small>'+esc(roles[p.role]||p.role)+
       ' · '+(p.active?'已啟用':'已停用')+'</small></div></div>'+
       '<div class="tp-person-points"><small>目前點數</small><strong>'+fmt(p.total_points)+' <span>點</span></strong></div>'+
       '<div class="tp-person-actions"><button type="button" class="btn alt" data-team-point-person="'+esc(p.user_id)+'">查看明細</button></div></article>';
   }).join(''):'<div class="tp-no-results">沒有符合搜尋條件的員工。</div>';
 }
 async function refresh(){
   if(!allowed())return;
   const n=++state.seq,root=$('teamPointsRoot');
   state.loading=true;
   if(root&&!state.loaded)root.innerHTML='<div class="tp-no-results">正在讀取全員點數…</div>';
   try{
     const {data,error}=await state.db.rpc('list_user_point_balances');
     if(error)throw error;
     if(n!==state.seq||!allowed())return;
     state.people=data||[];state.loaded=true;draw();
   }catch(e){
     if(n!==state.seq)return;
     if(root)root.innerHTML='<div class="tp-no-results">無法讀取全員點數：'+esc(e.message||'請檢查權限')+
       '。<button type="button" class="btn alt" id="teamPointsRetry">重新載入</button></div>';
     $('teamPointsRetry')?.addEventListener('click',refresh);
   }finally{state.loading=false}
 }
 function show(ctx){
   if(!initContext(ctx))return;
   refresh();
 }
 function closeDetails(){
   state.modalSeq++;
   const layer=$('teamPointsDetailLayer');if(layer)layer.hidden=true;
   const body=$('teamPointsDetailEvents');if(body)body.innerHTML='';
 }
 async function openUser(ctx,id){
   if(!initContext(ctx)||!id)return;
   if(!state.loaded){
     const {data,error}=await state.db.rpc('list_user_point_balances');
     if(error)return;
     state.people=data||[];state.loaded=true;
   }
   const person=state.people.find(p=>p.user_id===id);
   if(!person)return;
   const layer=$('teamPointsDetailLayer');if(!layer)return;
   const seq=++state.modalSeq;
   $('teamPointsDetailTitle').textContent=person.display_name||'員工';
   $('teamPointsDetailMeta').textContent=(roles[person.role]||person.role)+'｜'+(person.active?'已啟用':'已停用');
   $('teamPointsDetailBalance').textContent=fmt(person.total_points)+' 點';
   $('teamPointsDetailEvents').innerHTML='<div class="tp-no-results">正在讀取點數明細…</div>';
   layer.hidden=false;
   try{
     const {data,error}=await state.db.rpc('list_user_point_events',{p_user_id:person.user_id});
     if(error)throw error;
     if(seq!==state.modalSeq||layer.hidden)return;
     const ev=data||[];
     $('teamPointsDetailEvents').innerHTML=ev.length?ev.map(e=>
       '<div class="tp-event"><div><strong>'+esc(e.description||eventNames[e.source_type]||e.source_type)+'</strong>'+
       '<small>'+esc(when(e.created_at))+'</small></div><span class="'+(e.points>=0?'tp-positive':'tp-negative')+'">'+
       (e.points>0?'+':'')+fmt(e.points)+' 點</span></div>'
     ).join(''):'<div class="tp-no-results">尚無核點或兌換紀錄。</div>';
   }catch(e){
     if(seq!==state.modalSeq)return;
     $('teamPointsDetailEvents').innerHTML='<div class="tp-no-results">明細讀取失敗：'+esc(e.message||'請稍後重試')+'</div>';
   }
 }
 function bind(){
   $('closeTeamPointsDetails')?.addEventListener('click',closeDetails);
   $('teamPointsDetailLayer')?.addEventListener('click',e=>{if(e.target===$('teamPointsDetailLayer'))closeDetails()});
   document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDetails()});
 }
 function destroy(){
   state.seq++;state.modalSeq++;state.db=null;state.user=null;state.profile=null;
   state.people=[];state.loaded=false;state.query='';state.role='all';state.sort='points_desc';
   closeDetails();
   if($('teamPointsRoot'))$('teamPointsRoot').innerHTML='';
 }
 window.TeamPoints={bind,show,refresh,openUser,closeDetails,destroy};
})();