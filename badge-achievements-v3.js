/* 安護交班成就收藏 v3: 10 個新動態徽章 + 舊 3 個，僅在經授權後顯示。 */
'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const fmt=x=>x?new Date(x).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei'}):'';
 const roles={staff:'居服員',supervisor:'居督',admin:'管理員'};
 const sprites=['handover_first','handover_partner','care_observer','safety_guardian','monthly_star','handover_constellation','care_notebook','handover_fifty','support_hero','legendary_caregiver'];
 const state={db:null,user:null,profile:null,seq:0,busy:false,badges:[],mine:[],progress:[],cases:[],people:[],evidence:[],lastUser:null};
 const authorized=()=>state.user?.id&&state.db&&state.profile?.active;
 const reviewer=()=>['admin','supervisor'].includes(state.profile?.role);
 const message=(msg,isError)=>{const box=$('badgeV3Status');if(box){box.textContent=msg;box.hidden=!msg;box.className='badge-v3-status'+(isError?' error':'')}};
 function stop(){state.seq++;state.db=null;state.user=null;state.profile=null;state.badges=[];state.mine=[];state.progress=[];state.cases=[];state.people=[];state.evidence=[];state.lastUser=null;state.busy=false;}
 function awardImage(b,won){
   const idx=sprites.indexOf(b.code);
   // 原本兩枚 Emoji 徽章也使用小尺寸固定位置的動態盾牌，保留既有解鎖資料。
   const originalTwo={handover_star:0,care_sharer:1}[b.code];
   if(originalTwo!==undefined)return '<span role="img" aria-label="'+esc(b.title)+'動畫徽章" class="badge-v3-image badge-v3-original-two badge-v3-original-two-'+originalTwo+(won?'':' is-locked')+'"></span>';
   if(b.code==='mentor')return '<span role="img" aria-label="'+esc(b.title)+'動畫徽章" class="badge-v3-image badge-v3-mentor'+(won?'':' is-locked')+'"></span>';
   if(idx<0)return '<span class="badge-v3-legacy" aria-hidden="true">'+esc(b.icon||'🏅')+'</span>';
   return '<span role="img" aria-label="'+esc(b.title)+'動畫徽章" class="badge-v3-image badge-v3-image-'+idx+(won?'':' is-locked')+'">'+
    '<span class="badge-v3-image-fallback" aria-hidden="true">'+esc(b.icon||'🏅')+'</span></span>';
 }
 function draw(){
   const root=$('achievementsV3Root');if(!root||!authorized())return;
   const mine=new Map(state.mine.map(b=>[b.badge_code,b]));
   const progress=new Map(state.progress.map(p=>[p.code,p]));
   const unlocked=state.badges.filter(b=>mine.has(b.code)).length;
   root.innerHTML='<section class="reward-section badge-v3-section">'+
      '<div class="reward-section-title"><h2>🏅 我的成就徽章 <span class="badge-v3-counter">'+unlocked+' / '+state.badges.length+'</span></h2>'+
      '<p>共 13 種可收藏成就，包含新增的 10 款動態徽章。達成條件解鎖；灰色徽章代表尚未獲得。所有徽章永久保留，不會額外加點或扣點。</p></div>'+
      '<div class="badge-v3-gallery">'+state.badges.map(b=>{
       const won=mine.has(b.code),raw=progress.get(b.code);
       const total=b.threshold?Number(b.threshold):0;
       const current=Number(raw?.progress||0);
       const percent=total?Math.round(Math.min(1,current/total)*100):0;
       return '<article class="badge-v3-card'+(won?' earned':'')+'">'+
        '<div class="badge-v3-picture">'+awardImage(b,won)+'</div>'+
        '<div class="badge-v3-name">'+esc(b.title)+'</div>'+
        '<div class="badge-v3-rarity">'+(won?'✓ 已獲得':'🔒 尚未解鎖')+'</div>'+
        '<p class="badge-v3-description">'+esc(b.description)+'</p>'+
        (total?'<div class="badge-v3-progress" role="progressbar" aria-valuemin="0" aria-valuemax="'+total+'" aria-valuenow="'+(won?total:Math.min(total,current))+'">'+
           '<span style="width:'+(won?100:percent)+'%"></span></div><div class="badge-v3-amount">'+
           (won?total:Math.min(total,current))+' / '+total+'</div>':
           '<div class="badge-v3-amount">由主管核實並授予</div>')+
        (won?'<div class="badge-v3-earned">解鎖：'+fmt(mine.get(b.code).awarded_at)+'</div>':'')+
       '</article>';
      }).join('')+'</div></section>'+
      (reviewer()?verificationForm():'');
   $('badgeV3Submit')?.addEventListener('click',submitVerification);
 }
 function verificationForm(){
   const employees=state.people.filter(p=>p.role==='staff'&&p.active&&p.user_id!==state.user.id);
   const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
   return '<section class="reward-section badge-v3-verification">'+
    '<div class="reward-section-title"><h2>📋 專業成就核實</h2><p>照顧觀察家、安心守護者及支援小英雄，需要居督或管理員根據實際服務核實。每人同個案、同日期、同類別只能登錄一次；累積 5 筆後自動取得徽章，不會因此加點。</p></div>'+
    '<div id="badgeV3Status" role="status" class="badge-v3-status" hidden></div>'+
    (employees.length&&state.cases.length?'<div class="badge-v3-form">'+
      '<label>成就類型<select id="badgeV3Kind"><option value="care_observer">照顧觀察家｜具體觀察</option><option value="safety_guardian">安心守護者｜安全預防</option><option value="support_hero">支援小英雄｜臨時代班</option></select></label>'+
      '<label>居服員<select id="badgeV3User"><option value="">選擇居服員</option>'+employees.map(p=>'<option value="'+esc(p.user_id)+'">'+esc(p.display_name)+'</option>').join('')+'</select></label>'+
      '<label>個案<select id="badgeV3Case"><option value="">選擇有權限的個案</option>'+state.cases.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('')+'</select></label>'+
      '<label>服務日期<input type="date" id="badgeV3Date" max="'+date+'"></label>'+
      '<label class="badge-v3-full">核實說明<textarea rows="3" maxlength="500" id="badgeV3Note" placeholder="至少 12 字：請記載實際觀察、預防措施或代班完成情形。避免填寫不必要的個案隱私資訊。"></textarea></label>'+
      '<button type="button" class="btn badge-v3-full" id="badgeV3Submit">確認核實成就紀錄</button></div>':
      '<div class="reward-empty">目前沒有可核實的員工或授權個案。</div>')+
      (state.evidence.length?'<details class="badge-v3-history"><summary>最近核實紀錄（'+state.evidence.length+'）</summary><div class="reward-entries">'+state.evidence.slice(0,20).map(e=>{
       const person=state.people.find(p=>p.user_id===e.user_id)?.display_name||'居服員';
       const title={care_observer:'照顧觀察',safety_guardian:'安全預防',support_hero:'臨時支援'}[e.category]||e.category;
       return '<div class="reward-entry"><div><strong>'+esc(title)+' · '+esc(person)+'</strong><small>'+esc(e.service_date)+' · '+esc(state.cases.find(c=>c.id===e.case_id)?.name||'授權個案')+'</small></div></div>';
      }).join('')+'</div></details>':'')+'</section>';
 }
 async function submitVerification(){
   if(!reviewer()||state.busy)return;
   const kind=$('badgeV3Kind')?.value,who=$('badgeV3User')?.value,caseId=$('badgeV3Case')?.value,date=$('badgeV3Date')?.value,note=$('badgeV3Note')?.value?.trim();
   if(!who||!caseId||!date)return message('請選擇居服員、個案及服務日期。',true);
   if(!note||note.length<12||note.length>500)return message('請填寫12～500字的具體核實說明。',true);
   const person=state.people.find(p=>p.user_id===who&&p.role==='staff'&&p.active);
   if(!person)return message('找不到已啟用的居服員，請重新整理。',true);
   if(!window.confirm('確定核實「'+person.display_name+'」於 '+date+' 完成此項服務？同案同日同類別只能登錄一次。'))return;
   state.busy=true;
   const button=$('badgeV3Submit');if(button)button.disabled=true;
   try{
    const r=await state.db.rpc('verify_badge_contribution',{p_user_id:who,p_category:kind,p_case_id:caseId,p_service_date:date,p_note:note});
    if(r.error)throw r.error;
    await refresh();
    message('核實成功！符合條件的居服員已累積一次成就進度。',false);
   }catch(e){message('核實未完成：'+String(e?.message||'請稍後再試').slice(0,220),true)}
   finally{state.busy=false;if(button)button.disabled=false;}
 }
 async function refresh(){
   if(!authorized())return;
   const seq=++state.seq;
   const root=$('achievementsV3Root');if(!root)return;
   if(!state.badges.length)root.innerHTML='<div class="reward-empty">正在載入成就徽章…</div>';
   const db=state.db,id=state.user.id;
   try{
    const tasks=[
      db.from('reward_badge_catalog').select('code,title,description,icon,threshold,sort_order').eq('active',true).order('sort_order'),
      db.from('reward_user_badges').select('badge_code,awarded_at').eq('user_id',id),
      db.rpc('my_badge_progress')
    ];
    if(reviewer())tasks.push(
      db.rpc('list_user_point_balances'),
      db.from('cases').select('id,name').order('name').limit(500),
      db.from('reward_badge_evidence').select('user_id,case_id,category,service_date,verified_at').order('verified_at',{ascending:false}).limit(100)
    );
    const results=await Promise.all(tasks);
    if(seq!==state.seq||!authorized())return;
    for(const r of results)if(r.error)throw r.error;
    state.badges=results[0].data||[];state.mine=results[1].data||[];state.progress=results[2].data||[];
    if(reviewer()){state.people=results[3].data||[];state.cases=results[4].data||[];state.evidence=results[5].data||[];}
    draw();
   }catch(e){if(seq===state.seq)root.innerHTML='<div class="reward-empty">徽章讀取失敗：'+esc(e.message||'請稍後重試')+'。<button id="badgeV3Retry" class="btn alt" type="button">重新載入</button></div>';
    $('badgeV3Retry')?.addEventListener('click',refresh);
   }
 }
 function mount(ctx){
   if(!ctx?.db||!ctx.user?.id||!ctx.profile?.active){stop();return}
   if(state.lastUser!==ctx.user.id){stop();state.lastUser=ctx.user.id}
   state.db=ctx.db;state.user=ctx.user;state.profile=ctx.profile;
   refresh();
 }
 window.BadgeAchievements={mount,refresh,destroy:stop};
})();