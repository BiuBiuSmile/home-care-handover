/* 安護交班 v1 點數獎勵：只讀流水帳與受保護的兌換／審核 RPC。 */
'use strict';
(function(){
 const node=id=>document.getElementById(id);
 const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const fmt=value=>value?new Date(value).toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
 const errorText=e=>String(e?.message||'系統操作失敗').slice(0,250);
 const state={db:null,user:null,profile:null,balance:0,catalog:[],events:[],mine:[],pending:[],redemptions:[],caseNames:new Map(),reviews:[],mission:null,badges:[],myBadges:[],mentorCandidates:[],mentorAlready:new Set(),seq:0,busy:false,message:null};
 const reviewer=()=>['admin','supervisor'].includes(state.profile?.role);
 const admin=()=>state.profile?.role==='admin';
 const active=()=>!!state.db&&!!state.user?.id&&state.profile?.active;
 const labels={guide_approval:'照顧重點審核通過',handover_review:'正式交班完成',room_completion:'48 小時交班完成',redemption:'點數兌換申請',redemption_refund:'兌換未通過・點數返還',monthly_task:'每月交班小任務達標'};
 const statusLabels={pending:'待發放',fulfilled:'已發放',rejected:'已退回並返點'};
 function message(text,failed=false){
   state.message={text,failed};
   const area=node('rewardsNotice');
   if(area){area.hidden=!text;area.textContent=text||'';area.className='reward-notice'+(failed?' error':'');}
 }
 function destroy(){state.seq++;state.db=null;state.user=null;state.profile=null;state.balance=0;state.catalog=[];state.events=[];state.mine=[];state.pending=[];state.redemptions=[];state.caseNames=new Map();state.reviews=[];state.mission=null;state.badges=[];state.myBadges=[];state.mentorCandidates=[];state.mentorAlready=new Set();state.message=null;state.busy=false;if(node('rewardsRoot'))node('rewardsRoot').innerHTML='';}
 function overview(){
   const balance=Math.max(0,state.balance);
   const goal=state.catalog.length?state.catalog[0]:null;
   return '<div class="reward-hero"><div><div class="reward-kicker">照顧有心・交班有獎</div>'+
     '<h1>我的點數</h1><p>審核通過的照顧重點 +5 點；完成審核的正式交班 +5 點。48 小時交班經整理發佈且 A、B 都有實際留言，雙方各 +5 點。</p>'+
     '<button id="refreshRewards" type="button" class="btn alt">↻ 更新點數</button></div>'+
     '<div class="reward-balance"><small>目前可用點數</small><strong>'+balance.toLocaleString('zh-TW')+'</strong><span>點</span></div></div>'+
     (goal?'<div class="reward-goal">距離「'+esc(goal.title)+'」還差 <strong>'+Math.max(0,goal.cost-balance)+'</strong> 點。'+(balance>=goal.cost?'已達兌換門檻。':'')+'</div>':'');
 }

 function missionPanel(){
   if(!['staff','supervisor'].includes(state.profile?.role))return '';
   const m=state.mission||{month_key:'本月',progress:0,target:3,bonus_points:10,completed:false};
   const target=Math.max(1,Number(m.target||3)),progress=Math.max(0,Number(m.progress||0));
   const pct=Math.min(100,Math.round(progress/target*100));
   return '<section class="reward-section reward-mission-section">'+
     '<div class="reward-section-title"><h2>🎯 每月小任務</h2><p>本月完成 3 次經審核的有效交班，即自動領取 +10 點。每個月最多一次，次月重新開始。</p></div>'+
     '<div class="reward-mission-card"><div class="reward-mission-top"><div><span class="reward-mission-date">'+esc(m.month_key||'本月')+' 月度任務</span>'+
     '<h3>確實交班 3 次</h3><p>正式交班通過審核，或 48 小時交班室完成整理發佈，才計入進度。</p></div>'+
     '<span class="reward-mission-bonus">'+(m.completed?'✓ 已領取':'完成獎勵')+'<b>+10 點</b></span></div>'+
     '<div class="reward-mission-progress"><div class="reward-mission-progress-fill" style="width:'+pct+'%"></div></div>'+
     '<div class="reward-mission-foot"><span>本月進度 <strong>'+Math.min(target,progress)+' / '+target+'</strong></span>'+
     '<strong class="'+(m.completed?'reward-mission-done':'')+'">'+(m.completed?'已完成並自動加點':'再完成 '+Math.max(0,target-progress)+' 次即可達標')+'</strong></div></div></section>';
 }
 function badgePanel(){
   if(!['staff','supervisor'].includes(state.profile?.role))return '';
   const earned=new Map(state.myBadges.map(b=>[b.badge_code,b]));
   return '<section class="reward-section"><div class="reward-section-title"><h2>🏅 個人成就徽章</h2>'+
     '<p>徽章永久保留，不會扣除點數，也不等於可兌換點數。達成條件後自動取得，帶領新人的徽章需主管確認。</p></div>'+
     '<div class="reward-badge-grid">'+state.badges.map(b=>{
       const got=earned.has(b.code);
       const count=b.code==='handover_star'?Number(state.mission?.all_handovers||0):
         b.code==='care_sharer'?Number(state.mission?.all_guides||0):null;
       const goal=Number(b.threshold||0),done=count===null?0:Math.min(goal,count);
       return '<article class="reward-badge-card'+(got?' achieved':'')+'">'+
         '<div class="reward-badge-top"><span class="reward-badge-icon" aria-hidden="true">'+esc(b.icon||'🏅')+'</span>'+
         '<span class="reward-badge-state">'+(got?'✓ 已獲得':'尚未獲得')+'</span></div>'+
         '<h3>'+esc(b.title)+'</h3><p>'+esc(b.description)+'</p>'+
         (count!==null?'<div class="reward-badge-meter"><span style="width:'+Math.round(done/goal*100)+'%"></span></div>'+
           '<small>累積進度 '+done+' / '+goal+'</small>':
           '<small>需居督／管理員確認新進夥伴引導紀錄</small>')+
         (got?'<small class="reward-badge-earned">取得日期：'+fmt(earned.get(b.code).awarded_at)+'</small>':'')+
         '</article>';
     }).join('')+'</div></section>';
 }
 function mentorPanel(){
   if(!reviewer())return '';
   const eligible=state.mentorCandidates.filter(p=>p.role==='staff'&&p.active&&p.user_id!==state.user?.id&&!state.mentorAlready.has(p.user_id));
   return '<section class="reward-section reward-mentor-panel"><div class="reward-section-title">'+
     '<h2>🤝 新進夥伴引導員｜授予徽章</h2><p>居督或管理員核實同仁曾協助新進夥伴熟悉個案後，填寫具體事由授予永久徽章；每人僅能獲得一次，不加點、不扣點。</p></div>'+
     (eligible.length?'<div class="reward-mentor-form"><label>授予對象<select id="rewardMentorUser"><option value="">請選擇居服員</option>'+
       eligible.map(p=>'<option value="'+esc(p.user_id)+'">'+esc(p.display_name)+'</option>').join('')+'</select></label>'+
       '<label>引導事由<textarea id="rewardMentorReason" rows="2" maxlength="300" placeholder="請填寫具體協助內容（至少 8 字）"></textarea></label>'+
       '<button id="rewardMentorGrant" type="button" class="btn">確認授予永久徽章</button></div>':
       '<div class="reward-empty">目前沒有待授予此徽章的居服員。</div>')+'</section>';
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
     esc(state.message?.text||'')+'</div>'+missionPanel()+prizeCards()+myRedemptions()+eventList()+reviewQueue()+adminQueue()+
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
       db.from('reward_redemptions').select('id,reward_title,points_cost,status,requested_at,admin_note').eq('user_id',id).order('requested_at',{ascending:false}).limit(100),
       db.rpc('my_reward_monthly_mission'),
       db.from('reward_badge_catalog').select('code,title,description,icon,threshold,sort_order').eq('active',true).order('sort_order'),
       db.from('reward_user_badges').select('badge_code,awarded_at').eq('user_id',id)
     ];
     if(reviewer()){
       query.push(db.from('handovers').select('id,case_id,author_id,author_name,summary,description,created_at,source_room_id')
         .is('source_room_id',null).order('created_at',{ascending:false}).limit(200));
       query.push(db.from('reward_handover_reviews').select('handover_id,status').limit(300));
       query.push(db.from('cases').select('id,name').limit(500));
       query.push(db.rpc('list_user_point_balances'));
       query.push(db.from('reward_user_badges').select('user_id,badge_code').eq('badge_code','mentor').limit(500));
     }
     if(admin())query.push(db.from('reward_redemptions').select('id,applicant_name,reward_title,points_cost,status,requested_at,admin_note')
       .order('requested_at',{ascending:false}).limit(200));
     const values=await Promise.all(query);
     if(seq!==state.seq)return;
     for(let i=0;i<values.length;i++)if(values[i].error)throw Error('載入點數資料失敗：'+errorText(values[i].error));
     state.balance=Number(values[0].data||0);
     state.catalog=values[1].data||[];state.events=values[2].data||[];
     state.mine=values[3].data||[];
     state.mission=(values[4].data||[])[0]||null;
     state.badges=values[5].data||[];
     state.myBadges=values[6].data||[];
     let pos=7;
     if(reviewer()){
       const hs=values[pos++].data||[],reviews=values[pos++].data||[],cases=values[pos++].data||[];
       state.caseNames=new Map(cases.map(c=>[c.id,c.name]));
       const reviewed=new Set(reviews.map(x=>x.handover_id));
       state.pending=hs.filter(h=>h.author_id&&h.author_id!==id&&!reviewed.has(h.id));
       state.reviews=reviews;
       state.mentorCandidates=values[pos++].data||[];
       state.mentorAlready=new Set((values[pos++].data||[]).map(x=>x.user_id));
     }
     if(admin())state.redemptions=values[pos]?.data||[];
     draw();
   }catch(e){if(seq===state.seq){if(root)root.innerHTML='<div class="reward-empty">點數載入失敗：'+esc(errorText(e))+
     '。<button class="btn alt" id="rewardRetry" type="button">重新讀取</button></div>';
     node('rewardRetry')?.addEventListener('click',refresh);}}
 }

 async function grantMentorBadge(){
   if(!reviewer()||state.busy)return;
   const userId=node('rewardMentorUser')?.value||'';
   const reason=node('rewardMentorReason')?.value.trim()||'';
   const person=state.mentorCandidates.find(x=>x.user_id===userId&&x.role==='staff'&&x.active);
   if(!person)return message('請先選擇一位居服員。',true);
   if(reason.length<8||reason.length>300)return message('請填寫 8～300 字的具體引導事由。',true);
   if(!window.confirm('確認「'+person.display_name+'」已實際協助新進夥伴熟悉個案？此徽章永久保留，且每人僅能取得一次。'))return;
   state.busy=true;
   const button=node('rewardMentorGrant');if(button)button.disabled=true;
   try{
     await check(await state.db.rpc('grant_reward_mentor_badge',{p_user_id:userId,p_note:reason}),'授予徽章');
     await refresh();
     message('已授予「'+person.display_name+'」新進夥伴引導員徽章。');
   }catch(e){message('授予失敗：'+errorText(e),true);}
   finally{state.busy=false;if(button)button.disabled=false}
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
   if(state.user?.id!==user.id){state.events=[];state.catalog=[];state.mission=null;state.badges=[];state.myBadges=[];state.mentorCandidates=[];state.mentorAlready=new Set();state.message=null;}
   state.db=db;state.user=user;state.profile=profile;refresh();
 }
 window.Rewards={show,refresh,destroy};
})();