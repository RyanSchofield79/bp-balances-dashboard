const https = require('https');

const BASE_URL = 'api-zapier.businesspilot.co.uk';
const API_KEY  = process.env.BP_API_KEY;

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      { hostname: BASE_URL, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': API_KEY,
                   'Content-Length': Buffer.byteLength(payload) } },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('JSON parse error: ' + data.slice(0, 200))); }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function fetchAllContracts() {
  const fetchFrom = new Date();
  fetchFrom.setFullYear(fetchFrom.getFullYear() - 5);
  const fetchFromISO = fetchFrom.toISOString();
  let page = 1;
  const all = [];
  while (true) {
    const resp = await apiPost('/Contracts/find', {
      dateAddedAfter: fetchFromISO,
      page,
      pageSize: 500,
    });
    const items = Array.isArray(resp) ? resp : (resp.data || resp.contracts || []);
    if (!items.length) break;
    all.push(...items);
    if (items.length < 500) break;
    page++;
  }
  return all;
}

exports.handler = async () => {
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'BP_API_KEY not set' }) };
  }
  try {
    const raw = await fetchAllContracts();
    const contracts = raw
      .filter(c => {
        const type = (c.contractType || c.productType || '').toLowerCase();
        if (type.includes('service')) return false;
        const bal = parseFloat(c.balance || c.balanceDue) || 0;
        if (bal <= 0) return false;
        const status = (c.currentStatus || c.contractStatus || '').toLowerCase().trim();
        if (status === 'completed' || status === 'cancelled') return false;
        return true;
      })
      .map(c => ({
        contractNumber:    c.contractNumber || c.id || '',
        customer:          c.customer || c.customerName || '',
        owner:             c.currentOwner || c.assignedTo || '',
        contractType:      c.contractType || c.productType || '',
        netValue:          parseFloat(c.confirmedNetSaleValue) || 0,
        balance:           parseFloat(c.balance || c.balanceDue) || 0,
        contractStatus:    c.currentStatus || c.contractStatus || '',
        contractStatusDate: c.currentStatusDate || c.contractStatusDate || '',
        contractPipeline:  c.contractPipeline || c.pipeline || '',
        contractDate:      c.contractDate || c.dateAdded || '',
        installStart:      c.installStart || '',
        installationType:  c.installationType || '',
      }));
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(contracts),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
};
