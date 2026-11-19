/* Xadrez Entre Amigos · frontend sem dependências externas */
let site = null;
let archiveId = 0;
let editions = [];
let newEditionOpen = false;
let preview = {pairs:[],byes:[]};
let admin = false;
let toastTimer;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nameFor = id => site?.players.find(p=>p.id===id);
const rating = p => `${p?.rating ?? '—'}${p?.provisional ? '?' : ''}`;
const timeLabel = () => `${site?.settings?.minutes ?? 10}+${site?.settings?.increment ?? 0}`;
const tiebreakLabel = () => String(site?.settings?.tiebreak_minutes??5)+'+'+String(site?.settings?.tiebreak_increment??3);
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
  const [next, history]=await Promise.all([api(archiveId?`/api/tournaments/${archiveId}`:'/api/state'), api('/api/tournaments')]);
  site=next;editions=history.tournaments||[];
  if(!archiveId&&site.status==='registration') preview=await api('/api/preview');
  render();
 }catch(e){if(!quiet)toast(e.message)}
}
function tab(name){
 $$('.content-tab').forEach(el=>el.classList.toggle('hidden',el.id!==`tab-${name}`));
 $$('.nav-btn').forEach(el=>el.classList.toggle('active',el.dataset.tab===name));
 if(name==='admin'){
  if(archiveId){archiveId=0;refresh();}
  checkAdmin();
 }
 if(name==='chaves') renderBracket();
 if(name==='classificacao') renderRanking();
 window.scrollTo({top:0,behavior:'smooth'});
}

function ruleTokens(){
 const s=site.settings||{};
 return {title:s.title||'Torneio',minutes:s.minutes??10,increment:s.increment??0,time_control:timeLabel(),
  round_days:s.round_days??5,contact_day:s.contact_day??2,wo_minutes:s.wo_minutes??15,
  tiebreak_time_control:String(s.tiebreak_minutes??5)+'+'+String(s.tiebreak_increment??3)};
}
function expandRegulation(value){
 const values=ruleTokens();
 return String(value||'').replace(/\{([a-z_]+)\}/g,(original,key)=>Object.prototype.hasOwnProperty.call(values,key)?String(values[key]):original);
}
function renderRegulation(){
 const root=$('#regulation-body');root.replaceChildren();
 $('#regulation-name').textContent='REGULAMENTO DO TORNEIO MATA-MATA DE XADREZ';
 for(const part of (site.settings?.regulation_sections||[])){
  const article=document.createElement('article');article.className='regulation-section';
  const title=document.createElement('h4');title.textContent=part.title;article.appendChild(title);
  let ul=null;
  for(const line of expandRegulation(part.body).split(/\r?\n/)){
   if(!line.trim())continue;
   if(line.trim().startsWith('- ')){
    if(!ul){ul=document.createElement('ul');article.appendChild(ul)}
    const item=document.createElement('li');item.textContent=line.trim().slice(2);ul.appendChild(item);
   }else{ul=null;const p=document.createElement('p');p.textContent=line;article.appendChild(p)}
  }
  root.appendChild(article);
 }
}
function renderRegulationEditor(){
 const root=$('#admin-regulation'),parts=site.settings?.regulation_sections||[];
 const sig=JSON.stringify(parts);if(root.dataset.signature===sig)return;root.dataset.signature=sig;
 let html='<section class="admin-config regulation-editor"><div class="admin-config-head"><div><h3>Editar regulamento oficial</h3><p>As informações entre chaves são preenchidas automaticamente. Exemplos: <code>{round_days}</code>, <code>{time_control}</code>, <code>{tiebreak_time_control}</code> e <code>{wo_minutes}</code>.</p>';
 if(site.status!=='registration')html+='<p class="rules-alert">Atenção: evite alterar regras competitivas após o início da edição.</p>';
 html+='</div></div><form id="regulation-form">';
 parts.forEach((part,i)=>{
  html+='<div class="regulation-edit-row"><label for="rule-title-'+i+'">Título da seção '+(i+1)+'</label><input id="rule-title-'+i+'" name="title-'+i+'" required minlength="2" maxlength="120" value="'+esc(part.title)+'"/>';
  html+='<label for="rule-body-'+i+'">Regras (uma por linha, iniciada com -)</label><textarea id="rule-body-'+i+'" name="body-'+i+'" rows="'+Math.min(9,Math.max(3,part.body.split('\n').length+1))+'" required minlength="5" maxlength="3500">'+esc(part.body)+'</textarea></div>';
 });
 html+='<div class="settings-actions"><button class="btn primary slim" type="submit">Salvar regulamento</button><small>As alterações aparecerão no site público.</small></div></form></section>';
 root.innerHTML=html;
}

function phaseName(){return site.status==='registration'?'Inscrições':site.status==='finished'?'Finalizado':`Rodada ${site.round}`}
function render(){
 if(!site)return;
 const settings=site.settings||{};
 const title=settings.title||'Copa Mata-Mata | Xadrez Entre Amigos';
 document.title=title+' | Xadrez Entre Amigos';
 $('#hero-event-name').textContent=title.toUpperCase();
 $('#hero-description').textContent=settings.description||'Torneio online de xadrez em eliminatórias.';
 $('#hero-time').textContent=`◷   ${timeLabel()}`;
 $('#hero-deadline').textContent=`▦   ${settings.round_days||5} dia(s) por rodada`;
 $('#hero-prize').classList.toggle('hidden',!settings.prize);
 $('#hero-prize').textContent=settings.prize?'♛   '+settings.prize:'';
 $('#edition-name').textContent=title;
 $('#edition-note').textContent=archiveId?'Histórico preservado. Esta edição está disponível somente para consulta.':'Veja a edição atual ou consulte os torneios anteriores.';
 const selector=$('#tournament-selector');
 const desired=editions.map(x=>`<option value="${x.id}">${esc(x.title)}${x.current?' · atual':' · arquivo'}</option>`).join('');
 if(selector.innerHTML!==desired)selector.innerHTML=desired;
 selector.value=String(archiveId);
 renderRegulation();
 $('#stat-players').textContent=site.players.length;
 $('#stat-phase').textContent=phaseName();
 $('#stat-time').textContent=site.status==='active'?'Até '+localDate(site.deadline):site.status==='finished'?'Encerrado':`${settings.round_days||5} dias`;
 $('#status-pill').innerHTML = `<span class="pulse"></span>${site.status==='registration'?' Inscrições abertas':site.status==='active'?' Torneio em andamento':' Torneio encerrado'}`;
 const locked=archiveId!==0||site.status!=='registration';
 $$('#signup-form input').forEach(i=>i.disabled=locked);
 $('#signup-submit').disabled=locked;
 $('#signup-submit').innerHTML=locked?'Inscrições indisponíveis':'Confirmar inscrição <span>↗</span>';
 $('#player-counter').textContent=`${site.players.length} jogador${site.players.length===1?'':'es'}`;
 const sorted=[...site.players].sort((a,b)=>b.rating-a.rating);
 $('#player-list').innerHTML=sorted.length?sorted.map(p=>`<div class="player-row"><div class="player-info"><div class="avatar">${esc(p.name.charAt(0).toUpperCase())}</div><div><strong>${esc(p.name)}</strong><a href="${profile(p)}" target="_blank" rel="noopener noreferrer">@${esc(p.nick)} ↗</a></div></div><div class="rating">${rating(p)}<small>${p.rating_official!==null?'Rapid Lichess':p.verified?'Rating informado':'Não verificado'}</small></div></div>`).join(''):
 `<div class="empty"><span class="empty-mark">♙</span><strong>O tabuleiro está pronto.</strong><p>Os jogadores aparecerão aqui assim que se inscreverem.</p></div>`;
 renderBracket();
 renderRanking();
 if(admin&&!archiveId)renderAdmin();
}
function playerLine(p,winner=false){return `<span class="match-player ${winner?'win':''}" title="${esc(p?.name||'')}">${p?`<a href="${profile(p)}" target="_blank" rel="noopener noreferrer">${esc(p.nick)}</a>`:'A definir'}</span><span class="match-rating">${p?rating(p):''}</span>`}
function bracketCard(item, i, isPreview=false){
 const p1=nameFor(isPreview?item[0]:item.p1);
 const p2=nameFor(isPreview?item[1]:item.p2);
 const bye=!p2;
 const status=isPreview?(bye?'Folga':'Prévia'):item.status==='bye'?'Folga':item.status==='pending'?'Pendente':item.status==='draw_pending'?'Desempate':item.status==='double_wo'?'Dois W.O.':item.status==='wo'?'W.O.':'Concluído';
 const winId=isPreview?bye?p1.id:null:item.winner;
 const draw=!isPreview&&item.status==='draw_pending';
 return `<article class="match-card"><div class="match-top"><span>CONFRONTO ${i+1}</span><span class="${isPreview?'pending':item.status==='complete'?'complete':'pending'}">${status}</span></div><div class="versus">${playerLine(p1,winId===p1?.id)}</div><div class="versus">${bye?'<span class="bye-tag">Avança sem adversário</span>':playerLine(p2,winId===p2?.id)}</div>${!isPreview&&item.game_url?`<a class="game-link" href="${esc(item.game_url)}" target="_blank" rel="noopener noreferrer">Ver partida no Lichess ↗</a>`:''}${!isPreview&&draw?'<div class="game-link">Empate: é necessário desempate ${timeLabel()}</div>':''}</article>`;
}

function treeScore(match,id){
 if(!match||match.status==='pending')return '—';
 if(match.status==='bye')return match.winner===id?'↗':'—';
 if(match.status==='draw_pending')return '1/2';
 if(match.status==='double_wo')return '0';
 return match.winner===id?'1':'0';
}
function treePlayer(p,match,ghost=false){
 if(!p)return '<div class="tree-player tree-player-empty"><span class="tree-avatar">♙</span><span class="tree-player-meta"><strong>A definir</strong><small>Próxima fase</small></span></div>';
 const win=match&&match.winner===p.id;
 return '<button class="tree-player '+(win?'tree-player-win':'')+'" type="button" data-player-id="'+p.id+'" aria-label="Ver histórico de '+esc(p.name)+'"><span class="tree-avatar">'+esc(p.name.slice(0,1).toUpperCase())+'</span><span class="tree-player-meta"><strong>'+esc(p.name)+'</strong><small>@'+esc(p.nick)+' · '+esc(rating(p))+'</small></span><span class="tree-score">'+(ghost?'—':treeScore(match,p.id))+'</span></button>';
}
function treeMatch(match,index,isPreview=false){
 const p1=nameFor(match?.p1),p2=nameFor(match?.p2);
 const isBye=!isPreview&&match&&match.status==='bye';
 const s=isPreview?'Prévia':!match?'A definir':({pending:'Aguardando',draw_pending:'Desempate',complete:'Concluído',wo:'W.O.',double_wo:'W.O. duplo',bye:'Folga'}[match.status]||'Aguardando');
 let html='<article class="tree-match"><div class="tree-match-head"><span>CONFRONTO '+(index+1)+'</span><span class="tree-state '+((match?.status==='complete'||match?.status==='wo')?'state-won':'')+'">'+s+'</span></div>';
 html+=treePlayer(p1,match,isPreview);
 html+=isBye?'<div class="tree-player tree-player-empty"><span class="tree-avatar">↗</span><span class="tree-player-meta"><strong>Classificado por folga</strong><small>Sem adversário nesta rodada</small></span></div>':treePlayer(p2,match,isPreview);
 if(match?.game_url)html+='<a class="tree-link" target="_blank" rel="noopener noreferrer" href="'+esc(match.game_url)+'">Abrir partida no Lichess ↗</a>';
 if(match?.status==='draw_pending')html+='<div class="tree-link">Empate registrado · falta desempate</div>';
 html+='</article>';return html;
}
function renderBracket(){
 if(!site)return;
 const area=$('#bracket-area'),isPreview=site.status==='registration',r=site.round||0;
 const groups={};(site.matches||[]).forEach(m=>(groups[m.round]??=[]).push(m));
 if(isPreview&&site.players.length<2){
  area.innerHTML='<div class="panel bracket-empty"><div class="empty"><span class="empty-mark">♜</span><strong>Aguardando inscrições</strong><p>Os confrontos aparecerão a partir de dois jogadores.</p></div></div>';return;
 }
 if(isPreview){
  const pm=[...(preview.pairs||[]).map(([p1,p2])=>({p1,p2,status:'pending'})),...(preview.byes||[]).map(p1=>({p1,p2:null,status:'bye'}))];
  groups[1]=pm;
 }
 const mainRounds=Math.max(1,Math.ceil(Math.log2(Math.max(2,site.players.length))));
 const maxRounds=Math.max(mainRounds,...Object.keys(groups).map(Number));
 const firstCount=Math.max(1,groups[1]?.length||Math.ceil(site.players.length/2));
 const title=site.settings?.title||'Copa Mata-Mata';
 const trophy='<img src="/static/trophy.svg" class="tree-trophy" alt="Troféu da final" loading="lazy"/>';
 let html='';
 if(site.status==='active')html+='<div class="deadline-note"><span><strong>Rodada '+site.round+'</strong> · Contato até o '+(site.settings?.contact_day??2)+'º dia.</span><span><strong>Prazo final:</strong> '+esc(localDate(site.deadline))+'</span></div>';
 if(isPreview)html+='<div class="deadline-note"><span><strong>Sorteio provisório.</strong> Os adversários podem mudar até o início do torneio.</span><span>'+site.players.length+' inscritos</span></div>';
 if(site.status==='finished'){
  const champion=nameFor(site.champion_id);
  html+='<div class="champion"><div><small>CAMPEÃO DO TORNEIO</small><h3>'+esc(champion?.name||'Sem campeão')+'</h3><span>'+(champion?'@'+esc(champion.nick)+' · '+esc(rating(champion))+' Rapid':'Nenhum classificado na final')+'</span></div>'+trophy+'</div>';
 }
 html+='<div class="tree-intro"><span class="tree-legend"><i></i> Jogador classificado <span class="tree-legend-dot">•</span> Pontuação: 1 vitória · 1/2 empate · 0 derrota</span><span class="tree-legend">Toque em qualquer jogador para ver seu histórico.</span></div>';
 html+='<div class="bracket-scroll tree-scroller" tabindex="0" aria-label="Chaveamento horizontal, role para ver as fases"><div class="tournament-tree">';
 for(let round=1;round<=maxRounds;round++){
  const played=groups[round]||[];
  const available=played.length>0;
  const items=available?played:Array.from({length:Math.max(1,Math.ceil(firstCount/Math.pow(2,round-1)))},()=>null);
  const final=round===maxRounds;
  html+='<section class="tree-round '+(final?'tree-final':'')+'"><div class="tree-round-header"><span>'+(final?'GRANDE FINAL':round+'ª RODADA')+'</span><strong>'+(final?'Decisão':available?played.length+' confrontos':'Classificados')+'</strong></div>';
  if(final)html+='<div class="tree-trophy-box">'+trophy+'<span>'+ (site.status==='finished'?'TROFÉU DO CAMPEÃO':'UM ÚNICO CAMPEÃO')+'</span></div>';
  html+='<div class="tree-round-content">'+items.map((m,i)=>treeMatch(m,i,isPreview&&round===1)).join('')+'</div>';
  if(!final)html+='<span class="tree-flow-arrow" aria-hidden="true">→</span>';
  html+='</section>';
 }
 html+='</div></div><p class="tree-mobile-tip">Arraste horizontalmente para acompanhar as rodadas. Os confrontos das próximas fases serão sorteados entre os classificados, priorizando ratings próximos.</p>';
 area.innerHTML=html;
 $('#bracket-subtitle').textContent=isPreview?'Prévia atualizada com os inscritos. A chave oficial começa após o encerramento das inscrições.':'Chaveamento e resultados atualizados conforme a organização registra as partidas.';
}

function colorOf(m,id){return m?.white_id ? (m.white_id===id?'brancas':'pretas') : null}
function totalsOf(id){
 const total={white:0,black:0};
 for(const m of site.matches||[]){
  if(!m.white_id||!m.p2||!['complete','draw_pending'].includes(m.status)||![m.p1,m.p2].includes(id))continue;
  const count=(site.games||[]).filter(g=>g.match_id===m.id).length||1;
  for(let i=0;i<count;i++){
   const white=(m.white_id===id)===(i%2===0);
   total[white?'white':'black']++;
  }
 }
 return total;
}
function formatPoints(p){return Number.isInteger(p)?String(p):String(p).replace('.',',')}
function standings(){
 const ranked=(site.players||[]).map(p=>({...p,wins:0,draws:0,losses:0,matchWins:0,roundReached:0,score:0,played:0,colors:totalsOf(p.id)}));
 const byId=new Map(ranked.map(p=>[p.id,p]));
 for(const m of site.matches||[]){
  const players=[m.p1,m.p2].filter(Boolean).map(id=>byId.get(id)).filter(Boolean);
  players.forEach(p=>p.roundReached=Math.max(p.roundReached,m.round||0));
  const winner=byId.get(m.winner);
  if(winner&&m.status!=='bye')winner.matchWins++;
  if(['wo','double_wo','bye','pending'].includes(m.status))continue;
  const games=(site.games||[]).filter(g=>g.match_id===m.id);
  if(games.length){
   games.forEach(game=>players.forEach(p=>{
    const score=scoreForGame(game,m,p.id);
    if(score==='1'){p.wins++;p.score++;p.played++}
    else if(score==='1/2'){p.draws++;p.score+=.5;p.played++}
    else if(score==='0'){p.losses++;p.played++}
   }));
  }else{
   players.forEach(p=>{
    p.played++;
    if(m.status==='draw_pending'){p.draws++;p.score+=.5}
    else if(m.winner===p.id){p.wins++;p.score++}
    else p.losses++;
   });
  }
 }
 ranked.sort((a,b)=>Number(b.id===site.champion_id)-Number(a.id===site.champion_id)
   ||b.roundReached-a.roundReached||b.matchWins-a.matchWins||b.score-a.score
   ||b.wins-a.wins||b.rating-a.rating||a.name.localeCompare(b.name,'pt-BR'));
 return ranked;
}
function trophyIcon(i){
 const kind=['gold','silver','bronze'][i]||'';
 return '<svg aria-hidden="true" class="ranking-trophy '+kind+'" viewBox="0 0 64 64"><path d="M17 9h30v18c0 13-7 21-15 21s-15-8-15-21V9zM17 15H8c0 13 5 20 13 21M47 15h9c0 13-5 20-13 21M28 48h8v7h10v5H18v-5h10z" fill="currentColor"/><path d="M29 20h6v17h-6z" fill="#fff" opacity=".5"/></svg>';
}
function renderRanking(){
 if(!site)return;
 const root=$('#ranking-area');
 if(site.status==='registration'){
  root.innerHTML='<div class="panel ranking-empty"><span class="empty-mark">♛</span><h3>Classificação ainda não iniciada</h3><p>O ranking aparecerá após o sorteio oficial e a publicação dos resultados.</p></div>';return;
 }
 const players=standings(),final=site.status==='finished';
 const podium=players.slice(0,3).map((p,i)=>'<article class="podium-card podium-'+(i+1)+'"><div class="podium-label">'+trophyIcon(i)+'<span>'+ (i+1)+'º LUGAR</span></div><button data-player-id="'+p.id+'" class="podium-name"><strong>'+esc(p.name)+'</strong><small>@'+esc(p.nick)+'</small></button><span class="podium-stats">'+p.matchWins+' confrontos vencidos · '+formatPoints(p.score)+' pontos</span></article>').join('');
 const rows=players.map((p,i)=>'<tr><td class="rank-pos">'+(i<3?trophyIcon(i):String(i+1)+'º')+'</td><td><button class="rank-player" data-player-id="'+p.id+'"><strong>'+esc(p.name)+'</strong><small>@'+esc(p.nick)+'</small></button></td><td>'+p.roundReached+'ª</td><td>'+p.matchWins+'</td><td>'+p.wins+'</td><td>'+p.draws+'</td><td>'+p.losses+'</td><td class="rank-score">'+formatPoints(p.score)+'</td><td>'+p.colors.white+' / '+p.colors.black+'</td></tr>').join('');
 root.innerHTML='<div class="ranking-note"><strong>'+(final?'Classificação final':'Classificação provisória')+'</strong><span>'+(final?'Torneio concluído':'As posições podem mudar até o encerramento.')+'</span></div><div class="ranking-podium">'+podium+'</div><section class="panel ranking-panel"><h3>Tabela geral</h3><div class="ranking-table-scroll"><table class="ranking-table"><thead><tr><th>Pos.</th><th>Jogador</th><th>Fase</th><th>Confrontos</th><th>V</th><th>E</th><th>D</th><th>Pontos</th><th>Brancas / Pretas</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="ranking-criteria">Ordenação: campeão, fase alcançada, confrontos vencidos, pontos das partidas, vitórias e rating como último critério. W.O. e folga não contam como partida jogada. Sem uma disputa de terceiro lugar, o bronze é determinado pelos critérios da tabela, não por uma partida específica.</p></section>';
}

function scoreForGame(game,match,id){
 if(game.outcome==='draw')return '1/2';
 if(game.outcome==='p1')return match.p1===id?'1':'0';
 if(game.outcome==='p2')return match.p2===id?'1':'0';
 return '—';
}
function openPlayerHistory(playerId){
 const p=nameFor(playerId);if(!p)return;
 const history=[];
 for(const match of (site.matches||[])){
  if(match.p1!==p.id&&match.p2!==p.id)continue;
  const rival=nameFor(match.p1===p.id?match.p2:match.p1);
  const games=(site.games||[]).filter(g=>g.match_id===match.id);
  if(games.length){
   games.forEach((g,i)=>history.push({round:match.round,index:i,score:scoreForGame(g,match,p.id),name:i?'Desempate':'Partida',rival,url:g.game_url||''}));
  }else{
   let value='—',label='Aguardando partida';
   if(match.status==='bye')label='Folga · classificado sem jogar';
   else if(match.status==='wo'||match.status==='double_wo'){label=match.status==='wo'?'W.O.':'W.O. duplo';value=match.winner===p.id?'1':'0'}
   else if(match.status==='draw_pending'){label='Empate';value='1/2'}
   else if(match.status==='complete'){label='Resultado registrado';value=match.winner===p.id?'1':'0'}
   history.push({round:match.round,index:0,score:value,name:label,rival,url:match.game_url||''});
  }
 }
 history.sort((a,b)=>b.round-a.round||b.index-a.index);
 const rows=history.map(h=>'<div class="history-row"><span class="history-score '+(h.score==='1'?'history-win':h.score==='0'?'history-loss':'history-draw')+'">'+h.score+'</span><div class="history-row-detail"><strong>Rodada '+h.round+' · '+esc(h.name)+'</strong><small>'+esc(h.rival?'vs '+h.rival.name+' (@'+h.rival.nick+')':'sem adversário')+'</small></div>'+(h.url?'<a href="'+esc(h.url)+'" target="_blank" rel="noopener noreferrer" class="history-open">Ver no Lichess ↗</a>':'<span class="history-no-link">Sem link</span>')+'</div>').join('');
 $('#player-dialog-content').innerHTML='<span class="mini-label">HISTÓRICO DE PARTIDAS</span><h3 id="player-dialog-title">'+esc(p.name)+'</h3><p class="player-dialog-info"><a href="'+profile(p)+'" target="_blank" rel="noopener noreferrer">@'+esc(p.nick)+' ↗</a> · '+esc(rating(p))+' Rapid</p><p class="history-intro">Pontuação por partida: <strong>1</strong> vitória, <strong>1/2</strong> empate, <strong>0</strong> derrota. W.O. e folgas são identificados separadamente.</p><div class="history-list">'+(rows||'<div class="empty">O jogador ainda não possui confrontos nesta edição.</div>')+'</div>';
 const modal=$('#player-dialog');modal.classList.remove('hidden');document.body.classList.add('modal-open');$('#player-dialog-close').focus();
}
function closePlayerHistory(){
 $('#player-dialog').classList.add('hidden');document.body.classList.remove('modal-open');
}

async function checkAdmin(){
 try{const d=await api('/api/admin/session');admin=d.authenticated;$('#admin-login-box').classList.toggle('hidden',admin);$('#admin-dashboard').classList.toggle('hidden',!admin);if(admin)renderAdmin();if(!d.enabled&&!admin)$('#login-message').textContent='O servidor precisa ter ADMIN_PASSWORD configurada.'}catch(e){toast(e.message)}
}
function renderAdmin(){
 if(!site||!admin)return;
 renderAdminSettings();
 renderRegulationEditor();
 const controls=$('#admin-controls');
 if(site.status==='registration'){
  controls.innerHTML=`<div class="admin-action-row"><div><h3>Encerrar inscrições e iniciar a copa</h3><p>Ao iniciar, o chaveamento é sorteado e publicado. Novas inscrições não serão aceitas. Cada rodada terá ${site.settings?.round_days||5} dias corridos.</p></div><button id="start-tourney" class="btn primary" ${site.players.length<2?'disabled':''}>Realizar sorteio oficial →</button></div><section class="admin-players"><h3>Gerenciar inscrições (${site.players.length})</h3>${site.players.map(p=>`<div class="admin-player-row"><span><strong>${esc(p.name)}</strong> · @${esc(p.nick)} · ${rating(p)} ${p.rating_official!==null?'(oficial)':'(informado)'}</span><button data-delete-player="${p.id}">Remover</button></div>`).join('')}</section>`;
  $('#admin-match-list').innerHTML='';return;
 }
 const current=site.matches.filter(m=>m.round===site.round);
 const pending=current.filter(m=>['pending','draw_pending'].includes(m.status));
 controls.innerHTML=site.status==='active'?`<div class="admin-action-row"><div><h3>Rodada ${site.round} em andamento</h3><p>Encerramento: ${localDate(site.deadline)}. Restam ${pending.length} partida(s) sem resultado. ${Date.now()>new Date(site.deadline).getTime()?'O prazo terminou: revise os W.O. pendentes.':''} Registre o vencedor ou W.O. para liberar a próxima rodada.</p></div><button id="next-round" class="btn primary" ${pending.length?'disabled':''}>${pending.length?'Aguardando partidas':'Concluir rodada →'}</button></div>`:`<div class="admin-action-row"><div><h3>Copa encerrada</h3><p>Campeão: ${site.champion_id?esc(nameFor(site.champion_id)?.name):'Não houve campeão'}. O histórico permanece público no chaveamento.</p></div></div>`;
 $('#admin-match-list').innerHTML=site.status==='active'?`<section class="admin-results"><h3>Resultados da rodada ${site.round}</h3><div class="admin-help" style="padding:15px 20px 0">Use “Buscar no Lichess” para encontrar partidas oficiais ${timeLabel()} e desempates ${tiebreakLabel()} entre os adversários. Confirme manualmente qual partida pertence ao torneio.</div>${current.map(m=>{
 const p1=nameFor(m.p1),p2=nameFor(m.p2);
 const desc=m.status==='bye'?'Classificação automática':m.status==='complete'?'Resultado registrado':m.status==='double_wo'?'Ambos eliminados':m.status==='wo'?'Vitória por W.O.':m.status==='draw_pending'?'Empate, falta desempate':'Aguardando resultado';
 return `<article class="admin-match-card"><div class="admin-match-summary"><div><strong>${esc(p1?.nick)} ${p2?'× '+esc(p2.nick):'· FOLGA'}</strong><small>${desc}${m.game_url?' · <a href="'+esc(m.game_url)+'" target="_blank" rel="noopener">Ver partida ↗</a>':''}</small></div>${p2?`<div class="action-buttons"><button data-edit="${m.id}">Lançar resultado</button><button class="api-btn" data-lookup="${m.id}">Buscar no Lichess ↗</button></div>`:''}</div><div id="admin-detail-${m.id}"></div></article>`;
 }).join('')}</section>`:'';
}
function editMatch(id){
 const match=site.matches.find(m=>m.id===id),p1=nameFor(match.p1),p2=nameFor(match.p2);
 const area=$(`#admin-detail-${id}`);
 area.innerHTML=`<form class="admin-edit result-form" data-match-id="${id}"><label>Resultado</label><select name="choice" required><option value="p1">Vitória de ${esc(p1.nick)}</option><option value="p2">Vitória de ${esc(p2.nick)}</option><option value="p1_wo">${esc(p1.nick)} vence por W.O.</option><option value="p2_wo">${esc(p2.nick)} vence por W.O.</option><option value="draw">Empate (aguarda desempate ${tiebreakLabel()})</option><option value="double">Dois W.O. (ambos eliminados)</option></select><label>Link da partida (opcional)</label><input name="game_url" type="url" placeholder="https://lichess.org/abcdefgh" value="${esc(match.game_url||'')}"/><label>Observação (opcional)</label><textarea name="notes" maxlength="300" placeholder="Ex.: W.O. após 15 minutos de tolerância"></textarea><button class="btn primary slim" type="submit">Salvar resultado</button></form>`;
 area.querySelector('select').value=match.status==='double_wo'?'double':match.status==='draw_pending'?'draw':match.status==='wo'?(match.winner===match.p2?'p2_wo':'p1_wo'):match.winner===match.p2?'p2':'p1';
}
async function lookupGames(id){
 const area=$(`#admin-detail-${id}`);area.innerHTML='<div class="admin-edit">Consultando histórico público do Lichess…</div>';
 try{const data=await api(`/api/admin/matches/${id}/lichess`);
  area.innerHTML=`<div class="admin-edit"><p class="admin-help">Foram consideradas apenas partidas concluídas de ${timeLabel()} (ou desempate ${tiebreakLabel()} após empate), entre os dois nicks, durante o prazo da rodada. O organizador deve confirmar se o jogo realmente valeu pelo torneio.</p>${data.games.length?`<div class="candidate-list">${data.games.map(g=>`<div class="candidate"><span><strong>${g.draw?'Empate':'Vitória de '+esc(nameFor(g.winner_id)?.nick||'')}</strong><br>${localDate(g.created_at)} · <a href="${g.url}" target="_blank" rel="noopener noreferrer">Ver partida ↗</a></span><button data-confirm-game="${g.id}" data-match="${id}">${g.draw?'Registrar empate':'Confirmar resultado'}</button></div>`).join('')}</div>`:'<p class="admin-help">Nenhuma partida elegível encontrada. Você pode lançar o resultado manualmente.</p>'}</div>`;
 }catch(e){area.innerHTML=`<div class="admin-edit"><p class="admin-help">${esc(e.message)}</p><button data-edit="${id}" class="small-link">Lançar manualmente</button></div>`}
}
async function doAction(path,options,confirmText){
 if(confirmText&&!confirm(confirmText))return;
 try{const r=await api(path,options);toast(r.message||'Atualizado.');await refresh();}
 catch(e){toast(e.message)}
}
function settingsFields(s={},prefix='settings',freeze=false){
 const f=(label,name,value,type='text',opts='')=>`<div class="settings-field"><label for="${prefix}-${name}">${label}</label><input id="${prefix}-${name}" name="${name}" type="${type}" value="${esc(value)}" ${opts}/></div>`;
 return `<div class="settings-grid">
  <div class="settings-field span-2"><label for="${prefix}-title">Nome da competição</label><input id="${prefix}-title" name="title" minlength="3" maxlength="120" required value="${esc(s.title||'')}" placeholder="Ex.: 2ª Copa Xadrez Entre Amigos"/></div>
  ${f('Prêmio (opcional)','prize',s.prize||'','text','maxlength="160"')}
  <div class="settings-field span-full"><label for="${prefix}-description">Descrição apresentada no site</label><textarea id="${prefix}-description" name="description" maxlength="500" rows="3">${esc(s.description||'')}</textarea></div>
  ${f('Minutos por jogador','minutes',s.minutes??10,'number',`min="1" max="60" required ${freeze?'disabled':''}`)}
  ${f('Incremento por lance (segundos)','increment',s.increment??0,'number',`min="0" max="60" required ${freeze?'disabled':''}`)}
  ${f('Dias por rodada','round_days',s.round_days??5,'number',`min="1" max="30" required ${freeze?'disabled':''}`)}
  ${f('Contatar adversário até o dia','contact_day',s.contact_day??2,'number',`min="1" max="30" required ${freeze?'disabled':''}`)}
  ${f('Tolerância para W.O. (minutos)','wo_minutes',s.wo_minutes??15,'number',`min="0" max="60" required ${freeze?'disabled':''}`)}
  ${f('Minutos no desempate','tiebreak_minutes',s.tiebreak_minutes??5,'number',`min="1" max="60" required ${freeze?'disabled':''}`)}
  ${f('Incremento do desempate (segundos)','tiebreak_increment',s.tiebreak_increment??3,'number',`min="0" max="60" required ${freeze?'disabled':''}`)}
 </div>`;
}
function settingsPayload(form){
 const s=Object.fromEntries(new FormData(form).entries());
 for(const key of ['minutes','increment','round_days','contact_day','wo_minutes','tiebreak_minutes','tiebreak_increment']){
   if(!(key in s))s[key]=site.settings[key];
   s[key]=Number(s[key]);
 }
 return s;
}
function renderAdminSettings(){
 const s=site.settings||{};
 const lock=site.status!=='registration';
 const section=$('#admin-settings');
 const signature=JSON.stringify({s,lock});
 if(section.dataset.signature!==signature){
  section.dataset.signature=signature;
  section.innerHTML=`<section class="admin-config"><div class="admin-config-head"><div><h3>Editar dados do torneio atual</h3><p>Altere o nome, o prêmio, a apresentação e as regras. Depois do sorteio, ritmo e prazos ficam protegidos para não afetar as partidas.</p></div></div><form class="settings-form" id="settings-form">${settingsFields(s,'settings',lock)}<div class="settings-actions"><button class="btn primary slim" type="submit">Salvar informações</button><small>Alterações no nome e na descrição aparecem imediatamente na página pública.</small></div></form></section>`;
 }
 const canCreate=site.status==='finished'||site.status==='registration'&&site.players.length===0;
 const newbox=$('#admin-create');
 const newSignature=JSON.stringify({s,newEditionOpen,canCreate,hasPlayers:site.players.length,status:site.status});
 if(newbox.dataset.signature!==newSignature){newbox.dataset.signature=newSignature;newbox.innerHTML=`<div class="admin-create-toggle"><div><strong>Organizar outra edição</strong><small>${canCreate?'Crie um novo torneio e preserve o histórico dos anteriores.':'Conclua o torneio atual antes de criar uma nova edição.'}</small></div><button type="button" id="toggle-new" ${canCreate?'':'disabled'}>${newEditionOpen?'Fechar':'Criar nova edição'}</button></div>${canCreate&&newEditionOpen?`<section class="admin-config"><div class="admin-config-head"><div><h3>Novo torneio</h3><p>A edição anterior será arquivada, com todos os inscritos, confrontos e resultados. A inscrição do novo torneio começará vazia.</p></div></div><form id="new-tournament-form">${settingsFields({...s,title:'',prize:''},'new')}<div class="settings-actions"><button type="submit" class="btn primary slim">Criar torneio e arquivar o anterior</button></div></form></section>`:''}`;}
}
async function downloadBackup(){
 try{
  const result=await api('/api/admin/export');
  const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');anchor.href=url;
  anchor.download='xadrez-entre-amigos-backup-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  URL.revokeObjectURL(url);
  toast('Histórico exportado. Guarde este arquivo em local seguro.');
 }catch(e){toast(e.message)}
}
// Navegação e controles globais
$$('[data-tab]').forEach(el=>el.addEventListener('click',()=>{if(['chaves','regras','inscricoes','classificacao'].includes(el.dataset.tab))history.replaceState(null,'','#'+el.dataset.tab);tab(el.dataset.tab)}));
$('#refresh-button').addEventListener('click',()=>refresh());
$('#ranking-area').addEventListener('click',e=>{const b=e.target.closest('button[data-player-id]');if(b)openPlayerHistory(Number(b.dataset.playerId))});
$('#bracket-area').addEventListener('click',e=>{
 const node=e.target.closest('button[data-player-id]');
 if(node)openPlayerHistory(Number(node.dataset.playerId));
});
$('#player-dialog').addEventListener('click',e=>{if(e.target.closest('[data-close-player]'))closePlayerHistory()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#player-dialog').classList.contains('hidden'))closePlayerHistory()});

$('#tournament-selector').addEventListener('change', async e=>{archiveId=Number(e.target.value);preview={pairs:[],byes:[]};await refresh();tab('chaves');});
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
 if(b.id==='download-backup'){downloadBackup();return;}
 if(b.id==='toggle-new'){newEditionOpen=!newEditionOpen;renderAdmin();return;}
 if(b.id==='start-tourney')doAction('/api/admin/start',{method:'POST'},'Encerrar definitivamente as inscrições e sortear a primeira rodada?');
 if(b.id==='next-round')doAction('/api/admin/next-round',{method:'POST'},'Confirmar todos os resultados e iniciar a próxima rodada?');
 if(b.dataset.deletePlayer)doAction(`/api/admin/players/${b.dataset.deletePlayer}`,{method:'DELETE'},'Remover este jogador da inscrição?');
 if(b.dataset.edit)editMatch(Number(b.dataset.edit));
 if(b.dataset.lookup)lookupGames(Number(b.dataset.lookup));
 if(b.dataset.confirmGame)doAction(`/api/admin/matches/${b.dataset.match}/use-game`,{method:'POST',body:JSON.stringify({game_id:b.dataset.confirmGame})},'Confirmar que esta partida pertence ao torneio e lançar o resultado?');
});
$('#admin-dashboard').addEventListener('submit',async e=>{
 const config=e.target.closest('#settings-form');
 if(config){e.preventDefault();await doAction('/api/admin/settings',{method:'PUT',body:JSON.stringify(settingsPayload(config))});return;}
 const regulation=e.target.closest('#regulation-form');
 if(regulation){
  e.preventDefault();
  const data=new FormData(regulation);
  const sections=Array.from({length:7},(_,i)=>({title:String(data.get('title-'+i)||'').trim(),body:String(data.get('body-'+i)||'').trim()}));
  if(site.status!=='registration'&&!confirm('Atualizar o regulamento de uma edição já iniciada?'))return;
  await doAction('/api/admin/regulation',{method:'PUT',body:JSON.stringify({sections})});
  return;
 }
 const next=e.target.closest('#new-tournament-form');
 if(next){e.preventDefault();if(!confirm('Criar nova edição? Os dados do torneio anterior serão preservados no histórico e as inscrições da nova edição começarão vazias.'))return;
  try{const r=await api('/api/admin/tournaments/new',{method:'POST',body:JSON.stringify(settingsPayload(next))});toast(r.message);archiveId=0;newEditionOpen=false;await refresh();}
  catch(err){toast(err.message)}
  return;
 }
 const form=e.target.closest('.result-form');if(!form)return;e.preventDefault();
 const payload=Object.fromEntries(new FormData(form).entries());
 await doAction(`/api/admin/matches/${form.dataset.matchId}/result`,{method:'POST',body:JSON.stringify(payload)},'Confirmar e publicar este resultado?');
});
refresh().then(()=>{const deep=location.hash.slice(1);if(['inscricoes','chaves','regras','classificacao'].includes(deep))tab(deep)});setInterval(()=>refresh(true),30000);