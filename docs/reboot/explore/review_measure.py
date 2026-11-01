# 主审测量脚本：python3 review.py dNN  → 打印 JSON，结果追加到 review.jsonl
# 用浏览器内 JS 量：面板越界、文字截断、字号/字重集合、可点控件尺寸、禁用字号、百分比出现在异常面板中
MEASURE_JS = r"""
JSON.stringify((()=>{
 const q=(s,r=document)=>[...r.querySelectorAll(s)];
 const stages=q('.stage');
 const txt=q('.panel *').filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&getComputedStyle(e).display!=='none'&&e.offsetParent!==null);
 const fonts=[...new Set(txt.map(e=>parseFloat(getComputedStyle(e).fontSize)))].sort((a,b)=>a-b);
 const weights=[...new Set(txt.map(e=>getComputedStyle(e).fontWeight))].sort();
 const trunc=txt.filter(e=>e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflow!=='visible').map(e=>e.textContent.trim().slice(0,20));
 const out=stages.map((s,i)=>{const sr=s.getBoundingClientRect();return q('.panel',s).filter(p=>{const r=p.getBoundingClientRect();return r.right>sr.right+.5||r.left<sr.left-.5||r.bottom>sr.bottom+.5||r.top<sr.top-.5}).length});
 const panels=q('.panel').map(p=>{const r=p.getBoundingClientRect();const cs=getComputedStyle(p);return {w:Math.round(r.width),h:Math.round(r.height),bf:(cs.backdropFilter||cs.webkitBackdropFilter||'none').slice(0,40)}});
 const clickables=q('.panel button,.panel [role=button],.panel a,.panel [onclick],.panel .btn,.panel .icon,.panel .cmd,.panel .pcmd').map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.width),Math.round(r.height)]}).filter(([w,h])=>w>0);
 const small=clickables.filter(([w,h])=>w<28||h<28).length;
 const issueText=stages.length>=4?q('.panel',stages[2]).concat(q('.panel',stages[3])).map(p=>p.innerText).join(' '):'';
 const badPct=/客户 ?A[^\n]{0,40}(0%|100%)/.test(issueText);
 const emoji=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(q('.panel').map(p=>p.innerText).join(''));
 return {stages:stages.length,panels,fonts,weights,trunc:trunc.slice(0,6),outOfStage:out,clickables:clickables.length,smallTargets:small,badPct,emoji};
})())
"""
