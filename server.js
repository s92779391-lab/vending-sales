const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const ALL_SLOTS = [
  11, 13, 15, 17,
  21, 23, 25, 27,
  31, 33, 35, 37,
  40, 41, 42, 43, 44, 45, 46, 47,
  50, 51, 52, 53, 54, 55, 56, 57,
  60, 61, 62, 63, 64, 65, 66, 67,
];
const ALL_PERIODS = Array.from({ length: 12 }, (_, i) => i + 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── PostgreSQL ──────────────────────────────────────────

const USE_DB = !!process.env.DATABASE_URL;
let pool;

async function initDB() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_inventory (
      period       INTEGER NOT NULL,
      slot         INTEGER NOT NULL,
      name         TEXT    NOT NULL DEFAULT '',
      unit_price   INTEGER NOT NULL DEFAULT 0,
      opening_qty  INTEGER NOT NULL DEFAULT 0,
      purchase_qty INTEGER NOT NULL DEFAULT 0,
      closing_qty  INTEGER NOT NULL DEFAULT 0,
      once_qty     INTEGER NOT NULL DEFAULT 1,
      updated_at   TIMESTAMPTZ,
      PRIMARY KEY (period, slot)
    )
  `);

  // 모든 회기/슬롯 초기화
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const period of ALL_PERIODS) {
      for (const slot of ALL_SLOTS) {
        await client.query(
          `INSERT INTO sales_inventory (period, slot)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [period, slot]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function rowToItem(row) {
  return {
    name:        row.name,
    unitPrice:   row.unit_price,
    openingQty:  row.opening_qty,
    purchaseQty: row.purchase_qty,
    closingQty:  row.closing_qty,
    onceQty:     row.once_qty,
    updatedAt:   row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function dbReadPeriod(period) {
  const { rows } = await pool.query(
    `SELECT slot, name, unit_price, opening_qty, purchase_qty, closing_qty, once_qty, updated_at
     FROM sales_inventory WHERE period=$1 ORDER BY slot`,
    [period]
  );
  const result = {};
  for (const row of rows) result[row.slot] = rowToItem(row);
  return result;
}

async function dbWriteSlot(period, slot, data) {
  const { rows } = await pool.query(
    `INSERT INTO sales_inventory
       (period, slot, name, unit_price, opening_qty, purchase_qty, closing_qty, once_qty, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (period, slot) DO UPDATE SET
       name=$3, unit_price=$4, opening_qty=$5, purchase_qty=$6, closing_qty=$7, once_qty=$8, updated_at=NOW()
     RETURNING *`,
    [period, slot,
     String(data.name || ''),
     Math.max(0, parseInt(data.unitPrice)   || 0),
     Math.max(0, parseInt(data.openingQty)  || 0),
     Math.max(0, parseInt(data.purchaseQty) || 0),
     Math.max(0, parseInt(data.closingQty)  || 0),
     Math.max(1, parseInt(data.onceQty)     || 1)]
  );
  return rowToItem(rows[0]);
}

async function dbWriteMany(period, incoming) {
  const client = await pool.connect();
  const updated = {};
  try {
    await client.query('BEGIN');
    for (const [slotStr, data] of Object.entries(incoming)) {
      const slot = parseInt(slotStr);
      if (!ALL_SLOTS.includes(slot)) continue;
      const { rows } = await client.query(
        `INSERT INTO sales_inventory
           (period, slot, name, unit_price, opening_qty, purchase_qty, closing_qty, once_qty, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT (period, slot) DO UPDATE SET
           name=$3, unit_price=$4, opening_qty=$5, purchase_qty=$6, closing_qty=$7, once_qty=$8, updated_at=NOW()
         RETURNING *`,
        [period, slot,
         String(data.name || ''),
         Math.max(0, parseInt(data.unitPrice)   || 0),
         Math.max(0, parseInt(data.openingQty)  || 0),
         Math.max(0, parseInt(data.purchaseQty) || 0),
         Math.max(0, parseInt(data.closingQty)  || 0),
         Math.max(1, parseInt(data.onceQty)     || 1)]
      );
      if (rows[0]) updated[slot] = rowToItem(rows[0]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return updated;
}

async function dbGetAnnual() {
  const { rows } = await pool.query(`
    SELECT period,
      SUM(GREATEST(0, opening_qty + purchase_qty - closing_qty))              AS total_sales,
      SUM(GREATEST(0, opening_qty + purchase_qty - closing_qty) * unit_price) AS total_revenue
    FROM sales_inventory
    WHERE name <> ''
    GROUP BY period ORDER BY period
  `);
  const result = {};
  for (const p of ALL_PERIODS) result[p] = { totalSales: 0, totalRevenue: 0 };
  for (const row of rows) {
    result[row.period] = {
      totalSales:   parseInt(row.total_sales)   || 0,
      totalRevenue: parseInt(row.total_revenue) || 0,
    };
  }
  return result;
}

// ── JSON 파일 (로컬 개발 폴백) ──────────────────────────

const DATA_FILE = path.join(__dirname, 'data', 'sales.json');

function emptyItem() {
  return { name: '', unitPrice: 0, openingQty: 0, purchaseQty: 0, closingQty: 0, onceQty: 1, updatedAt: null };
}

function initFile() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {};
    for (const p of ALL_PERIODS) {
      initial[p] = {};
      for (const s of ALL_SLOTS) initial[p][s] = emptyItem();
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
  }
}

function fileReadAll() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return {}; }
}

function fileReadPeriod(period) {
  const all = fileReadAll();
  const pd = all[period] || {};
  const result = {};
  for (const s of ALL_SLOTS) result[s] = pd[s] || emptyItem();
  return result;
}

function fileWriteSlot(period, slot, data) {
  const all = fileReadAll();
  if (!all[period]) all[period] = {};
  const item = {
    name:        String(data.name || ''),
    unitPrice:   Math.max(0, parseInt(data.unitPrice)   || 0),
    openingQty:  Math.max(0, parseInt(data.openingQty)  || 0),
    purchaseQty: Math.max(0, parseInt(data.purchaseQty) || 0),
    closingQty:  Math.max(0, parseInt(data.closingQty)  || 0),
    onceQty:     Math.max(1, parseInt(data.onceQty)     || 1),
    updatedAt:   new Date().toISOString(),
  };
  all[period][slot] = item;
  fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2));
  return item;
}

function fileWriteMany(period, incoming) {
  const all = fileReadAll();
  if (!all[period]) all[period] = {};
  const now = new Date().toISOString();
  const updated = {};
  for (const [slotStr, data] of Object.entries(incoming)) {
    const slot = parseInt(slotStr);
    if (!ALL_SLOTS.includes(slot)) continue;
    all[period][slot] = {
      name:        String(data.name || ''),
      unitPrice:   Math.max(0, parseInt(data.unitPrice)   || 0),
      openingQty:  Math.max(0, parseInt(data.openingQty)  || 0),
      purchaseQty: Math.max(0, parseInt(data.purchaseQty) || 0),
      closingQty:  Math.max(0, parseInt(data.closingQty)  || 0),
      onceQty:     Math.max(1, parseInt(data.onceQty)     || 1),
      updatedAt:   now,
    };
    updated[slot] = all[period][slot];
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2));
  return updated;
}

function fileGetAnnual() {
  const all = fileReadAll();
  const result = {};
  for (const p of ALL_PERIODS) {
    const pd = all[p] || {};
    let totalSales = 0, totalRevenue = 0;
    for (const s of ALL_SLOTS) {
      const item = pd[s];
      if (!item?.name) continue;
      const sq = Math.max(0, (item.openingQty || 0) + (item.purchaseQty || 0) - (item.closingQty || 0));
      totalSales   += sq;
      totalRevenue += sq * (item.unitPrice || 0);
    }
    result[p] = { totalSales, totalRevenue };
  }
  return result;
}

// ── API ─────────────────────────────────────────────────

app.get('/api/inventory/:period', async (req, res) => {
  const period = parseInt(req.params.period);
  if (!ALL_PERIODS.includes(period)) return res.status(400).json({ error: 'Invalid period' });
  try {
    res.json(USE_DB ? await dbReadPeriod(period) : fileReadPeriod(period));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '데이터 조회 실패' });
  }
});

app.put('/api/inventory/:period/:slot', async (req, res) => {
  const period = parseInt(req.params.period);
  const slot   = parseInt(req.params.slot);
  if (!ALL_PERIODS.includes(period)) return res.status(400).json({ error: 'Invalid period' });
  if (!ALL_SLOTS.includes(slot))     return res.status(400).json({ error: 'Invalid slot' });
  try {
    const item = USE_DB
      ? await dbWriteSlot(period, slot, req.body)
      : fileWriteSlot(period, slot, req.body);
    res.json(item);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '저장 실패' });
  }
});

app.put('/api/inventory/:period', async (req, res) => {
  const period = parseInt(req.params.period);
  if (!ALL_PERIODS.includes(period)) return res.status(400).json({ error: 'Invalid period' });
  try {
    const updated = USE_DB
      ? await dbWriteMany(period, req.body)
      : fileWriteMany(period, req.body);
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '일괄 저장 실패' });
  }
});

app.get('/api/annual', async (req, res) => {
  try {
    res.json(USE_DB ? await dbGetAnnual() : fileGetAnnual());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '연간 데이터 조회 실패' });
  }
});

// ── 시작 ─────────────────────────────────────────────────

async function start() {
  if (USE_DB) {
    await initDB();
    console.log('✅ PostgreSQL 연결됨');
  } else {
    initFile();
    console.log('📁 JSON 파일 사용 중 (로컬 개발)');
  }
  app.listen(PORT, () => console.log(`🚀 서버 실행 중: http://localhost:${PORT}`));
}

start().catch(err => { console.error(err); process.exit(1); });
