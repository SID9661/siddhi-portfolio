'use strict';
const $=id=>document.getElementById(id), clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
let pages=[],nodes=[],book,current=0,busy=true,queued=null,retryAction=null,ready=false;
let zoom=1,panX=0,panY=0,highGeneration=0,resizePending=false;
let reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const cache=new Map(),inflight=new Map(),pointers=new Map();
const lastPage=()=>Math.max(0,pages.length-1);
const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
function status(message,action=null){$('status').hidden=!message;$('status-text').textContent=message||'';$('retry').hidden=!action;retryAction=action;}
function toast(message){$('toast').textContent=message;$('toast').style.opacity=1;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.opacity=0,2800);}
function mobile(){return book?book.getOrientation()==='portrait':innerWidth<760;}
function spread(p){p=clamp(p,0,lastPage());if(mobile()||p===0)return[p];const start=p%2?p:p-1;return[start,Math.min(start+1,lastPage())];}
function adjacent(p,dir){const s=spread(p);return clamp(dir>0?s[s.length-1]+1:s[0]-1,0,lastPage());}
function near(p){const s=spread(p),start=Math.max(0,s[0]-2),end=Math.min(lastPage(),s[s.length-1]+4);return Array.from({length:end-start+1},(_,i)=>start+i);}
function readImage(i){if(cache.has(i)){const img=cache.get(i);cache.delete(i);cache.set(i,img);return Promise.resolve(img);}if(inflight.has(i))return inflight.get(i);
 const promise=(async()=>{const img=new Image();img.decoding='async';img.src=pages[i].image;await img.decode();cache.set(i,img);return img;})().finally(()=>inflight.delete(i));inflight.set(i,promise);return promise;}
async function ensure(indices){await Promise.all([...new Set(indices)].filter(i=>i>=0&&i<pages.length).map(async i=>{const loaded=await readImage(i),el=nodes[i].querySelector('img');if(el.getAttribute('src')!==pages[i].image&&!el.dataset.high){el.src=loaded.src;await el.decode();}}));}
function trim(){const keep=new Set(near(current));for(const i of cache.keys()){if(cache.size<=12)break;if(!keep.has(i)){cache.delete(i);const img=nodes[i].querySelector('img');img.removeAttribute('src');delete img.dataset.high;}}}
let preloadRun=0;
async function prefetch(){const run=++preloadRun;const s=spread(current);const targets=[...near(current).filter(i=>i>s[s.length-1]),...near(current).filter(i=>i<s[0]).reverse()];for(const i of targets){if(run!==preloadRun)return;try{await ensure([i]);}catch{}if(!busy)trim();}}
function centerCover(){if(!book)return;const edge=!mobile()&&current===0;const offset=edge?book.getBoundsRect().pageWidth*-.5:0;$('book').style.transform=`translateX(${offset}px)`;}
function update(){if(!book)return;current=book.getCurrentPageIndex();const s=spread(current);$('page-input').value=current+1;$('page-input').max=pages.length;$('range').textContent=s.length===2?`–${s[1]+1}`:'';for(const id of ['prev','side-prev'])$(id).disabled=!ready||current===0;for(const id of ['next','side-next'])$(id).disabled=!ready||s.includes(lastPage());
 $('chapter').textContent=current===0?`${pages.length} PAGES · FIVE PROJECTS`:current===lastPage()?'BACK COVER':`SELECTED WORKS · ${String(current+1).padStart(2,'0')}`;
 document.querySelectorAll('.thumb').forEach((el,i)=>{if(s.includes(i))el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
 nodes.forEach((el,i)=>el.setAttribute('aria-hidden',String(!s.includes(i))));
 if(ready)history.replaceState(null,'',`#page=${current+1}`);centerCover();}
function transform(){const bounds=$('viewport').getBoundingClientRect();panX=clamp(panX,-bounds.width*(zoom-1)/2,bounds.width*(zoom-1)/2);panY=clamp(panY,-bounds.height*(zoom-1)/2,bounds.height*(zoom-1)/2);$('zoom-layer').style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;$('zoom-reset').textContent=`${Math.round(zoom*100)}%`;$('zoom-out').disabled=zoom<=1;$('zoom-in').disabled=zoom>=3;}
async function sharpen(){const generation=++highGeneration;if(zoom<=1)return;const indices=spread(current);for(const i of indices){try{const img=new Image();img.src=pages[i].zoom;await img.decode();if(generation!==highGeneration||zoom<=1||!spread(current).includes(i))return;const el=nodes[i].querySelector('img');el.src=img.src;el.dataset.high='1';}catch{toast('Sharper detail unavailable. Your page is still visible.');}}}
function setZoom(value){if(!ready||busy)return;zoom=clamp(value,1,3);if(zoom===1){panX=panY=0;++highGeneration;nodes.forEach((node,i)=>{const img=node.querySelector('img');if(img.dataset.high){img.src=pages[i].image;delete img.dataset.high;}});}transform();if(zoom>1){clearTimeout(setZoom.timer);setZoom.timer=setTimeout(sharpen,180);}}
function resetZoom(){zoom=1;panX=panY=0;++highGeneration;nodes.forEach((node,i)=>{const img=node.querySelector('img');if(img.dataset.high){img.src=pages[i].image;delete img.dataset.high;}});transform();}
async function navigate(target,animate=true){if(!ready)return;target=clamp(Math.round(target),0,lastPage());if(busy){queued={target,animate};return;}if(spread(current).includes(target))return;
 busy=true;queued=null;++preloadRun;resetZoom();const old=current;let loadingTimer=setTimeout(()=>status('Preparing the next pages…'),180);
 try{const required=[...spread(old),...spread(target)];for(let i=Math.max(0,old-2);i<=Math.min(lastPage(),old+3);i++)required.push(i);for(let i=Math.max(0,target-2);i<=Math.min(lastPage(),target+2);i++)required.push(i);await ensure(required);clearTimeout(loadingTimer);status(null);await frame();
 if(animate&&!reduced){await new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);book.off('changeState');resolve();};book.on('changeState',e=>{if(e.data==='read')done();});timer=setTimeout(()=>{book.turnToPage(target);done();},1000);book.flip(target,'bottom');});}else book.turnToPage(target);
 update();
 }catch(error){clearTimeout(loadingTimer);update();status('This page could not load. Please try again.',()=>navigate(target,animate));}
 finally{busy=false;if(resizePending){resizePending=false;await handleResize();}trim();prefetch();const next=queued;queued=null;if(next)navigate(next.target,next.animate);}}
function step(dir){const base=queued?.target??current;navigate(adjacent(base,dir));}
function toggleThumbs(open){$('thumbnails').hidden=!open;$('thumb-toggle').setAttribute('aria-expanded',String(open));if(open){const active=document.querySelector('.thumb[aria-current]');active?.scrollIntoView({block:'nearest'});$('thumb-close').focus();}else $('thumb-toggle').focus();}
function setMotion(){document.body.classList.toggle('reduced',reduced);$('motion').setAttribute('aria-pressed',String(reduced));}
async function handleResize(){if(!ready)return;if(busy){resizePending=true;return;}busy=true;resetZoom();try{await ensure(near(current));book.update();update();}catch{status('Could not prepare this layout.',handleResize);}finally{busy=false;prefetch();}}
function requestedPage(){const match=location.hash.match(/^#page=(\d+)$/);return match?clamp(Number(match[1])-1,0,lastPage()):0;}
async function init(){status('Preparing your portfolio…');try{if(!pages.length){const response=await fetch('pages.json');if(!response.ok)throw Error('Manifest unavailable');pages=await response.json();if(pages.length!==47)throw Error('Incomplete portfolio');
 nodes=pages.map((p,i)=>{const el=document.createElement('div');el.className='page';el.setAttribute('role','img');el.setAttribute('aria-label',p.label);const img=document.createElement('img');img.alt=p.label;img.draggable=false;img.width=1400;img.height=1400;el.append(img);const text=document.createElement('span');text.className='page-text';text.textContent=p.text;el.append(text);$('book').append(el);return el;});
 pages.forEach((p,i)=>{const button=document.createElement('button');button.className='thumb';button.setAttribute('aria-label',`Go to ${p.label.toLowerCase()}`);const img=document.createElement('img');img.src=p.thumbnail;img.alt='';img.loading='lazy';img.width=240;img.height=240;const span=document.createElement('span');span.textContent=String(i+1).padStart(2,'0');button.append(img,span);button.onclick=()=>{navigate(i);toggleThumbs(false);};$('thumb-grid').append(button);});}
 const start=requestedPage();await ensure([...new Set([0,1,2,...Array.from({length:Math.min(pages.length,start+5)-Math.max(0,start-2)},(_,i)=>Math.max(0,start-2)+i)])]);
 if(!book){book=new St.PageFlip($('book'),{width:600,height:600,size:'stretch',minWidth:350,maxWidth:1600,minHeight:150,maxHeight:1600,autoSize:false,showCover:true,flippingTime:700,usePortrait:true,useMouseEvents:false,showPageCorners:false,mobileScrollSupport:false,maxShadowOpacity:.22,startPage:start});book.loadFromHTML(nodes);book.on('flip',()=>{if(ready)update();});book.on('changeOrientation',()=>{if(ready){update();ensure(near(current)).catch(()=>{});}});}
 ready=true;busy=false;await frame();book.update();$('book').style.visibility='visible';status(null);update();transform();prefetch();
 }catch(error){busy=false;status('The portfolio could not load. Check your connection and retry.',init);}}
$('retry').onclick=()=>retryAction?.();['next','side-next'].forEach(id=>$(id).onclick=()=>step(1));['prev','side-prev'].forEach(id=>$(id).onclick=()=>step(-1));
$('navigation').onsubmit=e=>{e.preventDefault();const value=Number($('page-input').value);if(Number.isFinite(value)&&value>=1&&value<=pages.length)navigate(value-1);else update();$('page-input').blur();};
$('zoom-in').onclick=()=>setZoom(zoom+.5);$('zoom-out').onclick=()=>setZoom(zoom-.5);$('zoom-reset').onclick=()=>setZoom(1);
$('thumb-toggle').onclick=()=>toggleThumbs($('thumbnails').hidden);$('thumb-close').onclick=()=>toggleThumbs(false);$('motion').onclick=()=>{reduced=!reduced;setMotion();toast(reduced?'Reduced motion on':'Page-turn animation on');};setMotion();
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Fullscreen is not available in this browser.');}};if(!document.fullscreenEnabled)$('fullscreen').hidden=true;
$('share').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);toast('Link to this page copied');}catch{if(navigator.share){try{await navigator.share({title:document.title,url:location.href});}catch{}}else toast('Copy the address in your browser to share this page.');}};
window.addEventListener('hashchange',()=>navigate(requestedPage(),false));window.addEventListener('resize',()=>{clearTimeout(handleResize.timer);handleResize.timer=setTimeout(handleResize,180);});
window.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.key==='ArrowRight'){e.preventDefault();step(1);}if(e.key==='ArrowLeft'){e.preventDefault();step(-1);}if(e.key==='Home'){e.preventDefault();navigate(0);}if(e.key==='End'){e.preventDefault();navigate(lastPage());}if(e.key==='Escape'){toggleThumbs(false);setZoom(1);}if(e.key==='+'||e.key==='=')setZoom(zoom+.5);if(e.key==='-')setZoom(zoom-.5);});
let startPoint=null,pinch=null,wasPinch=false;
const distance=()=>{const [a,b]=[...pointers.values()];return Math.hypot(a.x-b.x,a.y-b.y);};
$('viewport').addEventListener('pointerdown',e=>{if(!ready||busy)return;$('viewport').setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===1){startPoint={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,time:Date.now()};wasPinch=false;}if(pointers.size===2){wasPinch=true;pinch={distance:distance(),zoom};}});
$('viewport').addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId)||busy)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2&&pinch)setZoom(pinch.zoom*distance()/pinch.distance);else if(zoom>1&&startPoint){panX+=e.clientX-startPoint.lastX;panY+=e.clientY-startPoint.lastY;transform();}if(startPoint){startPoint.lastX=e.clientX;startPoint.lastY=e.clientY;}});
function pointerEnd(e){if(!pointers.has(e.pointerId))return;pointers.delete(e.pointerId);if(!pointers.size&&startPoint){const dx=e.clientX-startPoint.x,dy=e.clientY-startPoint.y;if(!wasPinch&&zoom===1&&Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.2)step(dx<0?1:-1);startPoint=null;pinch=null;}else if(startPoint){const p=[...pointers.values()][0];startPoint.lastX=p.x;startPoint.lastY=p.y;}}
$('viewport').addEventListener('pointerup',pointerEnd);$('viewport').addEventListener('pointercancel',()=>{pointers.clear();startPoint=null;pinch=null;});$('viewport').addEventListener('dblclick',()=>setZoom(zoom>1?1:2));$('viewport').addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();setZoom(zoom-e.deltaY*.008);}else if(zoom>1){e.preventDefault();panX-=e.deltaX;panY-=e.deltaY;transform();}},{passive:false});
init();
