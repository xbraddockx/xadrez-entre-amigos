/* Xadrez Entre Amigos · frontend sem dependências externas */
let site = null;
let preview = {pairs:[],byes:[]};
let admin = false;
let toastTimer;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nameFor = id => site?.players.find(p=>p.id===id);
const rating = p => `${p?.rating ?? '—'}${p?.provisional ? '?' : ''}`;
const profile = p => p ? `https://lichess.org/@/${encodeURIComponent(p.nick)}` : '#';
const localDate = value => value ? new Date(value).toLocaleString('pt-BR',{timeZone:'America/Recife',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+' (Recife)' : '—';
const toast = message => {const n=$('#toast'); n.textContent=message; n.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>n.classList.remove('show'),4000)};
async function api(path, options={}){
  const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers},credentials:'same-origin'});
  let data; try{data=await res.json()}catch{data={}};
  if(!res.ok){const d=data.detail;throw new Error(typeof d==='string'?d:Array.isArray(d)?d.map(x=>x.msg).join('; '):'Não foi possível concluir.');}
  return data;
}
async function refresh(quiet=false){
 try{
  site=await api('/api/state');
  if(site.status==='registration') preview=await api('/api/preview');
  render();
 }catch(e){if(!quiet)toast(e.message)}
}
function tab(name){
 $$('.content-tab').forEach(el=>el.classList.toggle('hidden',el.id!==`tab-${name}`));
 $$('.nav-btn').forEach(el=>el.classList.toggle('active',el.dataset.tab===name));
 if(name==='admin') checkAdmin();
 if(name==='chaves') renderBracket();
 window.scrollTo({top:0,behavior:'smooth'});
}
function phaseName(){return site.status==='registration'?'Inscrições':site.status==='finished'?'Finalizado':`Rodada ${site.round}`}
function render(){
 if(!site)return;
 $('#stat-players').textContent=site.players.length;
 $('#stat-phase').textContent=phaseName();
 $('#stat-time').textContent=site.status==='active'?'Até '+localDate(site.deadline):site.status==='finished'?'Encerrado':'5 dias';
 $('#status-pill').innerHTML = `<span class="pulse"></span>${site.status==='registration'?' Inscrições abertas':site.status==='active'?' Torneio em andamento':' Torneio encerrado'}`;
 const locked=site.status!=='registration';
 $$('#signup-form input').forEach(i=>i.disabled=locked);
 $('#signup-submit').disabled=locked;
 $('#signup-submit').innerHTML=locked?'Inscrições encerradas':'Confirmar inscrição <span>↗</span>';
 $('#player-counter').textContent=`${site.players.length} jogador${site.players.length===1?'':'es'}`;
 const sorted=[...site.players].sort((a,b)=>b.rating-a.rating);
 $('#player-list').innerHTML=sorted.length?sorted.map(p=>`<div class="player-row"><div class="player-info"><div class="avatar">${esc(p.name.charAt(0).toUpperCase())}</div><div><strong>${esc(p.name)}</strong><a href="${profile(p)}" target="_blank" rel="noopener noreferrer">@${esc(p.nick)} ↗</a></div></div><div class="rating">${rating(p)}<small>${p.rating_official!==null?'Rapid Lichess':p.verified?'Rating informado':'Não verificado'}</small></div></div>`).join(''):
 `<div class="empty"><span class="empty-mark">♙</span><strong>O tabuleiro está pronto.</strong><p>Os jogadores aparecerão aqui assim que se inscreverem.</p></div>`;
 renderBracket();
 if(admin)renderAdmin();
}
function playerLine(p,winner=false){return `<span class="match-player ${winner?'win':''}" title="${esc(p?.name||'')}">${p?`<a href="${profile(p)}" target="_blank" rel="noopener noreferrer">${esc(p.nick)}</a>`:'A definir'}</span><span class="match-rating">${p?rating(p):''}</span>`}
function bracketCard(item, i, isPreview=false){
 const p1=nameFor(isPreview?item[0]:item.p1);
 const p2=nameFor(isPreview?item[1]:item.p2);
 const bye=!p2;
 const status=isPreview?(bye?'Folga':'Prévia'):item.status==='bye'?'Folga':item.status==='pending'?'Pendente':item.status==='draw_pending'?'Desempate':item.status==='double_wo'?'Dois W.O.':item.status==='wo'?'W.O.':'Concluído';
 const winId=isPreview?bye?p1.id:null:item.winner;
 const draw=item.status==='draw_pending';
 return `<article class="match-card"><div class="match-top"><span>CONFRONTO ${i+1}</span><span class="${isPreview?'pending':item.status==='complete'?'complete':'pending'}">${status}</span></div><div class="versus">${playerLine(p1,winId===p1?.id)}</div><div class="versus">${bye?'<span class="bye-tag">Avança sem adversário</span>':playerLine(p2,winId===p2?.id)}</div>${!isPreview&&item.game_url?`<a class="game-link" href="${esc(item.game_url)}" target="_blank" rel="noopener noreferrer">Ver partida no Lichess ↗</a>`:''}${!isPreview&&draw?'<div class="game-link">Empate: é necessário desempate 10+0</div>':''}</article>`;
}
function renderBracket(){
 if(!site)return;
 const area=$('#bracket-area');
 if(site.status==='registration'){
  $('#bracket-subtitle').textContent='Prévia que muda conforme chegam os inscritos. O organizador fecha as inscrições antes do sorteio oficial.';
  const rows=[...(preview.pairs||[]),...(preview.byes||[]).map(i=>[i,null])];
  if(site.players.length<2){area.innerHTML='<div class="panel bracket-empty"><div class="empty"><span class="empty-mark">♜</span><strong>Aguardando inscrições</strong><p>Com pelo menos dois jogadores, o sistema mostrará os possíveis duelos.</p></div></div>';return}
  area.innerHTML=`<div class="deadline-note"><span><strong>Sorteio provisório</strong> · Os confrontos serão confirmados apenas no início do torneio.</span><span>${site.players.length} inscritos</span></div><div class="round-heading"><h3>Prévia da 1ª rodada</h3><small>${preview.pairs.length} confrontos</small></div><div class="preview-match-grid">${rows.map((r,i)=>bracketCard(r,i,true)).join('')}</div>`;
  return;
 }
 $('#bracket-subtitle').textContent='Confrontos oficiais. Cada rodada só começa quando os resultados da anterior são confirmados.';
 let html='';
 if(site.status==='finished'){
  const champ=nameFor(site.champion_id);
  html+=`<div class="champion"><div><small>CAMPEÃO DO TORNEIO</small><h3>${champ?esc(champ.name):'Sem campeão'}</h3><span>${champ?'@'+esc(champ.nick)+' · '+rating(champ)+' Rapid':'Todos os participantes foram eliminados por W.O.'}</span></div><span class="crown">♛</span></div>`;
 }
 if(site.status==='active')html+=`<div class="deadline-note"><span><strong>Rodada ${site.round}</strong> · Os adversários devem combinar a partida até o 2º dia.</span><span><strong>Prazo final:</strong> ${localDate(site.deadline)}</span></div>`;
 const groups={};site.matches.forEach(m=>(groups[m.round]??=[]).push(m));
 html+='<div class="bracket-scroll"><div class="bracket-grid">'+Object.entries(groups).map(([round,matches])=>`<section class="round-col"><div class="round-heading"><h3>${Number(round)===1?'1ª':round+'ª'} rodada</h3><small>${matches.length} posições</small></div>${matches.map((m,i)=>bracketCard(m,i)).join('')}</section>`).join('')+'</div></div>';
 area.innerHTML=html;
}
async function checkAdmin(){
 try{const d=await api('/api/admin/session');admin=d.authenticated;$('#admin-login-box').classList.toggle('hidden',admin);$('#admin-dashboard').classList.toggle('hidden',!admin);if(admin)renderAdmin();if(!d.enabled&&!admin)$('#login-message').textContent='O servidor precisa ter ADMIN_PASSWORD configurada.'}catch(e){toast(e.message)}
}
function renderAdmin(){
 if(!site||!admin)return;
 const controls=$('#admin-controls');
 if(site.status==='registration'){
  controls.innerHTML=`<div class="admin-action-row"><div><h3>Encerrar inscrições e iniciar a copa</h3><p>Ao iniciar, o chaveamento é sorteado e publicado. Novas inscrições não serão aceitas. Cada rodada terá 5 dias corridos.</p></div><button id="start-tourney" class="btn primary" ${site.players.length<2?'disabled':''}>Realizar sorteio oficial →</button></div><section class="admin-players"><h3>Gerenciar inscrições (${site.players.length})</h3>${site.players.map(p=>`<div class="admin-player-row"><span><strong>${esc(p.name)}</strong> · @${esc(p.nick)} · ${rating(p)} ${p.rating_official!==null?'(oficial)':'(informado)'}</span><button data-delete-player="${p.id}">Remover</button></div>`).join('')}</section>`;
  $('#admin-match-list').innerHTML='';return;
 }
 const current=site.matches.filter(m=>m.round===site.round);
 const pending=current.filter(m=>['pending','draw_pending'].includes(m.status));
 controls.innerHTML=site.status==='active'?`<div class="admin-action-row"><div><h3>Rodada ${site.round} em andamento</h3><p>Encerramento: ${localDate(site.deadline)}. Restam ${pending.length} partida(s) sem resultado. ${Date.now()>new Date(site.deadline).getTime()?'O prazo terminou: revise os W.O. pendentes.':''} Registre o vencedor ou W.O. para liberar a próxima rodada.</p></div><button id="next-round" class="btn primary" ${pending.length?'disabled':''}>${pending.length?'Aguardando partidas':'Concluir rodada →'}</button></div>`:`<div class="admin-action-row"><div><h3>Copa encerrada</h3><p>Campeão: ${site.champion_id?esc(nameFor(site.champion_id)?.name):'Não houve campeão'}. O histórico permanece público no chaveamento.</p></div></div>`;
 $('#admin-match-list').innerHTML=site.status==='active'?`<section class="admin-results"><h3>Resultados da rodada ${site.round}</h3><div class="admin-help" style="padding:15px 20px 0">Use “Buscar no Lichess” para encontrar partidas oficiais 10+0 entre os adversários. Confirme manualmente qual partida pertence ao torneio.</div>${current.map(m=>{
 const p1=nameFor(m.p1),p2=nameFor(m.p2);
 const desc=m.status==='bye'?'Classificação automática':m.status==='complete'?'Resultado registrado':m.status==='double_wo'?'Ambos eliminados':m.status==='wo'?'Vitória por W.O.':m.status==='draw_pending'?'Empate, falta desempate':'Aguardando resultado';
 return `<article class="admin-match-card"><div class="admin-match-summary"><div><strong>${esc(p1?.nick)} ${p2?'× '+esc(p2.nick):'· FOLGA'}</strong><small>${desc}${m.game_url?' · <a href="'+esc(m.game_url)+'" target="_blank" rel="noopener">Ver partida ↗</a>':''}</small></div>${p2?`<div class="action-buttons"><button data-edit="${m.id}">Lançar resultado</button><button class="api-btn" data-lookup="${m.id}">Buscar no Lichess ↗</button></div>`:''}</div><div id="admin-detail-${m.id}"></div></article>`;
 }).join('')}</section>`:'';
}
function editMatch(id){
 const match=site.matches.find(m=>m.id===id),p1=nameFor(match.p1),p2=nameFor(match.p2);
 const area=$(`#admin-detail-${id}`);
 area.innerHTML=`<form class="admin-edit result-form" data-match-id="${id}"><label>Resultado</label><select name="choice" required><option value="p1">Vitória de ${esc(p1.nick)}</option><option value="p2">Vitória de ${esc(p2.nick)}</option><option value="p1_wo">${esc(p1.nick)} vence por W.O.</option><option value="p2_wo">${esc(p2.nick)} vence por W.O.</option><option value="draw">Empate (aguarda desempate 10+0)</option><option value="double">Dois W.O. (ambos eliminados)</option></select><label>Link da partida (opcional)</label><input name="game_url" type="url" placeholder="https://lichess.org/abcdefgh" value="${esc(match.game_url||'')}"/><label>Observação (opcional)</label><textarea name="notes" maxlength="300" placeholder="Ex.: W.O. após 15 minutos de tolerância"></textarea><button class="btn primary slim" type="submit">Salvar resultado</button></form>`;
 area.querySelector('select').value=match.status==='double_wo'?'double':match.status==='draw_pending'?'draw':match.status==='wo'?(match.winner===match.p2?'p2_wo':'p1_wo'):match.winner===match.p2?'p2':'p1';
}
async function lookupGames(id){
 const area=$(`#admin-detail-${id}`);area.innerHTML='<div class="admin-edit">Consultando histórico público do Lichess…</div>';
 try{const data=await api(`/api/admin/matches/${id}/lichess`);
  area.innerHTML=`<div class="admin-edit"><p class="admin-help">Foram consideradas apenas partidas concluídas de 10+0, entre os dois nicks, durante o prazo da rodada. O organizador deve confirmar se o jogo realmente valeu pelo torneio.</p>${data.games.length?`<div class="candidate-list">${data.games.map(g=>`<div class="candidate"><span><strong>${g.draw?'Empate':'Vitória de '+esc(nameFor(g.winner_id)?.nick||'')}</strong><br>${localDate(g.created_at)} · <a href="${g.url}" target="_blank" rel="noopener noreferrer">Ver partida ↗</a></span><button data-confirm-game="${g.id}" data-match="${id}">${g.draw?'Registrar empate':'Confirmar resultado'}</button></div>`).join('')}</div>`:'<p class="admin-help">Nenhuma partida elegível encontrada. Você pode lançar o resultado manualmente.</p>'}</div>`;
 }catch(e){area.innerHTML=`<div class="admin-edit"><p class="admin-help">${esc(e.message)}</p><button data-edit="${id}" class="small-link">Lançar manualmente</button></div>`}
}
async function doAction(path,options,confirmText){
 if(confirmText&&!confirm(confirmText))return;
 try{const r=await api(path,options);toast(r.message||'Atualizado.');await refresh();}
 catch(e){toast(e.message)}
}
// Navegação e controles globais
$$('[data-tab]').forEach(el=>el.addEventListener('click',()=>tab(el.dataset.tab)));
$('#refresh-button').addEventListener('click',()=>refresh());
$('#signup-form').addEventListener('submit',async e=>{
 e.preventDefault();const form=e.currentTarget,btn=$('#signup-submit'),msg=$('#signup-message');
 btn.disabled=true;msg.className='form-message';msg.textContent='Conferindo usuário e rating…';
 try{const d=await api('/api/register',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form).entries()))});
 msg.className='form-message success';msg.textContent=d.player.rating_official!==null?`Inscrito! Rating Rapid oficial utilizado: ${d.player.rating}${d.player.provisional?'?':''}.`:'Inscrição realizada! Rating informado salvo.';
 form.reset();await refresh();
 }catch(error){msg.className='form-message error';msg.textContent=error.message}
 finally{btn.disabled=site?.status!=='registration'}
});
$('#login-form').addEventListener('submit',async e=>{
 e.preventDefault();let msg=$('#login-message');
 try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('#admin-password').value})});msg.textContent='';$('#admin-password').value='';await checkAdmin();}
 catch(err){msg.className='form-message error';msg.textContent=err.message}
});
$('#logout-button').addEventListener('click',()=>doAction('/api/admin/logout',{method:'POST'}).then(()=>{admin=false;checkAdmin()}));
$('#admin-dashboard').addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.id==='start-tourney')doAction('/api/admin/start',{method:'POST'},'Encerrar definitivamente as inscrições e sortear a primeira rodada?');
 if(b.id==='next-round')doAction('/api/admin/next-round',{method:'POST'},'Confirmar todos os resultados e iniciar a próxima rodada?');
 if(b.dataset.deletePlayer)doAction(`/api/admin/players/${b.dataset.deletePlayer}`,{method:'DELETE'},'Remover este jogador da inscrição?');
 if(b.dataset.edit)editMatch(Number(b.dataset.edit));
 if(b.dataset.lookup)lookupGames(Number(b.dataset.lookup));
 if(b.dataset.confirmGame)doAction(`/api/admin/matches/${b.dataset.match}/use-game`,{method:'POST',body:JSON.stringify({game_id:b.dataset.confirmGame})},'Confirmar que esta partida pertence ao torneio e lançar o resultado?');
});
$('#admin-dashboard').addEventListener('submit',async e=>{
 const form=e.target.closest('.result-form');if(!form)return;e.preventDefault();
 const payload=Object.fromEntries(new FormData(form).entries());
 await doAction(`/api/admin/matches/${form.dataset.matchId}/result`,{method:'POST',body:JSON.stringify(payload)},'Confirmar e publicar este resultado?');
});
refresh();setInterval(()=>refresh(true),30000);