const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0);
const num = v => Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
const fmtDate = iso => { try { return new Date(iso).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}); } catch { return iso; } };
const escapeHtml = v => String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

let state = null;
let info = null;
let recipeDraft = [];
let extraDraft = [];
let updateAssetUrl = '';
let editingProductId = '';
let editingStockId = '';

const pageMeta = {
  dashboard:['Visão geral','Acompanhe caixa, estoque e lucro do seu delivery.'],
  sales:['Vendas','Registre pedidos e baixe o estoque automaticamente.'],
  products:['Cardápio','Monte seus lanches e fichas técnicas.'],
  stock:['Estoque','Controle quantidade, custo e alertas de reposição.'],
  cash:['Caixa','Separe lucro operacional de fluxo de caixa.'],
  settings:['Configurações','Backup, dados da loja e atualizações pelo GitHub.']
};

async function api(path, options={}) {
  const opts = {...options, headers:{...(options.headers||{})}};
  if (opts.body && typeof opts.body !== 'string') {
    opts.headers['Content-Type']='application/json';
    opts.body=JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  const ct = res.headers.get('content-type')||'';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || data || `Erro ${res.status}`);
  return data;
}

function toast(message,isError=false){
  const el=$('#toast'); el.textContent=message; el.classList.toggle('error',isError); el.classList.remove('hidden');
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.add('hidden'),3500);
}
function saveStatus(text='Dados salvos'){ $('#saveStatus').textContent=text; }
function goTab(name){
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  $$('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${name}`));
  $('#pageTitle').textContent=pageMeta[name][0]; $('#pageSubtitle').textContent=pageMeta[name][1];
}
function stockById(id){ return state.stock.find(s=>s.id===id); }
function productById(id){ return state.products.find(p=>p.id===id); }
function stockOptions(selected=''){ return state.stock.map(i=>`<option value="${i.id}" ${i.id===selected?'selected':''}>${escapeHtml(i.name)} (${escapeHtml(i.unit)})</option>`).join(''); }
function emptyRow(cols,text){ return `<tr><td colspan="${cols}" style="color:var(--muted);text-align:center;padding:25px">${escapeHtml(text)}</td></tr>`; }

function productCost(product){
  return (product?.recipe||[]).reduce((sum,r)=>sum+(stockById(r.stockId)?.cost||0)*Number(r.qty||0),0);
}
function financials(){
  const salesRevenue=state.sales.reduce((s,x)=>s+Number(x.revenue||0),0);
  const extraIncome=state.cash.filter(x=>x.type==='income').reduce((s,x)=>s+Number(x.value||0),0);
  const cogs=state.sales.reduce((s,x)=>s+Number(x.cogs||0),0);
  const fees=state.sales.reduce((s,x)=>s+Number(x.fee||0),0);
  const manualExpenses=state.cash.filter(x=>x.type==='expense'&&x.kind!=='inventory_purchase').reduce((s,x)=>s+Number(x.value||0),0);
  const purchases=state.cash.filter(x=>x.type==='expense'&&x.kind==='inventory_purchase').reduce((s,x)=>s+Number(x.value||0),0);
  const revenue=salesRevenue+extraIncome;
  const operatingExpenses=fees+manualExpenses;
  const profit=revenue-cogs-operatingExpenses;
  const cashBalance=revenue-fees-manualExpenses-purchases;
  return {salesRevenue,extraIncome,revenue,cogs,fees,manualExpenses,purchases,operatingExpenses,profit,cashBalance};
}

function renderDashboard(){
  const f=financials();
  $('#kpiRevenue').textContent=money(f.revenue); $('#kpiCogs').textContent=money(f.cogs); $('#kpiExpenses').textContent=money(f.operatingExpenses);
  $('#kpiProfit').textContent=money(f.profit); $('#kpiProfit').className=f.profit>=0?'positive':'negative';
  $('#kpiMargin').textContent=`Margem ${f.revenue?(f.profit/f.revenue*100).toFixed(1):'0.0'}%`;
  const low=state.stock.filter(i=>Number(i.qty)<=Number(i.min));
  $('#lowStockCount').textContent=`${low.length} ${low.length===1?'item':'itens'}`; $('#navLowStock').textContent=low.length; $('#navLowStock').classList.toggle('hidden',!low.length);
  $('#lowStockList').innerHTML=low.length?low.map(i=>`<div class="list-item"><div><strong>${escapeHtml(i.name)}</strong><small>Atual: ${num(i.qty)} ${escapeHtml(i.unit)} • mínimo: ${num(i.min)} ${escapeHtml(i.unit)}</small></div><strong class="warning">Comprar</strong></div>`).join(''):'<div class="list-item"><span>Nenhum ingrediente abaixo do mínimo.</span><strong class="positive">OK</strong></div>';
  const stockValue=state.stock.reduce((s,i)=>s+Number(i.qty||0)*Number(i.cost||0),0);
  $('#metricOrders').textContent=state.sales.length; $('#metricTicket').textContent=money(state.sales.length?f.salesRevenue/state.sales.length:0); $('#metricStockValue').textContent=money(stockValue);
  $('#metricCashBalance').textContent=money(f.cashBalance); $('#metricCashBalance').className=f.cashBalance>=0?'positive':'negative';
  const rows=[...state.sales].reverse().slice(0,8);
  $('#dashboardSales').innerHTML=rows.length?rows.map(s=>`<tr><td>${fmtDate(s.date)}</td><td>${s.qty}x ${escapeHtml(s.productName)}</td><td>${money(s.revenue)}</td><td>${money(s.cogs)}</td><td>${money(s.fee)}</td><td class="${s.result>=0?'positive':'negative'}">${money(s.result)}</td></tr>`).join(''):emptyRow(6,'Nenhuma venda registrada ainda.');
}

function renderSales(){
  const active=state.products.filter(p=>p.active!==false);
  const current=$('#saleProduct').value;
  $('#saleProduct').innerHTML=active.map(p=>`<option value="${p.id}" ${p.id===current?'selected':''}>${escapeHtml(p.name)} — ${money(p.price)}</option>`).join('');
  renderSaleRecipe(); renderExtras();
  const rows=[...state.sales].reverse();
  $('#salesTable').innerHTML=rows.length?rows.map(s=>`<tr><td>${fmtDate(s.date)}</td><td>${s.qty}x ${escapeHtml(s.productName)}</td><td>${escapeHtml(s.payment)}</td><td>${money(s.revenue)}</td><td>${money(s.cogs)}</td><td>${money(s.fee)}</td><td class="${s.result>=0?'positive':'negative'}">${money(s.result)}</td></tr>`).join(''):emptyRow(7,'Nenhuma venda registrada.');
}
function renderSaleRecipe(){
  const p=productById($('#saleProduct').value) || state.products.find(p=>p.active!==false);
  if(!p){ $('#removeIngredients').innerHTML='<div class="empty-state">Cadastre um lanche no Cardápio primeiro.</div>'; updateSalePreview(); return; }
  $('#saleProduct').value=p.id;
  $('#removeIngredients').innerHTML=(p.recipe||[]).map(r=>{const i=stockById(r.stockId); if(!i)return''; return `<label class="check-card"><input type="checkbox" data-remove-id="${i.id}"/><span><strong>${escapeHtml(i.name)}</strong><small>${num(r.qty)} ${escapeHtml(i.unit)} por lanche</small></span></label>`}).join('');
  updateSalePreview();
}
function renderExtras(){
  if(!extraDraft.length){ $('#extraList').innerHTML='<small style="color:var(--muted)">Nenhum acréscimo neste pedido.</small>'; updateSalePreview(); return; }
  $('#extraList').innerHTML=extraDraft.map((x,idx)=>`<div class="row-editor"><select data-extra-stock="${idx}">${stockOptions(x.stockId)}</select><input data-extra-qty="${idx}" type="number" min="0.001" step="0.001" value="${x.qty}" title="Quantidade usada"/><input data-extra-price="${idx}" type="number" min="0" step="0.01" value="${x.price}" title="Valor cobrado"/><button type="button" class="icon-btn" data-extra-remove="${idx}">×</button></div>`).join('');
  updateSalePreview();
}
function salePreview(){
  const p=productById($('#saleProduct').value); if(!p)return {revenue:0,cogs:0,fee:0,result:0};
  const qty=Math.max(1,Math.floor(Number($('#saleQty').value)||1));
  const removed=new Set($$('[data-remove-id]:checked').map(x=>x.dataset.removeId));
  let cogs=0;
  for(const r of p.recipe||[]){ if(!removed.has(r.stockId)){ const i=stockById(r.stockId); if(i)cogs+=Number(i.cost||0)*Number(r.qty||0)*qty; } }
  let extraRevenue=0;
  for(const x of extraDraft){ const i=stockById(x.stockId); if(i)cogs+=Number(i.cost||0)*Number(x.qty||0)*qty; extraRevenue+=Number(x.price||0)*qty; }
  const revenue=Number(p.price||0)*qty+extraRevenue; const fee=Math.max(0,Number($('#saleFee').value)||0); return {revenue,cogs,fee,result:revenue-cogs-fee};
}
function updateSalePreview(){ const x=salePreview(); $('#previewRevenue').textContent=money(x.revenue); $('#previewCogs').textContent=money(x.cogs); $('#previewFee').textContent=money(x.fee); $('#previewResult').textContent=money(x.result); $('#previewResult').className=x.result>=0?'positive':'negative'; }

function renderProducts(){
  $('#productCards').innerHTML=state.products.length?state.products.map(p=>{const cost=productCost(p),gross=Number(p.price)-cost,margin=Number(p.price)?gross/Number(p.price)*100:0;return `<article class="product-card ${p.active===false?'is-inactive':''}"><div class="product-title-row"><div><h3>${escapeHtml(p.name)}</h3><div class="price">${money(p.price)}</div></div><span class="status-chip">${p.active===false?'Inativo':'Ativo'}</span></div><div class="product-stats"><div><small>Custo estimado</small><strong>${money(cost)}</strong></div><div><small>Lucro bruto</small><strong class="${gross>=0?'positive':'negative'}">${money(gross)}</strong></div><div><small>Margem bruta</small><strong>${margin.toFixed(1)}%</strong></div><div><small>Ingredientes</small><strong>${(p.recipe||[]).length}</strong></div></div><div class="product-actions"><button type="button" class="primary-btn compact-btn" data-product-edit="${p.id}">Editar</button><button type="button" class="ghost-btn compact-btn" data-product-duplicate="${p.id}">Duplicar</button><button type="button" class="ghost-btn compact-btn" data-product-toggle="${p.id}">${p.active===false?'Ativar':'Desativar'}</button></div></article>`}).join(''):'<article class="panel">Nenhum lanche cadastrado.</article>';
  renderRecipeDraft();
}
function renderRecipeDraft(){
  $('#recipeList').innerHTML=recipeDraft.length?recipeDraft.map((r,idx)=>`<div class="row-editor"><select data-recipe-stock="${idx}">${stockOptions(r.stockId)}</select><input data-recipe-qty="${idx}" type="number" min="0.001" step="0.001" value="${r.qty}"/><button type="button" class="icon-btn" data-recipe-remove="${idx}">×</button></div>`).join(''):'<small style="color:var(--muted)">Clique em “+ Ingrediente” para montar a ficha técnica.</small>';
}

function renderStock(){
  $('#restockItem').innerHTML=stockOptions($('#restockItem').value);
  $('#stockTable').innerHTML=state.stock.length?state.stock.map(i=>{const low=Number(i.qty)<=Number(i.min);return `<tr><td><strong>${escapeHtml(i.name)}</strong></td><td>${num(i.qty)} ${escapeHtml(i.unit)}</td><td><input class="stock-min-input" data-stock-min="${i.id}" type="number" min="0" step="0.001" value="${i.min}"/></td><td>${money(i.cost)}</td><td>${money(Number(i.qty)*Number(i.cost))}</td><td class="${low?'warning':'positive'}">${low?'⚠ Estoque baixo':'OK'}</td><td><div class="table-actions"><button type="button" class="ghost-btn compact-btn" data-stock-edit="${i.id}">Editar</button><button type="button" class="ghost-btn compact-btn" data-stock-adjust="${i.id}" data-delta="-1">-1</button><button type="button" class="ghost-btn compact-btn" data-stock-adjust="${i.id}" data-delta="1">+1</button><button type="button" class="ghost-btn compact-btn" data-stock-set="${i.id}">Definir qtd.</button></div></td></tr>`}).join(''):emptyRow(7,'Nenhum ingrediente cadastrado.');
}

function renderCash(){
  const f=financials(); $('#cashRevenue').textContent=money(f.revenue); $('#cashProfit').textContent=money(f.profit); $('#cashProfit').className=f.profit>=0?'positive':'negative'; $('#cashPurchases').textContent=money(f.purchases); $('#cashBalance').textContent=money(f.cashBalance); $('#cashBalance').className=f.cashBalance>=0?'positive':'negative';
  const rows=[...state.cash].reverse();
  $('#cashTable').innerHTML=rows.length?rows.map(c=>`<tr><td>${fmtDate(c.date)}</td><td>${c.type==='income'?'Receita':'Despesa'}</td><td>${escapeHtml(c.category)}</td><td>${escapeHtml(c.description)}</td><td class="${c.type==='income'?'positive':'negative'}">${c.type==='income'?'+':'-'} ${money(c.value)}</td></tr>`).join(''):emptyRow(5,'Nenhuma movimentação registrada.');
}
function renderSettings(){
  $('#brandName').textContent=state.settings?.businessName||'Gestão Delivery'; $('#businessName').value=state.settings?.businessName||''; $('#githubOwner').value=state.settings?.githubOwner||''; $('#githubRepo').value=state.settings?.githubRepo||'';
}

function resetProductForm(){
  editingProductId='';
  $('#productForm').reset();
  recipeDraft=state?.stock?.length?[{stockId:state.stock[0].id,qty:1}]:[];
  $('#productFormTitle').textContent='Novo lanche';
  $('#productFormSubtitle').textContent='Monte a ficha técnica para o sistema calcular custo e baixa de estoque.';
  $('#productSubmitBtn').textContent='Salvar lanche';
  $('#cancelProductEditBtn').classList.add('hidden');
  $('#productEditBadge').classList.add('hidden');
  renderRecipeDraft();
}
function startProductEdit(id){
  const p=productById(id); if(!p)return;
  editingProductId=p.id;
  $('#productName').value=p.name;
  $('#productPrice').value=Number(p.price||0);
  recipeDraft=(p.recipe||[]).map(r=>({stockId:r.stockId,qty:Number(r.qty||0)}));
  $('#productFormTitle').textContent='Editar lanche';
  $('#productFormSubtitle').textContent='Altere nome, preço ou ingredientes. As próximas vendas usarão esta ficha técnica.';
  $('#productSubmitBtn').textContent='Salvar alterações';
  $('#cancelProductEditBtn').classList.remove('hidden');
  $('#productEditBadge').classList.remove('hidden');
  renderRecipeDraft();
  $('#productForm').scrollIntoView({behavior:'smooth',block:'start'});
}
function resetStockForm(){
  editingStockId='';
  $('#stockForm').reset();
  $('#stockFormTitle').textContent='Novo ingrediente';
  $('#stockFormSubtitle').textContent='Defina quantidade, custo e estoque mínimo.';
  $('#stockSubmitBtn').textContent='Cadastrar ingrediente';
  $('#cancelStockEditBtn').classList.add('hidden');
  $('#stockEditBadge').classList.add('hidden');
}
function startStockEdit(id){
  const i=stockById(id); if(!i)return;
  editingStockId=i.id;
  $('#stockName').value=i.name;
  $('#stockQty').value=Number(i.qty||0);
  $('#stockUnit').value=i.unit||'un';
  $('#stockMin').value=Number(i.min||0);
  $('#stockCost').value=Number(i.cost||0);
  $('#stockFormTitle').textContent='Editar ingrediente';
  $('#stockFormSubtitle').textContent='Altere nome, quantidade, unidade, estoque mínimo ou custo.';
  $('#stockSubmitBtn').textContent='Salvar alterações';
  $('#cancelStockEditBtn').classList.remove('hidden');
  $('#stockEditBadge').classList.remove('hidden');
  $('#stockForm').scrollIntoView({behavior:'smooth',block:'start'});
}
function renderAll(){ renderDashboard(); renderSales(); renderProducts(); renderStock(); renderCash(); renderSettings(); }
async function refresh(){ state=await api('/api/data'); renderAll(); }
async function runAction(fn,success){ try{saveStatus('Salvando...'); state=await fn(); renderAll(); saveStatus('Dados salvos'); if(success)toast(success);}catch(e){saveStatus('Erro ao salvar');toast(e.message||'Ocorreu um erro.',true);} }

$$('.nav-btn').forEach(b=>b.addEventListener('click',()=>goTab(b.dataset.tab)));
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>goTab(b.dataset.go)));

$('#stockForm').addEventListener('submit',async e=>{e.preventDefault();const body={name:$('#stockName').value,qty:Number($('#stockQty').value),unit:$('#stockUnit').value,min:Number($('#stockMin').value),cost:Number($('#stockCost').value)};if(editingStockId){body.id=editingStockId;await runAction(()=>api('/api/stock/update',{method:'POST',body}), 'Ingrediente atualizado.');resetStockForm();}else{await runAction(()=>api('/api/stock/add',{method:'POST',body}), 'Ingrediente cadastrado.');resetStockForm();}});
$('#restockForm').addEventListener('submit',e=>{e.preventDefault();runAction(()=>api('/api/stock/restock',{method:'POST',body:{stockId:$('#restockItem').value,qty:Number($('#restockQty').value),total:Number($('#restockTotal').value)}}),'Compra registrada e estoque atualizado.').then(()=>e.target.reset());});
$('#productForm').addEventListener('submit',async e=>{e.preventDefault();if(!recipeDraft.length)return toast('Adicione pelo menos um ingrediente.',true);const current=editingProductId?productById(editingProductId):null;const body={name:$('#productName').value,price:Number($('#productPrice').value),recipe:recipeDraft.map(r=>({...r})),active:current?current.active!==false:true};if(editingProductId){body.id=editingProductId;await runAction(()=>api('/api/product/update',{method:'POST',body}),'Lanche atualizado.');resetProductForm();}else{await runAction(()=>api('/api/product/add',{method:'POST',body}),'Lanche cadastrado.');resetProductForm();}});
$('#cashForm').addEventListener('submit',e=>{e.preventDefault();runAction(()=>api('/api/cash/add',{method:'POST',body:{type:$('#cashType').value,category:$('#cashCategory').value,description:$('#cashDescription').value,value:Number($('#cashValue').value)}}),'Lançamento registrado.').then(()=>e.target.reset());});
$('#settingsForm').addEventListener('submit',e=>{e.preventDefault();runAction(()=>api('/api/settings',{method:'POST',body:{businessName:$('#businessName').value,githubOwner:$('#githubOwner').value,githubRepo:$('#githubRepo').value}}),'Configurações salvas.');});

$('#addRecipeBtn').addEventListener('click',()=>{if(!state.stock.length)return toast('Cadastre um ingrediente primeiro.',true);recipeDraft.push({stockId:state.stock[0].id,qty:1});renderRecipeDraft();});
$('#cancelProductEditBtn').addEventListener('click',resetProductForm);
$('#cancelStockEditBtn').addEventListener('click',resetStockForm);
$('#addExtraBtn').addEventListener('click',()=>{if(!state.stock.length)return toast('Cadastre um ingrediente primeiro.',true);extraDraft.push({stockId:state.stock[0].id,qty:1,price:0});renderExtras();});
$('#saleProduct').addEventListener('change',()=>{extraDraft=[];renderSaleRecipe();renderExtras();});
$('#saleQty').addEventListener('input',updateSalePreview); $('#saleFee').addEventListener('input',updateSalePreview); $('#removeIngredients').addEventListener('change',updateSalePreview);
$('#finishSaleBtn').addEventListener('click',async()=>{const p=productById($('#saleProduct').value);if(!p)return toast('Cadastre um lanche antes de vender.',true);const removedIds=$$('[data-remove-id]:checked').map(x=>x.dataset.removeId);await runAction(()=>api('/api/sale/add',{method:'POST',body:{productId:p.id,qty:Number($('#saleQty').value),payment:$('#salePayment').value,fee:Number($('#saleFee').value),removedIds,extras:extraDraft}}),'Venda finalizada e estoque atualizado.');extraDraft=[];$('#saleQty').value=1;$('#saleFee').value=0;renderExtras();renderSaleRecipe();});

document.addEventListener('input',e=>{
  if(e.target.matches('[data-recipe-qty]'))recipeDraft[Number(e.target.dataset.recipeQty)].qty=Math.max(.001,Number(e.target.value)||.001);
  if(e.target.matches('[data-extra-qty]')){extraDraft[Number(e.target.dataset.extraQty)].qty=Math.max(.001,Number(e.target.value)||.001);updateSalePreview();}
  if(e.target.matches('[data-extra-price]')){extraDraft[Number(e.target.dataset.extraPrice)].price=Math.max(0,Number(e.target.value)||0);updateSalePreview();}
});
document.addEventListener('change',async e=>{
  if(e.target.matches('[data-recipe-stock]'))recipeDraft[Number(e.target.dataset.recipeStock)].stockId=e.target.value;
  if(e.target.matches('[data-extra-stock]')){extraDraft[Number(e.target.dataset.extraStock)].stockId=e.target.value;updateSalePreview();}
  if(e.target.matches('[data-stock-min]'))await runAction(()=>api('/api/stock/update',{method:'POST',body:{ID:e.target.dataset.stockMin,Min:Number(e.target.value)}}),'Estoque mínimo atualizado.');
});
document.addEventListener('click',async e=>{
  const rr=e.target.closest('[data-recipe-remove]');if(rr){recipeDraft.splice(Number(rr.dataset.recipeRemove),1);renderRecipeDraft();}
  const er=e.target.closest('[data-extra-remove]');if(er){extraDraft.splice(Number(er.dataset.extraRemove),1);renderExtras();}
  const adj=e.target.closest('[data-stock-adjust]');if(adj){const item=stockById(adj.dataset.stockAdjust);if(item)await runAction(()=>api('/api/stock/update',{method:'POST',body:{ID:item.id,Qty:Math.max(0,Number(item.qty)+Number(adj.dataset.delta))}}),'Estoque ajustado.');}
  const set=e.target.closest('[data-stock-set]');if(set){const item=stockById(set.dataset.stockSet);if(!item)return;const value=prompt(`Quantidade atual de ${item.name} (${item.unit}):`,String(item.qty));if(value===null)return;const n=Number(String(value).replace(',','.'));if(!Number.isFinite(n)||n<0)return toast('Quantidade inválida.',true);await runAction(()=>api('/api/stock/update',{method:'POST',body:{ID:item.id,Qty:n}}),'Quantidade atualizada.');}
  const se=e.target.closest('[data-stock-edit]');if(se){startStockEdit(se.dataset.stockEdit);}
  const pe=e.target.closest('[data-product-edit]');if(pe){startProductEdit(pe.dataset.productEdit);}
  const pd=e.target.closest('[data-product-duplicate]');if(pd){const p=productById(pd.dataset.productDuplicate);if(p){editingProductId='';$('#productName').value=p.name+' (cópia)';$('#productPrice').value=Number(p.price||0);recipeDraft=(p.recipe||[]).map(r=>({stockId:r.stockId,qty:Number(r.qty||0)}));$('#productFormTitle').textContent='Duplicar lanche';$('#productFormSubtitle').textContent='Ajuste o que quiser e salve como um novo lanche.';$('#productSubmitBtn').textContent='Salvar cópia';$('#cancelProductEditBtn').classList.remove('hidden');$('#productEditBadge').classList.add('hidden');renderRecipeDraft();$('#productForm').scrollIntoView({behavior:'smooth',block:'start'});}}
  const pt=e.target.closest('[data-product-toggle]');if(pt){const p=productById(pt.dataset.productToggle);if(p)await runAction(()=>api('/api/product/update',{method:'POST',body:{id:p.id,name:p.name,price:Number(p.price||0),recipe:(p.recipe||[]),active:p.active===false}}),p.active===false?'Lanche ativado.':'Lanche desativado.');}
});

$('#checkUpdateBtn').addEventListener('click',async()=>{try{$('#updateMessage').textContent='Verificando...';const r=await api('/api/update/check');updateAssetUrl=r.assetUrl||'';if(!r.newer){$('#updateMessage').textContent=`Você já está na versão mais recente (${r.current}).`;$('#installUpdateBtn').classList.add('hidden');return;}if(!updateAssetUrl){$('#updateMessage').textContent=`Versão ${r.latest} encontrada, mas o Release não contém GestaoDelivery.exe.`;$('#installUpdateBtn').classList.add('hidden');return;}$('#updateMessage').textContent=`Nova versão ${r.latest} disponível. Você usa ${r.current}.`;$('#installUpdateBtn').classList.remove('hidden');}catch(e){toast(e.message,true);$('#updateMessage').textContent=e.message;}});
$('#installUpdateBtn').addEventListener('click',async()=>{if(!updateAssetUrl)return;try{$('#updateMessage').textContent='Baixando atualização...';await api('/api/update/install',{method:'POST',body:{url:updateAssetUrl}});$('#updateMessage').textContent='Atualização baixada. O aplicativo vai reiniciar.';}catch(e){toast(e.message,true);$('#updateMessage').textContent=e.message;}});
$('#openDataFolderBtn').addEventListener('click',()=>api('/api/data/open-folder',{method:'POST'}).catch(e=>toast(e.message,true)));
$('#importBackupBtn').addEventListener('click',()=>$('#backupFile').click());
$('#backupFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;if(!confirm('Restaurar este backup substituirá os dados atuais. Continuar?')){e.target.value='';return;}try{const text=await file.text();const obj=JSON.parse(text);state=await api('/api/backup/import',{method:'POST',body:obj});renderAll();toast('Backup restaurado.');}catch(err){toast(err.message||'Backup inválido.',true);}e.target.value='';});
$('#quitBtn').addEventListener('click',async()=>{try{await api('/api/quit',{method:'POST'});}catch{}window.close();});

(async function init(){
  try{
    $('#todayText').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});
    info=await api('/api/info'); $('#versionText').textContent=`v${info.version}`; $('#dataPathText').textContent=info.dataPath;
    state=await api('/api/data'); if(state.stock.length)recipeDraft=[{stockId:state.stock[0].id,qty:1}]; renderAll();
  }catch(e){toast('Falha ao iniciar: '+e.message,true);}
})();
