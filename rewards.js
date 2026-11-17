/* 安護交班 v1 點數獎勵：只讀流水帳與受保護的兌換／審核 RPC。 */
'use strict';
(function(){
 const node=id=>document.getElementById(id);
 const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const fmt=value=>value?new Date(value).toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
 const errorText=e=>String(e?.message||'系統操作失敗').slice(0,250);
 const state={db:null,user:null,profile:null,balance:0,catalog:[],events:[],mine:[],pending:[],redemptions:[],caseNames:new Map(),reviews:[],seq:0,busy:false,message:null};
 const reviewer=()=>['admin','supervisor'].includes(state.profile?.role);
 const admin=()=>state.profile?.role==='admin';
 const active=()=>!!state.db&&!!state.user?.id&&state.profile?.active;
 const labels={guide_approval:'照顧重點審核通過',handover_review:'正式交班完成',room_completion:'48 小時交班完成',redemption:'點數兌換申請',redemption_refund:'兌換未通過・點數返還'};
 const statusLabels={pending:'待發放',fulfilled:'已發放',rejected:'已退回並返點'};
 function message(text,failed=false){
   state.message={text,failed};
   const area=node('rewardsNotice');
   if(area){area.hidden=!text;area.textContent=text||'';area.className='reward-notice'+(failed?' error':'');}
 }
 function destroy(){state.seq++;state.db=null;state.user=null;state.profile=null;state.balance=0;state.catalog=[];state.events=[];state.mine=[];state.pending=[];state.redemptions=[];state.caseNames=new Map();state.reviews=[];state.message=null;state.busy=false;if(node('rewardsRoot'))node('rewardsRoot').innerHTML='';}
 function overview(){
   const balance=Math.max(0,state.balance);
   const goal=state.catalog.length?state.catalog[0]:null;
   return '<div class="reward-hero"><div><div class="reward-kicker">照顧有心・交班有獎</div>'+
     '<h1>我的點數</h1><p>審核通過的照顧重點 +5 點；完成審核的正式交班 +5 點。48 小時交班經整理發佈且 A、B 都有實際留言，雙方各 +5 點。</p>'+
     '<button id="refreshRewards" type="button" class="btn alt">↻ 更新點數</button></div>'+
     '<div class="reward-balance"><small>目前可用點數</small><strong>'+balance.toLocaleString('zh-TW')+'</strong><span>點</span></div></div>'+
     (goal?'<div class="reward-goal">距離「'+esc(goal.title)+'」還差 <strong>'+Math.max(0,goal.cost-balance)+'</strong> 點。'+(balance>=goal.cost?'已達兌換門檻。':'')+'</div>':'');
 }
 function prizeCards(){
   return '<section class="reward-section"><div class="reward-section-title"><h2>獎品兌換</h2><p>兌換送出時先扣點；管理員確認實際發放，若退回申請會自動返點。</p></div>'+
   '<div class="reward-catalog">'+state.catalog.map(r=>{
     const qualified=state.balance>=r.cost&&['staff','supervisor'].includes(state.profile?.role);
     const icon=r.code==='frappuccino'?'🥤':'🎁';
     return '<article class="reward-prize"><div class="reward-prize-top"><span class="reward-prize-icon">'+icon+'</span><span class="reward-price">'+r.cost+' 點</span></div>'+
       '<h3>'+esc(r.title)+'</h3><p>'+esc(r.description)+'</p>'+
       '<button type="button" class="btn" data-reward-request="'+esc(r.code)+'" '+(qualified?'':'disabled')+'>'+
       (qualified?'申請兌換':(state.balance<r.cost?'尚差 '+(r.cost-state.balance)+' 點':'僅開放員工兌換'))+'</button></article>';
   }).join('')+'</div></section>';
 }
 function eventList(){
   return '<section class="reward-section"><div class="reward-section-title"><h2>點數紀錄</h2><p>每筆活動只會計點一次，所有增減都有歷史。</p></div>'+
   (state.events.length?'<div class="reward-entries">'+state.events.map(e=>
      '<div class="reward-entry"><div><strong>'+esc(e.description||labels[e.source_type]||e.source_type)+'</strong>'+
      '<small>'+fmt(e.created_at)+'</small></div><span class="'+(e.points>0?'reward-plus':'reward-minus')+'">'+
      (e.points>0?'+':'')+e.points+' 點</span></div>').join('')+'</div>':
      '<div class="reward-empty">尚無點數紀錄，目前從 0 點開始累積。</div>')+'</section>';
 }
 function myRedemptions(){
   return '<section class="reward-section"><div class="reward-section-title"><h2>我的兌換紀錄</h2><p>申請後由管理員確認發放；待發放不代表已領取。</p></div>'+
   (state.mine.length?'<div class="reward-entries">'+state.mine.map(r=>
     '<div class="reward-entry"><div><strong>'+esc(r.reward_title)+'</strong><small>'+fmt(r.requested_at)+
     (r.admin_note?' ・ '+esc(r.admin_note):'')+'</small></div><div class="reward-entry-right"><b>'+r.points_cost+' 點</b>'+
     '<span class="reward-status '+esc(r.status)+'">'+(statusLabels[r.status]||'處理中')+'</span></div></div>').join('')+'</div>':
     '<div class="reward-empty">尚未申請兌換獎品。</div>')+'</section>';
 }
 function reviewQueue(){
   if(!reviewer())return '';
   return '<section class="reward-section"><div class="reward-section-title"><h2>正式交班審核</h2><p>只有居督／管理員確認交班內容後，提交者才會得到 5 點；同一筆無法重複核點。</p></div>'+
   (state.pending.length?'<div class="reward-entries">'+state.pending.map(r=>
     '<article class="reward-review-row"><div><strong>'+esc(r.summary)+'</strong><small>'+esc(state.caseNames.get(r.case_id)||'授權個案')+
     ' ・ 提交者：'+esc(r.author_name)+' ・ '+fmt(r.created_at)+'</small>'+
     '<p>'+esc(r.description)+'</p></div><div class="reward-review-actions">'+
     '<button type="button" class="btn" data-handover-review="'+esc(r.id)+'" data-approve="true">確認完成・+5 點</button>'+
     '<button type="button" class="btn alt" data-handover-review="'+esc(r.id)+'" data-approve="false">未完成・不計點</button></div></article>').join('')+'</div>':
     '<div class="reward-empty">目前沒有待審核的正式交班紀錄。</div>')+'</section>';
 }
 function adminQueue(){
   if(!admin())return '';
   const pending=state.redemptions.filter(x=>x.status==='pending'),done=state.redemptions.filter(x=>x.status!=='pending');
   return '<section class="reward-section"><div class="reward-section-title"><h2>兌換申請管理</h2><p>只有管理員能確認發放或退回；退回會自動返還點數。</p></div>'+
     (pending.length?'<div class="reward-entries">'+pending.map(r=>
     '<article class="reward-review-row"><div><strong>'+esc(r.applicant_name)+' ・ '+esc(r.reward_title)+'</strong>'+
     '<small>'+fmt(r.requested_at)+' ・ '+r.points_cost+' 點 ・ 待發放</small></div>'+
     '<div class="reward-review-actions"><button type="button" class="btn" data-redemption-id="'+esc(r.id)+'" data-delivered="true">確認已發放</button>'+
     '<button type="button" class="btn alt" data-redemption-id="'+esc(r.id)+'" data-delivered="false">退回並返點</button></div></article>').join('')+'</div>':
     '<div class="reward-empty">沒有待處理的兌換申請。</div>')+
     (done.length?'<details class="reward-past"><summary>已處理兌換紀錄（'+done.length+'）</summary>'+
     '<div class="reward-entries">'+done.map(r=>
       '<div class="reward-entry"><div><strong>'+esc(r.applicant_name)+' ・ '+esc(r.reward_title)+'</strong><small>'+
       fmt(r.requested_at)+(r.admin_note?' ・ '+esc(r.admin_note):'')+'</small></div><span class="reward-status '+esc(r.status)+'">'+
       (statusLabels[r.status]||'')+'</span></div>').join('')+'</div></details>':'')+'</section>';
 }
 function draw(){
   const root=node('rewardsRoot');if(!root)return;
   root.innerHTML='<div class="reward-page">'+overview()+
     '<div id="rewardsNotice" class="reward-notice" role="status" '+(!state.message?.text?'hidden':'')+'>'+
     esc(state.message?.text||'')+'</div>'+prizeCards()+myRedemptions()+eventList()+reviewQueue()+adminQueue()+
     '<p class="reward-fineprint">獎勵機制試行中：此處為點數與兌換申請，無法直接提供電子票券；實際發放由管理員處理。僅計算本機制啟用後經審核的紀錄。</p></div>';
   if(state.message)message(state.message.text,state.message.failed);
   node('refreshRewards')?.addEventListener('click',()=>refresh());
   root.querySelectorAll('[data-reward-request]').forEach(b=>b.addEventListener('click',()=>redeem(b.dataset.rewardRequest,b)));
   root.querySelectorAll('[data-handover-review]').forEach(b=>b.addEventListener('click',()=>review(b.dataset.handoverReview,b.dataset.approve==='true',b)));
   root.querySelectorAll('[data-redemption-id]').forEach(b=>b.addEventListener('click',()=>decide(b.dataset.redemptionId,b.dataset.delivered==='true',b)));
 }
 async function check(result,what){if(result.error)throw Error(what+'：'+errorText(result.error));return result.data||[];}
 async function refresh(){
   if(!active())return;
   const seq=++state.seq,db=state.db,id=state.user.id;
   const root=node('rewardsRoot');if(root&&!state.events.length&&!state.catalog.length)root.innerHTML='<div class="reward-empty">正在讀取點數及獎勵資料…</div>';
   try{
     const query=[
       db.rpc('my_reward_balance'),
       db.from('reward_catalog').select('code,title,description,cost,sort_order').eq('active',true).order('sort_order'),
       db.from('reward_point_events').select('id,source_type,description,points,created_at').eq('user_id',id).order('created_at',{ascending:false}).limit(100),
       db.from('reward_redemptions').select('id,reward_title,points_cost,status,requested_at,admin_note').eq('user_id',id).order('requested_at',{ascending:false}).limit(100)
     ];
     if(reviewer()){
       query.push(db.from('handovers').select('id,case_id,author_id,author_name,summary,description,created_at,source_room_id')
         .is('source_room_id',null).order('created_at',{ascending:false}).limit(200));
       query.push(db.from('reward_handover_reviews').select('handover_id,status').limit(300));
       query.push(db.from('cases').select('id,name').limit(500));
     }
     if(admin())query.push(db.from('reward_redemptions').select('id,applicant_name,reward_title,points_cost,status,requested_at,admin_note')
       .order('requested_at',{ascending:false}).limit(200));
     const values=await Promise.all(query);
     if(seq!==state.seq)return;
     for(let i=0;i<values.length;i++)if(values[i].error)throw Error('載入點數資料失敗：'+errorText(values[i].error));
     state.balance=Number(values[0].data||0);
     state.catalog=values[1].data||[];state.events=values[2].data||[];
     state.mine=values[3].data||[];
     let pos=4;
     if(reviewer()){
       const hs=values[pos++].data||[],reviews=values[pos++].data||[],cases=values[pos++].data||[];
       state.caseNames=new Map(cases.map(c=>[c.id,c.name]));
       const reviewed=new Set(reviews.map(x=>x.handover_id));
       state.pending=hs.filter(h=>h.author_id&&h.author_id!==id&&!reviewed.has(h.id));
       state.reviews=reviews;
     }
     if(admin())state.redemptions=values[pos]?.data||[];
     draw();
   }catch(e){if(seq===state.seq){if(root)root.innerHTML='<div class="reward-empty">點數載入失敗：'+esc(errorText(e))+
     '。<button class="btn alt" id="rewardRetry" type="button">重新讀取</button></div>';
     node('rewardRetry')?.addEventListener('click',refresh);}}
 }
 async function redeem(code,button){
   const prize=state.catalog.find(x=>x.code===code);
   if(!prize||state.busy||state.balance<prize.cost)return;
   if(!window.confirm('確定使用 '+prize.cost+' 點申請「'+prize.title+'」？點數將立即扣除，管理員確認後發放。'))return;
   state.busy=true;button.disabled=true;
   try{
     await check(await state.db.rpc('request_reward_redemption',{p_reward_code:code}),'申請兌換');
     message('已送出獎品兌換申請並扣除點數，等待管理員確認發放。');
     await refresh();
     message('已送出獎品兌換申請並扣除點數，等待管理員確認發放。');
   }catch(e){message('兌換失敗：'+errorText(e),true);await refresh();}
   finally{state.busy=false;button.disabled=false}
 }
 async function review(id,approve,button){
   if(!reviewer()||state.busy)return;
   if(!window.confirm(approve?'確定交班內容已完成並核發提交者 5 點？':'確定此筆交班未完成，不核發點數？'))return;
   state.busy=true;button.disabled=true;
   try{
     await check(await state.db.rpc('review_handover_reward',{p_handover_id:id,p_approve:approve}),'交班審核');
     await refresh();
     message(approve?'已確認交班完成；符合資格的提交者已獲得 5 點。':'已記錄未完成，本筆不計點。');
   }catch(e){message('審核失敗：'+errorText(e),true)}
   finally{state.busy=false;button.disabled=false}
 }
 async function decide(id,delivered,button){
   if(!admin()||state.busy)return;
   const note=window.prompt(delivered?'請輸入發放日期或方式（可留白）；按取消不處理。':'請輸入退回原因，會自動返還點數；按取消不處理。','');
   if(note===null)return;
   if(!delivered&&!note.trim())return message('退回申請必須填寫原因。',true);
   if(!window.confirm(delivered?'確認已實際發放獎品？':'確定退回申請並返還所有扣除點數？'))return;
   state.busy=true;button.disabled=true;
   try{
     await check(await state.db.rpc('decide_reward_redemption',{
       p_redemption_id:id,p_fulfilled:delivered,p_note:note.trim()
     }),'兌換處理');
     await refresh();
     message(delivered?'已記錄獎品已發放。':'兌換已退回，點數已全數返還。');
   }catch(e){message('兌換處理失敗：'+errorText(e),true)}
   finally{state.busy=false;button.disabled=false}
 }
 function show({db,user,profile}){
   if(!db||!user?.id||!profile?.active)return;
   if(state.user?.id!==user.id){state.events=[];state.catalog=[];state.message=null;}
   state.db=db;state.user=user;state.profile=profile;refresh();
 }
 window.Rewards={show,refresh,destroy};
})();