'use strict';

// ── 슬롯 구성 ─────────────────────────────────────────────
const SLOT_GROUPS = [
  { label: '1열 · 11~17', slots: [11, 13, 15, 17] },
  { label: '2열 · 21~27', slots: [21, 23, 25, 27] },
  { label: '3열 · 31~37', slots: [31, 33, 35, 37] },
  { label: '4열 · 40~47', slots: [40, 41, 42, 43, 44, 45, 46, 47] },
  { label: '5열 · 50~57', slots: [50, 51, 52, 53, 54, 55, 56, 57] },
  { label: '6열 · 60~67', slots: [60, 61, 62, 63, 64, 65, 66, 67] },
];
const ALL_SLOTS = SLOT_GROUPS.flatMap(g => g.slots);

// ── 상태 ──────────────────────────────────────────────────
let currentPeriod = 1;       // 1~12 또는 'annual'
let inventory     = {};      // inventory[period][slot] = item
const dirtySlots  = new Set();
let annualData    = null;

// ── 자동계산 ──────────────────────────────────────────────
function salesQty(item) {
  return Math.max(0,
    (item.openingQty  || 0) +
    (item.purchaseQty || 0) -
    (item.closingQty  || 0)
  );
}
function revenue(item) {
  return salesQty(item) * (item.unitPrice || 0);
}
function purchaseCycle(item) {
  const sq   = salesQty(item);
  const once = Math.max(1, item.onceQty || 1);
  if (sq === 0) return '—';
  return Math.round(30 / (sq / once)) + '일';
}
function isLow(item) {
  return !!item.name?.trim() && (item.closingQty || 0) <= 10;
}

// ── 숫자 포맷 ─────────────────────────────────────────────
function fmt(n) {
  return n.toLocaleString('ko-KR');
}
function fmtRevenue(n) {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '억';
  if (n >= 10000)     return Math.floor(n / 10000) + '만' + (n % 10000 ? (n % 10000).toLocaleString() : '');
  return fmt(n);
}

// ── 빈 아이템 ─────────────────────────────────────────────
function emptyItem() {
  return { name: '', unitPrice: 0, openingQty: 0, purchaseQty: 0, closingQty: 0, onceQty: 1, updatedAt: null };
}
function getItem(slot) {
  if (!inventory[currentPeriod])        inventory[currentPeriod] = {};
  if (!inventory[currentPeriod][slot])  inventory[currentPeriod][slot] = emptyItem();
  return inventory[currentPeriod][slot];
}

// ── 데이터 로드 ───────────────────────────────────────────
async function loadPeriod(period) {
  if (inventory[period]) return;
  try {
    const res = await fetch(`/api/inventory/${period}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    inventory[period] = {};
    for (const slot of ALL_SLOTS) {
      inventory[period][slot] = data[slot] || emptyItem();
    }
  } catch {
    showToast('데이터 로드 실패', 'error');
  }
}

async function loadAnnual() {
  try {
    const res = await fetch('/api/annual');
    if (!res.ok) throw new Error();
    annualData = await res.json();
  } catch {
    showToast('연간 데이터 로드 실패', 'error');
  }
}

// ── 회기 선택 ─────────────────────────────────────────────
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    dirtySlots.clear();
    updateHint();

    const val = btn.dataset.period;
    if (val === 'annual') {
      currentPeriod = 'annual';
      await loadAnnual();
      renderAnnual();
    } else {
      currentPeriod = parseInt(val);
      await loadPeriod(currentPeriod);
      renderMonthly();
    }
  });
});

// ── 월별 뷰 렌더 ──────────────────────────────────────────
function renderMonthly() {
  const main = document.getElementById('main');
  main.innerHTML = '';
  main.className = '';
  document.getElementById('btn-save-all').style.display = '';

  const pData = inventory[currentPeriod] || {};

  for (const group of SLOT_GROUPS) {
    const section = document.createElement('section');
    section.className = 'slot-group';

    const hdr = document.createElement('div');
    hdr.className = 'group-header';
    hdr.textContent = group.label;
    section.appendChild(hdr);

    const grid = document.createElement('div');
    grid.className = 'group-grid';
    for (const slot of group.slots) {
      grid.appendChild(buildCard(slot, pData[slot] || emptyItem()));
    }
    section.appendChild(grid);
    main.appendChild(section);
  }
  updateStats();
}

// ── 카드 생성 ─────────────────────────────────────────────
function buildCard(slot, item) {
  const card = document.createElement('div');
  const low  = isLow(item);
  card.className = cardCls(item);
  card.dataset.slot = slot;

  card.innerHTML = `
    <div class="card-top">
      <span class="slot-num">${slot}번</span>
      ${item.name?.trim() && low ? '<span class="badge low">재고부족</span>' : ''}
    </div>
    <input class="name-input" type="text" placeholder="상품명" value="${esc(item.name)}"
      maxlength="20" autocomplete="off" spellcheck="false">
    <div class="price-row">
      <span class="field-lbl">단가</span>
      <input class="price-input" data-field="unitPrice" type="number" inputmode="numeric"
        value="${item.unitPrice || 0}" min="0" placeholder="0">
      <span class="field-unit">원</span>
    </div>
    <div class="qty-grid">
      <span class="field-lbl">기초</span>
      <input class="qty-inp" data-field="openingQty"  type="number" inputmode="numeric" value="${item.openingQty  || 0}" min="0">
      <span class="field-lbl">구입</span>
      <input class="qty-inp" data-field="purchaseQty" type="number" inputmode="numeric" value="${item.purchaseQty || 0}" min="0">
      <span class="field-lbl${low ? ' danger' : ''}">기말</span>
      <input class="qty-inp${low ? ' danger' : ''}" data-field="closingQty" type="number" inputmode="numeric" value="${item.closingQty || 0}" min="0">
      <span class="field-lbl">1회</span>
      <input class="qty-inp" data-field="onceQty" type="number" inputmode="numeric" value="${item.onceQty || 1}" min="1">
    </div>
    <div class="calc-section">
      <div class="calc-row">
        <span class="calc-lbl">판매수량</span>
        <span class="calc-val" id="c-sales-${slot}">${fmt(salesQty(item))}개</span>
      </div>
      <div class="calc-row">
        <span class="calc-lbl">매출액</span>
        <span class="calc-val revenue" id="c-rev-${slot}">${fmt(revenue(item))}원</span>
      </div>
      <div class="calc-row">
        <span class="calc-lbl">구매주기</span>
        <span class="calc-val" id="c-cycle-${slot}">${purchaseCycle(item)}</span>
      </div>
    </div>
    <div class="card-footer">
      <span class="mod-time">${fmtTime(item.updatedAt)}</span>
      <button class="save-btn" type="button">저장</button>
    </div>
  `;

  // 이벤트
  const nameInput = card.querySelector('.name-input');
  nameInput.addEventListener('input', () => {
    getItem(slot).name = nameInput.value;
    markDirty(slot);
    refreshCard(slot);
  });

  card.querySelectorAll('[data-field]').forEach(input => {
    input.addEventListener('change', () => {
      const field = input.dataset.field;
      const v = parseInt(input.value);
      const min = field === 'onceQty' ? 1 : 0;
      getItem(slot)[field] = isNaN(v) ? min : Math.max(min, v);
      input.value = getItem(slot)[field];
      markDirty(slot);
      refreshCard(slot);
    });
  });

  card.querySelector('.save-btn').addEventListener('click', () => saveSlot(slot));
  return card;
}

// ── 카드 CSS 클래스 ────────────────────────────────────────
function cardCls(item, dirty = false) {
  let c = 'slot-card';
  if (!item.name?.trim()) c += ' empty';
  else if (isLow(item))   c += ' low';
  if (dirty) c += ' dirty';
  return c;
}

// ── 카드 갱신 (계산값·배지·색상) ──────────────────────────
function refreshCard(slot) {
  const card = document.querySelector(`.slot-card[data-slot="${slot}"]`);
  if (!card) return;
  const item  = getItem(slot);
  const dirty = dirtySlots.has(slot);
  const low   = isLow(item);

  card.className = cardCls(item, dirty);

  // 배지
  const top = card.querySelector('.card-top');
  const oldBadge = top.querySelector('.badge');
  if (oldBadge) oldBadge.remove();
  if (item.name?.trim() && low) top.insertAdjacentHTML('beforeend', '<span class="badge low">재고부족</span>');

  // 기말 색상
  const closingInput = card.querySelector('[data-field="closingQty"]');
  const closingLabel = closingInput?.previousElementSibling;
  if (closingInput) closingInput.classList.toggle('danger', low);
  if (closingLabel) closingLabel.classList.toggle('danger', low);

  // 계산값
  const sq = salesQty(item);
  const salesEl = document.getElementById(`c-sales-${slot}`);
  const revEl   = document.getElementById(`c-rev-${slot}`);
  const cycleEl = document.getElementById(`c-cycle-${slot}`);
  if (salesEl) salesEl.textContent = fmt(sq) + '개';
  if (revEl)   revEl.textContent   = fmt(revenue(item)) + '원';
  if (cycleEl) cycleEl.textContent = purchaseCycle(item);

  updateStats();
}

// ── 통계 업데이트 ─────────────────────────────────────────
function updateStats() {
  if (currentPeriod === 'annual') return;
  const pData = inventory[currentPeriod] || {};
  let totalSales = 0, totalRevenue = 0, lowCount = 0;
  for (const slot of ALL_SLOTS) {
    const item = pData[slot] || emptyItem();
    if (!item.name?.trim()) continue;
    totalSales   += salesQty(item);
    totalRevenue += revenue(item);
    if (isLow(item)) lowCount++;
  }
  document.getElementById('stat-sales').textContent   = fmt(totalSales) + '개';
  document.getElementById('stat-revenue').textContent = fmtRevenue(totalRevenue) + '원';
  document.getElementById('stat-low').textContent     = lowCount;
}

// ── 연간 합계 뷰 ──────────────────────────────────────────
function renderAnnual() {
  const main = document.getElementById('main');
  main.innerHTML = '';
  main.className = 'annual-view';
  document.getElementById('btn-save-all').style.display = 'none';

  if (!annualData) {
    main.innerHTML = '<p style="padding:2rem;text-align:center;color:#94a3b8">로딩 중...</p>';
    return;
  }

  const LABELS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  let totalSales = 0, totalRevenue = 0;
  const rows = [];

  for (let p = 1; p <= 12; p++) {
    const curr = annualData[p] || { totalSales: 0, totalRevenue: 0 };
    const prev = p > 1 ? (annualData[p - 1] || { totalRevenue: 0 }) : null;
    totalSales   += curr.totalSales;
    totalRevenue += curr.totalRevenue;

    let growthStr = '—', growthCls = '';
    if (prev && prev.totalRevenue > 0) {
      const rate = ((curr.totalRevenue - prev.totalRevenue) / prev.totalRevenue * 100).toFixed(1);
      growthStr = (parseFloat(rate) >= 0 ? '+' : '') + rate + '%';
      growthCls = parseFloat(rate) >= 0 ? 'pos' : 'neg';
    }
    rows.push({ label: LABELS[p - 1], period: p, ...curr, growthStr, growthCls });
  }

  // 연간 헤더 통계
  document.getElementById('stat-sales').textContent   = fmt(totalSales) + '개';
  document.getElementById('stat-revenue').textContent = fmtRevenue(totalRevenue) + '원';
  document.getElementById('stat-low').textContent     = '—';

  const wrap = document.createElement('div');
  wrap.className = 'annual-wrap';

  const title = document.createElement('h2');
  title.className = 'annual-title';
  title.textContent = '연간 매출 합계 (12회기)';
  wrap.appendChild(title);

  const table = document.createElement('table');
  table.className = 'annual-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>회기</th>
        <th>판매수량</th>
        <th>매출액</th>
        <th>전월대비</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => `
        <tr class="${r.totalRevenue > 0 ? '' : 'zero-row'}">
          <td class="td-period">${r.label}</td>
          <td class="td-num">${fmt(r.totalSales)}개</td>
          <td class="td-num td-revenue">${fmt(r.totalRevenue)}원</td>
          <td class="td-num td-growth ${r.growthCls}">${r.growthStr}</td>
        </tr>
      `).join('')}
    </tbody>
    <tfoot>
      <tr>
        <td class="td-total">합계</td>
        <td class="td-num td-total">${fmt(totalSales)}개</td>
        <td class="td-num td-revenue td-total">${fmt(totalRevenue)}원</td>
        <td class="td-num td-total">—</td>
      </tr>
    </tfoot>
  `;
  wrap.appendChild(table);
  main.appendChild(wrap);
}

// ── Dirty 관리 ────────────────────────────────────────────
function markDirty(slot) {
  dirtySlots.add(slot);
  const card = document.querySelector(`.slot-card[data-slot="${slot}"]`);
  if (card) {
    card.classList.add('dirty');
    const btn = card.querySelector('.save-btn');
    if (btn) { btn.className = 'save-btn pending'; btn.textContent = '저장'; btn.disabled = false; }
  }
  updateHint();
}

function markClean(slot, updatedAt) {
  dirtySlots.delete(slot);
  const card = document.querySelector(`.slot-card[data-slot="${slot}"]`);
  if (card) {
    card.classList.remove('dirty');
    const btn = card.querySelector('.save-btn');
    if (btn) {
      btn.className = 'save-btn saved';
      btn.textContent = '저장됨 ✓';
      btn.disabled = false;
      const timeEl = card.querySelector('.mod-time');
      if (timeEl && updatedAt) timeEl.textContent = fmtTime(updatedAt);
      setTimeout(() => {
        if (btn.classList.contains('saved')) {
          btn.className = 'save-btn';
          btn.textContent = '저장';
        }
      }, 2000);
    }
  }
  updateHint();
}

function updateHint() {
  const el = document.getElementById('unsaved-hint');
  el.textContent = dirtySlots.size > 0 ? `⚠ ${dirtySlots.size}개 슬롯 미저장` : '';
}

// ── 저장 ─────────────────────────────────────────────────
async function saveSlot(slot) {
  const card = document.querySelector(`.slot-card[data-slot="${slot}"]`);
  const btn  = card?.querySelector('.save-btn');
  if (btn) { btn.className = 'save-btn saving'; btn.textContent = '저장 중…'; btn.disabled = true; }

  try {
    const res = await fetch(`/api/inventory/${currentPeriod}/${slot}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getItem(slot)),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    getItem(slot).updatedAt = data.updatedAt;
    markClean(slot, data.updatedAt);
  } catch {
    if (btn) { btn.className = 'save-btn pending'; btn.textContent = '저장'; btn.disabled = false; }
    showToast('저장 실패', 'error');
  }
}

// ── 전체 저장 ─────────────────────────────────────────────
document.getElementById('btn-save-all').addEventListener('click', async () => {
  if (dirtySlots.size === 0) { showToast('변경 사항이 없습니다'); return; }

  const btn = document.getElementById('btn-save-all');
  btn.disabled = true;
  btn.textContent = '저장 중…';

  const slotsToSave = [...dirtySlots];
  const payload = {};
  for (const s of slotsToSave) payload[s] = getItem(s);

  try {
    const res = await fetch(`/api/inventory/${currentPeriod}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    const updated = await res.json();
    for (const s of slotsToSave) {
      if (updated[s]) {
        getItem(s).updatedAt = updated[s].updatedAt;
        markClean(s, updated[s].updatedAt);
      }
    }
    showToast(`${slotsToSave.length}개 슬롯 저장 완료!`, 'success');
  } catch {
    showToast('저장 실패', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '전체 저장';
  }
});

// ── 유틸 ─────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '미저장';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show${type ? ' ' + type : ''}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 2500);
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── 서비스 워커 ───────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ── 시작 ─────────────────────────────────────────────────
(async () => {
  await loadPeriod(1);
  renderMonthly();
})();
