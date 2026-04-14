'use strict';
const https = require('https');

const BASE_URL  = 'api-zapier.businesspilot.co.uk';
const PAGE_SIZE = 500;

function apiPost(apiKey, endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: BASE_URL,
      path: `/api${endpoint}`,
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Accept': 'application/json',
      },
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error('JSON parse error: ' + e.message + ' | ' + raw.slice(0, 200))); }
        } else {
          reject(new Error('HTTP ' + res.statusCode + ': ' + raw.slice(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function fetchAllContracts(apiKey) {
  const fetchFrom = new Date();
  fetchFrom.setFullYear(fetchFrom.getFullYear() - 5);
  const fetchFromISO = fetchFrom.toISOString();
  let all = [];
  let page = 1;
  while (true) {
    const resp = await apiPost(apiKey, '/Contracts/find', {
      dateAddedAfter: fetchFromISO,
      page,
      pageSize: PAGE_SIZE,
    });
    const result    = Array.isArray(resp) ? resp[0] : resp;
    const items     = result.items || [];
    const itemCount = result.itemCount || 0;
    if (items.length === 0) break;
    all = all.concat(items);
    if (items.length < PAGE_SIZE) break;
    if (all.length >= itemCount) break;
    page++;
  }
  return all;
}

exports.handler = async () => {
  const API_KEY = process.env.BP_API_KEY;
  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'BP_API_KEY not configured' }),
    };
  }
  try {
    const raw = await fetchAllContracts(API_KEY);

    const mapped = raw.map(c => {
      const lead    = c.lead    || {};
      const contact = lead.contact || {};
      return {
        contractNumber:     String(c.contractNumber || ''),
        customer:           (contact.contactName || contact.companyName || '').trim(),
        owner:              c.currentOwner || '',
        contractType:       lead.leadType || lead.productType1 || '',
        netValue:           parseFloat(c.confirmedNetSaleValue) || 0,
        balance:            parseFloat(c.balance || c.balanceDue) || 0,
        contractStatus:     c.currentStatus || '',
        contractStatusDate: c.currentStatusDate || '',
        contractPipeline:   c.currentPipeline || '',
        contractDate:       c.contractDate || c.dateAdded || '',
        installStart:       c.installStart || '',
        installationType:   lead.productType1 || '',
      };
    });

    const contracts = mapped.filter(c => {
      // Exclude service contracts
      const pipeline = (c.contractPipeline || '').toLowerCase();
      const type     = (c.contractType     || '').toLowerCase();
      if (pipeline.includes('service') || type.includes('service')) return false;
      // Must have a positive balance
      if (c.balance <= 0) return false;
      // Exclude completed / cancelled
      const status = (c.contractStatus || '').toLowerCase().trim();
      if (status === 'completed' || status === 'cancelled') return false;
      return true;
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(contracts),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
