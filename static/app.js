/* Xadrez Entre Amigos · frontend sem dependências externas */
let site = null;
let archiveId = 0;
let editions = [];
let newEditionOpen = false;
let preview = {pairs:[],byes:[]};
let admin = false;
let adminDisqualifications = [];
let importCandidates = null;
let importSourceId = 0;
let importSelected = new Set();
let toastTimer;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nameFor = id => site?.players.find(p=>p.id===id);
const rating = p => p?.rating == null ? 's/r' : `${p.rating}${p.provisional ? '?' : ''}`;
const speedName = () => {const s=60*(site?.settings?.minutes??10)+40*(site?.settings?.increment??0);return s<30?'UltraBullet':s<180?'Bullet':s<480?'Blitz':s<1500?'Rapid':'Classical'};
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
function tab(name,scrollTarget=null){
 $$('.content-tab').forEach(el=>el.classList.toggle('hidden',el.id!==`tab-${name}`));
 $$('.nav-btn').forEach(el=>el.classList.toggle('active',el.dataset.tab===name));
 if(name==='admin'){
  if(archiveId){archiveId=0;refresh();}
  checkAdmin();
 }
 if(name==='chaves') renderBracket();
 if(name==='classificacao') renderRanking();
 if(scrollTarget){
  requestAnimationFrame(()=>{
   const target=document.getElementById(scrollTarget);
   if(target)target.scrollIntoView({behavior:'smooth',block:'start'});
  });
 }else{
  window.scrollTo({top:0,behavior:'smooth'});
 }
}


function consentWarning(message=''){
 const warning=$('#signup-agreement-warning');
 const checkbox=$('#signup-agree');
 warning.textContent=message;
 checkbox.setAttribute('aria-invalid',message?'true':'false');
 $('#signup-consent').classList.toggle('consent-invalid',Boolean(message));
}
function openRegulationDialog(){
 if(!site?.settings?.regulation_sections?.length){
  toast('O regulamento ainda está carregando. Tente novamente.');
  return;
 }
 const dialog=$('#regulation-dialog');
 $('#regulation-dialog-title').textContent='Regulamento · '+(site.settings.title||'Torneio de Xadrez');
 const content=$('#regulation-dialog-body');
 content.replaceChildren(...[...$('#regulation-body').children].map(node=>node.cloneNode(true)));
 dialog.classList.remove('hidden');
 document.body.classList.add('modal-open');
 $('#regulation-dialog-close').focus();
}
function closeRegulationDialog(){
 $('#regulation-dialog').classList.add('hidden');
 document.body.classList.remove('modal-open');
 $('#signup-regulation-link').focus();
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
 const sorted=[...site.players].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
 $('#player-list').innerHTML=sorted.length?sorted.map(p=>`<div class="player-row"><div class="player-info"><div class="avatar">${esc(p.name.charAt(0).toUpperCase())}</div><div><strong>${esc(p.name)}</strong><a href="${profile(p)}" target="_blank" rel="noopener noreferrer">@${esc(p.nick)} ↗</a></div></div><div class="rating"><small>${p.disqualified?'Desclassificado':'Inscrito'}</small></div></div>`).join(''):
 `<div class="empty"><span class="empty-mark">♙</span><strong>O tabuleiro está pronto.</strong><p>Os jogadores aparecerão aqui assim que se inscreverem.</p></div>`;
 renderBracket();
 renderRanking();
 if(admin&&!archiveId)renderAdmin();
}
function playerLine(p,winner=false){return `<span class="match-player ${winner?'win':''}" title="${esc(p?.name||'')}">${p?`<a href="${profile(p)}" target="_blank" rel="noopener noreferrer">${esc(p.nick)}</a>`:'A definir'}</span>`}
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
 if(match.status==='dq')return '0';
 if(match.status==='bye')return match.winner===id?'↗':'—';
 if(match.status==='draw_pending')return '1/2';
 if(match.status==='double_wo')return '0';
 return match.winner===id?'1':'0';
}
function treePlayer(p,match,ghost=false){
 if(!p)return '<div class="tree-player tree-player-empty"><span class="tree-avatar">♙</span><span class="tree-player-meta"><strong>A definir</strong><small>Próxima fase</small></span></div>';
 const win=match&&match.winner===p.id;
 return '<button class="tree-player '+(win?'tree-player-win':'')+(p.disqualified?' tree-player-disqualified':'')+'" type="button" data-player-id="'+p.id+'" aria-label="Ver histórico de '+esc(p.name)+'"><span class="tree-avatar">'+esc(p.name.slice(0,1).toUpperCase())+'</span><span class="tree-player-meta"><strong>'+esc(p.name)+'</strong><small>@'+esc(p.nick)+' · '+esc(speedName())+' '+esc(rating(p))+(p.disqualified?' · Desclassificado':'')+'</small></span><span class="tree-color-and-score">'+(!ghost&&match?.p2?(match.white_id?'<span class="color-chip '+(match.white_id===p.id?'white-piece':'black-piece')+'">'+(match.white_id===p.id?'♔ Brancas':'♚ Pretas')+'</span>':'<span class="color-chip unknown-piece">Cor não registrada</span>'):'')+'<span class="tree-score">'+(ghost?'—':treeScore(match,p.id))+'</span></span></button>';
}
function treeMatch(match,index,isPreview=false){
 const p1=nameFor(match?.p1),p2=nameFor(match?.p2);
 const isBye=!isPreview&&match&&match.status==='bye';
 const s=isPreview?'Prévia':!match?'A definir':match.source==='disqualification'?'Desclassificação':({pending:'Aguardando',draw_pending:'Desempate',complete:'Concluído',wo:'W.O.',double_wo:'W.O. duplo',bye:'Folga',dq:'Desclassificação'}[match.status]||'Aguardando');
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
  if(['double_wo','bye','pending','dq'].includes(m.status))continue;
  const games=(site.games||[]).filter(g=>g.match_id===m.id);
  if(m.status==='wo'&&!games.length)continue;
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
 ranked.sort((a,b)=>Number(a.disqualified)-Number(b.disqualified)||Number(b.id===site.champion_id)-Number(a.id===site.champion_id)
   ||b.roundReached-a.roundReached||b.matchWins-a.matchWins||b.score-a.score
   ||b.wins-a.wins||a.name.localeCompare(b.name,'pt-BR'));
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
 const players=standings(),final=site.status==='finished',medalists=players.filter(p=>!p.disqualified).slice(0,3);
 const podium=medalists.map((p,i)=>'<article class="podium-card podium-'+(i+1)+'"><div class="podium-label">'+trophyIcon(i)+'<span>'+ (i+1)+'º LUGAR</span></div><button data-player-id="'+p.id+'" class="podium-name"><strong>'+esc(p.name)+'</strong><small>@'+esc(p.nick)+'</small></button><span class="podium-stats">'+p.matchWins+' confrontos vencidos · '+formatPoints(p.score)+' pontos</span></article>').join('');
 const rows=players.map((p,i)=>'<tr class="'+(p.disqualified?'ranking-disqualified':'')+'"><td class="rank-pos">'+(!p.disqualified&&medalists.some(q=>q.id===p.id)?trophyIcon(medalists.findIndex(q=>q.id===p.id)):String(i+1)+'º')+'</td><td><button class="rank-player" data-player-id="'+p.id+'"><strong>'+esc(p.name)+'</strong><small>@'+esc(p.nick)+(p.disqualified?' · Desclassificado':'')+'</small></button></td><td>'+p.roundReached+'ª</td><td>'+p.matchWins+'</td><td>'+p.wins+'</td><td>'+p.draws+'</td><td>'+p.losses+'</td><td class="rank-score">'+formatPoints(p.score)+'</td><td>'+p.colors.white+' / '+p.colors.black+'</td></tr>').join('');
 root.innerHTML='<div class="ranking-note"><strong>'+(final?'Classificação final':'Classificação provisória')+'</strong><span>'+(final?'Torneio concluído':'As posições podem mudar até o encerramento.')+'</span></div><div class="ranking-podium">'+podium+'</div><section class="panel ranking-panel"><h3>Tabela geral</h3><div class="ranking-table-scroll"><table class="ranking-table"><thead><tr><th>Pos.</th><th>Jogador</th><th>Fase</th><th>Confrontos</th><th>V</th><th>E</th><th>D</th><th>Pontos</th><th>Brancas / Pretas</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="ranking-criteria">Ordenação: campeão, fase alcançada, confrontos vencidos, pontos das partidas, vitórias e ordem alfabética como último critério. Desclassificados ficam fora do pódio e ao final da classificação. W.O. e folga não contam como partida jogada. Sem uma disputa de terceiro lugar, o bronze é determinado pelos critérios da tabela, não por uma partida específica.</p></section>';
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
   games.forEach((g,i)=>history.push({round:match.round,index:i,score:scoreForGame(g,match,p.id),name:i?'Desempate':'Partida',rival,url:g.game_url||'',color:match.white_id?((match.white_id===p.id)===(i%2===0)?'Brancas':'Pretas'):null}));
  }else{
   let value='—',label='Aguardando partida';
   if(match.status==='bye')label='Folga · classificado sem jogar';
   else if(match.status==='wo'||match.status==='double_wo'||match.status==='dq'){label=match.source==='disqualification'?'Desclassificação / decisão administrativa':match.status==='wo'?'W.O.':'W.O. duplo';value=match.winner===p.id?'1':'0'}
   else if(match.status==='draw_pending'){label='Empate';value='1/2'}
   else if(match.status==='complete'){label='Resultado registrado';value=match.winner===p.id?'1':'0'}
   history.push({round:match.round,index:0,score:value,name:label,rival,url:match.game_url||'',color:colorOf(match,p.id)});
  }
 }
 for(const match of (site.matches||[])){
  if(match.source!=='disqualification'||(match.p1!==p.id&&match.p2!==p.id))continue;
  const games=(site.games||[]).filter(g=>g.match_id===match.id);
  if(!games.length)continue;
  const rival=nameFor(match.p1===p.id?match.p2:match.p1);
  history.push({round:match.round,index:10000,score:match.winner===p.id?'1':'0',name:'Decisão administrativa / W.O.',rival,url:'',color:null});
 }
 history.sort((a,b)=>b.round-a.round||b.index-a.index);
 const rows=history.map(h=>'<div class="history-row"><span class="history-score '+(h.score==='1'?'history-win':h.score==='0'?'history-loss':'history-draw')+'">'+h.score+'</span><div class="history-row-detail"><strong>Rodada '+h.round+' · '+esc(h.name)+'</strong><small>'+esc(h.rival?'vs '+h.rival.name+' (@'+h.rival.nick+')':'sem adversário')+'</small></div>'+(h.url?'<a href="'+esc(h.url)+'" target="_blank" rel="noopener noreferrer" class="history-open">Ver no Lichess ↗</a>':'<span class="history-no-link">Sem link</span>')+'</div>').join('');
 $('#player-dialog-content').innerHTML='<span class="mini-label">HISTÓRICO DE PARTIDAS</span><h3 id="player-dialog-title">'+esc(p.name)+'</h3><p class="player-dialog-info"><a href="'+profile(p)+'" target="_blank" rel="noopener noreferrer">@'+esc(p.nick)+' ↗</a></p><p class="history-intro">Pontuação por partida: <strong>1</strong> vitória, <strong>1/2</strong> empate, <strong>0</strong> derrota. W.O. e folgas são identificados separadamente.</p><div class="history-list">'+(rows||'<div class="empty">O jogador ainda não possui confrontos nesta edição.</div>')+'</div>';
 const modal=$('#player-dialog');modal.classList.remove('hidden');document.body.classList.add('modal-open');$('#player-dialog-close').focus();
}
function closePlayerHistory(){
 $('#player-dialog').classList.add('hidden');document.body.classList.remove('modal-open');
}

async function checkAdmin(){
 try{const d=await api('/api/admin/session');admin=d.authenticated;$('#admin-login-box').classList.toggle('hidden',admin);$('#admin-dashboard').classList.toggle('hidden',!admin);if(admin){await Promise.all([loadDisqualifications(),loadImportablePlayers()]);renderAdmin()}else adminDisqualifications=[];if(!d.enabled&&!admin)$('#login-message').textContent='O servidor precisa ter ADMIN_PASSWORD configurada.'}catch(e){toast(e.message)}
}
function renderAdminColors(){
 const area=$('#admin-colors');if(!area)return;
 const old=(site.matches||[]).filter(m=>m.p2&&(site.status==='finished'||m.round<site.round));
 if(!old.length){area.innerHTML='';return}
 area.innerHTML='<section class="admin-results" style="margin-top:20px"><h3>Cores de confrontos anteriores</h3><p class="admin-help" style="padding:0 20px 12px">Confrontos realizados antes da atualização não receberam cores fictícias. Informe quem realmente jogou de brancas para completar o histórico.</p>'+old.map(m=>'<article class="admin-match-card"><div class="admin-match-summary"><div><strong>Rodada '+m.round+' · '+esc(nameFor(m.p1)?.nick)+' × '+esc(nameFor(m.p2)?.nick)+'</strong><small>'+(m.white_id?'Brancas: @'+esc(nameFor(m.white_id)?.nick||'?'):'Cor não registrada')+'</small></div><button class="api-btn" data-edit-color="'+m.id+'">Definir cores</button></div><div id="admin-detail-'+m.id+'"></div></article>').join('')+'</section>';
}



async function loadImportablePlayers(){
 if(!admin){importCandidates=null;return}
 try{
  importCandidates=await api('/api/admin/importable-players');
  if(!importCandidates.available){importSourceId=0;importSelected.clear();return}
  if(!importCandidates.editions.some(e=>e.id===importSourceId)){
   importSourceId=importCandidates.editions[0]?.id||0;
   importSelected.clear();
  }
 }catch(e){importCandidates=null;toast(e.message)}
}
function importListForSource(){
 return (importCandidates?.players||[]).filter(p=>p.archive_id===importSourceId);
}
function renderAdminImport(){
 const root=$('#admin-import');if(!root)return;
 if(site.status!=='registration'){root.innerHTML='';return}
 const data=importCandidates;
 if(!data){
  root.innerHTML='<section class="admin-config import-player-panel"><h3>Reaproveitar participantes anteriores</h3><p>Entre novamente no painel ou atualize a lista de edições para selecionar jogadores já cadastrados.</p><button type="button" class="btn slim ghost" data-reload-import="true">Carregar participantes anteriores</button></section>';
  return;
 }
 if(!data.editions.length){
  root.innerHTML='<section class="admin-config import-player-panel"><h3>Reaproveitar participantes anteriores</h3><p>Após concluir e arquivar a primeira edição, os jogadores ficarão disponíveis aqui para novos torneios.</p></section>';
  return;
 }
 const currentKeys=new Set((site.players||[]).map(p=>p.nick.toLowerCase()));
 const options=data.editions.map(e=>'<option value="'+e.id+'"'+(e.id===importSourceId?' selected':'')+'>'+esc(e.title)+' ('+e.count+' inscritos)</option>').join('');
 const players=importListForSource();
 const eligible=players.filter(p=>!p.already_registered&&!currentKeys.has(p.nick.toLowerCase()));
 const eligibleKeys=new Set(eligible.map(p=>p.nick.toLowerCase()));
 for(const key of importSelected){if(!eligibleKeys.has(key))importSelected.delete(key)}
 const list=players.map(p=>{
  const key=p.nick.toLowerCase();
  const duplicate=p.already_registered||currentKeys.has(key);
  const isChecked=!duplicate&&importSelected.has(key);
  return '<label class="import-person'+(duplicate?' import-existing':'')+'"><input type="checkbox" data-import-nick="'+esc(p.nick)+'"'+(duplicate?' disabled':'')+(isChecked?' checked':'')+'/><span class="import-person-details"><strong>'+esc(p.name)+'</strong><small>@'+esc(p.nick)+'</small></span><span class="import-person-status">'+(duplicate?'Já inscrito':p.disqualified_in_source?'Desclassificado na origem':isChecked?'Selecionado':'Disponível')+'</span></label>';
 }).join('');
 const hint=players.length?list:'<p class="admin-help">Esta edição não tem participantes disponíveis.</p>';
 root.innerHTML='<section class="admin-config import-player-panel"><div class="admin-config-head"><div><h3>Transferir participantes de outras edições</h3><p>Escolha uma competição anterior e marque quem deseja reinscrever. O torneio atual continuará aceitando novos jogadores pelo formulário público. Jogadores já cadastrados não poderão ser duplicados. A seleção em lote não inclui desclassificados de edições anteriores; estes exigem escolha individual.</p></div></div><form id="import-form"><label class="import-source-label" for="import-source">Torneio de origem</label><select id="import-source" name="archive_id">'+options+'</select><div class="import-selection-toolbar"><span>'+eligible.length+' disponível(is) · '+importSelected.size+' selecionado(s)</span><div><button type="button" data-import-all="true">Selecionar todos</button><button type="button" data-import-none="true">Limpar seleção</button></div></div><div class="import-list">'+hint+'</div><div class="settings-actions"><button type="submit" class="btn primary slim"'+(!importSelected.size?' disabled':'')+'>Transferir '+importSelected.size+' jogador(es)</button><small>Os ratings armazenados serão reaproveitados. Eles podem estar desatualizados; ratings de outras modalidades não serão apresentados como se fossem da categoria atual.</small></div></form></section>';
}

async function loadDisqualifications(){
 if(!admin){adminDisqualifications=[];return}
 try{const data=await api('/api/admin/disqualifications');adminDisqualifications=data.items||[]}
 catch(e){adminDisqualifications=[];toast(e.message)}
}
function renderAdminDisqualifications(){
 const container=$('#admin-disqualifications');
 if(!container)return;
 if(site.status==='registration'){container.innerHTML='';return}
 const current=(site.matches||[]).filter(m=>m.round===site.round);
 const candidates=site.status==='active'?(site.players||[]).filter(p=>!p.disqualified):[];
 const records=new Map(adminDisqualifications.map(d=>[d.player_id,d]));
 const disqualified=(site.players||[]).filter(p=>p.disqualified);
 let html='<section class="admin-results disqualification-panel"><div class="disqualification-head"><h3>Desclassificação de participantes</h3><p>Após o início, você pode desclassificar um jogador sem apagar partidas ou links do Lichess. O adversário recebe vitória técnica; caso haja folga, a vaga é cancelada.</p></div>';
 html+='<div class="disqualification-players">'+(candidates.length?candidates.map(p=>{
  const m=current.find(m=>m.p1===p.id||m.p2===p.id);
  return '<div class="disqualification-person"><span><strong>'+esc(p.name)+'</strong><small>@'+esc(p.nick)+' · '+(m?'Rodada '+m.round:'Já eliminado (apenas registro)')+'</small></span><button class="disqualify-btn" data-disqualify-player="'+p.id+'" type="button">Desclassificar</button></div>';
 }).join(''):'<p class="admin-help">Não há jogadores elegíveis para desclassificação nesta rodada.</p>')+'</div>';
 html+='<div id="disqualification-form-area"></div>';
 if(disqualified.length){
  html+='<div class="disqualification-history"><h4>Desclassificações registradas</h4>'+disqualified.map(p=>{
   const record=records.get(p.id);
   return '<div class="disqualification-record"><strong>'+esc(p.name)+'</strong><span>@'+esc(p.nick)+' · Rodada '+(p.disqualified_round??record?.round??'—')+'</span>'+(record?.reason?'<p><strong>Motivo registrado:</strong> '+esc(record.reason)+'</p>':'')+'</div>';
  }).join('')+'</div>';
 }
 html+='</section>';
 container.innerHTML=html;
}
function showDisqualificationForm(id){
 const player=nameFor(id),area=$('#disqualification-form-area');
 if(!player||!area)return;
 area.innerHTML='<form class="admin-edit disqualification-form" data-disqualification-id="'+id+'"><h4>Desclassificar '+esc(player.name)+'</h4><p>A desclassificação impedirá qualquer avanço. Confrontos ativos terão decisão técnica; jogos já concluídos ficam preservados. O motivo é privado.</p><label for="disqualification-reason">Motivo da desclassificação</label><textarea id="disqualification-reason" name="reason" required minlength="8" maxlength="300" rows="3" placeholder="Ex.: desistência comunicada à organização"></textarea><div class="disqualification-actions"><button class="btn primary slim" type="submit">Confirmar desclassificação</button><button class="btn slim" type="button" data-cancel-disqualification="true">Cancelar</button></div></form>';
 area.querySelector('textarea').focus();
}


function renderAdminArchives(){
 const root=$('#admin-archives');
 if(!root)return;
 const archived=(editions||[]).filter(e=>!e.current&&Number(e.id)>0);
 const signature=JSON.stringify(archived);
 if(root.dataset.signature===signature)return;
 root.dataset.signature=signature;
 const list=archived.map(e=>{
  const date=e.archived_at?new Date(e.archived_at).toLocaleDateString('pt-BR'):'Data não informada';
  return '<article class="archive-delete-item"><div class="archive-delete-info"><strong>'+esc(e.title)+'</strong><small>Arquivo #'+e.id+' · '+esc(date)+'</small></div><button type="button" class="archive-delete-open" data-open-archive-delete="'+e.id+'">Excluir edição</button></article><div class="archive-delete-confirm-slot" id="archive-delete-slot-'+e.id+'"></div>';
 }).join('');
 root.innerHTML='<section class="admin-config archive-management"><div class="admin-config-head"><div><h3>Gerenciar edições anteriores</h3><p>Exclua versões de teste ou torneios arquivados que não deseja mais exibir. A edição atual, seus inscritos e os participantes já transferidos não serão afetados.</p></div></div>'+(archived.length?'<div class="archive-delete-list">'+list+'</div>':'<p class="archive-delete-empty">Não existem edições anteriores arquivadas.</p>')+'<p class="archive-delete-disclaimer">A exclusão é permanente e remove o histórico público, os confrontos e os resultados daquela edição. Antes de excluir, considere baixar o backup em JSON acima.</p></section>';
}
function openArchiveDeletion(id){
 const archive=editions.find(x=>Number(x.id)===id&&!x.current);
 const slot=$('#archive-delete-slot-'+id);
 if(!archive||!slot)return;
 slot.innerHTML='<form class="archive-delete-form" data-archive-delete-id="'+id+'"><h4>Excluir definitivamente esta edição?</h4><p>Você está prestes a apagar <strong>'+esc(archive.title)+'</strong> (arquivo #'+id+'). Seus inscritos históricos, chaves e resultados deixarão de estar disponíveis nessa edição. A competição atual permanece intacta.</p><label for="archive-delete-text-'+id+'">Digite <strong>EXCLUIR</strong> para confirmar</label><input id="archive-delete-text-'+id+'" name="confirmation" type="text" autocomplete="off" spellcheck="false" maxlength="7" required placeholder="EXCLUIR"/><div class="archive-delete-actions"><button type="submit" class="archive-delete-confirm-btn">Excluir edição permanentemente</button><button type="button" class="archive-delete-cancel-btn" data-cancel-archive-delete="'+id+'">Cancelar</button></div></form>';
 slot.querySelector('input').focus();
}

function renderAdmin(){
 if(!site||!admin)return;
 renderAdminSettings();
 renderRegulationEditor();
 renderAdminColors();
 renderAdminDisqualifications();
 renderAdminImport();
 renderAdminArchives();
 const controls=$('#admin-controls');
 if(site.status==='registration'){
  controls.innerHTML=`<div class="admin-action-row"><div><h3>Encerrar inscrições e iniciar a copa</h3><p>Ao iniciar, o chaveamento é sorteado e publicado. Novas inscrições não serão aceitas. Cada rodada terá ${site.settings?.round_days||5} dias corridos.</p></div><button id="start-tourney" class="btn primary" ${site.players.length<2?'disabled':''}>Realizar sorteio oficial →</button></div><section class="admin-players"><h3>Gerenciar inscrições (${site.players.length})</h3>${site.players.map(p=>`<div class="admin-player-row"><span><strong>${esc(p.name)}</strong> · @${esc(p.nick)}</span><button data-delete-player="${p.id}">Remover</button></div>`).join('')}</section>`;
  $('#admin-match-list').innerHTML='';return;
 }
 const current=site.matches.filter(m=>m.round===site.round);
 const pending=current.filter(m=>['pending','draw_pending'].includes(m.status));
 controls.innerHTML=site.status==='active'?`<div class="admin-action-row"><div><h3>Rodada ${site.round} em andamento</h3><p>Encerramento: ${localDate(site.deadline)}. Restam ${pending.length} partida(s) sem resultado. ${Date.now()>new Date(site.deadline).getTime()?'O prazo terminou: revise os W.O. pendentes.':''} Registre o vencedor ou W.O. para liberar a próxima rodada.</p></div><button id="next-round" class="btn primary" ${pending.length?'disabled':''}>${pending.length?'Aguardando partidas':'Concluir rodada →'}</button></div>`:`<div class="admin-action-row"><div><h3>Copa encerrada</h3><p>Campeão: ${site.champion_id?esc(nameFor(site.champion_id)?.name):'Não houve campeão'}. O histórico permanece público no chaveamento.</p></div></div>`;
 $('#admin-match-list').innerHTML=site.status==='active'?`<section class="admin-results"><h3>Resultados da rodada ${site.round}</h3><div class="admin-help" style="padding:15px 20px 0">Use “Buscar no Lichess” para encontrar partidas oficiais ${timeLabel()} e desempates ${tiebreakLabel()} entre os adversários. Confirme manualmente qual partida pertence ao torneio.</div>${current.map(m=>{
 const p1=nameFor(m.p1),p2=nameFor(m.p2);
 const desc=m.source==='disqualification'?'Desclassificação / decisão administrativa':m.status==='bye'?'Classificação automática':m.status==='dq'?'Desclassificação':m.status==='complete'?'Resultado registrado':m.status==='double_wo'?'Ambos eliminados':m.status==='wo'?'Vitória por W.O.':m.status==='draw_pending'?'Empate, falta desempate':'Aguardando resultado';
  const ctext=m.p2?(m.white_id?' · Brancas: @'+esc(nameFor(m.white_id)?.nick||'?'):' · Cores anteriores não registradas'):'';
 return `<article class="admin-match-card"><div class="admin-match-summary"><div><strong>${esc(p1?.nick)} ${p2?'× '+esc(p2.nick):'· FOLGA'}</strong><small>${desc}${ctext}${m.game_url?' · <a href="'+esc(m.game_url)+'" target="_blank" rel="noopener">Ver partida ↗</a>':''}</small></div>${p2?`<div class="action-buttons">${m.source==='disqualification'?'':`<button data-edit="${m.id}">Lançar resultado</button>`}${m.source==='disqualification'?'':`<button class="api-btn" data-lookup="${m.id}">Buscar no Lichess ↗</button>`}<button class="api-btn" data-edit-color="${m.id}">Definir cores</button></div>`:''}</div><div id="admin-detail-${m.id}"></div></article>`;
 }).join('')}</section>`:'';
}
function editColors(id){
 const m=site.matches.find(x=>x.id===id);if(!m||!m.p2)return;
 const a=nameFor(m.p1),b=nameFor(m.p2),root=$('#admin-detail-'+id);
 root.innerHTML='<form data-color-form="'+id+'" class="admin-edit"><label>Quem jogará ou jogou de brancas?</label><select name="white_id"><option value="'+a.id+'">'+esc(a.name)+' (@'+esc(a.nick)+')</option><option value="'+b.id+'">'+esc(b.name)+' (@'+esc(b.nick)+')</option></select><p class="admin-help">Nos confrontos antigos, registre a cor real. O resultado não será alterado.</p><button class="btn primary slim" type="submit">Salvar cores</button></form>';
 root.querySelector('select').value=m.white_id||m.p1;
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
 try{const r=await api(path,options);toast(r.message||'Atualizado.');if(path.includes('/disqualify'))await loadDisqualifications();await refresh();}
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
 if(newbox.dataset.signature!==newSignature){newbox.dataset.signature=newSignature;newbox.innerHTML=`<div class="admin-create-toggle"><div><strong>Organizar outra edição</strong><small>${canCreate?'Crie um novo torneio e preserve o histórico dos anteriores.':'Conclua o torneio atual antes de criar uma nova edição.'}</small></div><button type="button" id="toggle-new" ${canCreate?'':'disabled'}>${newEditionOpen?'Fechar':'Criar nova edição'}</button></div>${canCreate&&newEditionOpen?`<section class="admin-config"><div class="admin-config-head"><div><h3>Novo torneio</h3><p>A edição anterior será arquivada, com todos os inscritos, confrontos e resultados. Depois de criar a edição, você poderá selecionar jogadores anteriores individualmente ou em lote. Novas inscrições continuarão abertas.</p></div></div><form id="new-tournament-form">${settingsFields({...s,title:'',prize:''},'new')}<div class="settings-actions"><button type="submit" class="btn primary slim">Criar torneio e arquivar o anterior</button></div></form></section>`:''}`;}
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
$$('[data-tab]').forEach(el=>el.addEventListener('click',()=>{if(['chaves','regras','inscricoes','classificacao'].includes(el.dataset.tab))history.replaceState(null,'','#'+el.dataset.tab);tab(el.dataset.tab,el.dataset.scrollTarget||null)}));
$('#refresh-button').addEventListener('click',()=>refresh());
$('#ranking-area').addEventListener('click',e=>{const b=e.target.closest('button[data-player-id]');if(b)openPlayerHistory(Number(b.dataset.playerId))});
$('#bracket-area').addEventListener('click',e=>{
 const node=e.target.closest('button[data-player-id]');
 if(node)openPlayerHistory(Number(node.dataset.playerId));
});
$('#player-dialog').addEventListener('click',e=>{if(e.target.closest('[data-close-player]'))closePlayerHistory()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#player-dialog').classList.contains('hidden'))closePlayerHistory()});

$('#tournament-selector').addEventListener('change', async e=>{archiveId=Number(e.target.value);preview={pairs:[],byes:[]};await refresh();tab('chaves');});
$('#signup-agree').addEventListener('change',e=>{if(e.target.checked)consentWarning();});
$('#signup-regulation-link').addEventListener('click',e=>{e.preventDefault();openRegulationDialog();});
$('#regulation-dialog').addEventListener('click',e=>{if(e.target.closest('[data-close-regulation]'))closeRegulationDialog();});
$('#regulation-dialog').addEventListener('keydown',e=>{
 if(e.key==='Escape'){e.preventDefault();closeRegulationDialog();return;}
 if(e.key!=='Tab')return;
 const buttons=[...$('#regulation-dialog').querySelectorAll('button:not([disabled]),a[href]')];
 const first=buttons[0],last=buttons[buttons.length-1];
 if(!first||!last)return;
 if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
 else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
});
$('#signup-form').addEventListener('submit',async e=>{
 e.preventDefault();
 const form=e.currentTarget,btn=$('#signup-submit'),msg=$('#signup-message');
 const agree=$('#signup-agree');
 if(!agree.checked){
  consentWarning('Para confirmar a inscrição, marque a caixa “Estou de acordo com o Regulamento”.');
  agree.focus();
  return;
 }
 consentWarning();
 if(!form.checkValidity()){form.reportValidity();return;}
 const data=Object.fromEntries(new FormData(form).entries());
 data.agreed_to_rules=agree.checked;
 btn.disabled=true;msg.className='form-message';msg.textContent='Conferindo usuário e rating…';
 try{
  await api('/api/register',{method:'POST',body:JSON.stringify(data)});
  msg.className='form-message success';msg.textContent='Inscrição confirmada! Seu aceite do regulamento foi registrado.';
  form.reset();
  consentWarning();
  await refresh();
 }catch(error){msg.className='form-message error';msg.textContent=error.message}
 finally{btn.disabled=site?.status!=='registration'}
});
$('#login-form').addEventListener('submit',async e=>{
 e.preventDefault();let msg=$('#login-message');
 try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('#admin-password').value})});msg.textContent='';$('#admin-password').value='';await checkAdmin();}
 catch(err){msg.className='form-message error';msg.textContent=err.message}
});
$('#logout-button').addEventListener('click',()=>doAction('/api/admin/logout',{method:'POST'}).then(()=>{admin=false;checkAdmin()}));
$('#admin-dashboard').addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.id==='download-backup'){downloadBackup();return;}
 if(b.dataset.openArchiveDelete){openArchiveDeletion(Number(b.dataset.openArchiveDelete));return;}
 if(b.dataset.cancelArchiveDelete){const slot=$('#archive-delete-slot-'+b.dataset.cancelArchiveDelete);if(slot)slot.replaceChildren();return;}
 if(b.id==='toggle-new'){newEditionOpen=!newEditionOpen;renderAdmin();return;}
 if(b.dataset.reloadImport){await loadImportablePlayers();renderAdminImport();return;}
 if(b.dataset.importAll){importSelected=new Set(importListForSource().filter(p=>!p.already_registered&&!p.disqualified_in_source&&!site.players.some(q=>q.nick.toLowerCase()===p.nick.toLowerCase())).map(p=>p.nick.toLowerCase()));renderAdminImport();return;}
 if(b.dataset.importNone){importSelected.clear();renderAdminImport();return;}
 if(b.dataset.disqualifyPlayer){showDisqualificationForm(Number(b.dataset.disqualifyPlayer));return}
 if(b.dataset.cancelDisqualification){$('#disqualification-form-area').innerHTML='';return}
 if(b.id==='start-tourney')doAction('/api/admin/start',{method:'POST'},'Encerrar definitivamente as inscrições e sortear a primeira rodada?');
 if(b.id==='next-round')doAction('/api/admin/next-round',{method:'POST'},'Confirmar todos os resultados e iniciar a próxima rodada?');
 if(b.dataset.deletePlayer)doAction(`/api/admin/players/${b.dataset.deletePlayer}`,{method:'DELETE'},'Remover este jogador da inscrição?');
 if(b.dataset.edit)editMatch(Number(b.dataset.edit));
 if(b.dataset.lookup)lookupGames(Number(b.dataset.lookup));
  if(b.dataset.editColor)editColors(Number(b.dataset.editColor));
 if(b.dataset.confirmGame)doAction(`/api/admin/matches/${b.dataset.match}/use-game`,{method:'POST',body:JSON.stringify({game_id:b.dataset.confirmGame})},'Confirmar que esta partida pertence ao torneio e lançar o resultado?');
});
$('#admin-dashboard').addEventListener('change',e=>{
 const source=e.target.closest('#import-source');
 if(source){importSourceId=Number(source.value);importSelected.clear();renderAdminImport();return}
 const checkbox=e.target.closest('input[data-import-nick]');
 if(checkbox){const key=checkbox.dataset.importNick.toLowerCase();if(checkbox.checked)importSelected.add(key);else importSelected.delete(key);renderAdminImport()}
});
$('#admin-dashboard').addEventListener('submit',async e=>{
 const deleteArchive=e.target.closest('form[data-archive-delete-id]');
 if(deleteArchive){
  e.preventDefault();
  const id=Number(deleteArchive.dataset.archiveDeleteId);
  const title=editions.find(item=>Number(item.id)===id&&!item.current)?.title;
  const typed=String(new FormData(deleteArchive).get('confirmation')||'').trim();
  if(!title||typed!=='EXCLUIR'){toast('Digite EXCLUIR em letras maiúsculas para confirmar a exclusão.');return;}
  if(!confirm('Excluir DEFINITIVAMENTE a edição '+title+' (#'+id+')? Essa ação não poderá ser desfeita.'))return;
  const button=deleteArchive.querySelector('[type="submit"]');
  button.disabled=true;
  try{
   const result=await api('/api/admin/tournaments/archives/'+id,{method:'DELETE',body:JSON.stringify({confirmation:'EXCLUIR'})});
   toast(result.message||'Edição excluída.');
   if(archiveId===id)archiveId=0;
   importSelected.clear();
   importSourceId=0;
   await loadImportablePlayers();
   await refresh();
  }catch(error){toast(error.message)}
  finally{if(button.isConnected)button.disabled=false}
  return;
 }
 const disqualificationForm=e.target.closest('form[data-disqualification-id]');
 if(disqualificationForm){
  e.preventDefault();
  const id=Number(disqualificationForm.dataset.disqualificationId);
  const p=nameFor(id),reason=String(new FormData(disqualificationForm).get('reason')||'').trim();
  if(reason.length<8){toast('Informe um motivo com pelo menos 8 caracteres.');return}
  await doAction('/api/admin/players/'+id+'/disqualify',{method:'POST',body:JSON.stringify({reason})},'Confirmar a desclassificação de '+(p?.name||'este jogador')+'? A classificação da rodada será alterada, mas as partidas permanecerão no histórico.');
  return;
 }
 const importer=e.target.closest('#import-form');
 if(importer){
  e.preventDefault();
  const nicks=importListForSource().filter(p=>importSelected.has(p.nick.toLowerCase())).map(p=>p.nick);
  if(!nicks.length){toast('Selecione pelo menos um jogador.');return}
  if(!confirm('Reinscrever '+nicks.length+' jogador(es) na edição atual?'))return;
  try{
   const response=await api('/api/admin/import-players',{method:'POST',body:JSON.stringify({archive_id:importSourceId,nicks})});
   toast(response.message+(response.skipped?.length?' Alguns nicks já estavam inscritos ou foram ignorados.':''));
   importSelected.clear();await loadImportablePlayers();await refresh();
  }catch(err){toast(err.message)}
  return;
 }
 const colorForm=e.target.closest('form[data-color-form]');
 if(colorForm){e.preventDefault();await doAction('/api/admin/matches/'+colorForm.dataset.colorForm+'/color',{method:'PUT',body:JSON.stringify({white_id:Number(new FormData(colorForm).get('white_id'))})});return;}
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
  try{const r=await api('/api/admin/tournaments/new',{method:'POST',body:JSON.stringify(settingsPayload(next))});toast(r.message);archiveId=0;newEditionOpen=false;await loadImportablePlayers();await refresh();}
  catch(err){toast(err.message)}
  return;
 }
 const form=e.target.closest('.result-form');if(!form)return;e.preventDefault();
 const payload=Object.fromEntries(new FormData(form).entries());
 await doAction(`/api/admin/matches/${form.dataset.matchId}/result`,{method:'POST',body:JSON.stringify(payload)},'Confirmar e publicar este resultado?');
});
function restoreTabFromUrl(){const deep=location.hash.slice(1);if(site&&['inscricoes','chaves','regras','classificacao'].includes(deep))tab(deep)}
window.addEventListener('hashchange',restoreTabFromUrl);
refresh().then(restoreTabFromUrl);setInterval(()=>refresh(true),30000);