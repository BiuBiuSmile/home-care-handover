/* 安護交班 · private, EXIF-stripped handover image attachments. */
'use strict';
(function(){
 const BUCKET='handover-photos',LIMIT=3,MAX_SOURCE_BYTES=16*1024*1024;
 const views=new Map(),cached=new Map();
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const error=e=>String(e?.message||'照片處理失敗').slice(0,240);
 function chosen(input){
   const files=Array.from(input?.files||[]);
   if(files.length>LIMIT)throw Error('每次最多只能上傳 3 張照片。');
   for(const f of files){
     if(!['image/jpeg','image/png','image/webp'].includes(f.type))throw Error('僅支援 JPG、PNG、WebP 照片。');
     if(f.size>MAX_SOURCE_BYTES)throw Error('單張來源照片不可超過 16 MB。');
   }
   return files;
 }
 function clearPreview(target){
   if(!target)return;
   for(const url of views.get(target)||[])URL.revokeObjectURL(url);
   views.delete(target);target.innerHTML='';
 }
 function preview(input,target){
   clearPreview(target);
   try{
     const files=chosen(input),urls=[];
     if(!files.length)return;
     for(const f of files)urls.push(URL.createObjectURL(f));
     views.set(target,urls);
     target.innerHTML='<div class="handover-photo-preview-list">'+
       files.map((f,i)=>'<div class="handover-photo-preview-item"><img src="'+esc(urls[i])+'" alt="待上傳照片 '+(i+1)+'"><span>照片 '+(i+1)+'</span></div>').join('')+
       '</div><small>照片會壓縮成 JPG，並移除拍攝資訊。每則最多 3 張。</small>';
   }catch(e){
     if(input)input.value='';
     target.textContent=error(e);
     throw e;
   }
 }
 async function prepare(file){
   const source=await createImageBitmap(file).catch(()=>{throw Error('照片無法開啟，請改用 JPG、PNG 或 WebP。');});
   const max=1600,ratio=Math.min(1,max/Math.max(source.width,source.height));
   let w=Math.max(1,Math.round(source.width*ratio)),h=Math.max(1,Math.round(source.height*ratio));
   const canvas=document.createElement('canvas');let blob;
   for(let i=0;i<5;i++){
     canvas.width=w;canvas.height=h;
     const ctx=canvas.getContext('2d');
     if(!ctx)throw Error('瀏覽器不支援圖片壓縮。');
     ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(source,0,0,w,h);
     blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.83-i*0.10));
     if(blob&&blob.size<=2*1024*1024)break;
     w=Math.max(1,Math.round(w*0.83));h=Math.max(1,Math.round(h*0.83));
   }
   source.close?.();
   if(!blob||blob.size>2*1024*1024)throw Error('照片壓縮後仍超過 2 MB，請縮小後重試。');
   return blob;
 }
 async function uploadSelected({input,db,userId,caseId,roomId}){
   const files=chosen(input);
   if(!files.length)return [];
   if(!db||!userId||!caseId&&!roomId)throw Error('交班身分未準備完成。');
   const prefix=roomId?'room/'+roomId+'/':'formal/'+caseId+'/';
   const created=[];
   try{
     for(const file of files){
       const blob=await prepare(file);
       const path=prefix+userId+'/'+crypto.randomUUID()+'.jpg';
       const {error:uploadError}=await db.storage.from(BUCKET)
         .upload(path,blob,{contentType:'image/jpeg',upsert:false,cacheControl:'3600'});
       if(uploadError)throw uploadError;
       created.push(path);
     }
     return created;
   }catch(e){await removeUnlinked(db,created);throw Error('圖片上傳失敗：'+error(e));}
 }
 async function removeUnlinked(db,paths){
   if(!db||!paths?.length)return;
   try{await db.storage.from(BUCKET).remove(paths)}catch(_){/* best effort cleanup only */}
 }
 function markup(paths){
   if(!Array.isArray(paths)||!paths.length)return '';
   return '<div class="handover-photo-attachments" aria-label="交班照片">'+
     paths.slice(0,LIMIT).map((path,i)=>
       '<button type="button" class="handover-photo-thumb" data-handover-photo-path="'+esc(path)+
       '" aria-label="查看交班照片 '+(i+1)+'"><span class="handover-photo-loading">🖼️ 照片 '+(i+1)+'</span></button>').join('')+
     '</div>';
 }
 async function getPhoto(path,db){
   if(cached.has(path))return cached.get(path);
   const {data,error:loadError}=await db.storage.from(BUCKET).download(path);
   if(loadError||!data)throw loadError||Error('無法讀取照片');
   if(cached.size>=100){
      const [old,url]=cached.entries().next().value;URL.revokeObjectURL(url);cached.delete(old);
   }
   const url=URL.createObjectURL(data);cached.set(path,url);return url;
 }
 function openLightbox(url){
   let dlg=document.getElementById('handoverPhotoDialog');
   if(!dlg){
      dlg=document.createElement('dialog');dlg.id='handoverPhotoDialog';dlg.className='handover-photo-dialog';
      const close=document.createElement('button');close.type='button';close.className='handover-photo-close';close.textContent='✕ 關閉';
      const image=document.createElement('img');image.alt='交班照片放大檢視';
      close.addEventListener('click',()=>dlg.close());
      dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close()});
      dlg.append(close,image);document.body.appendChild(dlg);
   }
   dlg.querySelector('img').src=url;dlg.showModal();
 }
 async function hydrate(root,db){
   if(!root||!db)return;
   const buttons=Array.from(root.querySelectorAll('[data-handover-photo-path]'));
   await Promise.all(buttons.map(async b=>{
     const path=b.dataset.handoverPhotoPath;
     try{
       const url=await getPhoto(path,db);
       if(!b.isConnected||b.dataset.handoverPhotoPath!==path)return;
       const img=document.createElement('img');img.loading='lazy';img.alt='交班附圖';
       img.src=url;b.replaceChildren(img);
       b.onclick=()=>openLightbox(url);
     }catch(_){
       if(b.isConnected)b.textContent='🔒 無權限或照片無法載入';
     }
   }));
 }
 function destroy(){
   const dlg=document.getElementById('handoverPhotoDialog');if(dlg){if(dlg.open)dlg.close();dlg.remove()}
   for(const url of cached.values())URL.revokeObjectURL(url);
   cached.clear();
   for(const [el] of views)clearPreview(el);
 }
 window.HandoverPhotos={preview,clearPreview,chosen,uploadSelected,removeUnlinked,markup,hydrate,destroy};
})();
